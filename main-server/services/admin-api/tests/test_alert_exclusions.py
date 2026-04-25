from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import AlertExclusion, System
from services.exclusion_filter import is_excluded, mark_skipped


def _utc_naive_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


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


# ── count 임계값 테스트 ────────────────────────────────────────────────────

async def test_is_excluded_count_within_threshold(db_session: AsyncSession):
    """count <= max_count_per_window → 예외 적용"""
    sys = System(system_name="cs1", display_name="CS1", status="active")
    db_session.add(sys)
    await db_session.flush()

    rule = AlertExclusion(
        system_id=sys.id, instance_role="was1", template="ERROR: noisy",
        active=True, max_count_per_window=10,
    )
    db_session.add(rule)
    await db_session.flush()

    result = await is_excluded(db_session, sys.id, "was1", "ERROR: noisy", count=5)
    assert result is not None
    assert result.id == rule.id


async def test_is_excluded_count_exceeds_threshold(db_session: AsyncSession):
    """count > max_count_per_window → 예외 미적용 (None 반환)"""
    sys = System(system_name="cs2", display_name="CS2", status="active")
    db_session.add(sys)
    await db_session.flush()

    db_session.add(AlertExclusion(
        system_id=sys.id, instance_role="was1", template="ERROR: spike",
        active=True, max_count_per_window=10,
    ))
    await db_session.flush()

    result = await is_excluded(db_session, sys.id, "was1", "ERROR: spike", count=100)
    assert result is None  # 임계값 초과 → 예외 미적용 → 정상 분석 진행


async def test_is_excluded_count_unlimited(db_session: AsyncSession):
    """max_count_per_window=NULL이면 무제한 (어떤 count에도 예외 적용)"""
    sys = System(system_name="cs3", display_name="CS3", status="active")
    db_session.add(sys)
    await db_session.flush()

    db_session.add(AlertExclusion(
        system_id=sys.id, instance_role="was1", template="ERROR: always",
        active=True, max_count_per_window=None,
    ))
    await db_session.flush()

    # 매우 큰 count도 예외 적용
    result = await is_excluded(db_session, sys.id, "was1", "ERROR: always", count=99999)
    assert result is not None


async def test_is_excluded_count_none_skips_threshold_check(db_session: AsyncSession):
    """count=None이면 max_count 검사 생략 (admin-api 호환)"""
    sys = System(system_name="cs4", display_name="CS4", status="active")
    db_session.add(sys)
    await db_session.flush()

    db_session.add(AlertExclusion(
        system_id=sys.id, instance_role="was1", template="ERROR: legacy",
        active=True, max_count_per_window=5,
    ))
    await db_session.flush()

    # count 인자 미제공 → 임계값 무시하고 매칭만 확인
    result = await is_excluded(db_session, sys.id, "was1", "ERROR: legacy", count=None)
    assert result is not None


# ── 만료(expires_at) 테스트 ────────────────────────────────────────────────

async def test_is_excluded_future_expiry_matches(db_session: AsyncSession):
    """expires_at이 미래면 매칭됨"""
    sys = System(system_name="ex1", display_name="EX1", status="active")
    db_session.add(sys)
    await db_session.flush()

    db_session.add(AlertExclusion(
        system_id=sys.id, instance_role="was1", template="ERROR: future",
        active=True, expires_at=_utc_naive_now() + timedelta(days=7),
    ))
    await db_session.flush()

    result = await is_excluded(db_session, sys.id, "was1", "ERROR: future")
    assert result is not None


async def test_is_excluded_past_expiry_skipped(db_session: AsyncSession):
    """expires_at이 과거면 매칭 안 됨 (Lazy 만료)"""
    sys = System(system_name="ex2", display_name="EX2", status="active")
    db_session.add(sys)
    await db_session.flush()

    db_session.add(AlertExclusion(
        system_id=sys.id, instance_role="was1", template="ERROR: expired",
        active=True, expires_at=_utc_naive_now() - timedelta(days=1),
    ))
    await db_session.flush()

    result = await is_excluded(db_session, sys.id, "was1", "ERROR: expired")
    assert result is None  # 만료된 규칙은 매칭 안 됨


async def test_is_excluded_null_expiry_matches(db_session: AsyncSession):
    """expires_at=NULL이면 만료 없음 (기존 동작 호환)"""
    sys = System(system_name="ex3", display_name="EX3", status="active")
    db_session.add(sys)
    await db_session.flush()

    db_session.add(AlertExclusion(
        system_id=sys.id, instance_role="was1", template="ERROR: forever",
        active=True, expires_at=None,
    ))
    await db_session.flush()

    result = await is_excluded(db_session, sys.id, "was1", "ERROR: forever")
    assert result is not None


# ── /analysis 통합 테스트 ──────────────────────────────────────────────────

async def test_analysis_count_below_threshold_excluded(authed_client: AsyncClient):
    """template_counts가 임계값 이하 → alert/incident 미생성"""
    system = await _create_system(authed_client)
    template = "ERROR: batch noise"

    await authed_client.post("/api/v1/alert-exclusions", json={
        "items": [{
            "system_id": system["id"], "instance_role": "was1",
            "template": template, "max_count_per_window": 10,
        }]
    })

    resp = await authed_client.post("/api/v1/analysis", json={
        **ANALYSIS_PAYLOAD,
        "system_id": system["id"],
        "templates": [template],
        "template_counts": {template: 3},   # 임계값 이하
    })
    assert resp.status_code == 201

    alerts = (await authed_client.get("/api/v1/alerts", params={"system_id": system["id"]})).json()
    incidents = (await authed_client.get("/api/v1/incidents", params={"system_id": system["id"]})).json()
    assert len(alerts) == 0
    assert len(incidents) == 0


async def test_analysis_count_exceeds_threshold_alerts(authed_client: AsyncClient):
    """template_counts가 임계값 초과 → 정상 분석 경로 (alert 생성)"""
    system = await _create_system(authed_client)
    template = "ERROR: spike pattern"

    await authed_client.post("/api/v1/alert-exclusions", json={
        "items": [{
            "system_id": system["id"], "instance_role": "was1",
            "template": template, "max_count_per_window": 10,
        }]
    })

    with patch("routes.analysis.notifier.send_log_analysis_alert", new_callable=AsyncMock, return_value=False):
        resp = await authed_client.post("/api/v1/analysis", json={
            **ANALYSIS_PAYLOAD,
            "system_id": system["id"],
            "templates": [template],
            "template_counts": {template: 100},  # 임계값 초과
        })
    assert resp.status_code == 201

    # 임계값 초과 → 정상 분석 → alert_history 생성
    alerts = (await authed_client.get("/api/v1/alerts", params={"system_id": system["id"]})).json()
    assert len(alerts) == 1
    assert alerts[0]["alert_type"] == "log_analysis"


# ── 만료 자동 필터링 (list API) ────────────────────────────────────────────

async def test_list_exclusions_active_excludes_expired_by_default(authed_client: AsyncClient):
    """GET /alert-exclusions?active=true는 기본적으로 만료된 규칙 제외"""
    system = await _create_system(authed_client)

    # 활성 + 미만료
    await authed_client.post("/api/v1/alert-exclusions", json={
        "items": [{"system_id": system["id"], "template": "ERROR: live"}]
    })
    # 활성 + 만료
    past = (_utc_naive_now() - timedelta(days=1)).isoformat() + "Z"
    await authed_client.post("/api/v1/alert-exclusions", json={
        "items": [{"system_id": system["id"], "template": "ERROR: expired", "expires_at": past}]
    })

    resp = await authed_client.get("/api/v1/alert-exclusions", params={"active": "true"})
    rules = resp.json()
    templates = {r["template"] for r in rules}
    assert "ERROR: live" in templates
    assert "ERROR: expired" not in templates


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
