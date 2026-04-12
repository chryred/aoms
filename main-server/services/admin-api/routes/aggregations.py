"""
집계 데이터 관리 — /api/v1/aggregations

1시간/1일/7일/월간 집계 데이터 저장 및 조회.
WF6~WF10이 각 기간별 집계 완료 후 POST로 저장하고,
UI/n8n이 GET으로 조회한다.
"""

from datetime import datetime
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
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


def _naive(dt: Optional[datetime]) -> Optional[datetime]:
    """timezone-aware datetime을 naive로 변환 (DB 컬럼이 timezone-naive)"""
    if dt is not None and dt.tzinfo is not None:
        return dt.replace(tzinfo=None)
    return dt


def _strip_tz(v: Any) -> Any:
    """timezone-aware datetime을 naive UTC로 변환 (DB 컬럼이 TIMESTAMP WITHOUT TIME ZONE)"""
    if isinstance(v, datetime) and v.tzinfo is not None:
        return v.replace(tzinfo=None)
    return v


async def _upsert(
    db: AsyncSession,
    model_cls: Any,
    lookup: dict,
    body: BaseModel,
) -> Any:
    """
    lookup 조건으로 기존 행을 조회하여 있으면 갱신, 없으면 삽입.
    commit + refresh 후 ORM 인스턴스 반환.
    """
    # timezone-aware datetime → naive 변환 (DB 컬럼이 TIMESTAMP WITHOUT TIME ZONE)
    lookup = {k: _strip_tz(v) for k, v in lookup.items()}
    conditions = [getattr(model_cls, k) == v for k, v in lookup.items()]
    existing = await db.execute(select(model_cls).where(and_(*conditions)))
    row = existing.scalar_one_or_none()
    if row:
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(row, field, _strip_tz(value))
    else:
        data = {k: _strip_tz(v) for k, v in body.model_dump().items()}
        row = model_cls(**data)
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


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
        conditions.append(MetricHourlyAggregation.hour_bucket >= _naive(from_dt))
    if to_dt:
        conditions.append(MetricHourlyAggregation.hour_bucket <= _naive(to_dt))
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
    row = await _upsert(db, MetricHourlyAggregation, {
        "system_id": body.system_id,
        "hour_bucket": body.hour_bucket,
        "collector_type": body.collector_type,
        "metric_group": body.metric_group,
    }, body)
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
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(hours=threshold_hours * 2)
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
                MetricHourlyAggregation.hour_bucket >= cutoff,
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
        conditions.append(MetricDailyAggregation.day_bucket >= _naive(from_dt))
    if to_dt:
        conditions.append(MetricDailyAggregation.day_bucket <= _naive(to_dt))
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
    row = await _upsert(db, MetricDailyAggregation, {
        "system_id": body.system_id,
        "day_bucket": body.day_bucket,
        "collector_type": body.collector_type,
        "metric_group": body.metric_group,
    }, body)
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
        conditions.append(MetricWeeklyAggregation.week_start >= _naive(from_dt))
    if to_dt:
        conditions.append(MetricWeeklyAggregation.week_start <= _naive(to_dt))
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
    row = await _upsert(db, MetricWeeklyAggregation, {
        "system_id": body.system_id,
        "week_start": body.week_start,
        "collector_type": body.collector_type,
        "metric_group": body.metric_group,
    }, body)
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
        conditions.append(MetricMonthlyAggregation.period_start >= _naive(from_dt))
    if to_dt:
        conditions.append(MetricMonthlyAggregation.period_start <= _naive(to_dt))
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
    row = await _upsert(db, MetricMonthlyAggregation, {
        "system_id": body.system_id,
        "period_start": body.period_start,
        "period_type": body.period_type,
        "collector_type": body.collector_type,
        "metric_group": body.metric_group,
    }, body)
    return MonthlyAggregationOut.model_validate(row)
