from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


SYSTEM_PAYLOAD = {
    "system_name": "was-server",
    "display_name": "WAS 서버",
    "host": "192.168.1.10",
    "os_type": "linux",
    "system_type": "was",
}

ALERT_PAYLOAD = {
    "status": "firing",
    "alerts": [
        {
            "status": "firing",
            "labels": {
                "alertname": "HighCpuUsage",
                "system_name": "was-server",
                "instance_role": "was1",
                "severity": "critical",
                "host": "192.168.1.10",
            },
            "annotations": {
                "summary": "CPU 90% 초과",
                "description": "CPU 사용률이 5분 이상 90%를 초과했습니다.",
            },
        }
    ],
}


async def create_system(client: AsyncClient) -> dict:
    resp = await client.post("/api/v1/systems", json=SYSTEM_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()


# ── /receive ─────────────────────────────────────────────────────────────────

async def test_receive_alert_no_webhook(client: AsyncClient):
    """webhook URL 없을 때: no_webhook 상태로 history 저장"""
    await create_system(client)

    resp = await client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    processed = resp.json()["processed"]
    assert len(processed) == 1
    assert processed[0]["alertname"] == "HighCpuUsage"
    assert processed[0]["status"] == "no_webhook"


async def test_receive_alert_sent(client: AsyncClient):
    """webhook URL 있고 발송 성공: sent 상태 반환"""
    await create_system(client)

    with patch("routes.alerts.DEFAULT_WEBHOOK_URL", "https://teams.example.com/webhook"), \
         patch("routes.alerts.notifier.send_metric_alert", new_callable=AsyncMock, return_value=True):
        resp = await client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    assert resp.json()["processed"][0]["status"] == "sent"


async def test_receive_alert_saves_history(client: AsyncClient):
    """alert_history에 저장되는지 확인"""
    system = await create_system(client)

    await client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    resp = await client.get(f"/api/v1/alerts?system_id={system['id']}")
    assert resp.status_code == 200
    history = resp.json()
    assert len(history) == 1
    assert history[0]["alertname"] == "HighCpuUsage"
    assert history[0]["severity"] == "critical"
    assert history[0]["alert_type"] == "metric"


async def test_receive_alert_unknown_system(client: AsyncClient):
    """등록되지 않은 system_name: no_webhook로 history 저장 (system_id=None)"""
    resp = await client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    assert resp.json()["processed"][0]["status"] == "no_webhook"


async def test_receive_alert_cooldown(client: AsyncClient):
    """5분 이내 동일 알림 재수신: cooldown_skipped 반환"""
    await create_system(client)

    with patch(
        "routes.alerts.notifier.send_metric_alert",
        new_callable=AsyncMock,
        return_value=True,
    ):
        await client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)
        resp = await client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    assert resp.json()["processed"][0]["status"] == "cooldown_skipped"


async def test_receive_resolved_alert_processed(client: AsyncClient):
    """status=resolved 알림은 처리되어 resolved 상태로 반환됨"""
    await create_system(client)
    payload = {
        "status": "resolved",
        "alerts": [{
            "status": "resolved",
            "labels": {"alertname": "HighCpuUsage", "system_name": "was-server", "severity": "critical"},
            "annotations": {},
        }],
    }
    resp = await client.post("/api/v1/alerts/receive", json=payload)

    assert resp.status_code == 200
    processed = resp.json()["processed"]
    assert len(processed) == 1
    assert processed[0]["alertname"] == "HighCpuUsage"
    assert processed[0]["status"] == "resolved"


# ── 이력 조회 ─────────────────────────────────────────────────────────────────

async def test_list_alerts_filter_severity(client: AsyncClient):
    """severity 필터 동작 확인"""
    await create_system(client)
    await client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    resp = await client.get("/api/v1/alerts?severity=critical")
    assert resp.status_code == 200
    assert all(a["severity"] == "critical" for a in resp.json())

    resp = await client.get("/api/v1/alerts?severity=info")
    assert resp.json() == []


async def test_list_alerts_filter_acknowledged(client: AsyncClient):
    """acknowledged 필터 동작 확인"""
    await create_system(client)
    await client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    resp = await client.get("/api/v1/alerts?acknowledged=false")
    assert len(resp.json()) == 1

    resp = await client.get("/api/v1/alerts?acknowledged=true")
    assert resp.json() == []


# ── acknowledge ───────────────────────────────────────────────────────────────

async def test_acknowledge_alert(client: AsyncClient):
    """알림 확인 처리: acknowledged=True, acknowledged_by 저장"""
    await create_system(client)
    await client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    history = (await client.get("/api/v1/alerts")).json()
    alert_id = history[0]["id"]

    resp = await client.post(
        f"/api/v1/alerts/{alert_id}/acknowledge",
        json={"acknowledged_by": "admin"}
    )
    assert resp.status_code == 200
    assert resp.json()["acknowledged"] is True


async def test_acknowledge_alert_not_found(client: AsyncClient):
    resp = await client.post(
        "/api/v1/alerts/9999/acknowledge",
        json={"acknowledged_by": "admin"}
    )
    assert resp.status_code == 404
