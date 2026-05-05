"""Knowledge Guides API — 챗봇 이미지+텍스트 응답을 위한 가이드 문서 관리.

엔드포인트 목록 (/api/v1/guides prefix):
  GET    /static/{guide_id}/{filename} — 정적 이미지 서빙 (path traversal 방지)
  GET    /                           — 가이드 리스트 (system_id/category/search 필터)
  GET    /{guide_id}                 — 가이드 상세 + 이미지 배열
  POST   /                           — 가이드 생성 (multipart, 이미지 0-5장)
  PUT    /{guide_id}                 — 가이드 수정
  DELETE /{guide_id}                 — 가이드 삭제 (soft 기본, ?hard=true admin only)
  POST   /{guide_id}/images          — 이미지 추가 업로드
  DELETE /{guide_id}/images/{image_id} — 이미지 삭제

Agent B (services/qdrant_guides.py) 콜백 훅은 ImportError swallow 패턴으로 연동됨.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
)
from pydantic import BaseModel
from fastapi.responses import FileResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import Contact, GuideImage, KnowledgeGuide, System, SystemContact, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/guides", tags=["guides"])


class _GuideUpdateBody(BaseModel):
    """PUT /{guide_id} 요청 본문 — JSON application/json."""

    title: Optional[str] = None
    content: Optional[str] = None
    system_id: Optional[int] = None
    category: Optional[str] = None
    tags: Optional[list[str]] = None
    is_active: Optional[bool] = None

# ── 환경 설정 ──────────────────────────────────────────────────────────────────
# 이미지는 KNOWLEDGE_DOCS_DIR/images/{guide_id}/ 서브디렉토리에 저장 (문서 파일과 분리).
# 파일명은 {uuid}.{ext} — 가이드 삭제 시 서브디렉토리 통째로 정리.

_KNOWLEDGE_DOCS_DIR = Path(
    os.getenv("KNOWLEDGE_DOCS_DIR", "/attaches/knowledge-docs")
)
_IMAGES_DIR = _KNOWLEDGE_DOCS_DIR / "images"

_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5MB
_MAX_IMAGES_PER_GUIDE = 5
_ALLOWED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp"}

# ── Agent B (Qdrant) 콜백 훅 — ImportError swallow ─────────────────────────

try:
    from services.qdrant_guides import index_guide, delete_guide_index  # type: ignore
except ImportError:
    index_guide = None  # type: ignore
    delete_guide_index = None  # type: ignore


# ── 내부 헬퍼 ──────────────────────────────────────────────────────────────────

def _file_path_to_url(file_path: str) -> str:
    """저장된 상대 경로 (예: 'images/{guide_id}/{uuid}.png') → /api/v1/guides/static/{guide_id}/{uuid} URL."""
    rel = file_path[len("images/"):]  # '{guide_id}/{uuid}.ext'
    return f"/api/v1/guides/static/{rel}"


def _parse_tags(raw: str | None) -> list[str]:
    """콤마 구분 또는 JSON 배열 문자열 → str 리스트 파싱."""
    if not raw:
        return []
    raw = raw.strip()
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(t).strip() for t in parsed if str(t).strip()]
    except (json.JSONDecodeError, TypeError):
        pass
    return [t.strip() for t in raw.split(",") if t.strip()]


async def _get_contact_for_user(db: AsyncSession, user: User) -> Contact | None:
    """User → Contact 조회 (없으면 None)."""
    return (
        await db.execute(
            select(Contact).where(Contact.user_id == user.id)
        )
    ).scalar_one_or_none()


async def _get_operator_system_ids(db: AsyncSession, contact_id: int) -> set[int]:
    """SystemContact 테이블에서 해당 contact가 담당하는 system_id 목록."""
    rows = (
        await db.execute(
            select(SystemContact.system_id).where(
                SystemContact.contact_id == contact_id
            )
        )
    ).scalars().all()
    return set(rows)


async def _check_can_read_guide(
    db: AsyncSession,
    user: User,
    guide: KnowledgeGuide,
) -> None:
    """읽기 권한 검사: admin은 전체, operator는 자신 시스템 + 공통(NULL)만."""
    if user.role == "admin":
        return
    contact = await _get_contact_for_user(db, user)
    if contact is None:
        raise HTTPException(status_code=403, detail="담당자 등록이 필요합니다")
    if guide.system_id is None:
        return  # 공통 가이드 — 모든 operator 열람 가능
    allowed = await _get_operator_system_ids(db, contact.id)
    if guide.system_id not in allowed:
        raise HTTPException(status_code=403, detail="해당 시스템의 담당자가 아닙니다")


async def _check_can_write_guide(
    db: AsyncSession,
    user: User,
    system_id: int | None,
) -> Contact | None:
    """생성/수정 권한 검사. 권한 없으면 HTTPException. Contact를 반환."""
    if user.role == "admin":
        return await _get_contact_for_user(db, user)
    contact = await _get_contact_for_user(db, user)
    if contact is None:
        raise HTTPException(status_code=403, detail="담당자 등록이 필요합니다")
    if system_id is None:
        # operator는 system_id=NULL(공통) 가이드 등록 불가
        raise HTTPException(status_code=403, detail="operator는 공통(system_id=NULL) 가이드를 등록할 수 없습니다")
    allowed = await _get_operator_system_ids(db, contact.id)
    if system_id not in allowed:
        raise HTTPException(status_code=403, detail="해당 시스템의 담당자가 아닙니다")
    return contact


async def _check_can_modify_guide(
    db: AsyncSession,
    user: User,
    guide: KnowledgeGuide,
    new_system_id: int | None = None,
) -> Contact | None:
    """기존 가이드 수정 권한 검사. admin은 전체. operator는 본인이 created_by & 담당 시스템."""
    if user.role == "admin":
        return await _get_contact_for_user(db, user)
    contact = await _get_contact_for_user(db, user)
    if contact is None:
        raise HTTPException(status_code=403, detail="담당자 등록이 필요합니다")
    if guide.created_by != contact.id:
        raise HTTPException(status_code=403, detail="본인이 등록한 가이드만 수정할 수 있습니다")
    # system_id 변경을 시도하는 경우 새 system_id도 검사
    target_system_id = new_system_id if new_system_id is not None else guide.system_id
    if target_system_id is None:
        raise HTTPException(status_code=403, detail="operator는 공통(system_id=NULL) 가이드를 수정할 수 없습니다")
    allowed = await _get_operator_system_ids(db, contact.id)
    if target_system_id not in allowed:
        raise HTTPException(status_code=403, detail="해당 시스템의 담당자가 아닙니다")
    return contact


async def _check_can_delete_guide(
    db: AsyncSession,
    user: User,
    guide: KnowledgeGuide,
    hard: bool = False,
) -> None:
    """삭제 권한 검사. hard=True는 admin만."""
    if hard and user.role != "admin":
        raise HTTPException(status_code=403, detail="완전 삭제는 관리자만 가능합니다")
    if user.role == "admin":
        return
    contact = await _get_contact_for_user(db, user)
    if contact is None:
        raise HTTPException(status_code=403, detail="담당자 등록이 필요합니다")
    if guide.created_by != contact.id:
        raise HTTPException(status_code=403, detail="본인이 등록한 가이드만 삭제할 수 있습니다")


async def _save_image_file(upload: UploadFile, guide_id: str) -> tuple[str, str]:
    """이미지 파일을 디스크에 저장하고 (file_path, filename) 반환.

    저장 경로: KNOWLEDGE_DOCS_DIR/images/{guide_id}/{uuid}.{ext}
    file_path는 KNOWLEDGE_DOCS_DIR 기준 상대 경로 (예: 'images/{guide_id}/{uuid}.png').
    """
    # MIME 검증
    mime = upload.content_type or ""
    if mime not in _ALLOWED_IMAGE_MIMES:
        raise HTTPException(
            status_code=415,
            detail=f"지원하지 않는 이미지 형식: {mime}. 허용: image/png, image/jpeg, image/webp",
        )

    # 크기 검증
    content = await upload.read()
    if len(content) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"이미지 크기가 5MB를 초과합니다 ({len(content) // 1024 // 1024}MB)",
        )

    # 확장자 결정
    ext_map = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
    ext = ext_map[mime]

    # 저장: images/{guide_id}/{uuid}.{ext}
    filename = f"{uuid.uuid4()}.{ext}"
    guide_dir = _IMAGES_DIR / guide_id
    guide_dir.mkdir(parents=True, exist_ok=True)
    dest = guide_dir / filename

    with open(dest, "wb") as f:
        f.write(content)

    return f"images/{guide_id}/{filename}", filename


def _delete_image_file(file_path: str) -> None:
    """디스크에서 이미지 파일 삭제 (best-effort — 실패 시 warning만)."""
    try:
        full_path = _KNOWLEDGE_DOCS_DIR / file_path
        if full_path.exists():
            full_path.unlink()
    except Exception as exc:
        logger.warning("이미지 파일 삭제 실패 (%s): %s", file_path, exc)


def _delete_guide_images_by_pattern(guide_id: str) -> None:
    """가이드 삭제 시 안전망 — images/{guide_id}/ 디렉토리 전체 삭제.

    DB row 기반의 _delete_image_file 후에도 (예: DB-디스크 동기화 실패 등으로) 잔존
    파일이 남을 수 있으므로 서브디렉토리 통째로 정리.
    """
    try:
        guide_dir = _IMAGES_DIR / guide_id
        if guide_dir.exists():
            shutil.rmtree(guide_dir)
    except Exception as exc:
        logger.warning("가이드 이미지 일괄 삭제 실패 (guide_id=%s): %s", guide_id, exc)


def _guide_image_to_dict(img: GuideImage) -> dict[str, Any]:
    return {
        "id": img.id,
        "guide_id": img.guide_id,
        "url": _file_path_to_url(img.file_path),
        "alt_text": img.alt_text,
        "sort_order": img.sort_order,
        "step_number": img.step_number,
        "created_at": img.created_at.isoformat() if img.created_at else None,
    }


async def _qdrant_index_background(
    guide_id: str,
    title: str,
    content: str,
    system_id: int | None,
    category: str | None = None,
    tags: list[str] | None = None,
    image_count: int = 0,
) -> None:
    """Qdrant 인덱싱 — Agent B services/qdrant_guides.py 연동. 실패 시 swallow."""
    if index_guide is None:
        return
    try:
        await index_guide(guide_id, title, content, system_id, category, tags or [], image_count)
    except Exception as exc:
        logger.warning("Qdrant guide 인덱싱 실패 (guide_id=%s): %s", guide_id, exc)


async def _qdrant_delete_background(guide_id: str) -> None:
    """Qdrant 인덱스 삭제 — Agent B 연동. 실패 시 swallow."""
    if delete_guide_index is None:
        return
    try:
        await delete_guide_index(guide_id)
    except Exception as exc:
        logger.warning("Qdrant guide 인덱스 삭제 실패 (guide_id=%s): %s", guide_id, exc)


# ── 정적 이미지 서빙 ── (가이드 라우트보다 먼저 등록해야 함) ──────────────────

@router.get("/static/{file_path:path}")
async def serve_guide_image(file_path: str) -> FileResponse:
    """가이드 첨부 이미지 서빙.

    경로 형식: {guide_id}/{uuid}.{ext}
    보안: guide_id와 파일명 각각 영문자/숫자/대시/언더스코어/점만 허용 + resolve()로 path traversal 방지.
    """
    if not re.match(r'^[a-zA-Z0-9-]+/[a-zA-Z0-9._-]+$', file_path):
        raise HTTPException(status_code=400, detail="유효하지 않은 파일 경로입니다")
    base = _IMAGES_DIR.resolve()
    dest = (base / file_path).resolve()
    if not str(dest).startswith(str(base)):
        raise HTTPException(status_code=400, detail="경로 탐색이 감지되었습니다")
    if not dest.exists():
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다")
    return FileResponse(dest)


# ── 가이드 리스트 ──────────────────────────────────────────────────────────────

@router.get("")
async def list_guides(
    system_id: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """가이드 리스트.

    권한:
      - admin: 전체 시스템 조회 (is_active=true 만 — 소프트 삭제된 가이드는 숨김)
      - operator: 자신 담당 시스템 + system_id=NULL(공통) 가이드만 (is_active=true)

    system_id 쿼리파라미터:
      - 미전달 / None: 전체 (필터 없음)
      - "null" 문자열: system_id IS NULL (공통 가이드만)
      - 숫자 문자열: 해당 system_id 가이드만
    """
    # system_id 파싱: "null" → IS NULL 필터, 숫자 문자열 → 정수 필터
    system_id_filter: Optional[int] = None
    filter_null_only: bool = False
    if system_id is not None:
        if system_id == "null":
            filter_null_only = True
        else:
            try:
                system_id_filter = int(system_id)
            except ValueError:
                raise HTTPException(status_code=422, detail="system_id는 정수 또는 'null'이어야 합니다")

    # 이미지 수 서브쿼리
    image_count_subq = (
        select(func.count(GuideImage.id).label("cnt"), GuideImage.guide_id.label("gid"))
        .group_by(GuideImage.guide_id)
        .subquery()
    )

    stmt = (
        select(
            KnowledgeGuide,
            System.display_name.label("system_name"),
            func.coalesce(image_count_subq.c.cnt, 0).label("image_count"),
        )
        .outerjoin(System, System.id == KnowledgeGuide.system_id)
        .outerjoin(image_count_subq, image_count_subq.c.gid == KnowledgeGuide.id)
    )

    # admin/operator 모두 active 가이드만 (소프트 삭제 숨김)
    stmt = stmt.where(KnowledgeGuide.is_active.is_(True))

    if user.role != "admin":
        # operator: 자신 담당 시스템 + 공통(NULL) 만
        contact = await _get_contact_for_user(db, user)
        if contact is None:
            return {"items": [], "total": 0}
        allowed_ids = await _get_operator_system_ids(db, contact.id)
        stmt = stmt.where(
            or_(
                KnowledgeGuide.system_id.in_(allowed_ids),
                KnowledgeGuide.system_id.is_(None),
            ),
        )

    # 추가 필터
    if filter_null_only:
        stmt = stmt.where(KnowledgeGuide.system_id.is_(None))
    elif system_id_filter is not None:
        stmt = stmt.where(KnowledgeGuide.system_id == system_id_filter)
    if category:
        stmt = stmt.where(KnowledgeGuide.category == category)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(
            or_(
                KnowledgeGuide.title.ilike(like),
                KnowledgeGuide.content.ilike(like),
            )
        )

    # 전체 건수
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await db.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(KnowledgeGuide.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).all()

    # created_by → 이름 매핑 (Contact → User)
    items = []
    for row in rows:
        guide: KnowledgeGuide = row.KnowledgeGuide
        created_by_name: str | None = None
        if guide.creator and guide.creator.user:
            created_by_name = guide.creator.user.name
        tags = guide.tags or []
        if isinstance(tags, str):
            tags = _parse_tags(tags)
        items.append({
            "id": guide.id,
            "title": guide.title,
            "system_id": guide.system_id,
            "system_name": row.system_name,
            "category": guide.category,
            "tags": tags,
            "is_active": guide.is_active,
            "created_by": guide.created_by,
            "created_by_name": created_by_name,
            "created_at": guide.created_at.isoformat() if guide.created_at else None,
            "updated_at": guide.updated_at.isoformat() if guide.updated_at else None,
            "image_count": row.image_count,
        })

    return {"items": items, "total": total}


# ── 가이드 상세 ────────────────────────────────────────────────────────────────

@router.get("/{guide_id}")
async def get_guide(
    guide_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """가이드 상세 (본문 + steps + images 배열, URL 변환 적용)."""
    guide = await db.get(KnowledgeGuide, guide_id)
    if guide is None or not guide.is_active:
        raise HTTPException(status_code=404, detail="가이드를 찾을 수 없습니다")

    await _check_can_read_guide(db, user, guide)

    # 이미지 목록 (sort_order 순)
    images_rows = (
        await db.execute(
            select(GuideImage)
            .where(GuideImage.guide_id == guide_id)
            .order_by(GuideImage.sort_order, GuideImage.created_at)
        )
    ).scalars().all()

    system_name: str | None = None
    if guide.system and guide.system.display_name:
        system_name = guide.system.display_name

    created_by_name: str | None = None
    if guide.creator and guide.creator.user:
        created_by_name = guide.creator.user.name

    tags = guide.tags or []
    if isinstance(tags, str):
        tags = _parse_tags(tags)

    return {
        "id": guide.id,
        "title": guide.title,
        "content": guide.content,
        "system_id": guide.system_id,
        "system_name": system_name,
        "category": guide.category,
        "tags": tags,
        "steps": guide.steps,
        "is_active": guide.is_active,
        "created_by": guide.created_by,
        "created_by_name": created_by_name,
        "created_at": guide.created_at.isoformat() if guide.created_at else None,
        "updated_at": guide.updated_at.isoformat() if guide.updated_at else None,
        "images": [_guide_image_to_dict(img) for img in images_rows],
    }


# ── 가이드 생성 ────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_guide(
    background_tasks: BackgroundTasks,
    title: str = Form(...),
    content: str = Form(...),
    system_id: Optional[int] = Form(None),
    category: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
    images: list[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """가이드 생성 (multipart/form-data).

    이미지는 0-5장, 파일당 최대 5MB, MIME = image/png|jpeg|webp.
    created_by = 현재 로그인 user의 contact_id.
    """
    # 권한 체크
    contact = await _check_can_write_guide(db, user, system_id)

    # 이미지 장수 검증
    if len(images) > _MAX_IMAGES_PER_GUIDE:
        raise HTTPException(status_code=400, detail=f"이미지는 최대 {_MAX_IMAGES_PER_GUIDE}장까지 첨부 가능합니다")

    tag_list = _parse_tags(tags)

    guide = KnowledgeGuide(
        system_id=system_id,
        title=title,
        content=content,
        category=category,
        tags=tag_list,
        created_by=contact.id if contact else None,
        is_active=True,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(guide)
    await db.flush()  # guide.id 확보

    # 이미지 저장
    saved_images: list[GuideImage] = []
    for i, upload in enumerate(images):
        if upload.filename == "" or upload.size == 0:
            continue
        file_path, _filename = await _save_image_file(upload, guide.id)
        img = GuideImage(
            guide_id=guide.id,
            file_path=file_path,
            alt_text=None,
            sort_order=i,
            step_number=None,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        db.add(img)
        saved_images.append(img)

    await db.commit()
    await db.refresh(guide)

    # Qdrant 인덱싱 (Agent B 연동, best-effort)
    background_tasks.add_task(
        _qdrant_index_background,
        guide.id,
        title,
        content,
        system_id,
        category,
        tag_list,
        len(saved_images),
    )

    return {
        "id": guide.id,
        "title": guide.title,
        "system_id": guide.system_id,
        "category": guide.category,
        "tags": guide.tags or [],
        "created_by": guide.created_by,
        "is_active": guide.is_active,
        "created_at": guide.created_at.isoformat() if guide.created_at else None,
        "image_count": len(saved_images),
    }


# ── 가이드 수정 ────────────────────────────────────────────────────────────────

@router.put("/{guide_id}")
async def update_guide(
    guide_id: str,
    background_tasks: BackgroundTasks,
    body: _GuideUpdateBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """가이드 수정 (application/json).

    권한: admin 전체 / operator는 본인이 created_by & 담당 시스템만.
    """
    guide = await db.get(KnowledgeGuide, guide_id)
    if guide is None:
        raise HTTPException(status_code=404, detail="가이드를 찾을 수 없습니다")

    await _check_can_modify_guide(db, user, guide, new_system_id=body.system_id)

    if body.title is not None:
        guide.title = body.title
    if body.content is not None:
        guide.content = body.content
    if body.system_id is not None:
        guide.system_id = body.system_id
    if body.category is not None:
        guide.category = body.category
    if body.tags is not None:
        guide.tags = body.tags
    if body.is_active is not None:
        guide.is_active = body.is_active

    guide.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    await db.commit()
    await db.refresh(guide)

    # Qdrant 재인덱싱
    background_tasks.add_task(
        _qdrant_index_background,
        guide.id,
        guide.title,
        guide.content,
        guide.system_id,
        guide.category,
        guide.tags or [],
        0,  # image_count: 수정 시 이미지는 별도 엔드포인트로 관리
    )

    return {
        "id": guide.id,
        "title": guide.title,
        "system_id": guide.system_id,
        "category": guide.category,
        "tags": guide.tags or [],
        "is_active": guide.is_active,
        "updated_at": guide.updated_at.isoformat() if guide.updated_at else None,
    }


# ── 가이드 삭제 ────────────────────────────────────────────────────────────────

@router.delete("/{guide_id}")
async def delete_guide(
    guide_id: str,
    background_tasks: BackgroundTasks,
    hard: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """가이드 삭제.

    기본: is_active=false (soft delete).
    ?hard=true: DB row + 디스크 이미지 파일 완전 삭제 (admin only).
    """
    guide = await db.get(KnowledgeGuide, guide_id)
    if guide is None:
        raise HTTPException(status_code=404, detail="가이드를 찾을 수 없습니다")

    await _check_can_delete_guide(db, user, guide, hard=hard)

    if hard:
        # 1차: DB row 기반 디스크 이미지 정리 (정상 경로)
        images_rows = (
            await db.execute(
                select(GuideImage).where(GuideImage.guide_id == guide_id)
            )
        ).scalars().all()
        for img in images_rows:
            _delete_image_file(img.file_path)

        await db.delete(guide)
        await db.commit()

        # 2차: 안전망 — guide_id 패턴으로 디스크에 남은 모든 이미지 일괄 정리
        # (DB-디스크 동기화 누락이 있어도 잔존 파일이 남지 않도록)
        _delete_guide_images_by_pattern(guide_id)

        # Qdrant 인덱스 삭제 (best-effort)
        background_tasks.add_task(_qdrant_delete_background, guide_id)
    else:
        # soft delete
        guide.is_active = False
        guide.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        await db.commit()

    return Response(status_code=204)


# ── 이미지 추가 업로드 ─────────────────────────────────────────────────────────

@router.post("/{guide_id}/images", status_code=201)
async def add_guide_image(
    guide_id: str,
    image: UploadFile = File(...),
    alt_text: Optional[str] = Form(None),
    sort_order: int = Form(0),
    step_number: Optional[int] = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """이미지 개별 추가 업로드.

    권한: 가이드 수정 권한과 동일.
    """
    guide = await db.get(KnowledgeGuide, guide_id)
    if guide is None:
        raise HTTPException(status_code=404, detail="가이드를 찾을 수 없습니다")

    await _check_can_modify_guide(db, user, guide)

    # 기존 이미지 수 검사
    existing_count: int = (
        await db.execute(
            select(func.count(GuideImage.id)).where(GuideImage.guide_id == guide_id)
        )
    ).scalar_one()
    if existing_count >= _MAX_IMAGES_PER_GUIDE:
        raise HTTPException(
            status_code=400,
            detail=f"이미지는 최대 {_MAX_IMAGES_PER_GUIDE}장까지 첨부 가능합니다",
        )

    file_path, _filename = await _save_image_file(image, guide_id)
    img = GuideImage(
        guide_id=guide_id,
        file_path=file_path,
        alt_text=alt_text,
        sort_order=sort_order,
        step_number=step_number,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(img)
    await db.commit()
    await db.refresh(img)

    return _guide_image_to_dict(img)


# ── 이미지 삭제 ────────────────────────────────────────────────────────────────

@router.delete("/{guide_id}/images/{image_id}")
async def delete_guide_image(
    guide_id: str,
    image_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """이미지 삭제 (DB + 디스크 파일)."""
    guide = await db.get(KnowledgeGuide, guide_id)
    if guide is None:
        raise HTTPException(status_code=404, detail="가이드를 찾을 수 없습니다")

    await _check_can_modify_guide(db, user, guide)

    img = (
        await db.execute(
            select(GuideImage).where(
                GuideImage.id == image_id,
                GuideImage.guide_id == guide_id,
            )
        )
    ).scalar_one_or_none()
    if img is None:
        raise HTTPException(status_code=404, detail="이미지를 찾을 수 없습니다")

    _delete_image_file(img.file_path)
    await db.delete(img)
    await db.commit()

    return Response(status_code=204)
