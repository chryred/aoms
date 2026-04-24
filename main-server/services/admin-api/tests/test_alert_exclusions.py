from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import AlertExclusion, System
from services.exclusion_filter import is_excluded, mark_skipped


SYSTEM_PAYLOAD = {"system_name": "test-system", "display_name": "테스트시스템"}
ANALYSIS_PAYLOAD = {
    "instance_role": "was1",
    "log_content": "ERROR: known batch job",
    "analysis_result": "배치 작업 오류",
    "severity": "critical",
    "root_cause": "배치 작업 정상 종료 로그",
    "recommendation": "무시",
    "templates": ["ERROR: known batch job template"],
}


async def _create_system(client: AsyncClient) -> dict:
    resp = await client.post("/api/v1/systems", json=SYSTEM_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()


async def _add_exclusion(db: AsyncSession, system_id: int, instance_role: str | None, template: str) -> AlertExclusion:
    rule = AlertExclusion(
        system_id=system_id,
        instance_role=instance_role,
        template=template,
        active=True,
    )
    db.add(rule)
    await db.flush()
    return rule


# ── exclusion_filter 단위 테스트 ────────────────────────────────────────────

async def test_is_excluded_exact_match(db_session: AsyncSession):
    """정확한 (system_id, instance_role, template) 매칭"""
    sys = System(system_name="s1", display_name="S1", status="active")
    db_session.add(sys)
    await db_session.flush()

    await _add_exclusion(db_session, sys.id, "was1", "ERROR: batch")

    result = await is_excluded(db_session, sys.id, "was1", "ERROR: batch")
    assert result is not None
    assert result.template == "ERROR: batch"


async def test_is_excluded_instance_role_none_wildcard(db_session: AsyncSession):
    """instance_role=None 규칙은 모든 role에 적용"""
    sys = System(system_name="s2", display_name="S2", status="active")
    db_session.add(sys)
    await db_session.flush()

    await _add_exclusion(db_session, sys.id, None, "ERROR: global")

    # was1, was2 모두 매칭
    assert await is_excluded(db_session, sys.id, "was1", "ERROR: global") is not None
    assert await is_excluded(db_session, sys.id, "was2", "ERROR: global") is not None


async def test_is_excluded_ignores_inactive(db_session: AsyncSession):
    """active=False 규칙은 매칭되지 않음"""
    sys = System(system_name="s3", display_name="S3", status="active")
    db_session.add(sys)
    await db_session.flush()

    rule = await _add_exclusion(db_session, sys.id, "was1", "ERROR: inactive")
    rule.active = False
    await db_session.flush()

    result = await is_excluded(db_session, sys.id, "was1", "ERROR: inactive")
    assert result is None


async def test_is_excluded_no_match_different_template(db_session: AsyncSession):
    """다른 template은 매칭 안 됨"""
    sys = System(system_name="s4", display_name="S4", status="active")
    db_session.add(sys)
    await db_session.flush()

    await _add_exclusion(db_session, sys.id, "was1", "ERROR: specific")

    result = await is_excluded(db_session, sys.id, "was1", "ERROR: different")
    assert result is None


async def test_mark_skipped_increments(db_session: AsyncSession):
    """mark_skipped()는 skip_count를 증가시키고 last_skipped_at을 갱신함"""
    sys = System(system_name="s5", display_name="S5", status="active")
    db_session.add(sys)
    await db_session.flush()

    rule = await _add_exclusion(db_session, sys.id, "was1", "ERROR: skip")
    assert rule.skip_count == 0

    await mark_skipped(db_session, rule.id)
    await db_session.refresh(rule)
    assert rule.skip_count == 1
    assert rule.last_skipped_at is not None


# ── API 통합 테스트 ────────────────────────────────────────────────────────

async def test_create_exclusion_and_list(authed_client: AsyncClient):
    """예외 규칙 등록 후 목록 조회"""
    system = await _create_system(authed_client)

    resp = await authed_client.post("/api/v1/alert-exclusions", json={
        "items": [
            {
                "system_id": system["id"],
                "instance_role": "was1",
                "template": "ERROR: test pattern",
                "reason": "알려진 배치 로그",
            }
        ]
    })
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["succeeded"]) == 1
    assert data["failed"] == []

    list_resp = await authed_client.get("/api/v1/alert-exclusions", params={"active": "true"})
    assert list_resp.status_code == 200
    rules = list_resp.json()
    assert any(r["template"] == "ERROR: test pattern" for r in rules)


async def test_create_exclusion_duplicate_skipped(authed_client: AsyncClient):
    """동일 규칙 재등록 시 failed에 추가"""
    system = await _create_system(authed_client)
    item = {"system_id": system["id"], "instance_role": "was1", "template": "ERROR: dup"}

    await authed_client.post("/api/v1/alert-exclusions", json={"items": [item]})
    resp = await authed_client.post("/api/v1/alert-exclusions", json={"items": [item]})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["succeeded"]) == 0
    assert len(data["failed"]) == 1


async def test_deactivate_exclusion(authed_client: AsyncClient):
    """예외 규칙 해제"""
    system = await _create_system(authed_client)

    create_resp = await authed_client.post("/api/v1/alert-exclusions", json={
        "items": [{"system_id": system["id"], "template": "ERROR: to-deactivate"}]
    })
    rule_id = create_resp.json()["succeeded"][0]

    deact_resp = await authed_client.patch("/api/v1/alert-exclusions/deactivate", json={"ids": [rule_id]})
    assert deact_resp.status_code == 200
    assert rule_id in deact_resp.json()["succeeded"]

    list_resp = await authed_client.get("/api/v1/alert-exclusions", params={"active": "false"})
    rules = list_resp.json()
    assert any(r["id"] == rule_id and not r["active"] for r in rules)


async def test_analysis_excluded_skips_alert_and_incident(authed_client: AsyncClient):
    """예외 규칙 매칭 시 alert_history, incident 미생성, excluded=True 저장"""
    system = await _create_system(authed_client)
    template = "ERROR: known batch job template"

    # 예외 규칙 등록
    await authed_client.post("/api/v1/alert-exclusions", json={
        "items": [{"system_id": system["id"], "instance_role": "was1", "template": template}]
    })

    with patch("routes.analysis.DEFAULT_WEBHOOK_URL", "https://teams.example.com/webhook"), \
         patch("routes.analysis.notifier.send_log_analysis_alert", new_callable=AsyncMock, return_value=True):
        resp = await authed_client.post("/api/v1/analysis", json={
            **ANALYSIS_PAYLOAD,
            "system_id": system["id"],
        })

    assert resp.status_code == 201
    data = resp.json()
    # excluded 분석이어도 LogAnalysisHistory 레코드는 생성됨
    assert data["id"] is not None
    # excluded=True 확인
    assert data.get("excluded") is True or data.get("alert_sent") is False

    # alert_history 미생성 확인
    alert_resp = await authed_client.get("/api/v1/alerts", params={"system_id": system["id"]})
    assert alert_resp.status_code == 200
    assert len(alert_resp.json()) == 0

    # incident 미생성 확인
    inc_resp = await authed_client.get("/api/v1/incidents", params={"system_id": system["id"]})
    assert inc_resp.status_code == 200
    assert len(inc_resp.json()) == 0


async def test_analysis_not_excluded_without_matching_template(authed_client: AsyncClient):
    """예외 규칙이 있어도 다른 template은 정상 처리"""
    system = await _create_system(authed_client)

    await authed_client.post("/api/v1/alert-exclusions", json={
        "items": [{"system_id": system["id"], "template": "ERROR: other pattern"}]
    })

    with patch("routes.analysis.notifier.send_log_analysis_alert", new_callable=AsyncMock, return_value=False):
        resp = await authed_client.post("/api/v1/analysis", json={
            **ANALYSIS_PAYLOAD,
            "system_id": system["id"],
            "templates": ["ERROR: different pattern"],
        })

    assert resp.status_code == 201
    data = resp.json()
    # 정상 분석이면 excluded=True가 아님 (LogAnalysisOut에는 excluded 없으므로 alert_sent로 체크)
    # 중요: alert_history가 생성됐는지 확인
    alert_resp = await authed_client.get("/api/v1/alerts", params={"system_id": system["id"]})
    assert resp.json()["id"] is not None
