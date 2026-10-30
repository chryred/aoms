from unittest.mock import AsyncMock, patch

from models import AgentInstance, System

TRACE = "a" * 32
SPAN = "b" * 16


async def _system(db, retention=7, name="sys-a"):
    s = System(system_name=name, display_name=name, tx_retention_days=retention, tx_slow_threshold_ms=2000)
    db.add(s)
    await db.flush()
    return s


def _row(i=0, span=None, **kw):
    r = {
        "trace_id": TRACE, "span_id": span or f"{i:016x}", "parent_span": "", "system_id": 1,
        "instance_role": "was1", "start_ts": "2026-10-30 01:02:03.456", "uri_id": "7",
        "method": "GET", "status": 200, "error": 0, "exc_class": "", "elapsed_ms": 10,
        "cpu_ms": 1, "sql_ms": 2, "sql_cnt": 1, "fetch_cnt": 0, "fetch_ms": 0, "ext_ms": 0,
        "ext_cnt": 0, "conn_open": 1, "conn_close": 1, "conn_leak": 0, "conn_uncommit": 0,
        "user_ip": "10.253.21.12", "user_id": "abcdef", "biz_key": "", "has_detail": 0,
    }
    r.update(kw)
    return r


async def test_transactions_requires_system_ids(authed_client):
    resp = await authed_client.get("/api/v1/apm/transactions")
    assert resp.status_code == 422


def _keys(rows):
    return [{"start_ts": r["start_ts"], "span_id": r["span_id"]} for r in rows]


async def test_transactions_masks_and_has_more(authed_client, db_session):
    s = await _system(db_session)
    rows = [_row(i, system_id=s.id, start_ts=f"2026-10-30 01:{59 - i % 60:02d}:00.000") for i in range(101)]
    page = rows[:100]
    # 2단계 결과는 순서 무관 (1단계 순서로 재정렬되어야 한다)
    qm = AsyncMock(side_effect=[_keys(rows), list(reversed(page)), [{"id": "7", "text": "/a/b"}]])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions", params={"system_ids": [s.id]})
    assert resp.status_code == 200
    body = resp.json()
    assert body["has_more"] is True
    assert [i["span_id"] for i in body["items"]] == [r["span_id"] for r in page]
    first = body["items"][0]
    assert first["user_ip"] == "10.253.21.*" and first["user_ip"].endswith("*")
    assert first["user_id"] == "ab****"
    assert first["uri"] == "/a/b"
    assert first["system_name"] == "sys-a"
    assert first["start_ts"].endswith("Z")
    # 1단계: 좁은 컬럼 + limit+offset+1, 2단계: 키 기반 전체 컬럼
    p1_sql, p1_params = qm.await_args_list[0].args
    assert p1_sql.startswith("SELECT start_ts, span_id FROM") and "optimize_read_in_order" in p1_sql
    assert p1_params["top_n"] == 101
    p2_sql, p2_params = qm.await_args_list[1].args
    assert "span_id IN {span_ids:Array(String)}" in p2_sql and "cpu_ms" in p2_sql
    assert p2_params["span_ids"] == [r["span_id"] for r in page]
    assert p2_params["system_ids"] == [s.id]
    assert p2_params["min_ts"] == min(r["start_ts"] for r in page)
    assert p2_params["max_ts"] == max(r["start_ts"] for r in page)


async def test_transactions_offset_and_no_more(authed_client, db_session):
    s = await _system(db_session)
    rows = [_row(i, system_id=s.id) for i in range(7)]
    qm = AsyncMock(side_effect=[_keys(rows), rows[5:7], [{"id": "7", "text": "/a"}]])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get(
            "/api/v1/apm/transactions", params={"system_ids": [s.id], "limit": 5, "offset": 5})
    body = resp.json()
    assert body["has_more"] is False
    assert [i["span_id"] for i in body["items"]] == [r["span_id"] for r in rows[5:7]]
    assert qm.await_args_list[0].args[1]["top_n"] == 11


async def test_transactions_skips_phase2_when_empty(authed_client, db_session):
    s = await _system(db_session)
    qm = AsyncMock(return_value=[])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions", params={"system_ids": [s.id]})
    assert resp.json() == {"items": [], "has_more": False}
    assert qm.await_count == 1


async def test_transactions_rejects_range_beyond_retention(authed_client, db_session):
    s = await _system(db_session, retention=7)
    qm = AsyncMock(return_value=[])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions", params={
            "system_ids": [s.id], "start": "2026-10-10T00:00:00Z", "end": "2026-10-20T00:00:01Z",
        })
    assert resp.status_code == 422
    qm.assert_not_awaited()


async def test_query_uses_bound_params(authed_client, db_session):
    s = await _system(db_session)
    evil = "x' OR 1=1"
    qm = AsyncMock(side_effect=[[{"id": "7"}], []])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions", params={
            "system_ids": [s.id], "uri": evil, "user_id": evil, "trace_id": evil,
        })
    assert resp.status_code == 200
    assert qm.await_count == 2
    for call in qm.await_args_list:
        assert "OR 1=1" not in call.args[0]
    assert qm.await_args_list[0].args[1]["uri"] == evil
    assert qm.await_args_list[1].args[1]["user_id"] == evil
    assert qm.await_args_list[1].args[1]["uri_ids"] == [7]


async def test_detail_404_and_path_order(authed_client, db_session):
    s = await _system(db_session)
    with patch("services.clickhouse_client.query", AsyncMock(return_value=[])):
        resp = await authed_client.get(f"/api/v1/apm/transactions/{TRACE}/{SPAN}")
    assert resp.status_code == 404

    path = [
        _row(system_id=s.id, span="c" * 16, start_ts="2026-10-30 01:00:00.000"),
        _row(system_id=s.id, span=SPAN, start_ts="2026-10-30 01:00:01.000", has_detail=1, parent_span="c" * 16),
    ]
    qm = AsyncMock(side_effect=[
        path,                                                   # tx_summary(trace)
        [{"id": "7", "text": "/a/b"}],                          # dict_uri
        [{"sql_id": "255", "cnt": 2, "ms": 30, "max_ms": 20, "fetch_cnt": 1, "fetch_ms": 3, "err": 0}],
        [{"id": "255", "text": "SELECT ?"}],                    # dict_sql
        [{"nodes": '[{"n":1}]', "stacks": "{}"}],               # tx_detail
    ])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get(f"/api/v1/apm/transactions/{TRACE}/{SPAN}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["span_id"] == SPAN
    assert [p["span_id"] for p in body["path"]] == ["c" * 16, SPAN]
    assert body["sql"][0]["sql_id"] == "00000000000000ff"
    assert body["sql"][0]["sql_text"] == "SELECT ?"
    assert body["detail"]["nodes"] == [{"n": 1}]


async def test_scatter_small_range_not_truncated(authed_client, db_session):
    s = await _system(db_session)
    pts = [{"ts": "2026-10-30 01:00:00.000", "elapsed_ms": 5, "error": 0,
            "trace_id": TRACE, "span_id": SPAN, "system_id": s.id}]
    qm = AsyncMock(side_effect=[[{"c": "1"}], pts])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/scatter", params={"system_ids": [s.id], "limit": 10})
    assert resp.status_code == 200
    assert resp.json()["truncated"] is False
    assert len(resp.json()["points"]) == 1


async def test_summary_without_agent(authed_client, db_session):
    s = await _system(db_session)
    qm = AsyncMock()
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get(f"/api/v1/apm/systems/{s.id}/summary")
    assert resp.status_code == 200
    assert resp.json() == {
        "has_agent_t": False, "tps_1h": 0.0, "avg_ms_1h": 0.0,
        "slow_count_1h": 0, "slow_threshold_ms": 2000,
    }
    qm.assert_not_awaited()


async def test_summary_with_agent(authed_client, db_session):
    s = await _system(db_session)
    db_session.add(AgentInstance(system_id=s.id, host="h", agent_type="agent_t", status="running"))
    await db_session.flush()
    qm = AsyncMock(return_value=[{"cnt": "7200", "avg_ms": 12.34, "slow_cnt": "3"}])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get(f"/api/v1/apm/systems/{s.id}/summary")
    body = resp.json()
    assert body["has_agent_t"] is True
    assert body["tps_1h"] == 2.0 and body["slow_count_1h"] == 3


async def test_apm_clickhouse_error_maps_to_502(authed_client, db_session):
    from services.clickhouse_client import ClickHouseError

    s = await _system(db_session)
    with patch("services.clickhouse_client.query", AsyncMock(side_effect=ClickHouseError("down"))):
        resp = await authed_client.get("/api/v1/apm/transactions", params={"system_ids": [s.id]})
    assert resp.status_code == 502
    assert resp.json()["detail"] == "트랜잭션 저장소 조회 실패"
