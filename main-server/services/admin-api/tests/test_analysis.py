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

async def test_create_analysis_no_webhook(authed_client: AsyncClient):
    """webhook 없는 상태에서 분석 결과 저장"""
    system = await create_system(authed_client)
    payload = {**ANALYSIS_PAYLOAD, "system_id": system["id"]}

    resp = await authed_client.post("/api/v1/analysis", json=payload)

    assert resp.status_code == 201
    data = resp.json()
    assert data["severity"] == "critical"
    assert data["root_cause"] == "힙 메모리 설정이 부족함"
    assert data["alert_sent"] is False


async def test_create_analysis_with_alert_sent(authed_client: AsyncClient):
    """severity=critical + webhook 있으면 alert_sent=True"""
    system = await create_system(authed_client)
    payload = {**ANALYSIS_PAYLOAD, "system_id": system["id"]}

    with patch("routes.analysis.DEFAULT_WEBHOOK_URL", "https://teams.example.com/webhook"), \
         patch("routes.analysis.notifier.send_log_analysis_alert", new_callable=AsyncMock, return_value=True):
        resp = await authed_client.post("/api/v1/analysis", json=payload)

    assert resp.status_code == 201
    assert resp.json()["alert_sent"] is True


async def test_create_analysis_info_no_alert(authed_client: AsyncClient):
    """severity=info이면 Teams 발송 없이 저장만"""
    system = await create_system(authed_client)
    payload = {**ANALYSIS_PAYLOAD, "system_id": system["id"], "severity": "info"}

    with patch(
        "routes.analysis.notifier.send_log_analysis_alert",
        new_callable=AsyncMock,
        return_value=True,
    ) as mock_send:
        resp = await authed_client.post("/api/v1/analysis", json=payload)

    assert resp.status_code == 201
    mock_send.assert_not_called()
    assert resp.json()["alert_sent"] is False


async def test_create_analysis_system_not_found(authed_client: AsyncClient):
    payload = {**ANALYSIS_PAYLOAD, "system_id": 9999}
    resp = await authed_client.post("/api/v1/analysis", json=payload)
    assert resp.status_code == 404


# ── 조회 ─────────────────────────────────────────────────────────────────────

async def test_list_analysis(authed_client: AsyncClient):
    system = await create_system(authed_client)
    payload = {**ANALYSIS_PAYLOAD, "system_id": system["id"]}

    await authed_client.post("/api/v1/analysis", json=payload)
    await authed_client.post("/api/v1/analysis", json={**payload, "severity": "warning"})

    resp = await authed_client.get("/api/v1/analysis")
    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_list_analysis_filter_system(authed_client: AsyncClient):
    system = await create_system(authed_client)
    payload = {**ANALYSIS_PAYLOAD, "system_id": system["id"]}
    await authed_client.post("/api/v1/analysis", json=payload)

    resp = await authed_client.get(f"/api/v1/analysis?system_id={system['id']}")
    assert len(resp.json()) == 1

    resp = await authed_client.get("/api/v1/analysis?system_id=9999")
    assert resp.json() == []


async def test_list_analysis_filter_severity(authed_client: AsyncClient):
    system = await create_system(authed_client)
    await authed_client.post("/api/v1/analysis", json={**ANALYSIS_PAYLOAD, "system_id": system["id"], "severity": "critical"})
    await authed_client.post("/api/v1/analysis", json={**ANALYSIS_PAYLOAD, "system_id": system["id"], "severity": "warning"})

    resp = await authed_client.get("/api/v1/analysis?severity=critical")
    assert len(resp.json()) == 1
    assert resp.json()[0]["severity"] == "critical"


async def test_get_analysis(authed_client: AsyncClient):
    system = await create_system(authed_client)
    created = (await authed_client.post("/api/v1/analysis", json={**ANALYSIS_PAYLOAD, "system_id": system["id"]})).json()

    resp = await authed_client.get(f"/api/v1/analysis/{created['id']}")
    assert resp.status_code == 200
    assert resp.json()["id"] == created["id"]


async def test_get_analysis_not_found(authed_client: AsyncClient):
    resp = await authed_client.get("/api/v1/analysis/9999")
    assert resp.status_code == 404


# ── LLM/분석 실패 레코드 ─────────────────────────────────────────────────────

async def test_create_analysis_with_error_message_sends_teams(authed_client: AsyncClient):
    """error_message가 있어도 warning/critical severity면 Teams 발송 + alert_sent=True"""
    system = await create_system(authed_client)
    payload = {
        **ANALYSIS_PAYLOAD,
        "system_id": system["id"],
        "severity": "warning",
        "error_message": "TimeoutError: LLM did not respond",
    }

    with patch("routes.analysis.DEFAULT_WEBHOOK_URL", "https://teams.example.com/webhook"), \
         patch(
             "routes.analysis.notifier.send_log_analysis_alert",
             new_callable=AsyncMock,
             return_value=True,
         ) as mock_send:
        resp = await authed_client.post("/api/v1/analysis", json=payload)

    assert resp.status_code == 201
    data = resp.json()
    assert data["alert_sent"] is True
    assert data["error_message"] == "TimeoutError: LLM did not respond"
    mock_send.assert_called_once()


async def test_list_analysis_includes_failed_records(authed_client: AsyncClient):
    """GET /api/v1/analysis 응답에 실패 레코드 포함 + error_message 필드 노출"""
    system = await create_system(authed_client)
    # 성공 레코드 1건
    await authed_client.post("/api/v1/analysis", json={**ANALYSIS_PAYLOAD, "system_id": system["id"]})
    # 실패 레코드 1건
    fail_payload = {
        **ANALYSIS_PAYLOAD,
        "system_id": system["id"],
        "severity": "info",
        "error_message": "ValueError: 응답 파싱 실패",
    }
    await authed_client.post("/api/v1/analysis", json=fail_payload)

    resp = await authed_client.get("/api/v1/analysis")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 2
    failed = [it for it in items if it.get("error_message")]
    assert len(failed) == 1
    assert failed[0]["error_message"] == "ValueError: 응답 파싱 실패"


async def test_create_analysis_failure_inserts_alert_history(authed_client: AsyncClient):
    """분석 실패(warning severity) 레코드는 alert_history에 삽입되고 Teams도 발송"""
    system = await create_system(authed_client)
    fail_payload = {
        **ANALYSIS_PAYLOAD,
        "system_id": system["id"],
        "severity": "warning",
        "error_message": "RuntimeError: LLM endpoint unreachable",
    }

    with patch("routes.analysis.DEFAULT_WEBHOOK_URL", "https://teams.example.com/webhook"), \
         patch(
             "routes.analysis.notifier.send_log_analysis_alert",
             new_callable=AsyncMock,
             return_value=True,
         ) as mock_send:
        resp = await authed_client.post("/api/v1/analysis", json=fail_payload)
    assert resp.status_code == 201
    mock_send.assert_called_once()

    # alert_history 에 동반 레코드가 생겼는지 확인 (log_analysis 타입)
    alerts = (await authed_client.get("/api/v1/alerts?alert_type=log_analysis")).json()
    failure_alerts = [a for a in alerts if a.get("error_message")]
    assert len(failure_alerts) >= 1
    assert failure_alerts[0]["error_message"] == "RuntimeError: LLM endpoint unreachable"
    assert failure_alerts[0]["title"] == f"로그 이상 감지 - {SYSTEM_PAYLOAD['display_name']}"


# ── alert_history.title 폴백 우선순위 ────────────────────────────────────────

async def _get_log_analysis_alert(client: AsyncClient) -> dict:
    alerts = (await client.get("/api/v1/alerts?alert_type=log_analysis")).json()
    assert len(alerts) == 1
    return alerts[0]


async def test_alert_title_uses_root_cause(authed_client: AsyncClient):
    system = await create_system(authed_client)
    payload = {
        **ANALYSIS_PAYLOAD,
        "system_id": system["id"],
        "severity": "warning",
        "root_cause": "슬로우 쿼리",
        "recommendation": "인덱스 추가",
    }
    await authed_client.post("/api/v1/analysis", json=payload)

    alert = await _get_log_analysis_alert(authed_client)
    assert alert["title"] == "슬로우 쿼리"


async def test_alert_title_falls_back_to_recommendation_when_root_cause_blank(authed_client: AsyncClient):
    """root_cause가 빈 문자열이면 recommendation을 사용 (JSON 원문 폴백 금지)"""
    system = await create_system(authed_client)
    payload = {
        **ANALYSIS_PAYLOAD,
        "system_id": system["id"],
        "severity": "warning",
        "analysis_result": '{"severity":"warning","root_cause":"","recommendation":"디비 재기동"}',
        "root_cause": "",
        "recommendation": "디비 재기동",
    }
    await authed_client.post("/api/v1/analysis", json=payload)

    alert = await _get_log_analysis_alert(authed_client)
    assert alert["title"] == "디비 재기동"
    assert "{" not in alert["title"]  # JSON 원문이 들어가면 안 됨


async def test_alert_title_falls_back_to_system_name_when_all_blank(authed_client: AsyncClient):
    system = await create_system(authed_client)
    payload = {
        **ANALYSIS_PAYLOAD,
        "system_id": system["id"],
        "severity": "warning",
        "analysis_result": '{"severity":"warning","root_cause":"","recommendation":""}',
        "root_cause": "",
        "recommendation": "",
    }
    await authed_client.post("/api/v1/analysis", json=payload)

    alert = await _get_log_analysis_alert(authed_client)
    assert alert["title"] == f"로그 이상 감지 - {SYSTEM_PAYLOAD['display_name']}"
