"""
집계 데이터 관리 — /api/v1/aggregations

1시간/1일/7일/월간 집계 데이터 저장 및 조회.
WF6~WF10이 각 기간별 집계 완료 후 POST로 저장하고,
UI/n8n이 GET으로 조회한다.
"""

import os
import logging
import os
from datetime import datetime
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)
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

_PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "").rstrip("/")

router = APIRouter(prefix="/api/v1/aggregations", tags=["aggregations"])

# ── Prometheus range query용 PromQL 맵 (instant, 1분 단위) ─────────────────
RANGE_PROMQL_MAP: dict[str, dict[str, dict[str, str]]] = {
    "synapse_agent": {
        "cpu": {
            "cpu_avg": 'avg(cpu_usage_percent{{system_name="{sn}",core="total"}})',
            "cpu_max": 'max(cpu_usage_percent{{system_name="{sn}",core="total"}})',
            "cpu_p95": 'quantile(0.95, cpu_usage_percent{{system_name="{sn}",core="total"}})',
            "load1":   'avg(cpu_load_avg{{system_name="{sn}",interval="1m"}})',
            "load5":   'avg(cpu_load_avg{{system_name="{sn}",interval="5m"}})',
        },
        "memory": {
            "mem_used_pct": 'avg(memory_used_bytes{{system_name="{sn}",type="used"}}) / ignoring(type) avg(memory_used_bytes{{system_name="{sn}",type="total"}}) * 100',
            "mem_p95":      'quantile(0.95, memory_used_bytes{{system_name="{sn}",type="used"}}) / ignoring(type) avg(memory_used_bytes{{system_name="{sn}",type="total"}}) * 100',
        },
        "disk": {
            "disk_read_mb":  'avg(rate(disk_bytes_total{{system_name="{sn}",direction="read"}}[5m])) / 1048576',
            "disk_write_mb": 'avg(rate(disk_bytes_total{{system_name="{sn}",direction="write"}}[5m])) / 1048576',
            "disk_io_ms":    'avg(disk_io_time_ms{{system_name="{sn}"}})',
        },
        "network": {
            "net_rx_mb":   'avg(rate(network_bytes_total{{system_name="{sn}",direction="rx"}}[5m])) / 1048576',
            "net_tx_mb":   'avg(rate(network_bytes_total{{system_name="{sn}",direction="tx"}}[5m])) / 1048576',
            "net_max_mbps": 'max(network_speed_mbps{{system_name="{sn}"}}) / 8',
        },
        "log": {
            "log_errors":     'count(log_error_total{{system_name="{sn}"}})',
            "log_errors_err": 'count(log_error_total{{system_name="{sn}",level="ERROR"}})',
        },
        "web": {
            "req_total":   'increase(http_request_total{{system_name="{sn}"}}[5m])',
            "req_slow":    'increase(http_request_slow_total{{system_name="{sn}"}}[5m])',
            "resp_avg_ms": 'avg(http_request_duration_ms{{system_name="{sn}"}})',
        },
    },
    "db_exporter": {
        "db_connections": {
            "conn_active_pct": 'avg(db_connections_active_percent{{system_name="{sn}"}})',
            "conn_max":        'max(db_connections_active{{system_name="{sn}"}})',
        },
        "db_query": {
            "tps":          'avg(db_transactions_per_second{{system_name="{sn}"}})',
            "slow_queries": 'avg(rate(db_slow_queries_total{{system_name="{sn}"}}[5m])) * 300',
        },
        "db_cache": {
            "cache_hit_rate": 'avg(db_cache_hit_rate_percent{{system_name="{sn}"}})',
        },
        "db_replication": {
            "repl_lag_sec": 'max(db_replication_lag_seconds{{system_name="{sn}"}})',
        },
    },
}


# ── Prometheus live-summary용 instant query 맵 ────────────────────────────
# 수치 판정 그룹(cpu/memory/db_connections/db_cache): avg_over_time 5분 평균 사용
# 나머지 그룹: 데이터 유무 확인용 쿼리
PCT_PROMQL: dict[str, dict[str, str]] = {
    "synapse_agent": {
        "cpu":     'avg(avg_over_time(cpu_usage_percent{{system_name="{sn}",core="total"}}[5m]))',
        "memory":  'avg(avg_over_time(memory_used_bytes{{system_name="{sn}",type="used"}}[5m])) / ignoring(type) avg(memory_used_bytes{{system_name="{sn}",type="total"}}) * 100',
        "disk":    'avg(disk_io_time_ms{{system_name="{sn}"}})',
        "network": 'avg(rate(network_bytes_total{{system_name="{sn}",direction="rx"}}[5m]))',
        "log":     'count(log_error_total{{system_name="{sn}"}})',
        "web":     'increase(http_request_total{{system_name="{sn}"}}[5m])',
    },
    "db_exporter": {
        "db_connections": 'avg(avg_over_time(db_connections_active_percent{{system_name="{sn}"}}[5m]))',
        "db_query":       'avg(db_transactions_per_second{{system_name="{sn}"}})',
        "db_cache":       'avg(db_cache_hit_rate_percent{{system_name="{sn}"}})',
        "db_replication": 'max(db_replication_lag_seconds{{system_name="{sn}"}})',
    },
}

# 대시보드 상태 판정용 임계치 — 프론트엔드 DashboardSystemDetailPage와 동일
METRIC_THRESHOLDS: dict[str, dict[str, dict[str, float]]] = {
    "synapse_agent": {
        "cpu":    {"warning": 60, "critical": 80, "direction": 1},  # high_bad
        "memory": {"warning": 60, "critical": 80, "direction": 1},
    },
    "db_exporter": {
        "db_connections": {"warning": 60, "critical": 80, "direction": 1},
        "db_cache":       {"warning": 80, "critical": 95, "direction": -1},  # low_bad
    },
}


def _naive(dt: Optional[datetime]) -> Optional[datetime]:
    """timezone-aware datetime을 KST naive로 변환.
    DB의 hour_bucket은 KST naive로 저장되므로, UTC 입력을 +9h 변환 후 tzinfo 제거한다."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        from datetime import timezone, timedelta
        kst = timezone(timedelta(hours=9))
        return dt.astimezone(kst).replace(tzinfo=None)
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


# ── Prometheus 1분 단위 range query ─────────────────────────────────────────

# 이 router는 prefix="/api/v1/aggregations" 이지만 시스템별 메트릭 range는
# /api/v1/systems/{id}/metrics/range 경로로 agents router에 추가하면 혼선이 생기므로
# 별도 router를 사용한다.
_metrics_router = APIRouter(prefix="/api/v1/systems", tags=["metrics-range"])


@_metrics_router.get("/{system_id}/metrics/range")
async def get_metrics_range(
    system_id: int,
    collector_type: str,
    metric_group: str,
    start_dt: str,
    end_dt: str,
    step: int = 60,
    db: AsyncSession = Depends(get_db),
):
    """
    Prometheus query_range로 1분 단위 메트릭 조회.
    HourlyAggregation-compatible dict list 반환 (프론트엔드 MetricChart 재사용).
    PROMETHEUS_URL 미설정 시 빈 목록 반환.
    """
    import json as _json
    import httpx
    from datetime import timezone

    # 모듈 로드 시 환경변수가 없었을 경우를 대비해 런타임에도 재확인
    prom_url = _PROMETHEUS_URL or os.getenv("PROMETHEUS_URL", "").rstrip("/")
    logger.info("metrics/range: prom_url=%r ct=%s mg=%s", prom_url, collector_type, metric_group)
    if not prom_url:
        logger.warning("metrics/range: PROMETHEUS_URL 미설정 — 빈 목록 반환")
        return []

    system = await db.get(System, system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    sn = system.system_name
    queries = (RANGE_PROMQL_MAP.get(collector_type) or {}).get(metric_group) or {}
    if not queries:
        logger.warning("metrics/range: collector_type=%r metric_group=%r 에 대한 PromQL 없음", collector_type, metric_group)
        return []

    def _to_unix(s: str) -> float:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.timestamp()

    start_ts = _to_unix(start_dt)
    end_ts = _to_unix(end_dt)

    import asyncio

    merged: dict[str, dict[str, float]] = {}

    async def _fetch_one(client: httpx.AsyncClient, key: str, raw_promql: str):
        promql = raw_promql.format(sn=sn)
        try:
            resp = await client.get(
                f"{prom_url}/api/v1/query_range",
                params={"query": promql, "start": start_ts, "end": end_ts, "step": step},
                timeout=15.0,
            )
            resp.raise_for_status()
            return key, resp.json().get("data", {}).get("result", [])
        except Exception as exc:
            logger.warning("metrics/range: key=%r promql 실패: %s", key, exc)
            return key, []

    async with httpx.AsyncClient() as client:
        results_list = await asyncio.gather(
            *[_fetch_one(client, key, raw_promql) for key, raw_promql in queries.items()]
        )

    for key, results in results_list:
        for series in results:
            for ts_raw, val_raw in series.get("values", []):
                ts_iso = datetime.fromtimestamp(
                    float(ts_raw), tz=timezone.utc
                ).strftime("%Y-%m-%dT%H:%M:%S")
                if ts_iso not in merged:
                    merged[ts_iso] = {}
                try:
                    merged[ts_iso][key] = round(float(val_raw), 4)
                except (ValueError, TypeError):
                    pass

    return [
        {
            "id": i,
            "system_id": system_id,
            "collector_type": collector_type,
            "metric_group": metric_group,
            "hour_bucket": ts,
            "metrics_json": _json.dumps(m),
            "llm_severity": None,
            "llm_trend": None,
            "llm_prediction": None,
            "llm_summary": None,
            "created_at": ts,
        }
        for i, (ts, m) in enumerate(sorted(merged.items()))
    ]


# ── /systems/{system_id}/metrics/live-summary ───────────────────────────────

@_metrics_router.get("/{system_id}/metrics/live-summary")
async def get_metrics_live_summary(
    system_id: int,
    collector_type: str,
    db: AsyncSession = Depends(get_db),
):
    """
    각 metric_group의 Prometheus 최근 10분 최대값 반환 → 카드 상태 표시용.
    값 있음(number): 해당 그룹 수집 중 + 수치로 상태 판정.
    값 없음(null): Prometheus에 데이터 없음 → 프론트엔드에서 미수집/수집 중 판단.
    PROMETHEUS_URL 미설정 시 빈 객체 반환.
    """
    import httpx

    prom_url = _PROMETHEUS_URL or os.getenv("PROMETHEUS_URL", "").rstrip("/")
    if not prom_url:
        return {}

    system = await db.get(System, system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    sn = system.system_name
    group_queries = PCT_PROMQL.get(collector_type, {})
    if not group_queries:
        return {}

    result: dict[str, float | None] = {}
    async with httpx.AsyncClient() as client:
        for group, promql_tpl in group_queries.items():
            promql = promql_tpl.format(sn=sn)
            try:
                resp = await client.get(
                    f"{prom_url}/api/v1/query",
                    params={"query": promql},
                    timeout=10.0,
                )
                resp.raise_for_status()
                data = resp.json().get("data", {}).get("result", [])
                if data:
                    val_str = data[0].get("value", [None, None])[1]
                    result[group] = round(float(val_str), 2) if val_str is not None else None
                else:
                    result[group] = None
            except Exception as exc:
                logger.warning("live-summary: group=%r 실패: %s", group, exc)
                result[group] = None

    return result


# ── /systems/{system_id}/metrics/process-summary ──────────────────────────

@_metrics_router.get("/{system_id}/metrics/process-summary")
async def get_process_summary(
    system_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    프로세스별 CPU/메모리 사용량 반환 (Treemap 시각화용).
    process_cpu_percent, process_memory_bytes instant query → 프로세스별 % 계산.
    """
    import asyncio
    import httpx

    prom_url = _PROMETHEUS_URL or os.getenv("PROMETHEUS_URL", "").rstrip("/")
    if not prom_url:
        return []

    system = await db.get(System, system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    sn = system.system_name

    async with httpx.AsyncClient() as client:
        # 3개 쿼리 병렬 실행: CPU%, 메모리 bytes, 전체 메모리
        async def _query(promql: str):
            try:
                resp = await client.get(
                    f"{prom_url}/api/v1/query",
                    params={"query": promql},
                    timeout=10.0,
                )
                resp.raise_for_status()
                return resp.json().get("data", {}).get("result", [])
            except Exception as exc:
                logger.warning("process-summary: 쿼리 실패: %s — %s", promql[:80], exc)
                return []

        cpu_res, mem_res, total_res, cores_res = await asyncio.gather(
            _query(f'process_cpu_percent{{system_name="{sn}"}}'),
            _query(f'process_memory_bytes{{system_name="{sn}"}}'),
            _query(f'memory_used_bytes{{system_name="{sn}",type="total"}}'),
            _query(f'count(cpu_usage_percent{{system_name="{sn}",core!="total"}})'),
        )

    # CPU 코어 수 (process_cpu_percent 정규화용)
    num_cores = 1
    if cores_res:
        try:
            num_cores = max(1, int(float(cores_res[0].get("value", [None, "1"])[1])))
        except (TypeError, ValueError, IndexError):
            pass

    # 전체 메모리 (bytes)
    total_mem = None
    if total_res:
        try:
            total_mem = float(total_res[0].get("value", [None, None])[1])
        except (TypeError, ValueError, IndexError):
            pass

    # CPU — process/service_name 기준으로 합산 후 코어 수로 정규화
    proc_map: dict[str, dict] = {}
    for series in cpu_res:
        labels = series.get("metric", {})
        name = labels.get("service_display") or labels.get("service_name") or labels.get("process", "unknown")
        val = series.get("value", [None, None])[1]
        if val is None:
            continue
        cpu_pct = float(val)
        if name not in proc_map:
            proc_map[name] = {"name": name, "cpu_percent": 0.0, "mem_percent": 0.0, "mem_bytes": 0}
        proc_map[name]["cpu_percent"] = round(proc_map[name]["cpu_percent"] + cpu_pct, 2)

    # 코어 수로 정규화 (전체 CPU 대비 비율로 변환)
    for entry in proc_map.values():
        entry["cpu_percent"] = round(entry["cpu_percent"] / num_cores, 2)

    # 메모리 — 같은 키로 합산
    for series in mem_res:
        labels = series.get("metric", {})
        name = labels.get("service_display") or labels.get("service_name") or labels.get("process", "unknown")
        val = series.get("value", [None, None])[1]
        if val is None:
            continue
        mem_bytes = float(val)
        if name not in proc_map:
            proc_map[name] = {"name": name, "cpu_percent": 0.0, "mem_percent": 0.0, "mem_bytes": 0}
        proc_map[name]["mem_bytes"] = round(proc_map[name]["mem_bytes"] + mem_bytes)
        if total_mem and total_mem > 0:
            proc_map[name]["mem_percent"] = round(proc_map[name]["mem_bytes"] / total_mem * 100, 2)

    # CPU% 내림차순 정렬
    return sorted(proc_map.values(), key=lambda x: x["cpu_percent"], reverse=True)
