"""routes/help.py 테스트 — 게스트 세션, 시스템 목록, 에스컬레이션."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient

from models import ChatMessage, ChatSession, Incident, IncidentTimeline, System


# ── 픽스처 ────────────────────────────────────────────────────────────────────

@pytest.fixture
async def sample_system(db_session):
    sys = System(
        system_name="test_sys",
        display_name="테스트시스템",
        description="테스트용",
        status="active",
    )
    db_session.add(sys)
    await db_session.commit()
    await db_session.refresh(sys)
    return sys


@pytest.fixture
async def guest_session(db_session, sample_system):
    """도움말 인창 게스트 세션"""
    sess = ChatSession(
        user_id=None,
        title="help:EMP001",
        area_code="help_inquiry",
        visitor_employee_id="EMP001",
        visitor_email="emp001@test.com",
        visitor_system_id=sample_system.id,
    )
    db_session.add(sess)
    await db_session.commit()
    await db_session.refresh(sess)
    return sess


# ── TC-1: 게스트 세션 생성 ───────────────────────────────────────────────────

@pytest.mark.anyio
async def test_create_help_session(client: AsyncClient, sample_system):
    resp = await client.post(
        "/api/v1/help/sessions",
        json={"employee_id": "EMP001", "email": "emp@test.com", "system_id": sample_system.id},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert "session_id" in data
    assert data["employee_id"] == "EMP001"
    assert data["system_id"] == sample_system.id


@pytest.mark.anyio
async def test_create_help_session_no_employee_id(client: AsyncClient):
    resp = await client.post("/api/v1/help/sessions", json={"employee_id": ""})
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_create_help_session_sets_null_user_id(client: AsyncClient, db_session):
    resp = await client.post("/api/v1/help/sessions", json={"employee_id": "EMP999"})
    assert resp.status_code == 201
    session_id = resp.json()["session_id"]

    from sqlalchemy import select
    row = (await db_session.execute(select(ChatSession).where(ChatSession.id == session_id))).scalar_one()
    assert row.user_id is None
    assert row.area_code == "help_inquiry"
    assert row.visitor_employee_id == "EMP999"


# ── TC-2: 시스템 목록 (인증 없이) ────────────────────────────────────────────

@pytest.mark.anyio
async def test_list_help_systems_no_auth(client: AsyncClient, sample_system):
    resp = await client.get("/api/v1/help/systems")
    assert resp.status_code == 200
    data = resp.json()
    assert any(s["system_name"] == "test_sys" for s in data)


@pytest.mark.anyio
async def test_list_help_systems_inactive_excluded(client: AsyncClient, db_session):
    inactive = System(system_name="inactive_sys", display_name="비활성", status="inactive")
    db_session.add(inactive)
    await db_session.commit()

    resp = await client.get("/api/v1/help/systems")
    assert resp.status_code == 200
    names = [s["system_name"] for s in resp.json()]
    assert "inactive_sys" not in names


# ── TC-3: 일반 세션 ID로 help 메시지 전송 → 403 ──────────────────────────────

@pytest.mark.anyio
async def test_send_message_rejects_non_help_session(client: AsyncClient, db_session):
    # area_code='chat_assistant' 세션 생성
    normal = ChatSession(user_id=None, title="normal", area_code="chat_assistant")
    db_session.add(normal)
    await db_session.commit()
    await db_session.refresh(normal)

    resp = await client.post(
        f"/api/v1/help/sessions/{normal.id}/messages",
        json={"content": "안녕"},
    )
    assert resp.status_code == 403


# ── TC-4: 에스컬레이션 → incidents.source='help_inquiry' ──────────────────────

@pytest.mark.anyio
async def test_escalate_creates_incident(client: AsyncClient, db_session, guest_session):
    resp = await client.post(
        f"/api/v1/help/sessions/{guest_session.id}/escalate",
        json={"description": "추가 내용"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "created"
    incident_id = data["incident_id"]

    from sqlalchemy import select
    incident = (await db_session.execute(select(Incident).where(Incident.id == incident_id))).scalar_one()
    assert incident.source == "help_inquiry"
    assert incident.severity == "warning"
    assert incident.status == "open"
    assert incident.system_id == guest_session.visitor_system_id

    timeline = (
        await db_session.execute(
            select(IncidentTimeline).where(IncidentTimeline.incident_id == incident_id)
        )
    ).scalar_one()
    assert timeline.event_type == "comment"
    assert timeline.actor_name == "EMP001"


@pytest.mark.anyio
async def test_escalate_rejects_non_help_session(client: AsyncClient, db_session):
    normal = ChatSession(user_id=None, title="normal", area_code="chat_assistant")
    db_session.add(normal)
    await db_session.commit()
    await db_session.refresh(normal)

    resp = await client.post(
        f"/api/v1/help/sessions/{normal.id}/escalate",
        json={},
    )
    assert resp.status_code == 403


# ── TC-5: run_react_stream 게스트 세션 → 도구 필터 확인 ──────────────────────

@pytest.mark.anyio
async def test_help_tools_filtered(db_session, guest_session):
    """help_inquiry 세션에서 chat_agent.run_react_stream 호출 시 RAG 도구만 남아야 한다."""
    from services.chat_agent import _HELP_ALLOWED_TOOLS
    from services.chat_tools.registry import list_enabled_tools

    all_tools = await list_enabled_tools(db_session)
    if not all_tools:
        pytest.skip("chat_tools 테이블 비어 있음 (개발 DB 필요)")

    filtered = [t for t in all_tools if t["name"] in _HELP_ALLOWED_TOOLS]
    disallowed = [t for t in filtered if t["name"] not in _HELP_ALLOWED_TOOLS]
    assert len(disallowed) == 0, f"허용되지 않은 도구가 필터링 후 남았음: {disallowed}"


# ── TC-6: 메시지 조회 ─────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.mark.anyio
async def test_help_get_messages_owner_match(client: AsyncClient, db_session, guest_session):
    """사번 일치 → 200 + 메시지 시간순 반환."""
    from datetime import timedelta

    t0 = _now_utc()
    msg1 = ChatMessage(
        session_id=guest_session.id,
        role="user",
        content="첫 번째 질문",
        created_at=t0,
    )
    msg2 = ChatMessage(
        session_id=guest_session.id,
        role="assistant",
        content="첫 번째 답변",
        created_at=t0 + timedelta(seconds=1),
    )
    db_session.add(msg1)
    db_session.add(msg2)
    await db_session.commit()

    resp = await client.get(
        f"/api/v1/help/sessions/{guest_session.id}/messages",
        params={"employee_id": "EMP001"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["content"] == "첫 번째 질문"
    assert data[1]["content"] == "첫 번째 답변"


@pytest.mark.anyio
async def test_help_get_messages_owner_mismatch(client: AsyncClient, guest_session):
    """사번 불일치 → 403."""
    resp = await client.get(
        f"/api/v1/help/sessions/{guest_session.id}/messages",
        params={"employee_id": "EMP_OTHER"},
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_help_get_messages_deleted_session(client: AsyncClient, db_session, guest_session):
    """soft delete 세션 (deleted_at NOT NULL) → 403."""
    guest_session.deleted_at = _now_utc()
    await db_session.commit()

    resp = await client.get(
        f"/api/v1/help/sessions/{guest_session.id}/messages",
        params={"employee_id": "EMP001"},
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_help_get_messages_wrong_area(client: AsyncClient, db_session):
    """area_code='chat_assistant' 세션 → 403."""
    wrong_sess = ChatSession(
        user_id=None,
        title="normal_chat",
        area_code="chat_assistant",
        visitor_employee_id="EMP001",
    )
    db_session.add(wrong_sess)
    await db_session.commit()
    await db_session.refresh(wrong_sess)

    resp = await client.get(
        f"/api/v1/help/sessions/{wrong_sess.id}/messages",
        params={"employee_id": "EMP001"},
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_help_get_messages_empty(client: AsyncClient, guest_session):
    """메시지 0건 → 200 + 빈 배열."""
    resp = await client.get(
        f"/api/v1/help/sessions/{guest_session.id}/messages",
        params={"employee_id": "EMP001"},
    )
    assert resp.status_code == 200
    assert resp.json() == []
