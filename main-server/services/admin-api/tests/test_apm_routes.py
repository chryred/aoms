import pytest
from unittest.mock import AsyncMock, patch

from models import AgentInstance, System

CNT = {"total": "3", "err": "1"}
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
    qm = AsyncMock(side_effect=[[CNT], _keys(rows), list(reversed(page)), [{"id": "7", "text": "/a/b"}]])
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
    p1_sql, p1_params = qm.await_args_list[1].args
    assert p1_sql.startswith("SELECT start_ts, span_id FROM") and "optimize_read_in_order" in p1_sql
    assert p1_params["top_n"] == 101
    p2_sql, p2_params = qm.await_args_list[2].args
    assert "span_id IN {span_ids:Array(String)}" in p2_sql and "cpu_ms" in p2_sql
    assert p2_params["span_ids"] == [r["span_id"] for r in page]
    assert p2_params["system_ids"] == [s.id]
    assert p2_params["min_ts"] == min(r["start_ts"] for r in page)
    assert p2_params["max_ts"] == max(r["start_ts"] for r in page)


async def test_transactions_offset_and_no_more(authed_client, db_session):
    s = await _system(db_session)
    rows = [_row(i, system_id=s.id) for i in range(7)]
    qm = AsyncMock(side_effect=[[CNT], _keys(rows), rows[5:7], [{"id": "7", "text": "/a"}]])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get(
            "/api/v1/apm/transactions", params={"system_ids": [s.id], "limit": 5, "offset": 5})
    body = resp.json()
    assert body["has_more"] is False
    assert [i["span_id"] for i in body["items"]] == [r["span_id"] for r in rows[5:7]]
    assert qm.await_args_list[1].args[1]["top_n"] == 11


async def test_transactions_skips_phase2_when_empty(authed_client, db_session):
    s = await _system(db_session)
    qm = AsyncMock(return_value=[])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions", params={"system_ids": [s.id]})
    assert resp.json() == {"items": [], "has_more": False, "counts": {"total": 0, "normal": 0, "error": 0}}
    assert qm.await_count == 2


async def test_transactions_rejects_range_beyond_retention(authed_client, db_session):
    s = await _system(db_session, retention=7)
    qm = AsyncMock(return_value=[])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions", params={
            "system_ids": [s.id], "start": "2026-10-10T00:00:00Z", "end": "2026-10-20T00:00:01Z",
        })
    assert resp.status_code == 422
    qm.assert_not_awaited()


async def test_transactions_elapsed_range_filter(authed_client, db_session):
    s = await _system(db_session)
    qm = AsyncMock(return_value=[])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions", params={
            "system_ids": [s.id], "min_elapsed_ms": 100, "max_elapsed_ms": 500,
        })
    assert resp.status_code == 200
    sql, params = qm.await_args_list[0].args  # counts 쿼리도 동일 WHERE
    assert "elapsed_ms >= {min_elapsed_ms:UInt32}" in sql and "elapsed_ms < {max_elapsed_ms:UInt32}" in sql
    assert params["min_elapsed_ms"] == 100 and params["max_elapsed_ms"] == 500


async def test_query_uses_bound_params(authed_client, db_session):
    s = await _system(db_session)
    evil = "x' OR 1=1"
    qm = AsyncMock(side_effect=[[{"id": "7"}], [], []])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions", params={
            "system_ids": [s.id], "uri": evil, "user_id": evil, "trace_id": evil,
        })
    assert resp.status_code == 200
    assert qm.await_count == 3
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
        [{"sql_id": "255", "db": "ORCL", "cnt": 2, "ms": 30, "max_ms": 20, "fetch_cnt": 1, "fetch_ms": 3, "err": 0}],
        [{"id": "255", "text": "SELECT ?"}],                    # dict_sql
        [{"nodes": '[{"n":1}]', "stacks": "{}",
          "params": '{"q":"a=1&pw=****","p":[["a","1"],["pw","****"],["bad"]],"t":true}'}],  # tx_detail
    ])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get(f"/api/v1/apm/transactions/{TRACE}/{SPAN}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["span_id"] == SPAN
    assert [p["span_id"] for p in body["path"]] == ["c" * 16, SPAN]
    assert body["sql"][0]["sql_id"] == "00000000000000ff"
    assert body["sql"][0]["sql_text"] == "SELECT ?"
    assert body["sql"][0]["db"] == "ORCL"
    assert "db" in qm.call_args_list[2].args[0]
    assert body["detail"]["nodes"] == [{"n": 1}]
    assert body["params"] == {"q": "a=1&pw=****", "p": [["a", "1"], ["pw", "****"]], "t": True}
    assert "params" in qm.call_args_list[4].args[0]
    # tx_sql / tx_detail 조회는 system_id + start_ts 로 가지치기돼야 한다 (전체 테이블 스캔 방지)
    for call_idx in (2, 4):
        sql, params = qm.call_args_list[call_idx].args
        assert "system_id = {system_id:UInt32}" in sql
        assert "start_ts = {start_ts:DateTime64(3, 'UTC')}" in sql
        assert params["system_id"] == s.id
        assert params["start_ts"] == "2026-10-30 01:00:01.000"


@pytest.mark.parametrize("raw", ["", None, "not json", "[]", '{"q":"","p":[],"t":false}'])
async def test_detail_params_null_when_absent_or_invalid(authed_client, db_session, raw):
    s = await _system(db_session)
    qm = AsyncMock(side_effect=[
        [_row(system_id=s.id, span=SPAN, start_ts="2026-10-30 01:00:01.000", has_detail=1)],
        [{"id": "7", "text": "/a/b"}],
        [],
        [{"nodes": "[]", "stacks": "[]", "params": raw}],
    ])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get(f"/api/v1/apm/transactions/{TRACE}/{SPAN}")
    assert resp.status_code == 200
    assert resp.json()["params"] is None
    assert resp.json()["detail"] is not None


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


async def test_counts_dedupe_and_host(authed_client, db_session):
    s = await _system(db_session)
    rows = [_row(i, system_id=s.id, host="was-host-1") for i in range(2)]
    qm = AsyncMock(side_effect=[[CNT], _keys(rows), rows, [{"id": "7", "text": "/a"}]])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions", params={"system_ids": [s.id]})
    body = resp.json()
    assert body["counts"] == {"total": 3, "normal": 2, "error": 1}
    assert body["items"][0]["host"] == "was-host-1"
    csql = qm.await_args_list[0].args[0]
    assert "uniqExact(span_id)" in csql and "error = 1" in csql and "LIMIT" not in csql


async def test_order_by_and_validation(authed_client, db_session):
    s = await _system(db_session)
    for col in ("start_ts", "elapsed_ms", "sql_ms", "cpu_ms", "fetch_cnt", "sql_cnt", "ext_ms"):
        qm = AsyncMock(return_value=[])
        with patch("services.clickhouse_client.query", qm):
            resp = await authed_client.get("/api/v1/apm/transactions", params={
                "system_ids": [s.id], "order_by": col, "order": "asc"})
        assert resp.status_code == 200
        assert f"ORDER BY {col} ASC" in qm.await_args_list[1].args[0]
    qm = AsyncMock(return_value=[])
    with patch("services.clickhouse_client.query", qm):
        r1 = await authed_client.get("/api/v1/apm/transactions", params={"system_ids": [s.id]})
        assert "ORDER BY start_ts DESC" in qm.await_args_list[1].args[0]
        bad1 = await authed_client.get("/api/v1/apm/transactions", params={
            "system_ids": [s.id], "order_by": "elapsed_ms; DROP TABLE x"})
        bad2 = await authed_client.get("/api/v1/apm/transactions", params={
            "system_ids": [s.id], "order": "sideways"})
    assert r1.status_code == 200
    assert bad1.status_code == 422 and bad2.status_code == 422


async def test_new_filters_bound(authed_client, db_session):
    s = await _system(db_session)
    qm = AsyncMock(return_value=[])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions", params={
            "system_ids": [s.id], "min_fetch_cnt": 5, "min_sql_cnt": 3, "min_conn_open": 2,
            "biz_key": "ORD_1%", "span_id": "x' OR 1=1"})
    assert resp.status_code == 200
    sql, params = qm.await_args_list[0].args
    assert "fetch_cnt >= {min_fetch_cnt:UInt32}" in sql
    assert "sql_cnt >= {min_sql_cnt:UInt32}" in sql
    assert "conn_open >= {min_conn_open:UInt32}" in sql
    assert "biz_key LIKE {biz_key:String}" in sql and "span_id = {span_id:String}" in sql
    assert "OR 1=1" not in sql
    assert params["min_fetch_cnt"] == 5 and params["min_sql_cnt"] == 3 and params["min_conn_open"] == 2
    assert params["biz_key"] == "ORD\\_1%" and params["span_id"] == "x' OR 1=1"
    # 정확 일치
    qm2 = AsyncMock(return_value=[])
    with patch("services.clickhouse_client.query", qm2):
        await authed_client.get("/api/v1/apm/transactions", params={"system_ids": [s.id], "biz_key": "K1"})
    sql2, params2 = qm2.await_args_list[0].args
    assert "biz_key = {biz_key:String}" in sql2 and params2["biz_key"] == "K1"
    for bad in ("min_fetch_cnt", "min_sql_cnt", "min_conn_open"):
        r = await authed_client.get("/api/v1/apm/transactions", params={"system_ids": [s.id], bad: -1})
        assert r.status_code == 422


async def test_stats_by_uri(authed_client, db_session):
    s = await _system(db_session)
    groups = [
        {"uri_id": "7", "cnt": "3", "err_cnt": "1", "elapsed_max": 900, "elapsed_avg": 400.4,
         "sql_max": 300, "sql_avg": 100.5, "ext_max": 50, "ext_avg": 10.2, "ap_avg": 289.6},
        {"uri_id": "8", "cnt": "1", "err_cnt": "0", "elapsed_max": 5, "elapsed_avg": 5.0,
         "sql_max": 0, "sql_avg": 0.0, "ext_max": 0, "ext_avg": 0.0, "ap_avg": 5.0},
    ]
    qm = AsyncMock(side_effect=[
        [{"total": "4"}], groups, [{"id": "7", "text": "/a"}, {"id": "8", "text": "/b"}]])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions/stats-by-uri", params={
            "system_ids": [s.id], "min_elapsed_ms": 1, "limit": 50})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 4
    assert body["items"][0] == {
        "uri": "/a", "count": 3, "error_count": 1, "ratio": 75.0, "elapsed_max": 900,
        "elapsed_avg": 400, "sql_max": 300, "sql_avg": 100, "ext_max": 50, "ext_avg": 10, "ap_avg": 290}
    assert body["items"][1]["ratio"] == 25.0
    sql, params = qm.await_args_list[1].args
    assert "GROUP BY uri_id ORDER BY cnt DESC" in sql and "greatest(" in sql
    assert params["stat_limit"] == 50 and params["min_elapsed_ms"] == 1
    big = await authed_client.get("/api/v1/apm/transactions/stats-by-uri", params={
        "system_ids": [s.id], "limit": 1001})
    assert big.status_code == 422


async def test_hourly_24_buckets_kst(authed_client, db_session):
    s = await _system(db_session)
    rows = [
        {"hour": "09", "cnt": "4", "elapsed_avg": 120.6, "sql_sum": "100", "sql_cnt_sum": "8"},
        {"hour": "23", "cnt": "1", "elapsed_avg": 10.0, "sql_sum": "0", "sql_cnt_sum": "0"},
    ]
    qm = AsyncMock(return_value=rows)
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get("/api/v1/apm/transactions/hourly", params={
            "system_ids": [s.id], "error_only": True})
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert [i["hour"] for i in items] == [f"{h:02d}" for h in range(24)]
    assert items[9] == {"hour": "09", "count": 4, "elapsed_avg": 121, "sql_avg_per_exec": 12.5}
    assert items[0] == {"hour": "00", "count": 0, "elapsed_avg": 0, "sql_avg_per_exec": 0.0}
    assert items[23]["sql_avg_per_exec"] == 0.0
    sql, params = qm.await_args_list[0].args
    assert "toTimeZone(start_ts, {tz:String})" in sql and params["tz"] == "Asia/Seoul"
    assert "error = 1" in sql
