"""
피드백 엔드포인트 — 프론트엔드 React 페이지(/feedback/submit)에서 직접 호출.
"""
import logging
import os

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AlertFeedback, AlertHistory, System
from schemas import (
    FeedbackCreateRequest,
    FeedbackOut,
    FeedbackSearchOut,
    FeedbackSearchResponse,
    FeedbackUpdateRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])

LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")


async def _propagate_solution_to_qdrant(alert: AlertHistory, solution: str, resolver: str):
    """log-analyzer로 Qdrant 포인트에 해결책 업데이트 전파 (best-effort)"""
    if not alert.qdrant_point_id:
        return
    collection_type = "metric" if alert.alert_type == "metric" else "log"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            await client.post(
                f"{LOG_ANALYZER_URL}/solution/update",
                json={
                    "point_id": alert.qdrant_point_id,
                    "collection_type": collection_type,
                    "solution": solution,
                    "resolver": resolver,
                },
            )
    except Exception as exc:
        logger.warning("Qdrant 해결책 업데이트 실패: %s", exc)


@router.get("", response_model=list[FeedbackOut])
async def list_feedbacks(
    alert_history_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """특정 알림에 등록된 피드백 목록 조회 (프론트 상세 패널용)"""
    result = await db.execute(
        select(AlertFeedback)
        .where(AlertFeedback.alert_history_id == alert_history_id)
        .order_by(AlertFeedback.created_at.desc())
    )
    return result.scalars().all()


@router.get("/search", response_model=FeedbackSearchResponse)
async def search_feedbacks(
    system_id: int | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """해결책 검색 — 시스템 + 원인/해결책 키워드 ILIKE"""
    limit = max(1, min(limit, 200))
    offset = max(0, offset)

    conditions = []
    if system_id is not None:
        conditions.append(AlertFeedback.system_id == system_id)
    if q:
        like = f"%{q}%"
        conditions.append(or_(AlertFeedback.error_type.ilike(like), AlertFeedback.solution.ilike(like)))

    base = (
        select(
            AlertFeedback,
            AlertHistory.severity,
            AlertHistory.alert_type,
            AlertHistory.title,
            System.system_name,
            System.display_name,
        )
        .select_from(AlertFeedback)
        .outerjoin(AlertHistory, AlertFeedback.alert_history_id == AlertHistory.id)
        .outerjoin(System, AlertFeedback.system_id == System.id)
    )
    for cond in conditions:
        base = base.where(cond)

    total_stmt = select(func.count()).select_from(AlertFeedback)
    for cond in conditions:
        total_stmt = total_stmt.where(cond)
    total = (await db.execute(total_stmt)).scalar_one()

    rows = (
        await db.execute(
            base.order_by(AlertFeedback.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()

    items = [
        FeedbackSearchOut(
            id=fb.id,
            system_id=fb.system_id,
            alert_history_id=fb.alert_history_id,
            error_type=fb.error_type,
            solution=fb.solution,
            resolver=fb.resolver,
            created_at=fb.created_at,
            severity=severity,
            alert_type=alert_type,
            title=title,
            system_name=system_name,
            system_display_name=display_name,
        )
        for fb, severity, alert_type, title, system_name, display_name in rows
    ]
    return FeedbackSearchResponse(items=items, total=total)


@router.post("", response_model=FeedbackOut)
async def create_feedback(
    payload: FeedbackCreateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """프론트엔드에서 알림 확인 시 해결책 직접 등록"""
    alert = await db.get(AlertHistory, payload.alert_history_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    feedback = AlertFeedback(
        system_id=alert.system_id,
        alert_history_id=alert.id,
        error_type=payload.error_type,
        solution=payload.solution,
        resolver=payload.resolver,
    )
    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)

    # Qdrant 전파는 best-effort — 응답 지연 방지를 위해 백그라운드 실행
    if alert.qdrant_point_id:
        background_tasks.add_task(
            _propagate_solution_to_qdrant, alert, payload.solution, payload.resolver
        )
    return feedback


@router.put("/{feedback_id}", response_model=FeedbackOut)
async def update_feedback(
    feedback_id: int,
    payload: FeedbackUpdateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """기존 피드백 수정 (solution/error_type/resolver)"""
    feedback = await db.get(AlertFeedback, feedback_id)
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")

    feedback.error_type = payload.error_type
    feedback.solution = payload.solution
    feedback.resolver = payload.resolver
    await db.commit()
    await db.refresh(feedback)

    if feedback.alert_history_id is not None:
        alert = await db.get(AlertHistory, feedback.alert_history_id)
        if alert and alert.qdrant_point_id:
            background_tasks.add_task(
                _propagate_solution_to_qdrant, alert, payload.solution, payload.resolver
            )
    return feedback
