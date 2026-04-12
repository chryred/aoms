"""
Phase 5 — /api/v1/aggregations 단위 테스트
시간/일/주/월 집계 CRUD + trend-alert 조회
"""

import pytest
from datetime import datetime, timezone
from httpx import AsyncClient


SYSTEM_PAYLOAD = {
    "system_name": "agg-test-server",
    "display_name": "Aggregation Test Server",
}


async def create_system(client: AsyncClient) -> int:
    resp = await client.post("/api/v1/systems", json=SYSTEM_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()["id"]


# ── 1시간 집계 ────────────────────────────────────────────────────────────────

async def test_create_hourly(client: AsyncClient):
    system_id = await create_system(client)
    resp = await client.post("/api/v1/aggregations/hourly", json={
        "system_id": system_id,
        "hour_bucket": "2026-04-03T10:00:00",
        "collector_type": "node_exporter",
        "metric_group": "cpu",
        "metrics_json": '{"avg": 75.0, "max": 92.0}',
        "llm_severity": "warning",
        "llm_trend": "상승",
        "llm_summary": "CPU 사용률 상승 추세",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["collector_type"] == "node_exporter"
    assert data["llm_severity"] == "warning"


async def test_create_hourly_upsert(client: AsyncClient):
    """동일 키 재전송 시 업데이트 (upsert)"""
    system_id = await create_system(client)
    payload = {
        "system_id": system_id,
        "hour_bucket": "2026-04-03T10:00:00",
        "collector_type": "node_exporter",
        "metric_group": "cpu",
        "metrics_json": "{}",
        "llm_severity": "normal",
    }
    await client.post("/api/v1/aggregations/hourly", json=payload)

    payload["llm_severity"] = "warning"
    resp = await client.post("/api/v1/aggregations/hourly", json=payload)
    assert resp.status_code == 201
    assert resp.json()["llm_severity"] == "warning"

    # 중복 저장 안 됨
    list_resp = await client.get("/api/v1/aggregations/hourly", params={"system_id": system_id})
    assert len(list_resp.json()) == 1


async def test_get_hourly(client: AsyncClient):
    system_id = await create_system(client)
    create_resp = await client.post("/api/v1/aggregations/hourly", json={
        "system_id": system_id,
        "hour_bucket": "2026-04-03T11:00:00",
        "collector_type": "node_exporter",
        "metric_group": "memory",
        "metrics_json": "{}",
        "llm_severity": "normal",
    })
    agg_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/aggregations/hourly/{agg_id}")
    assert resp.status_code == 200
    assert resp.json()["metric_group"] == "memory"


async def test_get_hourly_not_found(client: AsyncClient):
    resp = await client.get("/api/v1/aggregations/hourly/9999")
    assert resp.status_code == 404


async def test_list_hourly_filter_severity(client: AsyncClient):
    system_id = await create_system(client)
    for i, severity in enumerate(["normal", "warning", "critical"]):
        await client.post("/api/v1/aggregations/hourly", json={
            "system_id": system_id,
            "hour_bucket": f"2026-04-03T{10+i}:00:00",
            "collector_type": "node_exporter",
            "metric_group": "cpu",
            "metrics_json": "{}",
            "llm_severity": severity,
        })

    resp = await client.get("/api/v1/aggregations/hourly", params={"severity": "warning"})
    assert resp.status_code == 200
    items = resp.json()
    assert all(item["llm_severity"] == "warning" for item in items)


async def test_trend_alert(client: AsyncClient):
    system_id = await create_system(client)
    # llm_prediction 있는 critical 항목 생성 (현재 시각 기준 hour_bucket)
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:00:00")
    await client.post("/api/v1/aggregations/hourly", json={
        "system_id": system_id,
        "hour_bucket": now_str,
        "collector_type": "node_exporter",
        "metric_group": "disk",
        "metrics_json": "{}",
        "llm_severity": "critical",
        "llm_prediction": "2시간 내 디스크 용량 고갈 예상",
    })

    resp = await client.get("/api/v1/aggregations/trend-alert")
    assert resp.status_code == 200
    items = resp.json()
    assert isinstance(items, list)
    assert len(items) == 1
    assert items[0]["llm_prediction"] == "2시간 내 디스크 용량 고갈 예상"


# ── 1일 집계 ─────────────────────────────────────────────────────────────────

async def test_create_and_list_daily(client: AsyncClient):
    system_id = await create_system(client)
    resp = await client.post("/api/v1/aggregations/daily", json={
        "system_id": system_id,
        "day_bucket": "2026-04-03T00:00:00",
        "collector_type": "node_exporter",
        "metric_group": "cpu",
        "metrics_json": '{"avg": 60.0}',
    })
    assert resp.status_code == 201

    list_resp = await client.get("/api/v1/aggregations/daily", params={"system_id": system_id})
    assert len(list_resp.json()) == 1


async def test_create_daily_upsert(client: AsyncClient):
    system_id = await create_system(client)
    payload = {
        "system_id": system_id,
        "day_bucket": "2026-04-03T00:00:00",
        "collector_type": "node_exporter",
        "metric_group": "cpu",
        "metrics_json": "{}",
    }
    await client.post("/api/v1/aggregations/daily", json=payload)
    await client.post("/api/v1/aggregations/daily", json=payload)

    list_resp = await client.get("/api/v1/aggregations/daily", params={"system_id": system_id})
    assert len(list_resp.json()) == 1


# ── 7일 집계 ─────────────────────────────────────────────────────────────────

async def test_create_and_list_weekly(client: AsyncClient):
    system_id = await create_system(client)
    resp = await client.post("/api/v1/aggregations/weekly", json={
        "system_id": system_id,
        "week_start": "2026-03-30T00:00:00",
        "collector_type": "node_exporter",
        "metric_group": "cpu",
        "metrics_json": "{}",
    })
    assert resp.status_code == 201

    list_resp = await client.get("/api/v1/aggregations/weekly", params={"system_id": system_id})
    assert len(list_resp.json()) == 1


# ── 월간 집계 ────────────────────────────────────────────────────────────────

async def test_create_and_list_monthly(client: AsyncClient):
    system_id = await create_system(client)
    resp = await client.post("/api/v1/aggregations/monthly", json={
        "system_id": system_id,
        "period_start": "2026-04-01T00:00:00",
        "period_type": "monthly",
        "collector_type": "node_exporter",
        "metric_group": "cpu",
        "metrics_json": "{}",
    })
    assert resp.status_code == 201
    assert resp.json()["period_type"] == "monthly"

    list_resp = await client.get("/api/v1/aggregations/monthly", params={"system_id": system_id})
    assert len(list_resp.json()) == 1


async def test_create_monthly_various_period_types(client: AsyncClient):
    system_id = await create_system(client)
    for period_type, period_start in [
        ("quarterly", "2026-01-01T00:00:00"),
        ("half_year", "2026-01-01T01:00:00"),
        ("annual",    "2026-01-01T02:00:00"),
    ]:
        resp = await client.post("/api/v1/aggregations/monthly", json={
            "system_id": system_id,
            "period_start": period_start,
            "period_type": period_type,
            "collector_type": "node_exporter",
            "metric_group": "cpu",
            "metrics_json": "{}",
        })
        assert resp.status_code == 201
        assert resp.json()["period_type"] == period_type
