"""
스케줄러 실행 이력 — /api/v1/scheduler-runs

log-analyzer 스케줄러가 매 실행 완료 후 POST로 기록.
관리자는 GET으로 과거 실행 이력(성공/실패)을 조회.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import SchedulerRunHistory
from schemas import SchedulerRunCreate, SchedulerRunOut

router = APIRouter(prefix="/api/v1/scheduler-runs", tags=["scheduler-runs"])

_VALID_TYPES = {"analysis", "hourly", "daily", "weekly", "monthly", "longperiod", "trend"}


@router.post("", status_code=201, response_model=SchedulerRunOut)
async def create_run(
    body: SchedulerRunCreate,
    db: AsyncSession = Depends(get_db),
):
    """log-analyzer 내부 호출 — 스케줄러 실행 결과 기록"""
    row = SchedulerRunHistory(
        scheduler_type=body.scheduler_type,
        started_at=body.started_at,
        finished_at=body.finished_at,
        status=body.status,
        error_count=body.error_count,
        analyzed_count=body.analyzed_count,
        summary_json=body.summary_json,
        error_message=body.error_message,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return SchedulerRunOut.model_validate(row)


@router.get("", response_model=list[SchedulerRunOut])
async def list_runs(
    scheduler_type: Optional[str] = Query(None, description="analysis|hourly|daily|weekly|monthly|longperiod|trend"),
    status: Optional[str] = Query(None, description="ok|error"),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    """스케줄러 실행 이력 조회"""
    stmt = select(SchedulerRunHistory)
    if scheduler_type:
        stmt = stmt.where(SchedulerRunHistory.scheduler_type == scheduler_type)
    if status:
        stmt = stmt.where(SchedulerRunHistory.status == status)
    if date_from:
        stmt = stmt.where(SchedulerRunHistory.started_at >= date_from)
    if date_to:
        stmt = stmt.where(SchedulerRunHistory.started_at <= date_to)
    stmt = stmt.order_by(SchedulerRunHistory.started_at.desc()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return [SchedulerRunOut.model_validate(r) for r in result.scalars().all()]
