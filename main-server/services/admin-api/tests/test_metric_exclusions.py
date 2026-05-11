"""prometheus_analyzer 메트릭 예외 처리 — 단위/통합 테스트.

Note: SQLite in-memory + JSONB는 SQLite에서 JSON으로 자동 fallback (SQLAlchemy 동작)
"""
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import AlertHistory, MetricExclusion, System
from services.metric_types import (
    METRIC_TYPE_LABELS_KO,
    MetricType,
    extract_metric_types_from_title,
)
from services.prometheus_analyzer import (
    _check_metric_exclusion,
    _load_active_metric_exclusions,
    _load_system_name_map,
)


def _utc_naive_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── extract_metric_types_from_title (레거시 폴백) ──────────────────────────

def test_extract_metric_types_single():
    title = "[prometheus_analyzer] 디스크 I/O 278ms (임계치 200ms)"
    assert extract_metric_types_from_title(title) == ["disk_io"]


def test_extract_metric_types_multi():
    title = "[prometheus_analyzer] CPU 평균 92%, 메모리 사용률 88%"
    result = extract_metric_types_from_title(title)
    assert "cpu" in result and "memory" in result


def test_extract_metric_types_empty():
    assert extract_metric_types_from_title("") == []
    assert extract_metric_types_from_title("알 수 없는 알림") == []


def test_extract_metric_types_all_seven():
    title = "CPU 평균 1%, 메모리 사용률 1%, 디스크 I/O 1ms, 네트워크 RX 1, 네트워크 TX 1, HTTP 지연 1, 로그 에러 1"
    assert set(extract_metric_types_from_title(title)) == {
        "cpu", "memory", "disk_io", "network_rx", "network_tx", "http_latency", "log_error_rate"
    }


def test_metric_type_labels_complete():
    # 모든 enum 값이 한글 라벨을 갖는다
    for mt in MetricType:
        assert mt.value in METRIC_TYPE_LABELS_KO
        assert METRIC_TYPE_LABELS_KO[mt.value]


# ── _check_metric_exclusion 단위 테스트 ───────────────────────────────────

def _rule(system_id: int, host: str | None, metric_type: str, override: float | None = None) -> MetricExclusion:
    return MetricExclusion(
        system_id=system_id,
        host=host,
        metric_type=metric_type,
        override_threshold=override,
        active=True,
    )


def test_check_no_rule_no_exclusion():
    rules = {}
    excluded, eff_thr, rule = _check_metric_exclusion(rules, 1, "h1", "cpu", 50.0, 70.0)
    assert excluded is False
    assert eff_thr == 70.0
    assert rule is None


def test_check_full_block_host_specific():
    """host 정확매치 + override_threshold=NULL → 완전 차단"""
    r = _rule(1, "dev-app01", "disk_io", override=None)
    rules = {(1, "dev-app01", "disk_io"): r}
    excluded, eff_thr, matched = _check_metric_exclusion(rules, 1, "dev-app01", "disk_io", 300.0, 200.0)
    assert excluded is True
    assert matched is r


def test_check_wildcard_when_host_unmatched():
    """host=None 와일드카드 규칙은 모든 host 에 적용 (정확매치 없을 때)"""
    r = _rule(1, None, "cpu", override=None)
    rules = {(1, None, "cpu"): r}
    excluded, _, matched = _check_metric_exclusion(rules, 1, "any-host", "cpu", 95.0, 70.0)
    assert excluded is True
    assert matched is r


def test_check_host_specific_overrides_wildcard():
    """동일 system+metric 에서 host 정확매치가 와일드카드보다 우선"""
    r_specific = _rule(1, "h1", "cpu", override=85.0)
    r_wildcard = _rule(1, None, "cpu", override=None)
    rules = {(1, "h1", "cpu"): r_specific, (1, None, "cpu"): r_wildcard}
    # value 80 < specific override 85 → 차단 (override 적용)
    excluded, eff_thr, matched = _check_metric_exclusion(rules, 1, "h1", "cpu", 80.0, 70.0)
    assert excluded is True
    assert eff_thr == 85.0
    assert matched is r_specific  # 와일드카드가 아니라 specific


def test_check_override_below_threshold_blocks():
    """override 미만 값은 차단됨"""
    r = _rule(1, "h1", "disk_io", override=500.0)
    rules = {(1, "h1", "disk_io"): r}
    excluded, eff_thr, _ = _check_metric_exclusion(rules, 1, "h1", "disk_io", 280.0, 200.0)
    assert excluded is True
    assert eff_thr == 500.0


def test_check_override_above_threshold_passes():
    """override 초과 값은 정상 알림. eff_thr 은 override 값"""
    r = _rule(1, "h1", "disk_io", override=500.0)
    rules = {(1, "h1", "disk_io"): r}
    excluded, eff_thr, matched = _check_metric_exclusion(rules, 1, "h1", "disk_io", 600.0, 200.0)
    assert excluded is False
    assert eff_thr == 500.0  # 메시지에 override 값으로 표기됨
    assert matched is r


def test_check_different_metric_type_no_match():
    """다른 metric_type 규칙은 매칭 안 됨"""
    r = _rule(1, "h1", "cpu", override=None)
    rules = {(1, "h1", "cpu"): r}
    excluded, _, matched = _check_metric_exclusion(rules, 1, "h1", "memory", 95.0, 70.0)
    assert excluded is False
    assert matched is None


# ── DB 통합 — _load_active_metric_exclusions ──────────────────────────────

async def test_load_excludes_inactive_and_expired(db_session: AsyncSession):
    sys = System(system_name="s1", display_name="S1", status="active")
    db_session.add(sys)
    await db_session.flush()

    now = _utc_naive_now()
    active_rule = MetricExclusion(
        system_id=sys.id, host="h1", metric_type="cpu", active=True,
    )
    inactive_rule = MetricExclusion(
        system_id=sys.id, host="h2", metric_type="cpu", active=False,
    )
    expired_rule = MetricExclusion(
        system_id=sys.id, host="h3", metric_type="cpu", active=True,
        expires_at=now - timedelta(days=1),
    )
    future_rule = MetricExclusion(
        system_id=sys.id, host="h4", metric_type="cpu", active=True,
        expires_at=now + timedelta(days=1),
    )
    db_session.add_all([active_rule, inactive_rule, expired_rule, future_rule])
    await db_session.flush()

    rules = await _load_active_metric_exclusions(db_session)
    keys = set(rules.keys())
    assert (sys.id, "h1", "cpu") in keys
    assert (sys.id, "h4", "cpu") in keys
    assert (sys.id, "h2", "cpu") not in keys  # inactive
    assert (sys.id, "h3", "cpu") not in keys  # expired


async def test_load_system_name_map(db_session: AsyncSession):
    s1 = System(system_name="alpha", display_name="A", status="active")
    s2 = System(system_name="beta", display_name="B", status="active")
    db_session.add_all([s1, s2])
    await db_session.flush()

    name_map = await _load_system_name_map(db_session)
    assert name_map["alpha"] == s1.id
    assert name_map["beta"] == s2.id


# ── API 통합 테스트 ────────────────────────────────────────────────────────

async def _create_system(client: AsyncClient) -> dict:
    resp = await client.post("/api/v1/systems", json={"system_name": "test-sys", "display_name": "테스트"})
    assert resp.status_code == 201
    return resp.json()


async def test_create_metric_exclusion_and_list(authed_client: AsyncClient):
    system = await _create_system(authed_client)

    resp = await authed_client.post("/api/v1/metric-exclusions", json={
        "items": [{
            "system_id": system["id"],
            "host": "dev-app01",
            "metric_type": "disk_io",
            "override_threshold": 500.0,
            "reason": "개발기 둔감화",
        }]
    })
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["succeeded"]) == 1
    assert data["failed"] == []

    list_resp = await authed_client.get("/api/v1/metric-exclusions", params={"active": "true"})
    assert list_resp.status_code == 200
    rules = list_resp.json()
    assert any(
        r["metric_type"] == "disk_io"
        and r["host"] == "dev-app01"
        and r["override_threshold"] == 500.0
        for r in rules
    )


async def test_create_metric_exclusion_wildcard_host(authed_client: AsyncClient):
    """host=None 는 시스템 전체 와일드카드"""
    system = await _create_system(authed_client)

    resp = await authed_client.post("/api/v1/metric-exclusions", json={
        "items": [{
            "system_id": system["id"],
            "host": None,
            "metric_type": "cpu",
        }]
    })
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["succeeded"]) == 1


async def test_duplicate_exclusion_skipped(authed_client: AsyncClient):
    system = await _create_system(authed_client)
    item = {"system_id": system["id"], "host": "h1", "metric_type": "memory"}

    await authed_client.post("/api/v1/metric-exclusions", json={"items": [item]})
    resp = await authed_client.post("/api/v1/metric-exclusions", json={"items": [item]})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["succeeded"]) == 0
    assert len(data["failed"]) == 1
    assert "이미 활성" in data["failed"][0]["reason"]


async def test_deactivate_metric_exclusion(authed_client: AsyncClient):
    system = await _create_system(authed_client)

    create_resp = await authed_client.post("/api/v1/metric-exclusions", json={
        "items": [{"system_id": system["id"], "host": "h1", "metric_type": "network_rx"}]
    })
    rule_id = create_resp.json()["succeeded"][0]

    deact = await authed_client.patch("/api/v1/metric-exclusions/deactivate", json={"ids": [rule_id]})
    assert deact.status_code == 200
    assert rule_id in deact.json()["succeeded"]

    listed = await authed_client.get("/api/v1/metric-exclusions", params={"active": "false"})
    assert any(r["id"] == rule_id and not r["active"] for r in listed.json())


async def test_invalid_metric_type_rejected(authed_client: AsyncClient):
    system = await _create_system(authed_client)
    resp = await authed_client.post("/api/v1/metric-exclusions", json={
        "items": [{
            "system_id": system["id"],
            "host": "h1",
            "metric_type": "unknown_metric",
        }]
    })
    assert resp.status_code == 422  # Pydantic validation error


async def test_list_active_excludes_expired_by_default(authed_client: AsyncClient):
    """active=true 조회는 기본적으로 만료 규칙 제외"""
    system = await _create_system(authed_client)

    await authed_client.post("/api/v1/metric-exclusions", json={
        "items": [{"system_id": system["id"], "host": "live", "metric_type": "cpu"}]
    })
    past = (_utc_naive_now() - timedelta(days=1)).isoformat() + "Z"
    await authed_client.post("/api/v1/metric-exclusions", json={
        "items": [{"system_id": system["id"], "host": "expired", "metric_type": "cpu", "expires_at": past}]
    })

    resp = await authed_client.get("/api/v1/metric-exclusions", params={"active": "true"})
    hosts = {r["host"] for r in resp.json()}
    assert "live" in hosts
    assert "expired" not in hosts


# ── AlertHistory.metric_types 컬럼 저장 검증 ──────────────────────────────

async def test_alert_history_metric_types_column(db_session: AsyncSession):
    """AlertHistory.metric_types 컬럼이 저장·조회 가능한지"""
    sys = System(system_name="s_at", display_name="AT", status="active")
    db_session.add(sys)
    await db_session.flush()

    hist = AlertHistory(
        system_id=sys.id,
        alert_type="metric",
        severity="warning",
        alertname="prometheus_analyzer_anomaly",
        title="[prometheus_analyzer] 디스크 I/O 278ms",
        instance_role="prometheus_analyzer",
        host="h1",
        metric_types=["disk_io"],
    )
    db_session.add(hist)
    await db_session.flush()
    await db_session.refresh(hist)
    assert hist.metric_types == ["disk_io"]
