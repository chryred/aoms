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

async def test_create_hourly(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    resp = await authed_client.post("/api/v1/aggregations/hourly", json={
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


async def test_create_hourly_upsert(authed_client: AsyncClient):
    """동일 키 재전송 시 업데이트 (upsert)"""
    system_id = await create_system(authed_client)
    payload = {
        "system_id": system_id,
        "hour_bucket": "2026-04-03T10:00:00",
        "collector_type": "node_exporter",
        "metric_group": "cpu",
        "metrics_json": "{}",
        "llm_severity": "normal",
    }
    await authed_client.post("/api/v1/aggregations/hourly", json=payload)

    payload["llm_severity"] = "warning"
    resp = await authed_client.post("/api/v1/aggregations/hourly", json=payload)
    assert resp.status_code == 201
    assert resp.json()["llm_severity"] == "warning"

    # 중복 저장 안 됨
    list_resp = await authed_client.get("/api/v1/aggregations/hourly", params={"system_id": system_id})
    assert len(list_resp.json()) == 1


async def test_get_hourly(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    create_resp = await authed_client.post("/api/v1/aggregations/hourly", json={
        "system_id": system_id,
        "hour_bucket": "2026-04-03T11:00:00",
        "collector_type": "node_exporter",
        "metric_group": "memory",
        "metrics_json": "{}",
        "llm_severity": "normal",
    })
    agg_id = create_resp.json()["id"]

    resp = await authed_client.get(f"/api/v1/aggregations/hourly/{agg_id}")
    assert resp.status_code == 200
    assert resp.json()["metric_group"] == "memory"


async def test_get_hourly_not_found(authed_client: AsyncClient):
    resp = await authed_client.get("/api/v1/aggregations/hourly/9999")
    assert resp.status_code == 404


async def test_list_hourly_filter_severity(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    for i, severity in enumerate(["normal", "warning", "critical"]):
        await authed_client.post("/api/v1/aggregations/hourly", json={
            "system_id": system_id,
            "hour_bucket": f"2026-04-03T{10+i}:00:00",
            "collector_type": "node_exporter",
            "metric_group": "cpu",
            "metrics_json": "{}",
            "llm_severity": severity,
        })

    resp = await authed_client.get("/api/v1/aggregations/hourly", params={"severity": "warning"})
    assert resp.status_code == 200
    items = resp.json()
    assert all(item["llm_severity"] == "warning" for item in items)


async def test_trend_alert(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    # llm_prediction 있는 critical 항목 생성 (현재 시각 기준 hour_bucket)
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:00:00")
    await authed_client.post("/api/v1/aggregations/hourly", json={
        "system_id": system_id,
        "hour_bucket": now_str,
        "collector_type": "node_exporter",
        "metric_group": "disk",
        "metrics_json": "{}",
        "llm_severity": "critical",
        "llm_prediction": "2시간 내 디스크 용량 고갈 예상",
    })

    resp = await authed_client.get("/api/v1/aggregations/trend-alert")
    assert resp.status_code == 200
    items = resp.json()
    assert isinstance(items, list)
    assert len(items) == 1
    assert items[0]["llm_prediction"] == "2시간 내 디스크 용량 고갈 예상"


# ── 1일 집계 ─────────────────────────────────────────────────────────────────

async def test_create_and_list_daily(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    resp = await authed_client.post("/api/v1/aggregations/daily", json={
        "system_id": system_id,
        "day_bucket": "2026-04-03T00:00:00",
        "collector_type": "node_exporter",
        "metric_group": "cpu",
        "metrics_json": '{"avg": 60.0}',
    })
    assert resp.status_code == 201

    list_resp = await authed_client.get("/api/v1/aggregations/daily", params={"system_id": system_id})
    assert len(list_resp.json()) == 1


async def test_create_daily_upsert(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    payload = {
        "system_id": system_id,
        "day_bucket": "2026-04-03T00:00:00",
        "collector_type": "node_exporter",
        "metric_group": "cpu",
        "metrics_json": "{}",
    }
    await authed_client.post("/api/v1/aggregations/daily", json=payload)
    await authed_client.post("/api/v1/aggregations/daily", json=payload)

    list_resp = await authed_client.get("/api/v1/aggregations/daily", params={"system_id": system_id})
    assert len(list_resp.json()) == 1


# ── 7일 집계 ─────────────────────────────────────────────────────────────────

async def test_create_and_list_weekly(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    resp = await authed_client.post("/api/v1/aggregations/weekly", json={
        "system_id": system_id,
        "week_start": "2026-03-30T00:00:00",
        "collector_type": "node_exporter",
        "metric_group": "cpu",
        "metrics_json": "{}",
    })
    assert resp.status_code == 201

    list_resp = await authed_client.get("/api/v1/aggregations/weekly", params={"system_id": system_id})
    assert len(list_resp.json()) == 1


# ── 월간 집계 ────────────────────────────────────────────────────────────────

async def test_create_and_list_monthly(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    resp = await authed_client.post("/api/v1/aggregations/monthly", json={
        "system_id": system_id,
        "period_start": "2026-04-01T00:00:00",
        "period_type": "monthly",
        "collector_type": "node_exporter",
        "metric_group": "cpu",
        "metrics_json": "{}",
    })
    assert resp.status_code == 201
    assert resp.json()["period_type"] == "monthly"

    list_resp = await authed_client.get("/api/v1/aggregations/monthly", params={"system_id": system_id})
    assert len(list_resp.json()) == 1


async def test_create_monthly_various_period_types(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    for period_type, period_start in [
        ("quarterly", "2026-01-01T00:00:00"),
        ("half_year", "2026-01-01T01:00:00"),
        ("annual",    "2026-01-01T02:00:00"),
    ]:
        resp = await authed_client.post("/api/v1/aggregations/monthly", json={
            "system_id": system_id,
            "period_start": period_start,
            "period_type": period_type,
            "collector_type": "node_exporter",
            "metric_group": "cpu",
            "metrics_json": "{}",
        })
        assert resp.status_code == 201
        assert resp.json()["period_type"] == period_type


# ── 대시보드 트렌드 합산 range query ──────────────────────────────────────────

async def test_metrics_range_batch_no_prometheus_url(authed_client: AsyncClient):
    """PROMETHEUS_URL 미설정 시 빈 dict 반환"""
    resp = await authed_client.get(
        "/api/v1/systems/metrics/range-batch",
        params={
            "metric_group": "cpu",
            "start_dt": "2026-06-09T00:00:00Z",
            "end_dt": "2026-06-09T01:00:00Z",
            "step": 60,
        },
    )
    assert resp.status_code == 200
    assert resp.json() == {}


async def test_metrics_range_batch_unknown_metric_group(authed_client: AsyncClient, monkeypatch):
    """정의되지 않은 metric_group은 빈 dict 반환"""
    monkeypatch.setattr("routes.aggregations._PROMETHEUS_URL", "http://prometheus:9090")
    resp = await authed_client.get(
        "/api/v1/systems/metrics/range-batch",
        params={
            "metric_group": "unknown",
            "start_dt": "2026-06-09T00:00:00Z",
            "end_dt": "2026-06-09T01:00:00Z",
            "step": 60,
        },
    )
    assert resp.status_code == 200
    assert resp.json() == {}


async def test_metrics_range_batch_groups_by_system_name(authed_client: AsyncClient, monkeypatch):
    """Prometheus 응답을 system_name 기준으로 묶어 반환"""
    import httpx
    from unittest.mock import AsyncMock, patch

    monkeypatch.setattr("routes.aggregations._PROMETHEUS_URL", "http://prometheus:9090")

    fake_response_json = {
        "data": {
            "result": [
                {
                    "metric": {"system_name": "sys-a"},
                    "values": [[1749427200, "12.5"], [1749427260, "13.0"]],
                },
                {
                    "metric": {"system_name": "sys-b"},
                    "values": [[1749427200, "20.0"]],
                },
            ]
        }
    }
    fake_resp = httpx.Response(
        200, json=fake_response_json, request=httpx.Request("GET", "http://prometheus:9090")
    )

    fake_client = AsyncMock()
    fake_client.get = AsyncMock(return_value=fake_resp)
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=None)

    with patch("httpx.AsyncClient", return_value=fake_client):
        resp = await authed_client.get(
            "/api/v1/systems/metrics/range-batch",
            params={
                "metric_group": "cpu",
                "start_dt": "2026-06-09T00:00:00Z",
                "end_dt": "2026-06-09T01:00:00Z",
                "step": 60,
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"sys-a", "sys-b"}
    assert body["sys-a"] == [
        {"hour_bucket": "2025-06-09T00:00:00", "value": 12.5},
        {"hour_bucket": "2025-06-09T00:01:00", "value": 13.0},
    ]
    assert body["sys-b"] == [{"hour_bucket": "2025-06-09T00:00:00", "value": 20.0}]
