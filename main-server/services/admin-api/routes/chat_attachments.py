"""챗봇 메시지 첨부 이미지 업로드/서빙.

저장 경로: CHAT_ATTACHMENT_DIR (기본 /var/lib/synapse-v/chat-attachments) / {session_id} / {uuid}.ext
"""

from __future__ import annotations

import mimetypes
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import ChatSession

router = APIRouter(prefix="/api/v1/chat", tags=["chat-attachments"])

ALLOWED_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_BYTES = int(os.getenv("CHAT_ATTACHMENT_MAX_MB", "10")) * 1024 * 1024
ROOT = Path(os.getenv("CHAT_ATTACHMENT_DIR", "/var/lib/synapse-v/chat-attachments"))


def _ext_for_mime(mime: str) -> str:
    ext = mimetypes.guess_extension(mime) or ".bin"
    # png의 경우 .png만 강제
    if mime == "image/jpeg":
        ext = ".jpg"
    return ext


async def _ensure_owner(db: AsyncSession, session_id: str, user_id: int) -> ChatSession:
    row = (
        await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    ).scalar_one_or_none()
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="세션을 찾을 수 없습니다.")
    return row


@router.post("/sessions/{session_id}/attachments")
async def upload_attachment(
    session_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await _ensure_owner(db, session_id, user.id)
    if file.content_type not in ALLOWED_MIMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"허용되지 않는 MIME: {file.content_type}",
        )
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"최대 {MAX_BYTES // (1024 * 1024)}MB",
        )

    session_dir = ROOT / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    key = f"{uuid.uuid4().hex}{_ext_for_mime(file.content_type)}"
    path = session_dir / key
    path.write_bytes(data)

    return {
        "key": key,
        "mime": file.content_type,
        "size": len(data),
    }


@router.get("/sessions/{session_id}/attachments/{key}")
async def get_attachment(
    session_id: str,
    key: str,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await _ensure_owner(db, session_id, user.id)
    # path traversal 방지
    if "/" in key or "\\" in key or key.startswith("."):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="잘못된 key")
    path = ROOT / session_id / key
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="파일 없음")
    mime, _ = mimetypes.guess_type(str(path))
    return FileResponse(
        path,
        media_type=mime or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=3600"},
    )
