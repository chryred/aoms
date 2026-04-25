"""단방향 LLM 쿼리 엔드포인트 — Synapse CLI ask 명령어용."""

from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import (
    AlertHistory,
    ChatMessage,
    ChatSession,
    LogAnalysisHistory,
    System,
    User,
)
from services.llm_client import call_llm_text

router = APIRouter(prefix="/api/v1/llm", tags=["llm-query"])

_KST = timezone(timedelta(hours=9))
_CONTEXT_WINDOW_MINUTES = 30


class LlmQueryRequest(BaseModel):
    prompt: str
    system_name: str
    area_code: str = "cli_query"


class LlmQueryResponse(BaseModel):
    answer: str
    session_id: str


async def _build_context(db: AsyncSession, system_name: str) -> str:
    """system_name 기준 최근 알림·분석 요약을 프롬프트 앞에 주입."""
    system = (
        await db.execute(select(System).where(System.system_name == system_name))
    ).scalar_one_or_none()
    if not system:
        return ""

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=_CONTEXT_WINDOW_MINUTES)

    # 최근 미해제 메트릭 알림 5건
    alert_rows = (
        await db.execute(
            select(AlertHistory)
            .where(AlertHistory.system_id == system.id)
            .where(AlertHistory.resolved_at.is_(None))
            .where(AlertHistory.created_at >= cutoff)
            .order_by(AlertHistory.created_at.desc())
            .limit(5)
        )
    ).scalars().all()

    # 최근 로그 분석 5건
    analysis_rows = (
        await db.execute(
            select(LogAnalysisHistory)
            .where(LogAnalysisHistory.system_id == system.id)
            .where(LogAnalysisHistory.created_at >= cutoff)
            .order_by(LogAnalysisHistory.created_at.desc())
            .limit(5)
        )
    ).scalars().all()

    if not alert_rows and not analysis_rows:
        return ""

    parts: list[str] = [f"[{system.display_name} 시스템 최근 현황 (최근 {_CONTEXT_WINDOW_MINUTES}분)]"]

    if alert_rows:
        parts.append("## 활성 메트릭 알림")
        for a in alert_rows:
            fired = a.created_at.replace(tzinfo=timezone.utc).astimezone(_KST).strftime("%H:%M")
            parts.append(f"- [{a.severity}] {a.alertname} ({a.instance_role}) @ {fired}")

    if analysis_rows:
        parts.append("## 로그 분석 결과")
        for r in analysis_rows:
            if r.error_message:
                continue
            ts = r.created_at.replace(tzinfo=timezone.utc).astimezone(_KST).strftime("%H:%M")
            parts.append(f"- [{r.severity}] {r.root_cause or '원인 미상'} ({r.instance_role}) @ {ts}")

    return "\n".join(parts) + "\n\n---\n\n"


async def _get_or_create_cli_session(db: AsyncSession, user_id: int, system_name: str) -> ChatSession:
    """system별 CLI 세션 재사용 (없으면 생성)."""
    title = f"synapse-cli:{system_name}"
    row = (
        await db.execute(
            select(ChatSession)
            .where(ChatSession.user_id == user_id)
            .where(ChatSession.title == title)
            .order_by(ChatSession.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if row is None:
        row = ChatSession(user_id=user_id, title=title, area_code="cli_query")
        db.add(row)
        await db.flush()

    return row


@router.post("/query", response_model=LlmQueryResponse)
async def llm_query(
    request: Request,
    body: LlmQueryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    context = await _build_context(db, body.system_name)
    full_prompt = context + body.prompt

    answer = await call_llm_text(full_prompt, max_tokens=2048, agent_code=body.area_code)
    if answer is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LLM 호출에 실패했습니다. 잠시 후 다시 시도해주세요.",
        )

    session = await _get_or_create_cli_session(db, user.id, body.system_name)

    client_host = request.client.host if request.client else "unknown"
    metadata = {"system_name": body.system_name, "host": client_host}

    db.add(ChatMessage(
        session_id=session.id,
        role="user",
        content=body.prompt,
        tool_args=metadata,
    ))
    db.add(ChatMessage(
        session_id=session.id,
        role="assistant",
        content=answer,
    ))
    await db.commit()

    return LlmQueryResponse(answer=answer, session_id=session.id)
