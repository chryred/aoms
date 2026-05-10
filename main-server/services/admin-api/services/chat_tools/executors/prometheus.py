"""Prometheus 챗봇 executor — 15일 이내 raw 메트릭 조회.

설계 원칙:
- KST 입력 → 내부 UTC 변환 → Prometheus 호출 → 결과 timestamp KST 포맷
- Prometheus retention(운영 15d) 초과 시 에러 반환 (LLM이 EMS/Qdrant로 폴백)
- 인스턴스 분리: instance_role 라벨 기준으로 row 단위 반환 (was1/was2 분리)
- 메트릭 이름은 synapse_agent / db_exporter 1:1 매핑 (collector 변경 시 함께 갱신)

ADR-013 타임존 정책:
- 저장(Prometheus)=UTC, 입력=KST, 출력=KST. 모든 변환은 이 모듈 내부에서만.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_KST = timezone(timedelta(hours=9))
_PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090").rstrip("/")
_RETENTION_DAYS = int(os.getenv("PROMETHEUS_RETENTION_DAYS", "15"))

_VALID_AGGS = {"avg", "max", "min", "p95", "sum"}
_DURATION_RE = re.compile(r"^\d+(s|m|h|d|w|y)$")


# ── 메트릭 베이스 표현식 (window/aggregation 미포함, 도구가 조립) ──────────────

_METRIC_BASE: dict[str, dict[str, str]] = {
    "cpu": {
        "cpu_percent": 'cpu_usage_percent{{system_name="{sn}",core="total"}}',
        "load_1m":     'cpu_load_avg{{system_name="{sn}",interval="1m"}}',
    },
    "memory": {
        "mem_used_pct": '100 * memory_used_bytes{{system_name="{sn}",type="used"}} / ignoring(type) memory_used_bytes{{system_name="{sn}",type="total"}}',
    },
    "disk": {
        "disk_io_ms": 'disk_io_time_ms{{system_name="{sn}"}}',
    },
    "network": {
        "net_rx_mb": 'rate(network_bytes_total{{system_name="{sn}",direction="rx"}}[5m]) / 1048576',
        "net_tx_mb": 'rate(network_bytes_total{{system_name="{sn}",direction="tx"}}[5m]) / 1048576',
    },
    "log": {
        "log_errors_per_min":     'sum by (instance_role) (rate(log_error_total{{system_name="{sn}"}}[5m])) * 60',
        "log_errors_err_per_min": 'sum by (instance_role) (rate(log_error_total{{system_name="{sn}",level="ERROR"}}[5m])) * 60',
    },
    "web": {
        "req_per_min":  'sum by (instance_role) (rate(http_request_total{{system_name="{sn}"}}[5m])) * 60',
        "slow_per_min": 'sum by (instance_role) (rate(http_request_slow_total{{system_name="{sn}"}}[5m])) * 60',
        "resp_avg_ms":  'http_request_duration_ms{{system_name="{sn}"}}',
    },
    "db": {
        "active_pct":     'db_connections_active_percent{{system_name="{sn}"}}',
        "active_count":   'db_connections_active{{system_name="{sn}"}}',
        "tps":            'db_transactions_per_second{{system_name="{sn}"}}',
        "slow_queries":   'db_slow_queries_total{{system_name="{sn}"}}',
        "cache_hit_pct":  'db_cache_hit_rate_percent{{system_name="{sn}"}}',
        "repl_lag_sec":   'db_replication_lag_seconds{{system_name="{sn}"}}',
    },
}


# ── 시간 파서 ────────────────────────────────────────────────────────────────

def _parse_kst_time(s: str | None) -> datetime | None:
    """KST 표현(자연어 or ISO) → UTC datetime. None/'now'/'지금' → None(=instant now)."""
    if not s:
        return None
    s = s.strip()
    if not s or s.lower() in ("now", "지금", "현재"):
        return None

    # ISO 8601 (KST tz 또는 naive=KST)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=_KST)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass

    # 한국어 자연어 — ems.parse_korean_date 재사용 (KST 기준 Unix ms 반환)
    try:
        from services.chat_tools.executors.ems import parse_korean_date
        ms = parse_korean_date(s)
        if ms is None:
            return None
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    except Exception:  # noqa: BLE001
        return None


def _validate_window(window: str | None) -> str:
    if not window:
        return "5m"
    w = str(window).strip()
    if not _DURATION_RE.match(w):
        raise ValueError(f"window 형식 오류: {window}. 예: 5m, 1h, 24h")
    return w


def _check_retention(ts_utc: datetime | None) -> str | None:
    """retention 초과면 에러 메시지, OK면 None."""
    if ts_utc is None:
        return None
    cutoff = datetime.now(timezone.utc) - timedelta(days=_RETENTION_DAYS)
    if ts_utc < cutoff:
        return (
            f"Prometheus 보관 기간({_RETENTION_DAYS}일)을 초과한 시각입니다. "
            f"ems_get_system_period_usage 또는 qdrant_search_aggregation_summary를 사용하세요."
        )
    return None


# ── PromQL 조립 ──────────────────────────────────────────────────────────────

def _build_query(base_expr: str, system_name: str, aggregation: str, window: str) -> str:
    """베이스 표현식 + system_name 치환 + 집계 함수 + 윈도우 조립."""
    expr = base_expr.format(sn=system_name)
    if aggregation == "p95":
        return f"quantile_over_time(0.95, {expr}[{window}])"
    return f"{aggregation}_over_time({expr}[{window}])"


# ── Prometheus 호출 ──────────────────────────────────────────────────────────

async def _query(client: httpx.AsyncClient, promql: str, ts_utc: datetime | None) -> list[dict[str, Any]]:
    """instant query. 결과는 raw vector(list of {metric:dict, value:[ts, str]}). 실패 시 빈 리스트."""
    params: dict[str, Any] = {"query": promql}
    if ts_utc is not None:
        params["time"] = ts_utc.timestamp()
    try:
        resp = await client.get(f"{_PROMETHEUS_URL}/api/v1/query", params=params, timeout=10.0)
        resp.raise_for_status()
        return resp.json().get("data", {}).get("result", []) or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("prometheus query 실패: %s — %s", promql[:100], exc)
        return []


# ── 결과 포맷 ────────────────────────────────────────────────────────────────

def _coerce_value(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _format_response(
    *,
    system_name: str,
    metric_group: str,
    aggregation: str,
    window: str,
    ts_utc: datetime | None,
    sub_results: dict[str, list[dict[str, Any]]],  # sub_metric → raw vector
) -> dict[str, Any]:
    """sub_metric별 raw vector를 instance_role 기준으로 합쳐서 instances 배열로 변환."""
    by_instance: dict[str, dict[str, float | None]] = {}
    for sub_name, vec in sub_results.items():
        for hit in vec:
            metric = hit.get("metric") or {}
            inst = metric.get("instance_role") or metric.get("instance") or "_total"
            value = hit.get("value") or [None, None]
            by_instance.setdefault(inst, {})[sub_name] = _coerce_value(value[1])

    time_kst = (
        ts_utc.astimezone(_KST).strftime("%Y-%m-%d %H:%M KST") if ts_utc else "now"
    )
    return {
        "system_name":  system_name,
        "metric_group": metric_group,
        "aggregation":  aggregation,
        "window":       window,
        "time":         time_kst,
        "instances": [
            {"instance_role": inst, "metrics": metrics}
            for inst, metrics in sorted(by_instance.items())
        ],
    }


# ── Tool 진입점 ──────────────────────────────────────────────────────────────

async def execute(db: AsyncSession, name: str, args: dict[str, Any]) -> dict[str, Any]:
    if name == "prometheus_query":
        return await _run_instant_query(args)
    if name == "prometheus_range_query":
        return await _run_range_query(args)
    return {"error": f"unknown prometheus tool: {name}"}


async def _run_instant_query(args: dict[str, Any]) -> dict[str, Any]:
    """한 시점의 raw 메트릭 조회 — /api/v1/query 사용."""
    system_name  = (args.get("system_name") or "").strip()
    metric_group = (args.get("metric_group") or "").strip()
    aggregation  = (args.get("aggregation") or "avg").strip()
    time_in      = args.get("time")
    window_in    = args.get("window")

    if not system_name:
        return {"error": "system_name 필수 (예: cxm)"}
    if metric_group not in _METRIC_BASE:
        return {
            "error": f"metric_group은 {sorted(_METRIC_BASE.keys())} 중 하나여야 합니다 (받음: {metric_group!r})"
        }
    if aggregation not in _VALID_AGGS:
        return {"error": f"aggregation은 {sorted(_VALID_AGGS)} 중 하나여야 합니다 (받음: {aggregation!r})"}

    try:
        window = _validate_window(window_in)
    except ValueError as e:
        return {"error": str(e)}

    ts_utc = _parse_kst_time(time_in if isinstance(time_in, str) else None)
    retention_err = _check_retention(ts_utc)
    if retention_err:
        return {"error": retention_err}

    sub_metrics = _METRIC_BASE[metric_group]
    sub_results: dict[str, list[dict[str, Any]]] = {}
    async with httpx.AsyncClient(timeout=15.0) as client:
        for sub_name, base_expr in sub_metrics.items():
            promql = _build_query(base_expr, system_name, aggregation, window)
            sub_results[sub_name] = await _query(client, promql, ts_utc)

    return _format_response(
        system_name=system_name,
        metric_group=metric_group,
        aggregation=aggregation,
        window=window,
        ts_utc=ts_utc,
        sub_results=sub_results,
    )


# ── Range Query 전용 헬퍼 ────────────────────────────────────────────────────

_DEFAULT_STEP = "5m"
_MAX_DATA_POINTS = 1000  # Prometheus 기본 query.max-samples 한도


def _parse_step_seconds(step: str) -> int:
    """step 표현식 → 초 단위. 형식 오류면 ValueError."""
    if not _DURATION_RE.match(step):
        raise ValueError(f"step 형식 오류: {step}. 예: 30s, 5m, 1h")
    n = int(step[:-1])
    unit = step[-1]
    mult = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800, "y": 31536000}[unit]
    return n * mult


def _validate_range(start_utc: datetime, end_utc: datetime, step: str) -> str | None:
    """range/step 조합 검증. 에러 메시지 반환 또는 None."""
    if end_utc <= start_utc:
        return f"end_time({end_utc})은 start_time({start_utc})보다 늦어야 합니다."
    try:
        step_sec = _parse_step_seconds(step)
    except ValueError as e:
        return str(e)
    duration_sec = (end_utc - start_utc).total_seconds()
    n_points = int(duration_sec / step_sec) + 1
    if n_points > _MAX_DATA_POINTS:
        return (
            f"데이터 포인트가 {n_points}개로 한도({_MAX_DATA_POINTS})를 초과합니다. "
            f"step을 더 큰 값으로 설정하거나 (예: 1h, 6h) 기간을 줄이세요."
        )
    if n_points < 2:
        return f"데이터 포인트가 {n_points}개로 너무 적습니다. step을 줄이거나 기간을 늘리세요."
    return None


async def _query_range(
    client: httpx.AsyncClient,
    promql: str,
    start_utc: datetime,
    end_utc: datetime,
    step: str,
) -> list[dict[str, Any]]:
    """range query. 결과는 raw matrix(list of {metric:dict, values:[[ts,str],...]}). 실패 시 빈 리스트."""
    params = {
        "query": promql,
        "start": start_utc.timestamp(),
        "end": end_utc.timestamp(),
        "step": step,
    }
    try:
        resp = await client.get(f"{_PROMETHEUS_URL}/api/v1/query_range", params=params, timeout=20.0)
        resp.raise_for_status()
        return resp.json().get("data", {}).get("result", []) or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("prometheus range query 실패: %s — %s", promql[:100], exc)
        return []


def _build_range_promql(base_expr: str, system_name: str, aggregation: str) -> str:
    """range query용 PromQL — 짧은 window(2m) over_time으로 평활화."""
    expr = base_expr.format(sn=system_name)
    window = "2m"
    if aggregation == "p95":
        return f"quantile_over_time(0.95, {expr}[{window}])"
    if aggregation in {"avg", "max", "min", "sum"}:
        return f"{aggregation}_over_time({expr}[{window}])"
    return expr  # fallback: raw


def _format_range_response(
    *,
    system_name: str,
    metric_group: str,
    aggregation: str,
    start_utc: datetime,
    end_utc: datetime,
    step: str,
    sub_results: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    """sub_metric별 matrix → instance_role 기준 시계열로 합침."""
    by_instance: dict[str, dict[str, list[list[Any]]]] = {}
    for sub_name, matrix in sub_results.items():
        for series in matrix:
            metric = series.get("metric") or {}
            inst = metric.get("instance_role") or metric.get("instance") or "_total"
            values = series.get("values") or []
            converted: list[list[Any]] = []
            for ts, val_str in values:
                try:
                    ts_kst = (
                        datetime.fromtimestamp(float(ts), tz=timezone.utc)
                        .astimezone(_KST)
                        .strftime("%Y-%m-%d %H:%M KST")
                    )
                except (ValueError, TypeError, OSError):
                    ts_kst = "?"
                converted.append([ts_kst, _coerce_value(val_str)])
            by_instance.setdefault(inst, {})[sub_name] = converted

    return {
        "system_name":  system_name,
        "metric_group": metric_group,
        "aggregation":  aggregation,
        "step":         step,
        "start":        start_utc.astimezone(_KST).strftime("%Y-%m-%d %H:%M KST"),
        "end":          end_utc.astimezone(_KST).strftime("%Y-%m-%d %H:%M KST"),
        "instances": [
            {
                "instance_role": inst,
                "series": metrics,
            }
            for inst, metrics in sorted(by_instance.items())
        ],
    }


async def _run_range_query(args: dict[str, Any]) -> dict[str, Any]:
    """24시간 추이 등 시계열 조회 — /api/v1/query_range 사용."""
    system_name  = (args.get("system_name") or "").strip()
    metric_group = (args.get("metric_group") or "").strip()
    aggregation  = (args.get("aggregation") or "avg").strip()
    start_in     = args.get("start_time") or args.get("start")
    end_in       = args.get("end_time") or args.get("end")
    step_in      = args.get("step") or _DEFAULT_STEP

    if not system_name:
        return {"error": "system_name 필요 (예: cxm)"}
    if metric_group not in _METRIC_BASE:
        return {"error": f"metric_group은 {sorted(_METRIC_BASE.keys())} 중 하나여야 합니다 (받음: {metric_group!r})"}
    if aggregation not in _VALID_AGGS:
        return {"error": f"aggregation은 {sorted(_VALID_AGGS)} 중 하나여야 합니다 (받음: {aggregation!r})"}
    if not start_in:
        return {"error": "start_time이 필요합니다 (예: '어제 0시', '24시간 전', '2026-05-09 00:00')"}

    if not end_in:
        end_utc = datetime.now(timezone.utc)
    else:
        end_utc = _parse_kst_time(end_in if isinstance(end_in, str) else None)
        if end_utc is None:
            return {"error": f"end_time을 파싱할 수 없습니다: {end_in!r}"}

    start_utc = _parse_kst_time(start_in if isinstance(start_in, str) else None)
    if start_utc is None:
        return {"error": f"start_time을 파싱할 수 없습니다: {start_in!r}"}

    retention_err = _check_retention(start_utc)
    if retention_err:
        return {"error": retention_err}

    range_err = _validate_range(start_utc, end_utc, step_in)
    if range_err:
        return {"error": range_err}

    sub_metrics = _METRIC_BASE[metric_group]
    sub_results: dict[str, list[dict[str, Any]]] = {}
    async with httpx.AsyncClient(timeout=20.0) as client:
        for sub_name, base_expr in sub_metrics.items():
            promql = _build_range_promql(base_expr, system_name, aggregation)
            sub_results[sub_name] = await _query_range(client, promql, start_utc, end_utc, step_in)

    return _format_range_response(
        system_name=system_name,
        metric_group=metric_group,
        aggregation=aggregation,
        start_utc=start_utc,
        end_utc=end_utc,
        step=step_in,
        sub_results=sub_results,
    )
