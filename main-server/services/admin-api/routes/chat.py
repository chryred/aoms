"""챗봇 세션/메시지 API (SSE 스트리밍 포함)."""

from __future__ import annotations

import json
import logging
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
    AutoInsightIn, ChatMessageOut, ChatSendIn, ChatSessionOut, ChatSessionPatchIn,
    ScreenContext,
)
from services.chat_agent import run_react_stream
from services.prompts import build_auto_insight_seed

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

from pydantic import BaseModel

_DEFAULT_ATTACH_DIR = Path(__file__).parent.parent.parent / "attaches" / "chat-attachments"
ATTACH_ROOT = Path(os.getenv("CHAT_ATTACHMENT_DIR", str(_DEFAULT_ATTACH_DIR)))


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
    from sqlalchemy import or_

    base = (
        select(ChatSession)
        .where(ChatSession.user_id == user.id)
        .where(ChatSession.deleted_at.is_(None))
    )

    if not q:
        rows = (await db.execute(
            base.order_by(ChatSession.updated_at.desc()).limit(50)
        )).scalars().all()
        return [ChatSessionOut.model_validate(r) for r in rows]

    # q가 있을 때: title ILIKE OR 메시지 본문 ILIKE
    pattern = f"%{q}%"

    message_match_subq = (
        select(ChatMessage.id)
        .where(ChatMessage.session_id == ChatSession.id)
        .where(ChatMessage.role.in_(["user", "assistant"]))
        .where(ChatMessage.content.ilike(pattern))
        .limit(1)
    ).exists()

    stmt = (
        base
        .where(or_(ChatSession.title.ilike(pattern), message_match_subq))
        .order_by(ChatSession.updated_at.desc())
        .limit(50)
    )
    sessions = (await db.execute(stmt)).scalars().all()

    results: list[ChatSessionOut] = []
    for s in sessions:
        out = ChatSessionOut.model_validate(s)
        if q.lower() in (s.title or "").lower():
            out.matched_in = "title"
            out.match_preview = None
        else:
            # 메시지에서 매칭 — 가장 최근 매칭 메시지의 미리보기
            msg = (await db.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == s.id)
                .where(ChatMessage.role.in_(["user", "assistant"]))
                .where(ChatMessage.content.ilike(pattern))
                .order_by(ChatMessage.created_at.desc())
                .limit(1)
            )).scalar_one_or_none()
            if msg and msg.content:
                out.matched_in = "message"
                out.match_preview = _build_match_preview(msg.content, q)
            else:
                out.matched_in = "message"
                out.match_preview = None
        results.append(out)

    return results


def _build_match_preview(content: str, query: str, context_chars: int = 50, max_total: int = 120) -> str:
    """매칭 부분 ±context_chars 컨텍스트로 미리보기 생성. 최대 max_total자."""
    lower_content = content.lower()
    lower_query = query.lower()
    idx = lower_content.find(lower_query)
    if idx < 0:
        return content[:max_total]
    start = max(0, idx - context_chars)
    end = min(len(content), idx + len(query) + context_chars)
    snippet = content[start:end]
    if start > 0:
        snippet = "…" + snippet
    if end < len(content):
        snippet = snippet + "…"
    # 줄바꿈은 공백으로 치환 (단일 줄 미리보기)
    snippet = " ".join(snippet.split())
    if len(snippet) > max_total:
        snippet = snippet[:max_total] + "…"
    return snippet


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
            try:
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

                # 가이드 검색은 ReAct 도구(qdrant_search_guide)로 위임됨.
                # LLM이 질문 의도에 따라 능동적으로 호출하며 텍스트가 컨텍스트에 포함된다.
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


@router.post("/sessions/{session_id}/auto-insight")
async def auto_insight(
    session_id: str,
    payload: AutoInsightIn,
    user=Depends(get_current_user),
):
    """선제적 통찰 — 사용자 메시지 없이 인시던트 자동 분석을 시작합니다 (Feature 5C-2).

    내부적으로 build_auto_insight_seed로 user_message를 자동 생성한 뒤
    기존 run_react_stream을 호출합니다. SSE 응답은 messages 엔드포인트와 동일.
    """
    async def event_generator():
        async with AsyncSessionLocal() as db:
            try:
                session = await _ensure_owner(db, session_id, user.id)
                if session.area_code == "help_inquiry":
                    yield _sse("error", {"message": "auto-insight는 일반 운영자 세션에서만 사용 가능합니다"})
                    return

                # 인시던트 존재 검증
                from models import Incident
                incident = await db.get(Incident, payload.incident_id)
                if not incident:
                    yield _sse("error", {"message": f"Incident #{payload.incident_id} not found"})
                    return

                auto_seed = build_auto_insight_seed(payload.incident_id, payload.screen_context)

                yield _sse("auto_insight_start", {"incident_id": payload.incident_id})
                async for event in run_react_stream(
                    db, session, auto_seed,
                    attachments=None,
                    screen_context=payload.screen_context,
                ):
                    yield _sse(event["type"], event.get("data", {}))
            except Exception as e:  # noqa: BLE001
                logger.exception("auto_insight 스트림 오류")
                yield _sse("error", {"message": f"자동 통찰 실패: {str(e)[:200]}"})

    return StreamingResponse(
        event_generator(),
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
