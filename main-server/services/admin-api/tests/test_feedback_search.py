import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import AlertFeedback, AlertHistory, System


@pytest.fixture
async def seeded(db_session: AsyncSession):
    sys_a = System(system_name="was-a", display_name="WAS-A")
    sys_b = System(system_name="db-b", display_name="DB-B")
    db_session.add_all([sys_a, sys_b])
    await db_session.flush()

    alert = AlertHistory(
        system_id=sys_a.id,
        alert_type="metric",
        severity="critical",
        alertname="HighCPU",
        title="CPU 임계치 초과",
    )
    db_session.add(alert)
    await db_session.flush()

    fb_with_history = AlertFeedback(
        system_id=sys_a.id,
        alert_history_id=alert.id,
        error_type="CPU 과부하",
        solution="불필요 프로세스 종료",
        resolver="홍길동",
    )
    fb_solo = AlertFeedback(
        system_id=sys_b.id,
        alert_history_id=None,
        error_type="디스크 풀",
        solution="로그 로테이션 설정",
        resolver="김철수",
    )
    fb_other = AlertFeedback(
        system_id=sys_a.id,
        alert_history_id=None,
        error_type="네트워크 단절",
        solution="방화벽 룰 수정",
        resolver="이영희",
    )
    db_session.add_all([fb_with_history, fb_solo, fb_other])
    await db_session.commit()
    return {"sys_a": sys_a, "sys_b": sys_b, "alert": alert}


async def test_search_returns_all(authed_client: AsyncClient, seeded):
    resp = await authed_client.get("/api/v1/feedback/search")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert len(body["items"]) == 3


async def test_search_by_system(authed_client: AsyncClient, seeded):
    resp = await authed_client.get(
        "/api/v1/feedback/search", params={"system_id": seeded["sys_a"].id}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    for item in body["items"]:
        assert item["system_id"] == seeded["sys_a"].id


async def test_search_q_matches_error_type(authed_client: AsyncClient, seeded):
    resp = await authed_client.get("/api/v1/feedback/search", params={"q": "디스크"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["error_type"] == "디스크 풀"


async def test_search_q_matches_solution(authed_client: AsyncClient, seeded):
    resp = await authed_client.get("/api/v1/feedback/search", params={"q": "방화벽"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["solution"] == "방화벽 룰 수정"


async def test_search_includes_alert_history_fields(authed_client: AsyncClient, seeded):
    resp = await authed_client.get("/api/v1/feedback/search", params={"q": "CPU"})
    assert resp.status_code == 200
    item = resp.json()["items"][0]
    assert item["severity"] == "critical"
    assert item["alert_type"] == "metric"
    assert item["title"] == "CPU 임계치 초과"
    assert item["system_name"] == "was-a"
    assert item["system_display_name"] == "WAS-A"


async def test_search_returns_feedback_without_alert_history(
    authed_client: AsyncClient, seeded
):
    resp = await authed_client.get("/api/v1/feedback/search", params={"q": "디스크"})
    item = resp.json()["items"][0]
    assert item["alert_history_id"] is None
    assert item["severity"] is None
    assert item["title"] is None
    assert item["system_display_name"] == "DB-B"


async def test_search_pagination(authed_client: AsyncClient, seeded):
    resp = await authed_client.get(
        "/api/v1/feedback/search", params={"limit": 2, "offset": 0}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert len(body["items"]) == 2

    resp2 = await authed_client.get(
        "/api/v1/feedback/search", params={"limit": 2, "offset": 2}
    )
    assert len(resp2.json()["items"]) == 1
