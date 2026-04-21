"""
get_trace_metrics — 에러/슬로우 절대 건수 기반 응답 검증
"""
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


def _trace(trace_id: str, duration_ms: float, *, ts_ns: int = 1_700_000_000_000_000_000) -> dict:
    return {
        "traceID": trace_id,
        "durationMs": duration_ms,
        "rootSpanTime": ts_ns,
        "rootTraceName": "GET /x",
        "errorCount": 0,
    }


@pytest.fixture(autouse=True)
def _clear_metrics_cache():
    """각 테스트 시작 전 인메모리 캐시 초기화 — 전 테스트의 결과가 새 계산에 섞이지 않게."""
    from routes import traces as traces_module
    traces_module._metrics_cache.clear()
    yield
    traces_module._metrics_cache.clear()


async def _patches():
    """공통 gating/서비스명 패치 컨텍스트 매니저 조합."""
    return [
        patch("routes.traces._system_has_running_otel_agent", new_callable=AsyncMock, return_value=True),
        patch("routes.traces._get_system_service_name", new_callable=AsyncMock, return_value="svc"),
    ]


async def test_metrics_counts_error_and_slow_separately(authed_client: AsyncClient):
    """에러 1 + slow 2 + 정상 5 → anomaly_count=3, p 값 계산"""
    all_traces = [_trace(f"t{i}", 100 + i) for i in range(1, 6)]   # 정상 5건
    all_traces.append(_trace("e1", 80))                              # 에러 1건
    all_traces.append(_trace("s1", 3000))                            # slow 1건
    all_traces.append(_trace("s2", 5000))                            # slow 2건

    err_traces = [{"traceID": "e1"}]
    slow_traces = [{"traceID": "s1"}, {"traceID": "s2"}]

    async def fake_tempo(path: str, params: dict | None = None) -> dict:
        q = (params or {}).get("q", "")
        if "status=error" in q:
            return {"traces": err_traces}
        if "duration >" in q:
            return {"traces": slow_traces}
        return {"traces": all_traces}

    with patch("routes.traces._system_has_running_otel_agent", new_callable=AsyncMock, return_value=True), \
         patch("routes.traces._get_system_service_name", new_callable=AsyncMock, return_value="svc"), \
         patch("routes.traces._query_tempo", side_effect=fake_tempo):
        resp = await authed_client.get("/api/v1/systems/1/traces/metrics?window_minutes=5")

    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 8             # 샘플 전체 수
    assert data["error_count"] == 1
    assert data["slow_count"] == 2
    assert data["anomaly_count"] == 3
    assert data["slow_threshold_ms"] == 2000
    assert "error_rate" not in data
    assert data["p95_ms"] > 0
    # dots: 8개, error/slow 플래그 반영
    dots = data["dots"]
    assert len(dots) == 8
    assert sum(1 for d in dots if d["error"]) == 1
    assert sum(1 for d in dots if d["slow"]) == 2


async def test_metrics_zero_traces(authed_client: AsyncClient):
    """trace 0건 → 모든 카운트/퍼센타일 0, 예외 없음"""
    async def fake_tempo(path: str, params: dict | None = None) -> dict:
        return {"traces": []}

    with patch("routes.traces._system_has_running_otel_agent", new_callable=AsyncMock, return_value=True), \
         patch("routes.traces._get_system_service_name", new_callable=AsyncMock, return_value="svc"), \
         patch("routes.traces._query_tempo", side_effect=fake_tempo):
        resp = await authed_client.get("/api/v1/systems/1/traces/metrics?window_minutes=5")

    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["error_count"] == 0
    assert data["slow_count"] == 0
    assert data["anomaly_count"] == 0
    assert data["p50_ms"] == 0
    assert data["p95_ms"] == 0
    assert data["dots"] == []


async def test_metrics_error_and_slow_mutually_exclusive(authed_client: AsyncClient):
    """같은 traceID 가 err_data 와 slow_data 양쪽에 있으면 error 로만 집계 (slow 에서 제외)"""
    all_traces = [_trace("x1", 4000)]
    err_traces = [{"traceID": "x1"}]
    slow_traces = [{"traceID": "x1"}]  # TraceQL 상 status != error 로 이미 걸러야 하지만 방어적 검증

    async def fake_tempo(path: str, params: dict | None = None) -> dict:
        q = (params or {}).get("q", "")
        if "status=error" in q:
            return {"traces": err_traces}
        if "duration >" in q:
            return {"traces": slow_traces}
        return {"traces": all_traces}

    with patch("routes.traces._system_has_running_otel_agent", new_callable=AsyncMock, return_value=True), \
         patch("routes.traces._get_system_service_name", new_callable=AsyncMock, return_value="svc"), \
         patch("routes.traces._query_tempo", side_effect=fake_tempo):
        resp = await authed_client.get("/api/v1/systems/1/traces/metrics?window_minutes=5")

    assert resp.status_code == 200
    data = resp.json()
    assert data["error_count"] == 1
    assert data["slow_count"] == 0
    assert data["anomaly_count"] == 1
    # dot 플래그 검증 — error 우선, slow False
    dot = data["dots"][0]
    assert dot["error"] is True
    assert dot["slow"] is False


async def test_metrics_no_otel_agent_returns_404(authed_client: AsyncClient):
    with patch("routes.traces._system_has_running_otel_agent", new_callable=AsyncMock, return_value=False):
        resp = await authed_client.get("/api/v1/systems/1/traces/metrics?window_minutes=5")
    assert resp.status_code == 404


async def test_metrics_cache_hit_avoids_tempo_call(authed_client: AsyncClient):
    """동일 파라미터 연속 호출 → 2번째는 캐시에서 반환 (Tempo 추가 호출 없음)"""
    all_traces = [_trace("t1", 100)]
    err_traces = []
    slow_traces = []

    call_count = 0

    async def fake_tempo(path: str, params: dict | None = None) -> dict:
        nonlocal call_count
        call_count += 1
        q = (params or {}).get("q", "")
        if "status=error" in q:
            return {"traces": err_traces}
        if "duration >" in q:
            return {"traces": slow_traces}
        return {"traces": all_traces}

    with patch("routes.traces._system_has_running_otel_agent", new_callable=AsyncMock, return_value=True), \
         patch("routes.traces._get_system_service_name", new_callable=AsyncMock, return_value="svc"), \
         patch("routes.traces._query_tempo", side_effect=fake_tempo):
        r1 = await authed_client.get("/api/v1/systems/1/traces/metrics?window_minutes=5")
        r2 = await authed_client.get("/api/v1/systems/1/traces/metrics?window_minutes=5")

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    # 1번째 호출 = 3 쿼리 (all/err/slow). 2번째는 캐시 히트 → 추가 없음
    assert call_count == 3
