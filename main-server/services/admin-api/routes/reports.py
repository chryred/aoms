"""
집계 리포트 이력 관리 — /api/v1/reports

Teams로 발송된 주기별 리포트(일간/주간/월간/분기/반기/연간) 이력 저장 및 조회.
WF7-WF10이 Teams 발송 완료 후 POST로 기록하고, 중복 발송 방지 및 이력 조회에 활용.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AggregationReportHistory
from routes.aggregations import _upsert
from schemas import ReportHistoryCreate, ReportHistoryOut

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


@router.get("", response_model=list[ReportHistoryOut])
async def list_reports(
    report_type: Optional[str] = None,
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
):
    """발송된 리포트 이력 조회"""
    stmt = select(AggregationReportHistory)
    if report_type:
        stmt = stmt.where(AggregationReportHistory.report_type == report_type)
    stmt = stmt.order_by(AggregationReportHistory.sent_at.desc()).limit(limit)
    result = await db.execute(stmt)
    return [ReportHistoryOut.model_validate(r) for r in result.scalars().all()]


@router.get("/{report_id}", response_model=ReportHistoryOut)
async def get_report(report_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AggregationReportHistory).where(AggregationReportHistory.id == report_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="리포트 이력을 찾을 수 없습니다.")
    return ReportHistoryOut.model_validate(row)


@router.post("", status_code=201, response_model=ReportHistoryOut)
async def create_report(
    body: ReportHistoryCreate,
    db: AsyncSession = Depends(get_db),
):
    """WF7-WF10 호출용 — 리포트 발송 기록 저장 (동일 report_type + period_start 중복 시 업데이트)"""
    row = await _upsert(db, AggregationReportHistory, {
        "report_type": body.report_type,
        "period_start": body.period_start,
    }, body)
    return ReportHistoryOut.model_validate(row)
