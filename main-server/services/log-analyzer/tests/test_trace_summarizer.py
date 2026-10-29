"""trace_summarizer: ClickHouse(Agent-T) 기반 trace 근거 요약 테스트."""
import json

import httpx
import pytest

import trace_summarizer

_RealClient = httpx.AsyncClient

TID = "a" * 31


def _rows(n):
    return [
        {
            "trace_id": f"{TID}{i}",
            "uri": f"/api/order/{i}",
            "elapsed_ms": 5000 - i * 100,
            "sql_ms": 1200 + i,
            "sql_cnt": 7 + i,
            "exc_class": "java.sql.SQLTimeoutException" if i == 0 else "",
        }
        for i in range(n)
    ]


def _install(monkeypatch, rows, captured=None):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/v1/systems":
            return httpx.Response(200, json=[{"id": 42, "system_name": "was-test", "tx_slow_threshold_ms": 2500}])
        if captured is not None:
            captured.append(request)
        body = "\n".join(json.dumps(r) for r in rows)
        return httpx.Response(200, text=body)

    monkeypatch.setattr(
        trace_summarizer.httpx,
        "AsyncClient",
        lambda **kw: _RealClient(transport=httpx.MockTransport(handler), **kw),
    )
    trace_summarizer._systems_cache.clear()


@pytest.mark.asyncio
async def test_build_trace_context_formats_lines(monkeypatch):
    captured = []
    _install(monkeypatch, _rows(3), captured)
    text, ids = await trace_summarizer.build_trace_context(
        "was-test", 1_700_000_000_000_000_000, 1_700_000_300_000_000_000, "5min"
    )
    lines = text.split("\n")
    assert len(lines) == 3
    assert lines[0] == "/api/order/0 5000ms sql 1200ms/7 java.sql.SQLTimeoutException"
    assert lines[1] == "/api/order/1 4900ms sql 1201ms/8"
    assert ids == [f"{TID}{i}" for i in range(3)]
    # 값은 쿼리 파라미터로만 전달
    ch = captured[0]
    assert ch.url.params["param_system_id"] == "42"
    assert "42" not in ch.content.decode()
    assert ch.url.params["param_slow_ms"] == "2500"
    sql = ch.content.decode()
    assert "t.error = 1 OR t.elapsed_ms >= {slow_ms:UInt32}" in sql
    assert "conn_leak > 0 OR t.conn_uncommit > 0" in sql
    assert "ORDER BY t.error DESC, t.elapsed_ms DESC" in sql
    assert "agent_t.tx_summary" in sql


@pytest.mark.asyncio
async def test_budget_truncates(monkeypatch):
    _install(monkeypatch, _rows(20), None)
    text, ids = await trace_summarizer.build_trace_context(
        "was-test", 0, 300_000_000_000, "daily"
    )
    assert len(text) <= trace_summarizer._TIER_BUDGET["daily"]
    assert len(ids) == len(text.split("\n"))
    assert 0 < len(ids) < 20


@pytest.mark.asyncio
async def test_unknown_system_or_failure_returns_empty(monkeypatch):
    _install(monkeypatch, _rows(3))
    assert await trace_summarizer.build_trace_context("nope", 0, 1, "5min") == ("", [])

    def boom(**kw):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(trace_summarizer.httpx, "AsyncClient", boom)
    trace_summarizer._systems_cache.clear()
    assert await trace_summarizer.build_trace_context("was-test", 0, 1, "5min") == ("", [])


@pytest.mark.asyncio
async def test_overlong_single_line_truncated_not_dropped(monkeypatch):
    row = _rows(1)[0]
    row["uri"] = "/x" * 500
    _install(monkeypatch, [row], None)
    text, ids = await trace_summarizer.build_trace_context("was-test", 0, 1, "5min")
    assert 0 < len(text) <= trace_summarizer._TIER_BUDGET["5min"]
    assert text.endswith("…")
    assert ids == [row["trace_id"]]
