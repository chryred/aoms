from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


SYSTEM_PAYLOAD = {"system_name": "was-server", "display_name": "WAS 서버"}

ALERT_CRITICAL = {
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
                "description": "CPU 과부하",
            },
        }
    ],
}


async def _create_system(client: AsyncClient) -> dict:
    resp = await client.post("/api/v1/systems", json=SYSTEM_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()


async def _fire_alert(client: AsyncClient, alertname: str = "HighCpuUsage", severity: str = "critical"):
    """Alertmanager webhook 발송 헬퍼."""
    payload = {
        "status": "firing",
        "alerts": [{
            "status": "firing",
            "labels": {
                "alertname": alertname,
                "system_name": "was-server",
                "instance_role": "was1",
                "severity": severity,
                "host": "192.168.1.10",
            },
            "annotations": {"summary": f"{alertname} 발생", "description": ""},
        }],
    }
    with patch("routes.alerts.DEFAULT_WEBHOOK_URL", ""), \
         patch("routes.alerts.notifier.send_metric_alert", new_callable=AsyncMock, return_value=True):
        resp = await client.post("/api/v1/alerts/receive", json=payload)
    assert resp.status_code == 200
    return resp.json()


# ── 자동 인시던트 생성 ────────────────────────────────────────────────────────

async def test_alert_creates_incident(authed_client: AsyncClient):
    """알림 수신 시 인시던트가 자동 생성되고 alert_history에 연결된다."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)

    incidents = (await authed_client.get("/api/v1/incidents")).json()
    assert len(incidents) == 1
    assert incidents[0]["status"] == "open"
    assert incidents[0]["severity"] == "critical"
    assert incidents[0]["alert_count"] == 1


async def test_multiple_alerts_group_into_single_incident(authed_client: AsyncClient):
    """30분 이내 같은 시스템의 알림은 하나의 인시던트로 묶인다."""
    await _create_system(authed_client)
    await _fire_alert(authed_client, alertname="HighCpuUsage", severity="warning")
    await _fire_alert(authed_client, alertname="HighMemory", severity="critical")

    incidents = (await authed_client.get("/api/v1/incidents")).json()
    assert len(incidents) == 1
    # warning → critical 상향 조정 확인
    assert incidents[0]["severity"] == "critical"
    assert incidents[0]["alert_count"] == 2


# ── 상태 전이 ──────────────────────────────────────────────────────────────

async def test_acknowledge_sets_timestamp(authed_client: AsyncClient):
    """상태를 acknowledged로 변경 시 acknowledged_at이 설정된다."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)

    incidents = (await authed_client.get("/api/v1/incidents")).json()
    incident_id = incidents[0]["id"]

    resp = await authed_client.patch(
        f"/api/v1/incidents/{incident_id}", json={"status": "acknowledged"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "acknowledged"
    assert data["acknowledged_at"] is not None
    assert data["mtta_minutes"] is not None


async def test_resolve_sets_mttr(authed_client: AsyncClient):
    """해결 처리 시 resolved_at + MTTR이 계산된다."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)

    incidents = (await authed_client.get("/api/v1/incidents")).json()
    incident_id = incidents[0]["id"]

    resp = await authed_client.patch(
        f"/api/v1/incidents/{incident_id}",
        json={"status": "resolved", "root_cause": "DB 락", "resolution": "재시작"},
    )
    data = resp.json()
    assert data["status"] == "resolved"
    assert data["resolved_at"] is not None
    assert data["root_cause"] == "DB 락"
    assert data["resolution"] == "재시작"
    assert data["mttr_minutes"] is not None


async def test_invalid_status_rejected(authed_client: AsyncClient):
    """유효하지 않은 status 값은 422."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)

    incidents = (await authed_client.get("/api/v1/incidents")).json()
    resp = await authed_client.patch(
        f"/api/v1/incidents/{incidents[0]['id']}", json={"status": "bogus"}
    )
    assert resp.status_code == 422


# ── 상세 조회 ──────────────────────────────────────────────────────────────

async def test_get_incident_includes_timeline_and_alerts(authed_client: AsyncClient):
    """상세 조회는 타임라인 + 연결 알림을 함께 반환한다."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)

    incidents = (await authed_client.get("/api/v1/incidents")).json()
    incident_id = incidents[0]["id"]

    resp = await authed_client.get(f"/api/v1/incidents/{incident_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["alert_history"]) == 1
    assert data["alert_history"][0]["alertname"] == "HighCpuUsage"
    assert len(data["timeline"]) >= 1
    assert data["timeline"][0]["event_type"] == "alert_added"


# ── 댓글 ──────────────────────────────────────────────────────────────────

async def test_add_comment(authed_client: AsyncClient):
    """댓글을 추가하면 타임라인에 등록된다."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)

    incidents = (await authed_client.get("/api/v1/incidents")).json()
    incident_id = incidents[0]["id"]

    resp = await authed_client.post(
        f"/api/v1/incidents/{incident_id}/comments",
        json={"comment": "DB팀에 문의 중"},
    )
    assert resp.status_code == 200
    assert resp.json()["event_type"] == "comment"
    assert resp.json()["description"] == "DB팀에 문의 중"


# ── 필터 ──────────────────────────────────────────────────────────────────

async def test_list_filter_by_status(authed_client: AsyncClient):
    """status 파라미터로 필터링 가능."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)

    incidents = (await authed_client.get("/api/v1/incidents")).json()
    await authed_client.patch(
        f"/api/v1/incidents/{incidents[0]['id']}", json={"status": "resolved"}
    )

    open_list = (await authed_client.get("/api/v1/incidents", params={"status": "open"})).json()
    resolved_list = (await authed_client.get("/api/v1/incidents", params={"status": "resolved"})).json()

    assert len(open_list) == 0
    assert len(resolved_list) == 1


# ── LLM 기반 엔드포인트 ─────────────────────────────────────────────────────

async def test_incident_report_returns_llm_output(authed_client: AsyncClient):
    """연결 알림 컨텍스트를 LLM에 전달해 보고서를 받는다."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)
    incidents = (await authed_client.get("/api/v1/incidents")).json()
    incident_id = incidents[0]["id"]

    with patch(
        "routes.incidents.call_llm_text",
        new_callable=AsyncMock,
        return_value="○ 장애발생일시 : 2026-04-21\n○ 장애원인 : DB 과부하\n",
    ):
        resp = await authed_client.post(f"/api/v1/incidents/{incident_id}/incident-report")

    assert resp.status_code == 200
    assert "장애원인" in resp.json()["report"]


async def test_incident_report_handles_llm_failure(authed_client: AsyncClient):
    """LLM이 빈 응답이면 503."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)
    incidents = (await authed_client.get("/api/v1/incidents")).json()

    with patch("routes.incidents.call_llm_text", new_callable=AsyncMock, return_value=""):
        resp = await authed_client.post(
            f"/api/v1/incidents/{incidents[0]['id']}/incident-report"
        )
    assert resp.status_code == 503


async def test_ai_analyze_parses_json_response(authed_client: AsyncClient):
    """LLM JSON 응답을 {root_cause, resolution, postmortem}으로 파싱."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)
    incidents = (await authed_client.get("/api/v1/incidents")).json()
    incident_id = incidents[0]["id"]

    llm_json = '{"root_cause": "DB 커넥션 풀 고갈", "resolution": "풀 크기 증가", "postmortem": "커넥션 모니터링 추가"}'
    with patch("routes.incidents.call_llm_text", new_callable=AsyncMock, return_value=llm_json):
        resp = await authed_client.post(f"/api/v1/incidents/{incident_id}/ai-analyze")

    assert resp.status_code == 200
    data = resp.json()
    assert data["root_cause"] == "DB 커넥션 풀 고갈"
    assert data["resolution"] == "풀 크기 증가"
    assert data["postmortem"] == "커넥션 모니터링 추가"


async def test_ai_analyze_handles_codefence_wrapped_json(authed_client: AsyncClient):
    """LLM이 ```json ``` 펜스로 감싼 응답도 파싱."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)
    incidents = (await authed_client.get("/api/v1/incidents")).json()

    wrapped = '```json\n{"root_cause":"A","resolution":"B","postmortem":"C"}\n```'
    with patch("routes.incidents.call_llm_text", new_callable=AsyncMock, return_value=wrapped):
        resp = await authed_client.post(
            f"/api/v1/incidents/{incidents[0]['id']}/ai-analyze"
        )
    assert resp.status_code == 200
    assert resp.json()["root_cause"] == "A"


async def test_ai_analyze_returns_502_on_malformed_json(authed_client: AsyncClient):
    """JSON 파싱 실패 시 502."""
    await _create_system(authed_client)
    await _fire_alert(authed_client)
    incidents = (await authed_client.get("/api/v1/incidents")).json()

    with patch(
        "routes.incidents.call_llm_text",
        new_callable=AsyncMock,
        return_value="plain text without json",
    ):
        resp = await authed_client.post(
            f"/api/v1/incidents/{incidents[0]['id']}/ai-analyze"
        )
    assert resp.status_code == 502
