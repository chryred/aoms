"""챗봇 세션/메시지 API (SSE 스트리밍 포함)."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user, require_admin
from database import AsyncSessionLocal, get_db
from models import ChatMessage, ChatSession, System
from schemas import (
    ChatMessageOut, ChatSendIn, ChatSessionOut, ChatSessionPatchIn,
    ScreenContext,
)
from services.chat_agent import run_react_stream

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

from pydantic import BaseModel

ATTACH_ROOT = Path(os.getenv("CHAT_ATTACHMENT_DIR", "/var/lib/synapse-v/chat-attachments"))


class ChatSessionCreateIn(BaseModel):
    system_ids: list[int] = []


async def _ensure_owner(db: AsyncSession, session_id: str, user_id: int) -> ChatSession:
    row = (
        await db.execute(
            select(ChatSession)
            .where(ChatSession.id == session_id)
            .where(ChatSession.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if row is None or row.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="세션을 찾을 수 없습니다.")
    return row


@router.post("/sessions", response_model=ChatSessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: Optional[ChatSessionCreateIn] = None,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    row = ChatSession(
        user_id=user.id,
        title="새 대화",
        area_code="chat_assistant",
        system_ids=(body.system_ids if body else []),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/sessions", response_model=list[ChatSessionOut])
async def list_sessions(
    q: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    stmt = (
        select(ChatSession)
        .where(ChatSession.user_id == user.id)
        .where(ChatSession.deleted_at.is_(None))
        .order_by(ChatSession.updated_at.desc())
        .limit(50)
    )
    if q:
        stmt = stmt.where(ChatSession.title.ilike(f"%{q}%"))
    rows = (await db.execute(stmt)).scalars().all()
    return list(rows)


@router.patch("/sessions/{session_id}", response_model=ChatSessionOut)
async def patch_session(
    session_id: str,
    body: ChatSessionPatchIn,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    session = await _ensure_owner(db, session_id, user.id)
    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(session, field, value)
    await db.commit()
    await db.refresh(session)
    return session


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    session = await _ensure_owner(db, session_id, user.id)
    # soft delete — 데이터 보존 (첨부파일 유지)
    session.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()


@router.post("/sessions/{session_id}/restore", response_model=ChatSessionOut)
async def restore_session(
    session_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)
):
    """소프트 삭제된 세션을 복구 (deleted_at = NULL). 본인 세션만 가능."""
    row = (
        await db.execute(select(ChatSession).where(ChatSession.id == session_id))
    ).scalar_one_or_none()
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="세션을 찾을 수 없습니다.")
    row.deleted_at = None
    await db.commit()
    await db.refresh(row)
    return row


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
                    db, session, payload.content,
                    attachments=attachments,
                    screen_context=payload.screen_context,
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


# ── 챗봇 통계 ─────────────────────────────────────────────────────────────────

class _ChatStatItem(BaseModel):
    system_id: Optional[int]
    system_name: Optional[str]
    session_count: int
    message_count: int
    top1_avg_score: Optional[float]


@router.get("/statistics", response_model=list[_ChatStatItem])
async def get_chat_statistics(
    from_: Optional[str] = Query(default=None, alias="from"),
    to: Optional[str] = Query(default=None),
    group_by: str = Query(default="system"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_admin),
):
    """시스템별 챗봇 사용 통계 (admin 전용).

    쿼리 파라미터:
    - from: 시작일 YYYY-MM-DD (포함)
    - to: 종료일 YYYY-MM-DD (포함, 23:59:59)
    - group_by: 현재는 'system' 만 지원
    """
    # from/to 파싱
    from_dt: Optional[datetime] = None
    to_dt: Optional[datetime] = None
    if from_:
        try:
            from_dt = datetime.strptime(from_, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="from 형식은 YYYY-MM-DD 입니다.")
    if to:
        try:
            to_dt = datetime.strptime(to, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        except ValueError:
            raise HTTPException(status_code=400, detail="to 형식은 YYYY-MM-DD 입니다.")

    # chat_messages LEFT JOIN systems GROUP BY system_id
    stmt = (
        select(
            ChatMessage.system_id,
            System.system_name,
            func.count(ChatMessage.session_id.distinct()).label("session_count"),
            func.count(ChatMessage.id).label("message_count"),
            func.avg(ChatMessage.rag_top1_score).label("top1_avg_score"),
        )
        .outerjoin(System, System.id == ChatMessage.system_id)
        .join(ChatSession, ChatSession.id == ChatMessage.session_id)
        .where(ChatSession.deleted_at.is_(None))
        .group_by(ChatMessage.system_id, System.system_name)
        .order_by(func.count(ChatMessage.id).desc())
    )

    if from_dt:
        stmt = stmt.where(ChatMessage.created_at >= from_dt)
    if to_dt:
        stmt = stmt.where(ChatMessage.created_at <= to_dt)

    rows = (await db.execute(stmt)).all()

    return [
        _ChatStatItem(
            system_id=r.system_id,
            system_name=r.system_name,
            session_count=r.session_count,
            message_count=r.message_count,
            top1_avg_score=float(r.top1_avg_score) if r.top1_avg_score is not None else None,
        )
        for r in rows
    ]
