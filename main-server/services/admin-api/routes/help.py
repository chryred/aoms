"""현업 담당자용 게스트 채팅 API (인증 없음).

/api/v1/help — 계정 없는 현업 직원이 RAG 챗봇을 사용할 수 있도록 제공하는 공개 엔드포인트.
모든 세션은 area_code='help_inquiry'로 생성되며, 게스트 세션 전용 엔드포인트만 접근 가능.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import ChatMessage, ChatSession, Incident, IncidentTimeline, System
from schemas import ChatMessageOut
from services.chat_agent import run_react_stream

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/help", tags=["help"])

# ── Rate limiting (인메모리, 재시작 시 초기화) ─────────────────────────────────
_SESSION_RATE: dict[str, list[float]] = defaultdict(list)   # ip → timestamps
_MSG_RATE: dict[str, list[float]] = defaultdict(list)       # session_id → timestamps
_RATE_SESSION_MAX = 5   # IP당 분당 최대 세션 생성
_RATE_MSG_MAX = 20      # 세션당 분당 최대 메시지


def _check_rate(store: dict[str, list[float]], key: str, limit: int) -> bool:
    """True=허용, False=차단."""
    now = time.monotonic()
    timestamps = [t for t in store[key] if now - t < 60]
    store[key] = timestamps
    if len(timestamps) >= limit:
        return False
    store[key].append(now)
    return True


# ── 스키마 ────────────────────────────────────────────────────────────────────

class HelpSessionCreate(BaseModel):
    employee_id: str
    email: str | None = None
    system_id: int | None = None

    @field_validator("employee_id")
    @classmethod
    def _not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("employee_id는 비워둘 수 없습니다.")
        return v.strip()


class HelpSessionOut(BaseModel):
    session_id: str
    employee_id: str
    system_id: int | None

    model_config = {"from_attributes": True}


class HelpSendIn(BaseModel):
    content: str


class HelpSystemOut(BaseModel):
    id: int
    system_name: str
    display_name: str
    description: str | None = None

    model_config = {"from_attributes": True}


class HelpEscalateIn(BaseModel):
    description: str | None = None


class HelpEscalateOut(BaseModel):
    incident_id: int
    status: str


# ── 헬퍼 ────────────────────────────────────────────────────────────────────

async def _get_help_session(db: AsyncSession, session_id: str) -> ChatSession:
    row = (
        await db.execute(
            select(ChatSession).where(
                ChatSession.id == session_id,
                ChatSession.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None or row.area_code != "help_inquiry":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="유효하지 않은 게스트 세션입니다.")
    return row


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _sse(event_type: str, data: Any) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ── 엔드포인트 ───────────────────────────────────────────────────────────────

@router.post("/sessions", response_model=HelpSessionOut, status_code=status.HTTP_201_CREATED)
async def create_help_session(
    body: HelpSessionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """게스트 세션 생성. 사번 필수, 이메일/시스템은 선택."""
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate(_SESSION_RATE, client_ip, _RATE_SESSION_MAX):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="잠시 후 다시 시도해주세요.")

    row = ChatSession(
        user_id=None,
        title=f"help:{body.employee_id}",
        area_code="help_inquiry",
        visitor_employee_id=body.employee_id,
        visitor_email=body.email,
        visitor_system_id=body.system_id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return HelpSessionOut(
        session_id=row.id,
        employee_id=row.visitor_employee_id or body.employee_id,
        system_id=row.visitor_system_id,
    )


@router.post("/sessions/{session_id}/messages")
async def send_help_message(
    session_id: str,
    body: HelpSendIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """게스트 SSE 스트리밍 채팅. area_code='help_inquiry' 세션만 허용."""
    if not _check_rate(_MSG_RATE, session_id, _RATE_MSG_MAX):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="잠시 후 다시 시도해주세요.")
    if not body.content.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="내용을 입력해주세요.")

    # 세션 검증 (인증 대신)
    session = await _get_help_session(db, session_id)

    async def _stream():
        try:
            async for event in run_react_stream(db, session, body.content):
                yield _sse(event["type"], event["data"])
        except Exception as exc:  # noqa: BLE001
            logger.error("help SSE 오류: %s", exc)
            yield _sse("error", {"message": "서버 오류가 발생했습니다."})

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/systems", response_model=list[HelpSystemOut])
async def list_help_systems(db: AsyncSession = Depends(get_db)):
    """시스템 카드 목록 (status='active', 인증 불필요)."""
    rows = (
        await db.execute(
            select(System)
            .where(System.status == "active")
            .order_by(System.display_name)
        )
    ).scalars().all()
    return [
        HelpSystemOut(
            id=r.id,
            system_name=r.system_name,
            display_name=r.display_name,
            description=r.description,
        )
        for r in rows
    ]


@router.get("/questions/frequent")
async def get_frequent_questions(
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
):
    """help_inquiry 세션의 자주 묻는 질문 (빈도순)."""
    rows = (
        await db.execute(
            text(
                """
                SELECT cm.content, COUNT(*) AS cnt
                FROM chat_messages cm
                JOIN chat_sessions cs ON cs.id = cm.session_id
                WHERE cs.area_code = 'help_inquiry'
                  AND cm.role = 'user'
                  AND LENGTH(cm.content) <= 200
                GROUP BY cm.content
                ORDER BY cnt DESC
                LIMIT :lim
                """
            ),
            {"lim": max(1, min(limit, 50))},
        )
    ).fetchall()
    return {"questions": [{"content": r[0], "count": r[1]} for r in rows]}


@router.post("/sessions/{session_id}/escalate", response_model=HelpEscalateOut)
async def escalate_help_session(
    session_id: str,
    body: HelpEscalateIn,
    db: AsyncSession = Depends(get_db),
):
    """에스컬레이션: incidents 테이블에 source='help_inquiry' 인시던트 생성."""
    session = await _get_help_session(db, session_id)

    last_user = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id, ChatMessage.role == "user")
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    title = last_user.content[:200] if last_user else "현업 문의 에스컬레이션"

    incident = Incident(
        system_id=session.visitor_system_id,
        title=title,
        severity="warning",
        status="open",
        detected_at=_now_utc(),
        source="help_inquiry",
        alert_count=1,
    )
    db.add(incident)
    await db.flush()

    desc = body.description or f"현업 담당자({session.visitor_employee_id}) 채팅 문의에서 에스컬레이션됨."
    timeline = IncidentTimeline(
        incident_id=incident.id,
        event_type="comment",
        actor_name=session.visitor_employee_id or "guest",
        description=desc,
    )
    db.add(timeline)
    await db.commit()

    return HelpEscalateOut(incident_id=incident.id, status="created")


@router.get("/sessions/{session_id}/messages", response_model=list[ChatMessageOut])
async def get_help_session_messages(
    session_id: str,
    employee_id: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
):
    """게스트 세션 메시지 이력 조회. 사번 일치 및 유효한 게스트 세션만 허용."""
    session = await _get_help_session(db, session_id)

    if session.visitor_employee_id != employee_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="유효하지 않은 게스트 세션입니다.")

    messages = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(ChatMessage.created_at, ChatMessage.id)
        )
    ).scalars().all()

    return messages
