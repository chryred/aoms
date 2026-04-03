"""
집계 데이터 관리 — /api/v1/aggregations

1시간/1일/7일/월간 집계 데이터 저장 및 조회.
WF6~WF10이 각 기간별 집계 완료 후 POST로 저장하고,
UI/n8n이 GET으로 조회한다.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import (
    MetricDailyAggregation,
    MetricHourlyAggregation,
    MetricMonthlyAggregation,
    MetricWeeklyAggregation,
    System,
)
from schemas import (
    DailyAggregationCreate,
    DailyAggregationOut,
    HourlyAggregationCreate,
    HourlyAggregationOut,
    MonthlyAggregationCreate,
    MonthlyAggregationOut,
    WeeklyAggregationCreate,
    WeeklyAggregationOut,
)

router = APIRouter(prefix="/api/v1/aggregations", tags=["aggregations"])


# ── 1시간 집계 ──────────────────────────────────────────────────────────────

@router.get("/hourly", response_model=list[HourlyAggregationOut])
async def list_hourly(
    system_id: Optional[int] = None,
    collector_type: Optional[str] = None,
    metric_group: Optional[str] = None,
    severity: Optional[str] = None,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """1시간 집계 목록 조회"""
    stmt = select(MetricHourlyAggregation)
    conditions = []
    if system_id is not None:
        conditions.append(MetricHourlyAggregation.system_id == system_id)
    if collector_type:
        conditions.append(MetricHourlyAggregation.collector_type == collector_type)
    if metric_group:
        conditions.append(MetricHourlyAggregation.metric_group == metric_group)
    if severity:
        conditions.append(MetricHourlyAggregation.llm_severity == severity)
    if from_dt:
        conditions.append(MetricHourlyAggregation.hour_bucket >= from_dt)
    if to_dt:
        conditions.append(MetricHourlyAggregation.hour_bucket <= to_dt)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.order_by(MetricHourlyAggregation.hour_bucket.desc()).limit(limit)
    result = await db.execute(stmt)
    return [HourlyAggregationOut.model_validate(r) for r in result.scalars().all()]


@router.get("/hourly/{agg_id}", response_model=HourlyAggregationOut)
async def get_hourly(agg_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MetricHourlyAggregation).where(MetricHourlyAggregation.id == agg_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="집계 데이터를 찾을 수 없습니다.")
    return HourlyAggregationOut.model_validate(row)


@router.post("/hourly", status_code=201, response_model=HourlyAggregationOut)
async def create_hourly(
    body: HourlyAggregationCreate,
    db: AsyncSession = Depends(get_db),
):
    """WF6 호출용 — 1시간 집계 저장 (중복 시 upsert)"""
    existing = await db.execute(
        select(MetricHourlyAggregation).where(
            and_(
                MetricHourlyAggregation.system_id == body.system_id,
                MetricHourlyAggregation.hour_bucket == body.hour_bucket,
                MetricHourlyAggregation.collector_type == body.collector_type,
                MetricHourlyAggregation.metric_group == body.metric_group,
            )
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(row, field, value)
    else:
        row = MetricHourlyAggregation(**body.model_dump())
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return HourlyAggregationOut.model_validate(row)


@router.get("/trend-alert")
async def get_trend_alerts(
    system_id: Optional[int] = None,
    threshold_hours: int = 4,
    db: AsyncSession = Depends(get_db),
):
    """
    llm_prediction이 존재하는 최근 집계 중 임계치 도달이 임박한 항목 조회.
    WF11 및 UI 장애 예방 화면에서 사용.
    """
    from sqlalchemy import text, func as sqlfunc
    stmt = (
        select(
            MetricHourlyAggregation,
            System.display_name,
            System.system_name,
        )
        .join(System, System.id == MetricHourlyAggregation.system_id)
        .where(
            and_(
                MetricHourlyAggregation.llm_prediction.isnot(None),
                MetricHourlyAggregation.llm_severity.in_(["warning", "critical"]),
                MetricHourlyAggregation.hour_bucket >= sqlfunc.now() - text(f"interval '{threshold_hours * 2} hours'"),
            )
        )
        .order_by(MetricHourlyAggregation.hour_bucket.desc())
        .limit(50)
    )
    if system_id:
        stmt = stmt.where(MetricHourlyAggregation.system_id == system_id)
    result = await db.execute(stmt)
    rows = result.all()
    return [
        {
            **HourlyAggregationOut.model_validate(r[0]).model_dump(),
            "display_name": r[1],
            "system_name": r[2],
        }
        for r in rows
    ]


# ── 1일 집계 ──────────────────────────────────────────────────────────────

@router.get("/daily", response_model=list[DailyAggregationOut])
async def list_daily(
    system_id: Optional[int] = None,
    collector_type: Optional[str] = None,
    metric_group: Optional[str] = None,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
    limit: int = 60,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(MetricDailyAggregation)
    conditions = []
    if system_id is not None:
        conditions.append(MetricDailyAggregation.system_id == system_id)
    if collector_type:
        conditions.append(MetricDailyAggregation.collector_type == collector_type)
    if metric_group:
        conditions.append(MetricDailyAggregation.metric_group == metric_group)
    if from_dt:
        conditions.append(MetricDailyAggregation.day_bucket >= from_dt)
    if to_dt:
        conditions.append(MetricDailyAggregation.day_bucket <= to_dt)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.order_by(MetricDailyAggregation.day_bucket.desc()).limit(limit)
    result = await db.execute(stmt)
    return [DailyAggregationOut.model_validate(r) for r in result.scalars().all()]


@router.post("/daily", status_code=201, response_model=DailyAggregationOut)
async def create_daily(
    body: DailyAggregationCreate,
    db: AsyncSession = Depends(get_db),
):
    """WF7 호출용 — 1일 집계 저장"""
    existing = await db.execute(
        select(MetricDailyAggregation).where(
            and_(
                MetricDailyAggregation.system_id == body.system_id,
                MetricDailyAggregation.day_bucket == body.day_bucket,
                MetricDailyAggregation.collector_type == body.collector_type,
                MetricDailyAggregation.metric_group == body.metric_group,
            )
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(row, field, value)
    else:
        row = MetricDailyAggregation(**body.model_dump())
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return DailyAggregationOut.model_validate(row)


# ── 7일 집계 ──────────────────────────────────────────────────────────────

@router.get("/weekly", response_model=list[WeeklyAggregationOut])
async def list_weekly(
    system_id: Optional[int] = None,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(MetricWeeklyAggregation)
    conditions = []
    if system_id is not None:
        conditions.append(MetricWeeklyAggregation.system_id == system_id)
    if from_dt:
        conditions.append(MetricWeeklyAggregation.week_start >= from_dt)
    if to_dt:
        conditions.append(MetricWeeklyAggregation.week_start <= to_dt)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.order_by(MetricWeeklyAggregation.week_start.desc()).limit(limit)
    result = await db.execute(stmt)
    return [WeeklyAggregationOut.model_validate(r) for r in result.scalars().all()]


@router.post("/weekly", status_code=201, response_model=WeeklyAggregationOut)
async def create_weekly(
    body: WeeklyAggregationCreate,
    db: AsyncSession = Depends(get_db),
):
    """WF8 호출용 — 7일 집계 저장"""
    existing = await db.execute(
        select(MetricWeeklyAggregation).where(
            and_(
                MetricWeeklyAggregation.system_id == body.system_id,
                MetricWeeklyAggregation.week_start == body.week_start,
                MetricWeeklyAggregation.collector_type == body.collector_type,
                MetricWeeklyAggregation.metric_group == body.metric_group,
            )
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(row, field, value)
    else:
        row = MetricWeeklyAggregation(**body.model_dump())
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return WeeklyAggregationOut.model_validate(row)


# ── 월/분기/반기/연간 집계 ────────────────────────────────────────────────────

@router.get("/monthly", response_model=list[MonthlyAggregationOut])
async def list_monthly(
    system_id: Optional[int] = None,
    period_type: Optional[str] = None,
    from_dt: Optional[datetime] = None,
    to_dt: Optional[datetime] = None,
    limit: int = 24,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(MetricMonthlyAggregation)
    conditions = []
    if system_id is not None:
        conditions.append(MetricMonthlyAggregation.system_id == system_id)
    if period_type:
        conditions.append(MetricMonthlyAggregation.period_type == period_type)
    if from_dt:
        conditions.append(MetricMonthlyAggregation.period_start >= from_dt)
    if to_dt:
        conditions.append(MetricMonthlyAggregation.period_start <= to_dt)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.order_by(MetricMonthlyAggregation.period_start.desc()).limit(limit)
    result = await db.execute(stmt)
    return [MonthlyAggregationOut.model_validate(r) for r in result.scalars().all()]


@router.post("/monthly", status_code=201, response_model=MonthlyAggregationOut)
async def create_monthly(
    body: MonthlyAggregationCreate,
    db: AsyncSession = Depends(get_db),
):
    """WF9/WF10 호출용 — 월/분기/반기/연간 집계 저장"""
    existing = await db.execute(
        select(MetricMonthlyAggregation).where(
            and_(
                MetricMonthlyAggregation.system_id == body.system_id,
                MetricMonthlyAggregation.period_start == body.period_start,
                MetricMonthlyAggregation.period_type == body.period_type,
                MetricMonthlyAggregation.collector_type == body.collector_type,
                MetricMonthlyAggregation.metric_group == body.metric_group,
            )
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(row, field, value)
    else:
        row = MetricMonthlyAggregation(**body.model_dump())
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return MonthlyAggregationOut.model_validate(row)
