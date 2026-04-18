"""
OTel Trace Context 요약기 (Phase OTel)

Tempo /api/search를 조회해 tier별 예산에 맞는 요약 텍스트와 trace_id 목록을 반환.

- 실패 시 ('', []) 반환 → analyzer는 현행 유지 (ADR-002 준수)
- freshness 보정: end_ts에서 (decision_wait=5s + buffer=10s) = 15s earlier로 조회
- trace_id 포맷: 앞 8자 prefix + "…" (Frontend prefix 검색 호환)
"""

import logging
import os
import time
from typing import Literal

import httpx

logger = logging.getLogger(__name__)

TEMPO_URL = os.getenv("TEMPO_URL", "http://tempo:3200")

# tier별 trace summary 예산 (자 단위)
_TIER_BUDGET = {
    "5min":   400,
    "hourly": 300,
    "daily":  200,
}


async def build_trace_context(
    system_name: str,
    start_ts_ns: int,
    end_ts_ns: int,
    tier: Literal["5min", "hourly", "daily"],
) -> tuple[str, list[str]]:
    """
    Tempo 조회 → tier별 예산 맞춘 요약 반환.

    freshness 보정: end_ts_ns에서 15s earlier로 조회.
    실패 시 ('', []) 반환 → analyzer는 계속 진행 (ADR-002 준수).

    Returns:
        (summary_text, referenced_trace_ids)
    """
    # freshness 보정: tail_sampling decision_wait(5s) + buffer(10s)
    adjusted_end_ns = end_ts_ns - 15_000_000_000

    traceql = f'{{ resource.service.name="{system_name}" }}'
    error_traceql = f'{{ resource.service.name="{system_name}" && status=error }}'

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 전체 trace (latency 계산용)
            all_resp = await client.get(
                f"{TEMPO_URL}/api/search",
                params={
                    "q": traceql,
                    "start": start_ts_ns,
                    "end": adjusted_end_ns,
                    "limit": 500,
                },
            )
            all_resp.raise_for_status()
            all_traces = all_resp.json().get("traces", [])

            # 에러 trace
            err_resp = await client.get(
                f"{TEMPO_URL}/api/search",
                params={
                    "q": error_traceql,
                    "start": start_ts_ns,
                    "end": adjusted_end_ns,
                    "limit": 50,
                },
            )
            err_resp.raise_for_status()
            error_traces = err_resp.json().get("traces", [])

    except Exception as exc:
        logger.debug("Tempo query failed for %s/%s: %s", system_name, tier, exc)
        return ("", [])

    if not all_traces:
        return ("", [])

    durations = sorted(
        float(t.get("durationMs", 0)) for t in all_traces if t.get("durationMs")
    )
    n = len(durations)
    error_count = len(error_traces)

    def pct(lst: list, p: float) -> float:
        if not lst:
            return 0.0
        return lst[max(0, int(len(lst) * p / 100) - 1)]

    p50 = pct(durations, 50)
    p95 = pct(durations, 95)
    p99 = pct(durations, 99)
    error_rate = round(error_count / n * 100, 1) if n else 0.0

    # top 에러 trace_id (8자 prefix + …)
    top_errors = error_traces[:3]
    referenced_ids = [t["traceID"] for t in top_errors if t.get("traceID")]
    short_ids = [tid[:8] + "…" for tid in referenced_ids]

    if tier == "5min":
        # (a) 에러 trace 상위 3개 (b) p50/p95/p99 (c) top 3 slow endpoints (d) call path
        slow_ep = sorted(all_traces, key=lambda t: float(t.get("durationMs", 0)), reverse=True)
        slow_top = [
            f"{t.get('rootTraceName', '?')}({float(t.get('durationMs', 0)):.0f}ms)"
            for t in slow_ep[:3]
        ]
        error_lines = [
            f"{sid}|{t.get('rootTraceName', '?')}|{float(t.get('durationMs', 0)):.0f}ms"
            for sid, t in zip(short_ids, top_errors)
        ]
        parts = [
            f"trace:{n}건 err:{error_count}({error_rate}%)",
            f"p50/p95/p99={p50:.0f}/{p95:.0f}/{p99:.0f}ms",
        ]
        if error_lines:
            parts.append("err:" + " ".join(error_lines))
        if slow_top:
            parts.append("slow:" + " ".join(slow_top))
        summary = " | ".join(parts)

    elif tier == "hourly":
        # (a) 에러율 (b) p95 추이 (c) 상위 3개 문제 endpoint
        ep_counts: dict[str, int] = {}
        for t in all_traces:
            key = t.get("rootTraceName", "?")
            ep_counts[key] = ep_counts.get(key, 0) + 1
        top_ep = sorted(ep_counts.items(), key=lambda x: x[1], reverse=True)[:3]
        ep_str = " ".join(f"{k}({v})" for k, v in top_ep)
        summary = f"trace:{n} err:{error_count}({error_rate}%) p95={p95:.0f}ms top:{ep_str}"

    else:  # daily
        # (a) 에러 피크 시간대 (b) 일 평균 p95 (c) 가장 잦은 error 패턴 1개
        peak_ep = max(
            (t.get("rootTraceName", "?") for t in error_traces),
            key=lambda x: sum(1 for t in error_traces if t.get("rootTraceName") == x),
            default="없음",
        ) if error_traces else "없음"
        summary = f"총trace:{n} err:{error_count}({error_rate}%) p95={p95:.0f}ms 주요에러:{peak_ep}"

    # 예산 내 잘라내기
    budget = _TIER_BUDGET[tier]
    if len(summary) > budget:
        summary = summary[:budget - 1] + "…"

    return (summary, referenced_ids)
