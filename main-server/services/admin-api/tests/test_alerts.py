from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


SYSTEM_PAYLOAD = {
    "system_name": "was-server",
    "display_name": "WAS 서버",
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

async def test_receive_alert_no_webhook(authed_client: AsyncClient):
    """webhook URL 없을 때: no_webhook 상태로 history 저장"""
    await create_system(authed_client)

    resp = await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    processed = resp.json()["processed"]
    assert len(processed) == 1
    assert processed[0]["alertname"] == "HighCpuUsage"
    assert processed[0]["status"] == "no_webhook"


async def test_receive_alert_sent(authed_client: AsyncClient):
    """webhook URL 있고 발송 성공: sent 상태 반환"""
    await create_system(authed_client)

    with patch("routes.alerts.DEFAULT_WEBHOOK_URL", "https://teams.example.com/webhook"), \
         patch("routes.alerts.notifier.send_metric_alert", new_callable=AsyncMock, return_value=True):
        resp = await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    assert resp.json()["processed"][0]["status"] == "sent"


async def test_receive_alert_saves_history(authed_client: AsyncClient):
    """alert_history에 저장되는지 확인"""
    system = await create_system(authed_client)

    await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    resp = await authed_client.get(f"/api/v1/alerts?system_id={system['id']}")
    assert resp.status_code == 200
    history = resp.json()
    assert len(history) == 1
    assert history[0]["alertname"] == "HighCpuUsage"
    assert history[0]["severity"] == "critical"
    assert history[0]["alert_type"] == "metric"


async def test_receive_alert_unknown_system(authed_client: AsyncClient):
    """등록되지 않은 system_name: no_webhook로 history 저장 (system_id=None)"""
    resp = await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    assert resp.json()["processed"][0]["status"] == "no_webhook"


async def test_receive_alert_cooldown(authed_client: AsyncClient):
    """5분 이내 동일 알림 재수신: cooldown_skipped 반환"""
    await create_system(authed_client)

    with patch(
        "routes.alerts.notifier.send_metric_alert",
        new_callable=AsyncMock,
        return_value=True,
    ):
        await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)
        resp = await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    assert resp.json()["processed"][0]["status"] == "cooldown_skipped"


async def test_receive_resolved_alert_processed(authed_client: AsyncClient):
    """resolved 수신 시 원본 firing alert의 resolved_at이 채워짐"""
    await create_system(authed_client)

    # 1) firing alert 생성
    await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)
    alerts_before = (await authed_client.get("/api/v1/alerts")).json()
    assert len(alerts_before) == 1
    assert alerts_before[0]["resolved_at"] is None

    # 2) resolved 수신 — Alertmanager 는 firing 과 동일한 labelset 을 보냄
    payload = {
        "status": "resolved",
        "alerts": [{
            "status": "resolved",
            "labels": {
                "alertname": "HighCpuUsage",
                "system_name": "was-server",
                "instance_role": "was1",
                "severity": "critical",
                "host": "192.168.1.10",
            },
            "annotations": {},
        }],
    }
    resp = await authed_client.post("/api/v1/alerts/receive", json=payload)
    assert resp.status_code == 200
    assert resp.json()["processed"][0]["status"] == "resolved"

    # 3) 별도 row 생성 안 됨 — 원본 1개만 존재, resolved_at 채워짐
    alerts_after = (await authed_client.get("/api/v1/alerts")).json()
    assert len(alerts_after) == 1
    assert alerts_after[0]["resolved_at"] is not None


async def test_receive_resolved_duplicate_skipped(authed_client: AsyncClient):
    """같은 그룹의 resolved 가 중복 수신되면 Teams 는 1회만 발송되고 2번째는 스킵된다."""
    await create_system(authed_client)

    resolved_payload = {
        "status": "resolved",
        "alerts": [{
            "status": "resolved",
            "labels": {
                "alertname": "HighCpuUsage",
                "system_name": "was-server",
                "instance_role": "was1",
                "severity": "critical",
                "host": "192.168.1.10",
            },
            "annotations": {},
        }],
    }

    with patch("routes.alerts.DEFAULT_WEBHOOK_URL", "https://teams.example.com/webhook"), \
         patch("routes.alerts.notifier.send_metric_alert", new_callable=AsyncMock, return_value=True), \
         patch("routes.alerts.notifier.send_recovery_alert", new_callable=AsyncMock, return_value=True) as mock_recovery:
        # firing
        await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)
        # 첫 resolved — 정상 처리
        first = await authed_client.post("/api/v1/alerts/receive", json=resolved_payload)
        # 둘째 resolved — 같은 labelset 중복 수신
        second = await authed_client.post("/api/v1/alerts/receive", json=resolved_payload)

    assert first.json()["processed"][0]["status"] == "resolved"
    assert second.json()["processed"][0]["status"] == "resolved_duplicate_skipped"
    assert mock_recovery.await_count == 1

    # 원본 row 는 1개, resolved_at 채워진 상태 유지 (덮어쓰기 없음)
    alerts = (await authed_client.get("/api/v1/alerts")).json()
    assert len(alerts) == 1
    assert alerts[0]["resolved_at"] is not None


async def test_resolved_matches_specific_severity(authed_client: AsyncClient):
    """동일 alertname 이 warning·critical 로 각각 firing 된 상태에서
    critical 만 resolved 되면 critical row 만 복구 처리되고 warning row 는 미복구로 남는다."""
    await create_system(authed_client)

    warning_payload = {
        "status": "firing",
        "alerts": [{
            "status": "firing",
            "labels": {
                "alertname": "HighCpuUsage",
                "system_name": "was-server",
                "instance_role": "was1",
                "severity": "warning",
                "host": "192.168.1.10",
            },
            "annotations": {"summary": "warn"},
        }],
    }
    critical_payload = {
        "status": "firing",
        "alerts": [{
            "status": "firing",
            "labels": {
                "alertname": "HighCpuUsage",
                "system_name": "was-server",
                "instance_role": "was1",
                "severity": "critical",
                "host": "192.168.1.10",
            },
            "annotations": {"summary": "crit"},
        }],
    }
    await authed_client.post("/api/v1/alerts/receive", json=warning_payload)
    await authed_client.post("/api/v1/alerts/receive", json=critical_payload)

    # critical 만 resolved
    await authed_client.post("/api/v1/alerts/receive", json={
        "status": "resolved",
        "alerts": [{
            "status": "resolved",
            "labels": {
                "alertname": "HighCpuUsage",
                "system_name": "was-server",
                "instance_role": "was1",
                "severity": "critical",
                "host": "192.168.1.10",
            },
            "annotations": {},
        }],
    })

    alerts = (await authed_client.get("/api/v1/alerts")).json()
    by_sev = {a["severity"]: a for a in alerts}
    assert by_sev["critical"]["resolved_at"] is not None
    assert by_sev["warning"]["resolved_at"] is None


async def test_resolved_matches_specific_instance_role(authed_client: AsyncClient):
    """동일 alertname + severity 가 서로 다른 instance_role 에서 firing 된 상태에서
    한 쪽 instance_role 만 resolved 되면 해당 row 만 복구 처리됨.
    (host 만 다른 경우는 쿨다운 키에 host 가 없어 2번째 firing 이 쿨다운에 걸리므로 대상 제외)"""
    await create_system(authed_client)

    def firing(role: str):
        return {
            "status": "firing",
            "alerts": [{
                "status": "firing",
                "labels": {
                    "alertname": "HighCpuUsage",
                    "system_name": "was-server",
                    "instance_role": role,
                    "severity": "critical",
                    "host": "192.168.1.10",
                },
                "annotations": {"summary": role},
            }],
        }

    await authed_client.post("/api/v1/alerts/receive", json=firing("was1"))
    await authed_client.post("/api/v1/alerts/receive", json=firing("was2"))

    # was1 만 resolved
    await authed_client.post("/api/v1/alerts/receive", json={
        "status": "resolved",
        "alerts": [{
            "status": "resolved",
            "labels": {
                "alertname": "HighCpuUsage",
                "system_name": "was-server",
                "instance_role": "was1",
                "severity": "critical",
                "host": "192.168.1.10",
            },
            "annotations": {},
        }],
    })

    alerts = (await authed_client.get("/api/v1/alerts")).json()
    by_role = {a["instance_role"]: a for a in alerts}
    assert by_role["was1"]["resolved_at"] is not None
    assert by_role["was2"]["resolved_at"] is None


# ── 이력 조회 ─────────────────────────────────────────────────────────────────

async def test_list_alerts_filter_severity(authed_client: AsyncClient):
    """severity 필터 동작 확인"""
    await create_system(authed_client)
    await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    resp = await authed_client.get("/api/v1/alerts?severity=critical")
    assert resp.status_code == 200
    assert all(a["severity"] == "critical" for a in resp.json())

    resp = await authed_client.get("/api/v1/alerts?severity=info")
    assert resp.json() == []


async def test_list_alerts_filter_alert_type(authed_client: AsyncClient):
    """alert_type 필터 동작 확인"""
    await create_system(authed_client)
    await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    resp = await authed_client.get("/api/v1/alerts?alert_type=metric")
    assert len(resp.json()) == 1

    resp = await authed_client.get("/api/v1/alerts?alert_type=log_analysis")
    assert resp.json() == []


async def test_list_alerts_filter_resolved(authed_client: AsyncClient):
    """resolved 필터 동작 확인"""
    await create_system(authed_client)
    await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    # 미복구 상태
    resp = await authed_client.get("/api/v1/alerts?resolved=false")
    assert len(resp.json()) == 1

    resp = await authed_client.get("/api/v1/alerts?resolved=true")
    assert resp.json() == []

    # resolved 처리 — firing 과 동일한 labelset 필요 (Alertmanager 동작 모사)
    payload = {
        "status": "resolved",
        "alerts": [{
            "status": "resolved",
            "labels": {
                "alertname": "HighCpuUsage",
                "system_name": "was-server",
                "instance_role": "was1",
                "severity": "critical",
                "host": "192.168.1.10",
            },
            "annotations": {},
        }],
    }
    await authed_client.post("/api/v1/alerts/receive", json=payload)

    resp = await authed_client.get("/api/v1/alerts?resolved=true")
    assert len(resp.json()) == 1

    resp = await authed_client.get("/api/v1/alerts?resolved=false")
    assert resp.json() == []


async def test_list_alerts_filter_acknowledged(authed_client: AsyncClient):
    """acknowledged 필터 동작 확인"""
    await create_system(authed_client)
    await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    resp = await authed_client.get("/api/v1/alerts?acknowledged=false")
    assert len(resp.json()) == 1

    resp = await authed_client.get("/api/v1/alerts?acknowledged=true")
    assert resp.json() == []


# ── acknowledge ───────────────────────────────────────────────────────────────

async def test_acknowledge_alert(authed_client: AsyncClient):
    """알림 확인 처리: acknowledged=True, acknowledged_by 저장"""
    await create_system(authed_client)
    await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    history = (await authed_client.get("/api/v1/alerts")).json()
    alert_id = history[0]["id"]

    resp = await authed_client.post(
        f"/api/v1/alerts/{alert_id}/acknowledge",
        json={"acknowledged_by": "admin"}
    )
    assert resp.status_code == 200
    assert resp.json()["acknowledged"] is True


async def test_acknowledge_alert_not_found(authed_client: AsyncClient):
    resp = await authed_client.post(
        "/api/v1/alerts/9999/acknowledge",
        json={"acknowledged_by": "admin"}
    )
    assert resp.status_code == 404


# ── related_trace_ids (Agent-T / ClickHouse) ─────────────────────────────────

async def _add_agent_t(client: AsyncClient, system_id: int) -> None:
    resp = await client.post(
        "/api/v1/agents",
        json={"system_id": system_id, "host": "10.0.0.1", "agent_type": "agent_t", "ssh_username": "was"},
    )
    assert resp.status_code == 201


async def _set_agent_t_status(db_session, status_value: str) -> None:
    from sqlalchemy import update
    from models import AgentInstance
    await db_session.execute(update(AgentInstance).where(AgentInstance.agent_type == "agent_t").values(status=status_value))
    await db_session.commit()


async def _stored_trace_ids(db_session):
    from sqlalchemy import select
    from models import AlertHistory
    rows = (await db_session.execute(select(AlertHistory.related_trace_ids))).scalars().all()
    assert len(rows) == 1
    return rows[0]


async def test_alert_related_traces_from_clickhouse(authed_client: AsyncClient, db_session):
    """agent_t 보유 시스템: tx_summary 에러 트랜잭션 trace_id 가 related_trace_ids 로 저장"""
    system = await create_system(authed_client)
    await _add_agent_t(authed_client, system["id"])
    await _set_agent_t_status(db_session, "running")

    mock_query = AsyncMock(return_value=[{"tid": "a" * 32}, {"tid": "b" * 32}])
    with patch("routes.alerts.clickhouse_client.query", mock_query):
        resp = await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    assert await _stored_trace_ids(db_session) == ["a" * 32, "b" * 32]
    sql, params = mock_query.call_args.args
    assert "agent_t.tx_summary" in sql and "error = 1" in sql
    assert "DateTime64(3, 'UTC')" in sql and "ORDER BY last_ts DESC" in sql
    assert params["system_id"] == system["id"]
    assert params["limit"] == 5


async def test_alert_related_traces_skipped_without_agent_t(authed_client: AsyncClient, db_session):
    await create_system(authed_client)
    mock_query = AsyncMock(return_value=[{"tid": "a" * 32}])
    with patch("routes.alerts.clickhouse_client.query", mock_query):
        resp = await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    mock_query.assert_not_called()
    assert await _stored_trace_ids(db_session) is None


async def test_alert_related_traces_clickhouse_error_swallowed(authed_client: AsyncClient, db_session):
    from services.clickhouse_client import ClickHouseError
    system = await create_system(authed_client)
    await _add_agent_t(authed_client, system["id"])
    await _set_agent_t_status(db_session, "installed")

    with patch("routes.alerts.clickhouse_client.query", AsyncMock(side_effect=ClickHouseError("down"))):
        resp = await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    assert resp.json()["processed"][0]["status"] == "no_webhook"
    assert await _stored_trace_ids(db_session) is None


async def test_alert_related_traces_clickhouse_timeout_swallowed(authed_client: AsyncClient, db_session, monkeypatch):
    import asyncio
    from routes import alerts
    system = await create_system(authed_client)
    await _add_agent_t(authed_client, system["id"])
    await _set_agent_t_status(db_session, "running")
    monkeypatch.setattr(alerts, "_CLICKHOUSE_ALERT_TIMEOUT_S", 0.05)

    async def hang(*_a, **_k):
        await asyncio.sleep(5)

    with patch("routes.alerts.clickhouse_client.query", hang):
        resp = await authed_client.post("/api/v1/alerts/receive", json=ALERT_PAYLOAD)

    assert resp.status_code == 200
    assert await _stored_trace_ids(db_session) is None
