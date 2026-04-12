"""
대시보드 API 단위 테스트
- GET /api/v1/dashboard/system-health
- GET /api/v1/dashboard/systems/{id}/detailed
- 상태 판정 로직
"""

import pytest
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession

from models import System, Contact, AlertHistory, LogAnalysisHistory, SystemContact
from routes.dashboard import _get_system_health


@pytest.fixture
async def sample_system(db_session: AsyncSession):
    """테스트용 시스템 생성"""
    system = System(
        system_name="test_system",
        display_name="Test System",
        status="active",
    )
    db_session.add(system)
    await db_session.commit()
    await db_session.refresh(system)
    return system


@pytest.fixture
async def sample_contact(db_session: AsyncSession, sample_system: System):
    """테스트용 담당자 생성"""
    contact = Contact(
        name="Test Engineer",
        teams_upn="test@company.com",
        email="test@company.com",
    )
    db_session.add(contact)
    await db_session.commit()
    await db_session.refresh(contact)

    # 시스템-담당자 연결
    system_contact = SystemContact(
        system_id=sample_system.id,
        contact_id=contact.id,
        role="primary",
        notify_channels="teams",
    )
    db_session.add(system_contact)
    await db_session.commit()

    return contact


# ==================== 상태 판정 로직 테스트 ====================

@pytest.mark.asyncio
async def test_system_health_normal(db_session: AsyncSession, sample_system: System):
    """정상 상태: 알림/로그분석 없음"""
    health = await _get_system_health(db_session, sample_system.id)

    assert health.status == "normal"
    assert health.reason == "모니터링 정상"
    assert health.metric_alerts_count == 0


@pytest.mark.asyncio
async def test_system_health_critical_metric(db_session: AsyncSession, sample_system: System):
    """위험 상태: Critical 메트릭 알림"""
    # Critical 알림 생성 (최근 1시간)
    alert = AlertHistory(
        system_id=sample_system.id,
        alert_type="metric",
        severity="critical",
        alertname="HighCPU",
        title="CPU usage > 90%",
        description="",
        instance_role="main",
        host="10.0.1.5",
    )
    db_session.add(alert)
    await db_session.commit()

    health = await _get_system_health(db_session, sample_system.id)

    assert health.status == "critical"
    assert "수집 알림 1개" in health.reason
    assert health.metric_alerts_count == 1


@pytest.mark.asyncio
async def test_system_health_warning_metric(db_session: AsyncSession, sample_system: System):
    """경고 상태: Warning 메트릭 알림"""
    alert = AlertHistory(
        system_id=sample_system.id,
        alert_type="metric",
        severity="warning",
        alertname="HighMemory",
        title="Memory usage > 80%",
        description="",
        instance_role="main",
        host="10.0.1.5",
    )
    db_session.add(alert)
    await db_session.commit()

    health = await _get_system_health(db_session, sample_system.id)

    assert health.status == "warning"
    assert "수집 알림 1개" in health.reason


@pytest.mark.asyncio
async def test_system_health_critical_log_analysis(db_session: AsyncSession, sample_system: System):
    """위험 상태: Critical 로그분석"""
    log_result = LogAnalysisHistory(
        system_id=sample_system.id,
        log_content="[ERROR] Database connection failed",
        analysis_result="Database connectivity issue detected",
        severity="critical",
        anomaly_type="new",
    )
    db_session.add(log_result)
    await db_session.commit()

    health = await _get_system_health(db_session, sample_system.id)

    assert health.status == "critical"
    assert "로그 이상 감지" in health.reason
    assert health.log_analysis_severity == "critical"


@pytest.mark.asyncio
async def test_system_health_warning_log_analysis(db_session: AsyncSession, sample_system: System):
    """경고 상태: Warning 로그분석"""
    log_result = LogAnalysisHistory(
        system_id=sample_system.id,
        log_content="[WARN] Database connection slow",
        analysis_result="Database latency increasing",
        severity="warning",
        anomaly_type="recurring",
    )
    db_session.add(log_result)
    await db_session.commit()

    health = await _get_system_health(db_session, sample_system.id)

    assert health.status == "warning"
    assert "로그 이상 경고" in health.reason


@pytest.mark.asyncio
async def test_system_health_multiple_alerts(db_session: AsyncSession, sample_system: System):
    """여러 알림이 있을 때 정확한 개수 계산"""
    for i in range(3):
        alert = AlertHistory(
            system_id=sample_system.id,
            alert_type="metric",
            severity="warning" if i < 2 else "critical",
            alertname=f"Alert{i}",
            title=f"Test Alert {i}",
            description="",
            instance_role="main",
            host="10.0.1.5",
        )
        db_session.add(alert)
    await db_session.commit()

    health = await _get_system_health(db_session, sample_system.id)

    # critical 1개 + warning 2개
    assert health.status == "critical"
    assert health.metric_alerts_count == 3
    assert "수집 알림 1개" in health.reason  # critical 우선


@pytest.mark.asyncio
async def test_system_health_ignores_old_alerts(db_session: AsyncSession, sample_system: System):
    """10분 이상 된 알림은 무시"""
    # 과거 2시간 전 알림
    old_alert = AlertHistory(
        system_id=sample_system.id,
        alert_type="metric",
        severity="critical",
        alertname="OldAlert",
        title="Old Critical Alert",
        description="",
        instance_role="main",
        host="10.0.1.5",
        created_at=datetime.utcnow() - timedelta(hours=2),
    )
    db_session.add(old_alert)
    await db_session.commit()

    health = await _get_system_health(db_session, sample_system.id)

    # 10분 이내의 알림이 없으므로 normal
    assert health.status == "normal"
    assert health.metric_alerts_count == 0


@pytest.mark.asyncio
async def test_system_health_combined_critical_and_warning(
    db_session: AsyncSession, sample_system: System
):
    """Critical 메트릭 + Warning 로그분석"""
    # Critical 메트릭
    alert = AlertHistory(
        system_id=sample_system.id,
        alert_type="metric",
        severity="critical",
        alertname="HighCPU",
        title="CPU critical",
        description="",
        instance_role="main",
        host="10.0.1.5",
    )
    db_session.add(alert)

    # Warning 로그분석
    log_result = LogAnalysisHistory(
        system_id=sample_system.id,
        log_content="[WARN] Some warning",
        analysis_result="Minor issue",
        severity="warning",
        anomaly_type="recurring",
    )
    db_session.add(log_result)
    await db_session.commit()

    health = await _get_system_health(db_session, sample_system.id)

    # Critical 메트릭이 우선 — warning 로그분석은 reason에 별도 표시되지 않음
    assert health.status == "critical"
    assert "수집 알림 1개" in health.reason


# ==================== API 엔드포인트 테스트 ====================

@pytest.mark.asyncio
async def test_get_dashboard_health_empty(authed_client):
    """빈 대시보드 (시스템 없음)"""
    response = await authed_client.get("/api/v1/dashboard/system-health")

    assert response.status_code == 200
    data = response.json()
    assert data["summary"]["total_systems"] == 0
    assert data["systems"] == []


@pytest.mark.asyncio
async def test_get_dashboard_health_with_systems(
    db_session: AsyncSession,
    authed_client,
    sample_system: System,
):
    """여러 시스템의 상태 조회"""
    # 두 번째 시스템 생성
    system2 = System(
        system_name="test_system_2",
        display_name="Test System 2",
        status="active",
    )
    db_session.add(system2)
    await db_session.commit()

    # 첫 번째 시스템에 Critical 알림 추가
    alert = AlertHistory(
        system_id=sample_system.id,
        alert_type="metric",
        severity="critical",
        alertname="Test",
        title="Critical",
        description="",
        instance_role="main",
        host="10.0.1.5",
    )
    db_session.add(alert)
    await db_session.commit()

    response = await authed_client.get("/api/v1/dashboard/system-health")

    assert response.status_code == 200
    data = response.json()
    assert data["summary"]["total_systems"] == 2
    assert data["summary"]["critical_systems"] == 1
    assert data["summary"]["normal_systems"] == 1
    assert len(data["systems"]) == 2


@pytest.mark.asyncio
async def test_get_system_detail_health(
    db_session: AsyncSession,
    authed_client,
    sample_system: System,
    sample_contact: Contact,
):
    """시스템 상세 정보 조회"""
    # 메트릭 알림 추가
    alert = AlertHistory(
        system_id=sample_system.id,
        alert_type="metric",
        severity="critical",
        alertname="HighCPU",
        title="CPU > 90%",
        description="CPU usage critical",
        instance_role="main",
        host="10.0.1.5",
        metric_value=95.0,
    )
    db_session.add(alert)

    # 로그분석 추가
    log_result = LogAnalysisHistory(
        system_id=sample_system.id,
        log_content="[ERROR] Connection timeout",
        analysis_result="Database connection pool exhausted",
        severity="critical",
        anomaly_type="new",
    )
    db_session.add(log_result)
    await db_session.commit()

    response = await authed_client.get(
        f"/api/v1/dashboard/systems/{sample_system.id}/detailed"
    )

    assert response.status_code == 200
    data = response.json()
    assert data["system_id"] == sample_system.id
    assert data["display_name"] == "Test System"
    assert len(data["metric_alerts"]) == 1
    assert data["metric_alerts"][0]["alertname"] == "HighCPU"
    assert len(data["log_analysis"]["incidents"]) == 1
    assert data["log_analysis"]["incidents"][0]["severity"] == "critical"
    assert len(data["contacts"]) == 1
    assert data["contacts"][0]["name"] == "Test Engineer"


@pytest.mark.asyncio
async def test_get_system_detail_health_not_found(db_session: AsyncSession, authed_client):
    """없는 시스템 조회"""
    response = await authed_client.get("/api/v1/dashboard/systems/99999/detailed")

    assert response.status_code == 404


# ==================== 인증 테스트 ====================

@pytest.mark.asyncio
async def test_dashboard_requires_auth(client):
    """인증 없이 대시보드 조회 불가"""
    response = await client.get("/api/v1/dashboard/system-health")

    assert response.status_code == 401
