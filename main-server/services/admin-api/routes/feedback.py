"""
피드백 엔드포인트 — Wave 2A 이후 구조 변경.

유지:
  POST   /upload                     — 첨부파일 임시 업로드 (staging)  [유지]
  GET    /attachments/{file_path}    — 첨부파일 서빙                  [유지]

410 Gone (인시던트 단위 엔드포인트로 이전):
  GET    /search                     → GET /api/v1/incidents/feedback/search
  GET    /                           → GET /api/v1/incidents/{id}/feedback
  POST   /                           → POST /api/v1/incidents/{id}/feedback
  POST   /{id}/approve               → POST /api/v1/incidents/{incident_id}/feedback/{id}/approve
  POST   /{id}/reject                → POST /api/v1/incidents/{incident_id}/feedback/{id}/reject
  POST   /{id}/resubmit              → POST /api/v1/incidents/{incident_id}/feedback/{id}/resubmit

삭제 (인시던트 단위로 이전):
  GET    /{feedback_id}              → 인시던트 단위 목록으로 통합
  GET    /pending                    → GET /api/v1/incidents/feedback/pending
"""
import logging
import os
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from auth import get_current_user
from schemas import FeedbackUploadResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])

# ── 파일 업로드 상수 ──────────────────────────────────────────────────────────
_KNOWLEDGE_DOCS_DIR = Path(os.getenv("KNOWLEDGE_DOCS_DIR", "/attaches/knowledge-docs"))
_FEEDBACK_ATTACH_DIR = _KNOWLEDGE_DOCS_DIR / "feedback"
_MAX_ATTACH_BYTES = 10 * 1024 * 1024  # 10MB
_MAX_ATTACHMENTS_PER_FEEDBACK = 10
_ALLOWED_ATTACH_MIMES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",   # xlsx
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
    "text/plain",
}


# ── 파일 업로드 헬퍼 ─────────────────────────────────────────────────────────

def _staging_dir() -> Path:
    d = _FEEDBACK_ATTACH_DIR / "staging"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── 첨부파일 업로드 (staging) ─────────────────────────────────────────────────

@router.post("/upload", response_model=FeedbackUploadResponse)
async def upload_feedback_attachment(
    file: UploadFile = File(...),
    _user=Depends(get_current_user),
):
    """첨부파일 임시 업로드 → staging 저장 후 file_path 반환.

    이 시점에는 feedback_id가 없으므로 staging/ 에 보관.
    POST /feedback 또는 POST /{id}/resubmit 호출 시 정식 위치로 이동.
    """
    mime = file.content_type or ""
    if mime not in _ALLOWED_ATTACH_MIMES:
        raise HTTPException(
            status_code=415,
            detail=f"지원하지 않는 파일 형식: {mime}",
        )

    content = await file.read()
    if len(content) > _MAX_ATTACH_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"파일 크기가 10MB를 초과합니다 ({len(content) // 1024 // 1024}MB)",
        )

    ext_map = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
        "application/pdf": "pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "text/plain": "txt",
    }
    ext = ext_map.get(mime, "bin")
    filename = f"{uuid.uuid4()}.{ext}"
    staging = _staging_dir()
    dest = staging / filename
    with open(dest, "wb") as f:
        f.write(content)

    # file_path는 KNOWLEDGE_DOCS_DIR 기준 상대경로
    rel_path = f"feedback/staging/{filename}"
    original_filename = file.filename or filename

    return FeedbackUploadResponse(file_path=rel_path, original_filename=original_filename)


# ── 첨부파일 서빙 ─────────────────────────────────────────────────────────────

@router.get("/attachments/{file_path:path}")
async def serve_feedback_attachment(file_path: str) -> FileResponse:
    """저장된 첨부파일 서빙.

    경로 형식: feedback/{id}/{uuid}.{ext}
    보안: resolve()로 path traversal 방지 + KNOWLEDGE_DOCS_DIR/feedback/ 하위 파일만 허용.
    인증 불필요 — 브라우저가 <img src> / <a href download> 로 직접 요청 (JWT 헤더 첨부 불가).
    (guides.py serve_guide_image과 동일 패턴)
    """
    # 허용 패턴: feedback/{숫자 또는 staging}/{uuid}.{ext}
    if not re.match(r'^feedback/(?:\d+|staging)/[a-zA-Z0-9._-]+$', file_path):
        raise HTTPException(status_code=400, detail="유효하지 않은 파일 경로입니다")
    base = _FEEDBACK_ATTACH_DIR.resolve()
    # file_path는 "feedback/{id}/..." 형태 — _KNOWLEDGE_DOCS_DIR 기준 상대경로
    dest = (_KNOWLEDGE_DOCS_DIR / file_path).resolve()
    if not str(dest).startswith(str(base)):
        raise HTTPException(status_code=400, detail="경로 탐색이 감지되었습니다")
    if not dest.exists():
        raise HTTPException(status_code=404, detail="첨부파일을 찾을 수 없습니다")
    return FileResponse(dest)


# ── 승인 대기 목록 — 410 Gone ──────────────────────────────────────────────────

@router.get("/pending")
async def list_pending_feedbacks_gone():
    """이전됨: GET /api/v1/incidents/feedback/pending 사용."""
    raise HTTPException(
        status_code=410,
        detail="Endpoint deprecated. Use GET /api/v1/incidents/feedback/pending instead.",
    )


# ── 해결책 검색 — 410 Gone ────────────────────────────────────────────────────

@router.get("/search")
async def search_feedbacks_gone():
    """이전됨: GET /api/v1/incidents/feedback/search 사용."""
    raise HTTPException(
        status_code=410,
        detail="Endpoint deprecated. Use GET /api/v1/incidents/feedback/search instead.",
    )


# ── 피드백 목록 — 410 Gone ────────────────────────────────────────────────────

@router.get("")
async def list_feedbacks_gone():
    """이전됨: GET /api/v1/incidents/{incident_id}/feedback 사용."""
    raise HTTPException(
        status_code=410,
        detail="Endpoint deprecated. Use GET /api/v1/incidents/{incident_id}/feedback instead.",
    )


# ── 단건 조회 — 410 Gone ──────────────────────────────────────────────────────

@router.get("/{feedback_id}")
async def get_feedback_gone(feedback_id: int):
    """이전됨: GET /api/v1/incidents/{incident_id}/feedback 사용."""
    raise HTTPException(
        status_code=410,
        detail="Endpoint deprecated. Use GET /api/v1/incidents/{incident_id}/feedback instead.",
    )


# ── 피드백 등록 — 410 Gone ────────────────────────────────────────────────────

@router.post("")
async def create_feedback_gone():
    """이전됨: POST /api/v1/incidents/{incident_id}/feedback 사용."""
    raise HTTPException(
        status_code=410,
        detail="Endpoint deprecated. Use POST /api/v1/incidents/{id}/feedback instead.",
    )


# ── 피드백 수정 — 410 Gone ────────────────────────────────────────────────────

@router.put("/{feedback_id}")
async def update_feedback_gone(feedback_id: int):
    """이전됨: PUT 수정은 인시던트 단위 엔드포인트를 사용하세요."""
    raise HTTPException(
        status_code=410,
        detail="Endpoint deprecated. Use incident-level feedback endpoints instead.",
    )


# ── 승인 — 410 Gone ───────────────────────────────────────────────────────────

@router.post("/{feedback_id}/approve")
async def approve_feedback_gone(feedback_id: int):
    """이전됨: POST /api/v1/incidents/{incident_id}/feedback/{id}/approve 사용."""
    raise HTTPException(
        status_code=410,
        detail="Endpoint deprecated. Use POST /api/v1/incidents/{incident_id}/feedback/{id}/approve instead.",
    )


# ── 반려 — 410 Gone ───────────────────────────────────────────────────────────

@router.post("/{feedback_id}/reject")
async def reject_feedback_gone(feedback_id: int):
    """이전됨: POST /api/v1/incidents/{incident_id}/feedback/{id}/reject 사용."""
    raise HTTPException(
        status_code=410,
        detail="Endpoint deprecated. Use POST /api/v1/incidents/{incident_id}/feedback/{id}/reject instead.",
    )


# ── 재등록 — 410 Gone ─────────────────────────────────────────────────────────

@router.post("/{feedback_id}/resubmit")
async def resubmit_feedback_gone(feedback_id: int):
    """이전됨: POST /api/v1/incidents/{incident_id}/feedback/{id}/resubmit 사용."""
    raise HTTPException(
        status_code=410,
        detail="Endpoint deprecated. Use POST /api/v1/incidents/{incident_id}/feedback/{id}/resubmit instead.",
    )
