"""챗봇 세션/메시지 API (SSE 스트리밍 포함)."""

from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import AsyncSessionLocal, get_db
from models import ChatMessage, ChatSession
from schemas import ChatMessageOut, ChatSendIn, ChatSessionOut
from services.chat_agent import run_react_stream

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

ATTACH_ROOT = Path(os.getenv("CHAT_ATTACHMENT_DIR", "/var/lib/synapse-v/chat-attachments"))


async def _ensure_owner(db: AsyncSession, session_id: str, user_id: int) -> ChatSession:
    row = (
        await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    ).scalar_one_or_none()
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="세션을 찾을 수 없습니다.")
    return row


@router.post("/sessions", response_model=ChatSessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    row = ChatSession(user_id=user.id, title="새 대화", area_code="chat_assistant")
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/sessions", response_model=list[ChatSessionOut])
async def list_sessions(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    rows = (
        await db.execute(
            select(ChatSession)
            .where(ChatSession.user_id == user.id)
            .order_by(ChatSession.updated_at.desc())
            .limit(50)
        )
    ).scalars().all()
    return list(rows)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    session = await _ensure_owner(db, session_id, user.id)
    # 첨부 파일 정리
    folder = ATTACH_ROOT / session_id
    if folder.exists():
        for p in folder.glob("*"):
            try:
                p.unlink()
            except OSError:
                pass
        try:
            folder.rmdir()
        except OSError:
            pass
    await db.delete(session)
    await db.commit()


@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageOut])
async def list_messages(
    session_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    await _ensure_owner(db, session_id, user.id)
    rows = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at)
        )
    ).scalars().all()
    return list(rows)


def _sse(event_type: str, data: dict) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    payload: ChatSendIn,
    user=Depends(get_current_user),
):
    # 소유자 검증은 스트림 내에서 새 세션으로 다시 체크
    async def event_stream():
        # 자체 세션을 만들어 generator 수명과 일치시킴
        async with AsyncSessionLocal() as db:
            session = await _ensure_owner(db, session_id, user.id)
            attachments = []
            for key in (payload.attachment_keys or []):
                # key는 이미 업로드된 상태. size/mime은 파일시스템에서 조회
                p = ATTACH_ROOT / session_id / key
                if not p.exists():
                    continue
                attachments.append(
                    {
                        "type": "image",
                        "key": key,
                        "size": p.stat().st_size,
                    }
                )
            try:
                async for event in run_react_stream(
                    db, session, payload.content, attachments=attachments
                ):
                    yield _sse(event["type"], event.get("data", {}))
            except Exception as e:  # noqa: BLE001
                yield _sse("error", {"message": f"서버 오류: {str(e)[:200]}"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
