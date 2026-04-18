"""
OTel / Tempo 분산 추적 API

엔드포인트:
  GET /api/v1/systems/{system_id}/traces/search  — dot-chart용 trace 목록 (버킷 집계 포함)
  GET /api/v1/traces/{trace_id}                  — span tree 상세
  GET /api/v1/systems/{system_id}/traces/metrics — p50/p95/p99 + error_rate (60s 메모리 캐시)

gating: agent_instances에 otel_javaagent running 상태인 에이전트가 없으면
  - search/metrics → 404 (시스템에 OTel 미적용)
  - /traces/{id}    → gating 생략 (trace_id는 시스템 종속 아님)
"""

import logging
import os
import re
import time
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["traces"])

TEMPO_URL = os.getenv("TEMPO_URL", "http://tempo:3200")

# ── 간단한 60s 인메모리 캐시 (Redis 없이) ──────────────────────────────────────
_metrics_cache: dict[tuple, tuple[float, dict]] = {}
_CACHE_TTL = 60.0

# ── Tempo 쿼리 파라미터 화이트리스트 ─────────────────────────────────────────────
_ALLOWED_METRIC_TYPES = {"rate", "error_rate", "p50", "p95", "p99", "duration"}
_SAFE_SERVICE_NAME_RE = re.compile(r"^[a-zA-Z0-9_\-\.]+$")


async def _system_has_running_otel_agent(system_id: int, db: AsyncSession) -> bool:
    """OTel Java Agent가 running 상태인지 EXISTS 쿼리로 확인."""
    result = await db.execute(
        text(
            "SELECT EXISTS("
            "  SELECT 1 FROM agent_instances"
            "  WHERE system_id = :sid"
            "    AND agent_type = 'otel_javaagent'"
            "    AND status = 'running'"
            ")"
        ),
        {"sid": system_id},
    )
    return bool(result.scalar())


async def _query_tempo(path: str, params: dict | None = None) -> dict:
    """Tempo HTTP API 단순 프록시."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{TEMPO_URL}{path}", params=params)
        resp.raise_for_status()
        return resp.json()


async def _get_system_service_name(system_id: int, db: AsyncSession) -> str:
    """시스템의 OTel service.name 조회 (label_info.tempo_service_name 우선, 없으면 system_name)."""
    result = await db.execute(
        text(
            "SELECT s.system_name, ai.label_info"
            " FROM systems s"
            " LEFT JOIN agent_instances ai"
            "   ON ai.system_id = s.id AND ai.agent_type = 'otel_javaagent' AND ai.status = 'running'"
            " WHERE s.id = :sid LIMIT 1"
        ),
        {"sid": system_id},
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="System not found")

    system_name, label_info_raw = row
    if label_info_raw:
        import json
        try:
            label_info = json.loads(label_info_raw) if isinstance(label_info_raw, str) else label_info_raw
            svc = label_info.get("tempo_service_name", "")
            if svc and _SAFE_SERVICE_NAME_RE.match(svc):
                return svc
        except Exception:
            pass
    return system_name


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@router.get("/systems/{system_id}/traces/search")
async def search_traces(
    system_id: int,
    start: Optional[str] = Query(None, description="Start time (Unix seconds or RFC3339)"),
    end: Optional[str] = Query(None, description="End time (Unix seconds or RFC3339)"),
    duration_gt_ms: Optional[int] = Query(None, ge=0, description="Minimum duration in ms"),
    error_only: bool = Query(False, description="Only error traces"),
    limit: int = Query(500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """
    Tempo에서 trace 목록을 조회하고 dot-chart용 버킷 집계를 추가 반환.

    dot-chart 다운샘플링:
      1분 bucket × 4 latency band (ok/<500ms / ok/≥500ms / slow/≥2s / error)
      에러: 100% 포함, 나머지: bucket당 20건 cap
    """
    if not await _system_has_running_otel_agent(system_id, db):
        raise HTTPException(status_code=404, detail="OTel agent not running for this system")

    service_name = await _get_system_service_name(system_id, db)

    # TraceQL 쿼리 구성
    filters = [f'resource.service.name="{service_name}"']
    if error_only:
        filters.append("status=error")
    if duration_gt_ms is not None:
        filters.append(f"duration>{duration_gt_ms}ms")
    traceql = "{ " + " && ".join(filters) + " }"

    tempo_params: dict = {"q": traceql, "limit": min(limit, 2000)}
    if start:
        tempo_params["start"] = _safe_int(start) if start.isdigit() else start
    if end:
        tempo_params["end"] = _safe_int(end) if end.isdigit() else end

    try:
        data = await _query_tempo("/api/search", tempo_params)
    except httpx.HTTPError as exc:
        logger.warning("Tempo search failed: %s", exc)
        raise HTTPException(status_code=502, detail="Tempo query failed")

    traces = data.get("traces", [])

    # dot-chart용 1분 버킷 집계
    buckets: dict[int, list] = {}
    for tr in traces:
        ts_ns = _safe_int(tr.get("rootSpanTime", tr.get("startTimeUnixNano", 0)))
        ts_min = (ts_ns // 60_000_000_000) * 60  # 1분 bucket (초 단위)
        buckets.setdefault(ts_min, []).append(tr)

    dot_chart: list[dict] = []
    for bucket_sec, bucket_traces in buckets.items():
        included: list[dict] = []
        others: list[dict] = []
        for tr in bucket_traces:
            root_error = tr.get("rootTraceName", "").endswith("error") or (
                tr.get("durationMs", 0) == 0 and tr.get("spanSets")
            )
            is_error = tr.get("errorCount", 0) > 0
            if is_error:
                included.append(tr)  # 에러는 100% 포함
            else:
                others.append(tr)

        # 나머지는 bucket당 20건 cap
        included.extend(others[:max(0, 20 - len(included))])
        dot_chart.extend(included)

    return {
        "traces": traces,
        "dot_chart": dot_chart,
        "total": len(traces),
        "service_name": service_name,
        # freshness 경고: tail_sampling decision_wait(5s) + buffer(10s) = ~15s 지연
        "freshness_gap_seconds": 15,
    }


@router.get("/traces/{trace_id}")
async def get_trace(
    trace_id: str,
    _current_user=Depends(get_current_user),
):
    """Tempo에서 trace 상세(span tree)를 조회. trace_id는 시스템 종속 아님."""
    # trace_id 형식 검증 (hex 32자)
    if not re.fullmatch(r"[0-9a-fA-F]{32}", trace_id):
        raise HTTPException(status_code=400, detail="Invalid trace_id format")

    try:
        data = await _query_tempo(f"/api/traces/{trace_id}")
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise HTTPException(status_code=404, detail="Trace not found")
        raise HTTPException(status_code=502, detail="Tempo query failed")
    except httpx.HTTPError as exc:
        logger.warning("Tempo get_trace failed: %s", exc)
        raise HTTPException(status_code=502, detail="Tempo query failed")

    return data


@router.get("/systems/{system_id}/traces/metrics")
async def get_trace_metrics(
    system_id: int,
    window_minutes: int = Query(5, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """
    최근 N분 trace 기반 p50/p95/p99 latency + error_rate.
    metrics-generator가 OFF이므로 Tempo /api/search 직접 집계.
    60초 서버사이드 캐시 적용.
    """
    if not await _system_has_running_otel_agent(system_id, db):
        raise HTTPException(status_code=404, detail="OTel agent not running for this system")

    cache_key = (system_id, window_minutes)
    now = time.time()
    if cache_key in _metrics_cache:
        cached_at, cached_data = _metrics_cache[cache_key]
        if now - cached_at < _CACHE_TTL:
            return cached_data

    service_name = await _get_system_service_name(system_id, db)
    # Tempo /api/search의 start/end는 Unix seconds (ns 아님)
    end_s = int(now)
    start_s = int(now - window_minutes * 60)

    traceql = f'{{ resource.service.name="{service_name}" }}'
    try:
        data = await _query_tempo(
            "/api/search",
            {"q": traceql, "start": start_s, "end": end_s, "limit": 2000},
        )
    except httpx.HTTPError as exc:
        logger.warning("Tempo metrics query failed: %s", exc)
        raise HTTPException(status_code=502, detail="Tempo query failed")

    traces = data.get("traces", [])
    durations = sorted(_safe_float(tr.get("durationMs", 0)) for tr in traces)
    n = len(durations)
    error_count = sum(1 for tr in traces if tr.get("errorCount", 0) > 0)

    def percentile(lst: list, pct: float) -> float:
        if not lst:
            return 0.0
        idx = max(0, int(len(lst) * pct / 100) - 1)
        return lst[idx]

    dots = []
    for tr in traces:
        ts_ns = _safe_int(tr.get("rootSpanTime", tr.get("startTimeUnixNano", 0)))
        dots.append({
            "ts": ts_ns // 1_000_000,  # ms — Frontend Date()에 바로 사용 가능
            "durationMs": _safe_float(tr.get("durationMs", 0)),
            "traceID": tr.get("traceID", ""),
            "error": tr.get("errorCount", 0) > 0,
            "name": tr.get("rootTraceName"),
        })

    result = {
        "window_minutes": window_minutes,
        "total": n,
        "error_count": error_count,
        "error_rate": round(error_count / n * 100, 2) if n else 0.0,
        "p50_ms": percentile(durations, 50),
        "p95_ms": percentile(durations, 95),
        "p99_ms": percentile(durations, 99),
        "dots": dots,
    }

    _metrics_cache[cache_key] = (now, result)
    return result
