from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


SYSTEM_PAYLOAD = {
    "system_name": "was-server",
    "display_name": "WAS 서버",
}

ANALYSIS_PAYLOAD = {
    "instance_role": "was1",
    "log_content": "ERROR: OutOfMemoryError at heap space\nException in thread main...",
    "analysis_result": "힙 메모리 부족으로 인한 OOM 오류",
    "severity": "critical",
    "root_cause": "힙 메모리 설정이 부족함",
    "recommendation": "JVM 힙 크기 증가 (-Xmx4g)",
    "model_used": "claude-sonnet-4-6",
    "processing_time": 1.23,
}


async def create_system(client: AsyncClient) -> dict:
    resp = await client.post("/api/v1/systems", json=SYSTEM_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()


# ── 등록 ─────────────────────────────────────────────────────────────────────

async def test_create_analysis_no_webhook(client: AsyncClient):
    """webhook 없는 상태에서 분석 결과 저장"""
    system = await create_system(client)
    payload = {**ANALYSIS_PAYLOAD, "system_id": system["id"]}

    resp = await client.post("/api/v1/analysis", json=payload)

    assert resp.status_code == 201
    data = resp.json()
    assert data["severity"] == "critical"
    assert data["root_cause"] == "힙 메모리 설정이 부족함"
    assert data["alert_sent"] is False


async def test_create_analysis_with_alert_sent(client: AsyncClient):
    """severity=critical + webhook 있으면 alert_sent=True"""
    system = await create_system(client)
    payload = {**ANALYSIS_PAYLOAD, "system_id": system["id"]}

    with patch("routes.analysis.DEFAULT_WEBHOOK_URL", "https://teams.example.com/webhook"), \
         patch("routes.analysis.notifier.send_log_analysis_alert", new_callable=AsyncMock, return_value=True):
        resp = await client.post("/api/v1/analysis", json=payload)

    assert resp.status_code == 201
    assert resp.json()["alert_sent"] is True


async def test_create_analysis_info_no_alert(client: AsyncClient):
    """severity=info이면 Teams 발송 없이 저장만"""
    system = await create_system(client)
    payload = {**ANALYSIS_PAYLOAD, "system_id": system["id"], "severity": "info"}

    with patch(
        "routes.analysis.notifier.send_log_analysis_alert",
        new_callable=AsyncMock,
        return_value=True,
    ) as mock_send:
        resp = await client.post("/api/v1/analysis", json=payload)

    assert resp.status_code == 201
    mock_send.assert_not_called()
    assert resp.json()["alert_sent"] is False


async def test_create_analysis_system_not_found(client: AsyncClient):
    payload = {**ANALYSIS_PAYLOAD, "system_id": 9999}
    resp = await client.post("/api/v1/analysis", json=payload)
    assert resp.status_code == 404


# ── 조회 ─────────────────────────────────────────────────────────────────────

async def test_list_analysis(client: AsyncClient):
    system = await create_system(client)
    payload = {**ANALYSIS_PAYLOAD, "system_id": system["id"]}

    await client.post("/api/v1/analysis", json=payload)
    await client.post("/api/v1/analysis", json={**payload, "severity": "warning"})

    resp = await client.get("/api/v1/analysis")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_list_analysis_filter_system(client: AsyncClient):
    system = await create_system(client)
    payload = {**ANALYSIS_PAYLOAD, "system_id": system["id"]}
    await client.post("/api/v1/analysis", json=payload)

    resp = await client.get(f"/api/v1/analysis?system_id={system['id']}")
    assert len(resp.json()) == 1

    resp = await client.get("/api/v1/analysis?system_id=9999")
    assert resp.json() == []


async def test_list_analysis_filter_severity(client: AsyncClient):
    system = await create_system(client)
    await client.post("/api/v1/analysis", json={**ANALYSIS_PAYLOAD, "system_id": system["id"], "severity": "critical"})
    await client.post("/api/v1/analysis", json={**ANALYSIS_PAYLOAD, "system_id": system["id"], "severity": "warning"})

    resp = await client.get("/api/v1/analysis?severity=critical")
    assert len(resp.json()) == 1
    assert resp.json()[0]["severity"] == "critical"


async def test_get_analysis(client: AsyncClient):
    system = await create_system(client)
    created = (await client.post("/api/v1/analysis", json={**ANALYSIS_PAYLOAD, "system_id": system["id"]})).json()

    resp = await client.get(f"/api/v1/analysis/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == created["id"]


async def test_get_analysis_not_found(client: AsyncClient):
    resp = await client.get("/api/v1/analysis/9999")
    assert resp.status_code == 404


# ── LLM/분석 실패 레코드 ─────────────────────────────────────────────────────

async def test_create_analysis_with_error_message_no_teams(client: AsyncClient):
    """error_message가 있으면 warning/critical severity여도 Teams 미발송 + alert_sent=False"""
    system = await create_system(client)
    payload = {
        **ANALYSIS_PAYLOAD,
        "system_id": system["id"],
        "severity": "critical",            # 평소라면 Teams 발송 트리거
        "error_message": "TimeoutError: LLM did not respond",
    }

    with patch("routes.analysis.DEFAULT_WEBHOOK_URL", "https://teams.example.com/webhook"), \
         patch(
             "routes.analysis.notifier.send_log_analysis_alert",
             new_callable=AsyncMock,
             return_value=True,
         ) as mock_send:
        resp = await client.post("/api/v1/analysis", json=payload)

    assert resp.status_code == 201
    data = resp.json()
    assert data["alert_sent"] is False
    assert data["error_message"] == "TimeoutError: LLM did not respond"
    mock_send.assert_not_called()


async def test_list_analysis_includes_failed_records(client: AsyncClient):
    """GET /api/v1/analysis 응답에 실패 레코드 포함 + error_message 필드 노출"""
    system = await create_system(client)
    # 성공 레코드 1건
    await client.post("/api/v1/analysis", json={**ANALYSIS_PAYLOAD, "system_id": system["id"]})
    # 실패 레코드 1건
    fail_payload = {
        **ANALYSIS_PAYLOAD,
        "system_id": system["id"],
        "severity": "info",
        "error_message": "ValueError: 응답 파싱 실패",
    }
    await client.post("/api/v1/analysis", json=fail_payload)

    resp = await client.get("/api/v1/analysis")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 2
    failed = [it for it in items if it.get("error_message")]
    assert len(failed) == 1
    assert failed[0]["error_message"] == "ValueError: 응답 파싱 실패"


async def test_create_analysis_failure_inserts_alert_history(client: AsyncClient):
    """분석 실패 레코드도 alert_history에 삽입되어 피드백 관리 목록에 노출되는지 확인"""
    system = await create_system(client)
    fail_payload = {
        **ANALYSIS_PAYLOAD,
        "system_id": system["id"],
        "severity": "info",
        "error_message": "RuntimeError: LLM endpoint unreachable",
    }

    with patch(
        "routes.analysis.notifier.send_log_analysis_alert",
        new_callable=AsyncMock,
        return_value=True,
    ) as mock_send:
        resp = await client.post("/api/v1/analysis", json=fail_payload)
    assert resp.status_code == 201
    mock_send.assert_not_called()

    # alert_history 에 동반 레코드가 생겼는지 확인 (log_analysis 타입)
    alerts = (await client.get("/api/v1/alerts?alert_type=log_analysis")).json()
    failure_alerts = [a for a in alerts if a.get("error_message")]
    assert len(failure_alerts) >= 1
    assert failure_alerts[0]["error_message"] == "RuntimeError: LLM endpoint unreachable"
    assert failure_alerts[0]["title"] == "LLM 분석 실패"
