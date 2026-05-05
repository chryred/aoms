"""Knowledge 관리 API (V1) — 문서 업로드, 운영자 노트, 피드백, 질문 분석.

다른 Track 의존성:
  - log-analyzer V1 엔드포인트 (T2) — 런타임 실패는 허용, import-time 오류 없음
  - knowledge_corrections / knowledge_sync_status 테이블 (T1) — models.py에 이미 존재
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
)
import httpx
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

_LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")
_PROXY_TIMEOUT = 20.0

from auth import get_current_user
from database import get_db
from models import Contact, KnowledgeCorrection, KnowledgeSyncStatus, SystemContact, User
from services import knowledge_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])

# 지원 MIME 타입 — docx/pdf/xlsx/pptx
_ALLOWED_MIMES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
}

# 문서 저장 루트 (운영: Docker 볼륨 마운트)
_DOCS_ROOT = os.getenv("KNOWLEDGE_DOCS_DIR", "/attaches/knowledge-docs")

# 인메모리 job 추적 (단일 프로세스, MVP 단순화)
_jobs: dict[str, dict[str, Any]] = {}

# 질문 빈도 분석 캐시 (5분 TTL)
_FREQ_CACHE_TTL = 300  # 초
_FREQ_CACHE_DATA: dict[str, Any] = {}


# ── 업로드 ─────────────────────────────────────────────────────────────────────

async def _embed_document_background(
    job_id: str,
    file_path: str,
    doc_type: str,
    system_id: int,
    tags: list[str],
) -> None:
    """log-analyzer /embed/document 비동기 호출 (BackgroundTask)."""
    _jobs[job_id]["status"] = "embedding"
    result = await knowledge_service.call_embed_document(file_path, doc_type, system_id, tags)
    if "error" in result:
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"] = result["error"]
    else:
        _jobs[job_id]["status"] = "done"
        _jobs[job_id]["point_count"] = result.get("point_count")


@router.post("/upload", status_code=202)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile,
    system_id: int = Form(...),
    tags: str | None = Form(None),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """파일 저장 → log-analyzer /embed/document 비동기 호출 → job_id 반환.

    지원 포맷: docx / pdf / xlsx / pptx
    저장 경로: {KNOWLEDGE_DOCS_DIR}/{system_id}/{filename}
    """
    if file.content_type not in _ALLOWED_MIMES:
        raise HTTPException(
            status_code=415,
            detail=f"지원하지 않는 파일 형식: {file.content_type}. 지원: pdf, docx, xlsx, pptx",
        )

    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()]

    # 저장 디렉터리 생성
    dest_dir = os.path.join(_DOCS_ROOT, str(system_id))
    os.makedirs(dest_dir, exist_ok=True)

    safe_name = os.path.basename(file.filename or "upload")
    dest_path = os.path.join(dest_dir, safe_name)

    content = await file.read()
    with open(dest_path, "wb") as f:
        f.write(content)

    # doc_type: content_type으로 분류
    _mime_to_doc = {
        "application/pdf": "pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
        "text/plain": "txt",
        "text/markdown": "md",
        "text/x-markdown": "md",
    }
    doc_type = _mime_to_doc.get(file.content_type or "", "unknown")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "file_name": safe_name,
        "system_id": system_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    background_tasks.add_task(
        _embed_document_background,
        job_id,
        dest_path,
        doc_type,
        system_id,
        tag_list,
    )

    return {"job_id": job_id, "status": "queued", "file_name": safe_name}


@router.get("/upload/{job_id}/status")
async def get_upload_status(
    job_id: str,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """업로드 Job 상태 조회."""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job을 찾을 수 없습니다.")
    return job


# ── 운영자 노트 ────────────────────────────────────────────────────────────────

class OperatorNoteCreate(BaseModel):
    question: str
    answer: str
    system_id: int
    source_reference: str | None = None
    tags: list[str] | None = None


class OperatorNoteUpdate(BaseModel):
    question: str
    answer: str
    source_reference: str | None = None
    tags: list[str] | None = None


@router.post("/operator-note", status_code=201)
async def create_operator_note(
    body: OperatorNoteCreate,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """운영자 Q&A 노트를 knowledge 벡터 DB에 저장.

    log-analyzer POST /knowledge/operator-note 호출 → point_id 반환.
    T2 미구현 시 호출 실패를 허용하고 point_id=null 반환.
    """
    point_id = await knowledge_service.call_operator_note(
        question=body.question,
        answer=body.answer,
        system_id=body.system_id,
        source_reference=body.source_reference,
        tags=body.tags,
    )
    return {
        "point_id": str(point_id) if point_id is not None else None,
        "question": body.question,
        "system_id": body.system_id,
        "stored": point_id is not None,
    }


@router.patch("/operator-note/{point_id}")
async def update_operator_note(
    point_id: str,
    body: OperatorNoteUpdate,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """운영자 노트 수정."""
    ok = await knowledge_service.call_update_operator_note(
        point_id=point_id,
        question=body.question,
        answer=body.answer,
        source_reference=body.source_reference,
        tags=body.tags,
    )
    if not ok:
        raise HTTPException(status_code=502, detail="log-analyzer 노트 수정 실패")
    return {"point_id": point_id, "updated": True}


@router.delete("/operator-note/{point_id}")
async def delete_operator_note(
    point_id: str,
    _user: User = Depends(get_current_user),
) -> Response:
    """운영자 노트 삭제."""
    ok = await knowledge_service.call_delete_operator_note(point_id)
    if not ok:
        raise HTTPException(status_code=502, detail="log-analyzer 노트 삭제 실패")
    return Response(status_code=204)


# ── 피드백 (오답 교정) ────────────────────────────────────────────────────────

class FeedbackCreate(BaseModel):
    source_point_id: str           # Qdrant point ID
    source_collection: str         # 'log_incidents' | 'metric_baselines' | ...
    question: str | None = None
    wrong_answer: str | None = None
    correct_answer: str


@router.post("/feedback", status_code=201)
async def create_feedback(
    body: FeedbackCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """오답 교정 피드백 — knowledge_corrections INSERT + log-analyzer /knowledge/correction 호출."""
    correction = KnowledgeCorrection(
        source_point_id=body.source_point_id,
        source_collection=body.source_collection,
        question=body.question,
        wrong_answer=body.wrong_answer,
        correct_answer=body.correct_answer,
        user_id=user.id,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(correction)
    await db.flush()
    correction_id = correction.id
    await db.commit()

    # log-analyzer 전파는 best-effort
    background_tasks.add_task(
        knowledge_service.call_correction,
        body.source_point_id,
        body.source_collection,
        body.correct_answer,
    )

    return {
        "id": correction_id,
        "source_point_id": body.source_point_id,
        "source_collection": body.source_collection,
        "stored": True,
    }


# ── 질문 분석 (chat_messages 기반) ────────────────────────────────────────────

async def _build_question_clusters(
    db: AsyncSession,
    days: int,
    unique_limit: int = 200,
) -> list[dict[str, Any]]:
    """기간 내 전체 질문을 content 기준으로 집계한 뒤 임베딩 클러스터링.

    GROUP BY content로 exact 중복을 DB에서 먼저 합산하므로
    메시지 건수가 많아도 unique_limit(기본 200) 개의 고유 질문만 임베딩한다.
    """
    from datetime import timedelta

    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
    sql = text("""
        SELECT
            cm.content,
            COUNT(*) AS exact_count,
            MAX(cm.created_at) AS last_asked_at,
            AVG(cm.rag_top1_score) AS avg_rag_score
        FROM chat_messages cm
        WHERE cm.role = 'user'
          AND cm.content != ''
          AND cm.created_at >= :since
        GROUP BY cm.content
        ORDER BY COUNT(*) DESC, MAX(cm.created_at) DESC
        LIMIT :limit
    """)
    rows = (await db.execute(sql, {"since": since, "limit": unique_limit})).fetchall()

    if not rows:
        return []

    contents = [row.content for row in rows]
    embeddings = await knowledge_service.call_embed_batch(contents)

    items: list[dict[str, Any]] = [
        {
            "content": row.content,
            "exact_count": int(row.exact_count),
            "last_asked_at": row.last_asked_at.isoformat() if row.last_asked_at else None,
            "avg_rag_score": float(row.avg_rag_score) if row.avg_rag_score is not None else None,
            "embedding": emb,
        }
        for row, emb in zip(rows, embeddings)
    ]

    clusters_raw = knowledge_service.cluster_questions_by_cosine(items, threshold=0.85)

    clusters: list[dict[str, Any]] = []
    for cluster in clusters_raw:
        total_count = sum(c["exact_count"] for c in cluster)
        last_asked = max((c["last_asked_at"] for c in cluster if c["last_asked_at"]), default=None)
        scores = [c["avg_rag_score"] for c in cluster if c["avg_rag_score"] is not None]
        avg_score = sum(scores) / len(scores) if scores else None
        clusters.append({
            "representative": cluster[0]["content"],
            "count": total_count,
            "last_asked_at": last_asked,
            "avg_rag_score": round(avg_score, 4) if avg_score is not None else None,
            "questions": [
                {
                    "content": c["content"],
                    "exact_count": c["exact_count"],
                    "last_asked_at": c["last_asked_at"],
                }
                for c in cluster
            ],
        })

    clusters.sort(key=lambda c: c["count"], reverse=True)
    return clusters


@router.get("/questions/frequent")
async def list_frequent_questions(
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """최근 N일 사용자 질문을 집계하고 유사 질문을 클러스터로 묶어 반환.

    캐시 TTL: 5분. 클러스터링: cosine 유사도 >= 0.85.
    """
    cache_key = f"{days}:clusters"
    now = time.monotonic()
    cached = _FREQ_CACHE_DATA.get(cache_key)
    if cached and (now - cached["ts"]) < _FREQ_CACHE_TTL:
        clusters = cached["data"]
    else:
        clusters = await _build_question_clusters(db, days)
        _FREQ_CACHE_DATA[cache_key] = {"ts": now, "data": clusters}

    total = sum(c["count"] for c in clusters)
    return {"clusters": clusters, "total_questions": total}


# ── 동기화 상태 ────────────────────────────────────────────────────────────────

class SyncStatusUpdate(BaseModel):
    source: str
    last_sync_at: datetime | None = None
    total_synced: int | None = None  # None = 업데이트하지 않음
    last_error: str | None = None
    is_syncing: bool | None = None   # None = 업데이트하지 않음


@router.get("/sync-status")
async def get_sync_status(
    source: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """knowledge_sync_status 조회."""
    stmt = select(KnowledgeSyncStatus)
    if source:
        stmt = stmt.where(KnowledgeSyncStatus.source == source)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "source": r.source,
            "last_sync_at": r.last_sync_at.isoformat() if r.last_sync_at else None,
            "total_synced": r.total_synced,
            "last_error": r.last_error,
            "is_syncing": r.is_syncing,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


@router.post("/sync-status", status_code=200)
async def update_sync_status(
    body: SyncStatusUpdate,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """log-analyzer 스케줄러가 호출 — last_sync_at, total_synced, is_syncing 업데이트 (UPSERT)."""
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    # UPSERT: source가 PK
    row = (
        await db.execute(
            select(KnowledgeSyncStatus).where(KnowledgeSyncStatus.source == body.source)
        )
    ).scalar_one_or_none()

    if row is None:
        row = KnowledgeSyncStatus(
            source=body.source,
            last_sync_at=body.last_sync_at.replace(tzinfo=None) if body.last_sync_at else None,
            total_synced=body.total_synced or 0,
            last_error=body.last_error,
            is_syncing=body.is_syncing if body.is_syncing is not None else False,
            updated_at=now_utc,
        )
        db.add(row)
    else:
        if body.last_sync_at is not None:
            row.last_sync_at = body.last_sync_at.replace(tzinfo=None)
            # 동기화 완료 시에만 결과 필드 갱신
            row.last_error = body.last_error
        if body.total_synced is not None:
            row.total_synced = body.total_synced
        if body.is_syncing is not None:
            row.is_syncing = body.is_syncing
        row.updated_at = now_utc

    await db.commit()
    return {"source": body.source, "updated": True}


# ── 프론트엔드 URL 규칙 맞춤 라우트 (/notes, /corrections, /frequent-questions, /sync/*, /documents) ──

# 운영자 노트 CRUD (/notes 경로)

@router.get("/notes")
async def list_notes(
    system_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """운영자 노트 목록 (log-analyzer Qdrant scroll 프록시)."""
    return await knowledge_service.call_list_operator_notes(
        system_id=system_id,
        limit=min(limit, 100),
        offset=offset,
    )


@router.post("/notes", status_code=201)
async def create_note(
    body: OperatorNoteCreate,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """운영자 노트 생성."""
    point_id = await knowledge_service.call_operator_note(
        question=body.question,
        answer=body.answer,
        system_id=body.system_id,
        source_reference=body.source_reference,
        tags=body.tags,
    )
    return {
        "point_id": str(point_id) if point_id is not None else None,
        "question": body.question,
        "answer": body.answer,
        "system_id": body.system_id,
        "tags": body.tags or [],
        "source_reference": body.source_reference,
        "stored": point_id is not None,
    }


@router.patch("/notes/{point_id}")
async def update_note(
    point_id: str,
    body: OperatorNoteUpdate,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """운영자 노트 수정."""
    ok = await knowledge_service.call_update_operator_note(
        point_id=point_id,
        question=body.question,
        answer=body.answer,
        source_reference=body.source_reference,
        tags=body.tags,
    )
    if not ok:
        raise HTTPException(status_code=502, detail="log-analyzer 노트 수정 실패")
    return {"point_id": point_id, "updated": True}


@router.delete("/notes/{point_id}")
async def delete_note(
    point_id: str,
    _user: User = Depends(get_current_user),
) -> Response:
    """운영자 노트 삭제."""
    ok = await knowledge_service.call_delete_operator_note(point_id)
    if not ok:
        raise HTTPException(status_code=502, detail="log-analyzer 노트 삭제 실패")
    return Response(status_code=204)


# 교정 이력 목록 (/corrections 경로)

@router.get("/corrections")
async def list_corrections(
    q: str | None = None,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """knowledge_corrections 목록 조회 (q: question/correct_answer ILIKE 검색)."""
    from sqlalchemy import func, or_

    stmt = select(KnowledgeCorrection)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                KnowledgeCorrection.question.ilike(like),
                KnowledgeCorrection.correct_answer.ilike(like),
            )
        )
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await db.execute(count_stmt)).scalar_one()

    stmt = stmt.order_by(KnowledgeCorrection.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().all()

    items = [
        {
            "id": r.id,
            "source_point_id": r.source_point_id,
            "source_collection": r.source_collection,
            "question": r.question,
            "correct_answer": r.correct_answer,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
    return {"items": items, "total": total}


# 빈도 질문 (/frequent-questions 경로 — FrequentQuestion[] 배열로 변환)

@router.get("/frequent-questions")
async def list_frequent_questions_v2(
    days: int = 7,
    threshold: int = 3,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """최근 N일 질문 클러스터를 FrequentQuestion[] 배열로 반환.

    threshold 파라미터: 최소 발생 횟수 (클러스터 count >= threshold 필터).
    """
    cache_key = f"{days}:clusters"
    now = time.monotonic()
    cached = _FREQ_CACHE_DATA.get(cache_key)
    if cached and (now - cached["ts"]) < _FREQ_CACHE_TTL:
        clusters = cached["data"]
    else:
        clusters = await _build_question_clusters(db, days)
        _FREQ_CACHE_DATA[cache_key] = {"ts": now, "data": clusters}

    result = []
    for c in clusters:
        if c["count"] < threshold:
            continue
        result.append({
            "representative_query": c["representative"],
            "similar_queries": [q["content"] for q in c.get("questions", [])[1:]],
            "occurrence_count": c["count"],
            "avg_top1_score": c.get("avg_rag_score"),
            "last_asked": c.get("last_asked_at"),
            "category": None,
        })
    return result


# 동기화 (/sync/* 경로)

@router.get("/sync/status")
async def get_sync_status_v2(
    source: str | None = None,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    """동기화 상태 조회 (/sync-status 별칭)."""
    stmt = select(KnowledgeSyncStatus)
    if source:
        stmt = stmt.where(KnowledgeSyncStatus.source == source)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "source": r.source,
            "last_sync_at": r.last_sync_at.isoformat() if r.last_sync_at else None,
            "total_synced": r.total_synced,
            "last_error": r.last_error,
            "is_syncing": r.is_syncing,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in rows
    ]


@router.post("/sync/{source}")
async def trigger_sync(
    source: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Jira/Confluence 동기화 즉시 트리거 (log-analyzer 프록시)."""
    if source not in ("jira", "confluence"):
        raise HTTPException(status_code=400, detail="source는 jira 또는 confluence여야 합니다")

    # 버튼 클릭 즉시 DB에 is_syncing=True 기록 — log-analyzer 콜백과 무관하게 UI가 즉시 비활성화됨
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    row = (
        await db.execute(
            select(KnowledgeSyncStatus).where(KnowledgeSyncStatus.source == source)
        )
    ).scalar_one_or_none()
    if row is None:
        db.add(KnowledgeSyncStatus(source=source, is_syncing=True, updated_at=now_utc))
    else:
        row.is_syncing = True
        row.updated_at = now_utc
    await db.commit()

    result = await knowledge_service.call_trigger_sync(source)
    return result


@router.post("/sync/jira/{issue_key}/force")
async def force_sync_jira_issue(
    issue_key: str,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Jira 단건 이슈 강제 재동기화 (log-analyzer 프록시). 완료까지 대기."""
    result = await knowledge_service.call_force_sync_jira(issue_key)
    if not result.get("synced"):
        raise HTTPException(status_code=502, detail=result.get("error", "force sync 실패"))
    return result


@router.post("/sync/confluence/{page_id}/force")
async def force_sync_confluence_page(
    page_id: str,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Confluence 단건 페이지 강제 재동기화 (log-analyzer 프록시). 완료까지 대기."""
    result = await knowledge_service.call_force_sync_confluence(page_id)
    if not result.get("synced"):
        raise HTTPException(status_code=502, detail=result.get("error", "force sync 실패"))
    return result


# 문서 업로드 (/documents 경로)

@router.post("/documents", status_code=202)
async def upload_document_v2(
    background_tasks: BackgroundTasks,
    file: UploadFile,
    system_id: int = Form(...),
    tags: str | None = Form(None),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """문서 업로드 (/upload 별칭)."""
    if file.content_type not in _ALLOWED_MIMES:
        raise HTTPException(
            status_code=415,
            detail=f"지원하지 않는 파일 형식: {file.content_type}. 지원: pdf, docx, xlsx, pptx",
        )

    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()]

    dest_dir = os.path.join(_DOCS_ROOT, str(system_id))
    os.makedirs(dest_dir, exist_ok=True)
    safe_name = os.path.basename(file.filename or "upload")
    dest_path = os.path.join(dest_dir, safe_name)

    content = await file.read()
    with open(dest_path, "wb") as f:
        f.write(content)

    _mime_to_doc = {
        "application/pdf": "pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
        "text/plain": "txt",
        "text/markdown": "md",
        "text/x-markdown": "md",
    }
    doc_type = _mime_to_doc.get(file.content_type or "", "unknown")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "file_name": safe_name,
        "system_id": system_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    background_tasks.add_task(
        _embed_document_background, job_id, dest_path, doc_type, system_id, tag_list
    )
    return {"job_id": job_id, "status": "queued", "file_name": safe_name}


@router.get("/documents/{job_id}")
async def get_upload_status_v2(
    job_id: str,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """문서 업로드 Job 상태 조회 (/upload/{job_id}/status 별칭)."""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job을 찾을 수 없습니다.")
    return job


# ── 적재 문서 목록 / 삭제 ────────────────────────────────────────────────────────

@router.get("/documents/{file_hash}/chunks")
async def get_document_chunks(
    file_hash: str,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """file_hash 기반 문서 청크 상세 조회 (log-analyzer 프록시).

    응답: { chunks: [{ point_id, chunk_index, text, stored_at, page_no?, ... }] }
    """
    base = _LOG_ANALYZER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=_PROXY_TIMEOUT) as client:
            resp = await client.get(f"{base}/knowledge/documents/{file_hash}/chunks")
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=f"log-analyzer 응답 오류: {resp.status_code}",
                )
            return resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("GET /knowledge/documents/%s/chunks 호출 실패: %s", file_hash, exc)
        raise HTTPException(status_code=502, detail="log-analyzer 연결 실패")


@router.get("/documents")
async def list_documents(
    system_id: int | None = Query(default=None),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Qdrant에 적재된 문서 목록 조회 (log-analyzer 프록시).

    log-analyzer GET /knowledge/documents 를 그대로 전달.
    응답: { items: [{ file_hash, file_name, system_id, chunk_count, uploaded_at }] }
    """
    base = _LOG_ANALYZER_URL.rstrip("/")
    params: dict[str, Any] = {}
    if system_id is not None:
        params["system_id"] = system_id
    try:
        async with httpx.AsyncClient(timeout=_PROXY_TIMEOUT) as client:
            resp = await client.get(f"{base}/knowledge/documents", params=params)
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=f"log-analyzer 응답 오류: {resp.status_code}",
                )
            return resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("GET /knowledge/documents 호출 실패: %s", exc)
        raise HTTPException(status_code=502, detail="log-analyzer 연결 실패")


@router.delete("/documents/{file_hash}", status_code=200)
async def delete_document(
    file_hash: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """file_hash 기반 문서 청크 일괄 삭제 (log-analyzer 프록시).

    권한:
      - admin: 무조건 허용
      - operator: 해당 file_hash 문서의 system_id 에 대한 SystemContact 매핑 담당자만 허용

    처리 순서:
      1. log-analyzer GET /knowledge/documents 에서 file_hash → system_id 조회
      2. 권한 검증 (admin 아닌 경우)
      3. log-analyzer DELETE /knowledge/documents/{file_hash} 호출
    """
    base = _LOG_ANALYZER_URL.rstrip("/")

    # 1) file_hash → system_id 조회
    file_system_id: int | None = None
    if user.role != "admin":
        try:
            async with httpx.AsyncClient(timeout=_PROXY_TIMEOUT) as client:
                resp = await client.get(f"{base}/knowledge/documents")
                if resp.status_code < 400:
                    items = resp.json().get("items") or []
                    for item in items:
                        if item.get("file_hash") == file_hash:
                            file_system_id = item.get("system_id")
                            break
        except Exception as exc:
            logger.warning("문서 목록 조회 실패 (권한 체크): %s", exc)
            raise HTTPException(status_code=502, detail="log-analyzer 연결 실패")

        # 2) 권한 검증
        if file_system_id is None:
            # 문서를 찾을 수 없으면 존재하지 않는 것 (또는 접근 불가)
            raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다")

        # SystemContact 매핑 확인: user → contact → system_contacts
        contact = (
            await db.execute(select(Contact).where(Contact.user_id == user.id))
        ).scalar_one_or_none()
        if contact is None:
            raise HTTPException(status_code=403, detail="담당자 권한이 없습니다")

        system_contact = (
            await db.execute(
                select(SystemContact).where(
                    SystemContact.contact_id == contact.id,
                    SystemContact.system_id == file_system_id,
                )
            )
        ).scalar_one_or_none()
        if system_contact is None:
            raise HTTPException(status_code=403, detail="해당 시스템의 담당자가 아닙니다")

    # 3) log-analyzer DELETE 호출
    try:
        async with httpx.AsyncClient(timeout=_PROXY_TIMEOUT) as client:
            resp = await client.delete(f"{base}/knowledge/documents/{file_hash}")
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다")
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=502,
                    detail=f"log-analyzer 응답 오류: {resp.status_code}",
                )
            return resp.json()
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("DELETE /knowledge/documents/%s 호출 실패: %s", file_hash, exc)
        raise HTTPException(status_code=502, detail="log-analyzer 연결 실패")
