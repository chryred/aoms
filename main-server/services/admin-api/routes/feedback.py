"""
피드백 엔드포인트 — 프론트엔드 React 페이지(/feedback/submit)에서 직접 호출.
"""
import logging
import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AlertFeedback, AlertHistory
from schemas import FeedbackCreateRequest, FeedbackOut, FeedbackUpdateRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])

LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")


async def _propagate_solution_to_qdrant(alert: AlertHistory, solution: str, resolver: str):
    """log-analyzer로 Qdrant 포인트에 해결책 업데이트 전파 (best-effort)"""
    if not alert.qdrant_point_id:
        return
    collection_type = "metric" if alert.alert_type == "metric" else "log"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
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


@router.post("", response_model=FeedbackOut)
async def create_feedback(
    payload: FeedbackCreateRequest,
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

    await _propagate_solution_to_qdrant(alert, payload.solution, payload.resolver)
    return feedback


@router.put("/{feedback_id}", response_model=FeedbackOut)
async def update_feedback(
    feedback_id: int,
    payload: FeedbackUpdateRequest,
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
        if alert:
            await _propagate_solution_to_qdrant(alert, payload.solution, payload.resolver)
    return feedback
