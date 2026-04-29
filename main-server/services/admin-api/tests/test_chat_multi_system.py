"""Wave 1: 챗봇 다중 시스템 스코프 + 소프트 삭제 + 통계 단위 테스트."""

from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from models import ChatMessage, ChatSession, System


# ── test_chat_session_patch ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_chat_session_patch_title(authed_client: AsyncClient):
    """PATCH /sessions/{id} — 제목 변경."""
    resp = await authed_client.post(
        "/api/v1/chat/sessions", json={"system_ids": []}
    )
    assert resp.status_code == 201
    sid = resp.json()["id"]

    resp = await authed_client.patch(
        f"/api/v1/chat/sessions/{sid}", json={"title": "변경된 제목"}
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "변경된 제목"


@pytest.mark.asyncio
async def test_chat_session_patch_system_ids(authed_client: AsyncClient, db_session):
    """PATCH /sessions/{id} — system_ids 변경."""
    # 시스템 2개 생성
    s1 = System(system_name="svc_a", display_name="서비스A", status="active")
    s2 = System(system_name="svc_b", display_name="서비스B", status="active")
    db_session.add(s1)
    db_session.add(s2)
    await db_session.flush()

    resp = await authed_client.post(
        "/api/v1/chat/sessions", json={"system_ids": [s1.id]}
    )
    assert resp.status_code == 201
    sid = resp.json()["id"]
    assert resp.json()["system_ids"] == [s1.id]

    resp = await authed_client.patch(
        f"/api/v1/chat/sessions/{sid}", json={"system_ids": [s1.id, s2.id]}
    )
    assert resp.status_code == 200
    assert set(resp.json()["system_ids"]) == {s1.id, s2.id}


@pytest.mark.asyncio
async def test_chat_session_patch_clear_system_ids(authed_client: AsyncClient):
    """PATCH /sessions/{id} — system_ids를 빈 배열로 명시적 클리어."""
    resp = await authed_client.post(
        "/api/v1/chat/sessions", json={"system_ids": []}
    )
    assert resp.status_code == 201
    sid = resp.json()["id"]

    resp = await authed_client.patch(
        f"/api/v1/chat/sessions/{sid}", json={"system_ids": []}
    )
    assert resp.status_code == 200
    assert resp.json()["system_ids"] == []


# ── test_chat_session_soft_delete ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_chat_session_soft_delete(authed_client: AsyncClient, db_session):
    """DELETE /sessions/{id} — 소프트 삭제: GET 목록에서 사라짐, DB에 deleted_at 채워짐."""
    resp = await authed_client.post(
        "/api/v1/chat/sessions", json={"system_ids": []}
    )
    assert resp.status_code == 201
    sid = resp.json()["id"]

    # 삭제 전: 목록에 있음
    resp = await authed_client.get("/api/v1/chat/sessions")
    ids = [s["id"] for s in resp.json()]
    assert sid in ids

    # 소프트 삭제
    resp = await authed_client.delete(f"/api/v1/chat/sessions/{sid}")
    assert resp.status_code == 204

    # 삭제 후: GET 목록에 없음
    resp = await authed_client.get("/api/v1/chat/sessions")
    ids = [s["id"] for s in resp.json()]
    assert sid not in ids

    # DB에는 deleted_at이 채워짐
    row = (
        await db_session.execute(select(ChatSession).where(ChatSession.id == sid))
    ).scalar_one_or_none()
    assert row is not None
    assert row.deleted_at is not None


@pytest.mark.asyncio
async def test_chat_session_restore(authed_client: AsyncClient, db_session):
    """POST /sessions/{id}/restore — 소프트 삭제 세션 복구: deleted_at = NULL."""
    resp = await authed_client.post("/api/v1/chat/sessions", json={"system_ids": []})
    assert resp.status_code == 201
    sid = resp.json()["id"]

    # 소프트 삭제
    resp = await authed_client.delete(f"/api/v1/chat/sessions/{sid}")
    assert resp.status_code == 204

    # 복구
    resp = await authed_client.post(f"/api/v1/chat/sessions/{sid}/restore")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == sid
    assert body.get("deleted_at") is None

    # 다시 목록에 노출됨
    resp = await authed_client.get("/api/v1/chat/sessions")
    ids = [s["id"] for s in resp.json()]
    assert sid in ids

    # DB도 deleted_at = None
    row = (
        await db_session.execute(select(ChatSession).where(ChatSession.id == sid))
    ).scalar_one_or_none()
    assert row is not None
    assert row.deleted_at is None


@pytest.mark.asyncio
async def test_chat_session_restore_not_owner(authed_client: AsyncClient, db_session):
    """다른 사용자 세션 복구 시도 → 404."""
    # 다른 user_id로 세션 직접 생성 (authed_client 사용자가 아님)
    other = ChatSession(user_id=999999, title="other", area_code="chat_assistant")
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)
    other.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db_session.commit()

    resp = await authed_client.post(f"/api/v1/chat/sessions/{other.id}/restore")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_soft_deleted_session_messages_inaccessible(authed_client: AsyncClient):
    """소프트 삭제된 세션의 messages 조회 → 404."""
    resp = await authed_client.post(
        "/api/v1/chat/sessions", json={"system_ids": []}
    )
    sid = resp.json()["id"]
    await authed_client.delete(f"/api/v1/chat/sessions/{sid}")

    resp = await authed_client.get(f"/api/v1/chat/sessions/{sid}/messages")
    assert resp.status_code == 404


# ── test_chat_session_search ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_chat_session_search_q(authed_client: AsyncClient):
    """GET /sessions?q= — 제목 ILIKE 검색."""
    resp1 = await authed_client.post(
        "/api/v1/chat/sessions", json={"system_ids": []}
    )
    sid1 = resp1.json()["id"]
    await authed_client.patch(f"/api/v1/chat/sessions/{sid1}", json={"title": "결제 서비스 CPU 이슈"})

    resp2 = await authed_client.post(
        "/api/v1/chat/sessions", json={"system_ids": []}
    )
    sid2 = resp2.json()["id"]
    await authed_client.patch(f"/api/v1/chat/sessions/{sid2}", json={"title": "DB 연결 장애"})

    # q=결제 → sid1만
    resp = await authed_client.get("/api/v1/chat/sessions?q=결제")
    ids = [s["id"] for s in resp.json()]
    assert sid1 in ids
    assert sid2 not in ids

    # q=DB → sid2만
    resp = await authed_client.get("/api/v1/chat/sessions?q=DB")
    ids = [s["id"] for s in resp.json()]
    assert sid2 in ids
    assert sid1 not in ids

    # q 없음 → 둘 다
    resp = await authed_client.get("/api/v1/chat/sessions")
    ids = [s["id"] for s in resp.json()]
    assert sid1 in ids
    assert sid2 in ids


@pytest.mark.asyncio
async def test_chat_session_search_excludes_deleted(authed_client: AsyncClient):
    """소프트 삭제된 세션은 q 검색에도 안 나온다."""
    resp = await authed_client.post(
        "/api/v1/chat/sessions", json={"system_ids": []}
    )
    sid = resp.json()["id"]
    await authed_client.patch(f"/api/v1/chat/sessions/{sid}", json={"title": "삭제될 대화"})
    await authed_client.delete(f"/api/v1/chat/sessions/{sid}")

    resp = await authed_client.get("/api/v1/chat/sessions?q=삭제될")
    ids = [s["id"] for s in resp.json()]
    assert sid not in ids


# ── test_chat_session_with_system_ids ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_session_with_system_ids(authed_client: AsyncClient, db_session):
    """POST /sessions { system_ids: [1] } → DB에 system_ids 저장 + 응답에 반영."""
    sys = System(system_name="crm", display_name="CRM 서버", status="active")
    db_session.add(sys)
    await db_session.flush()

    resp = await authed_client.post(
        "/api/v1/chat/sessions", json={"system_ids": [sys.id]}
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["system_ids"] == [sys.id]

    # DB 확인
    row = (
        await db_session.execute(
            select(ChatSession).where(ChatSession.id == data["id"])
        )
    ).scalar_one()
    # SQLite는 JSON으로 저장되므로 list 비교
    stored = list(row.system_ids) if row.system_ids else []
    assert stored == [sys.id]


@pytest.mark.asyncio
async def test_create_session_empty_system_ids(authed_client: AsyncClient):
    """POST /sessions {} (system_ids 기본값 []) → 200 + system_ids=[]."""
    resp = await authed_client.post(
        "/api/v1/chat/sessions", json={}
    )
    assert resp.status_code == 201
    assert resp.json()["system_ids"] == []


# ── test_chat_statistics_endpoint ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_chat_statistics_endpoint_empty(authed_client: AsyncClient):
    """GET /chat/statistics — 데이터 없을 때 빈 배열 반환 (admin 권한)."""
    resp = await authed_client.get("/api/v1/chat/statistics?group_by=system")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_chat_statistics_endpoint_with_data(authed_client: AsyncClient, db_session):
    """GET /chat/statistics — 메시지 데이터가 있을 때 집계 결과 반환."""
    sys = System(system_name="payment", display_name="결제시스템", status="active")
    db_session.add(sys)
    await db_session.flush()

    # 세션 + 메시지 생성
    resp = await authed_client.post(
        "/api/v1/chat/sessions", json={"system_ids": [sys.id]}
    )
    assert resp.status_code == 201
    sid = resp.json()["id"]

    # 메시지 직접 DB에 추가 (system_id 포함)
    msg = ChatMessage(
        session_id=sid,
        role="tool",
        content="",
        tool_name="qdrant_search_incident_knowledge",
        tool_args={"query": "테스트"},
        tool_result={"count": 1},
        system_id=sys.id,
    )
    db_session.add(msg)
    await db_session.commit()

    resp = await authed_client.get("/api/v1/chat/statistics?group_by=system")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    # system_id=sys.id인 row가 있어야 함
    matching = [r for r in data if r["system_id"] == sys.id]
    assert len(matching) == 1
    assert matching[0]["message_count"] >= 1


@pytest.mark.asyncio
async def test_chat_statistics_date_filter(authed_client: AsyncClient, db_session):
    """GET /chat/statistics?from=&to= — 날짜 범위 필터."""
    resp = await authed_client.get(
        "/api/v1/chat/statistics?from=2020-01-01&to=2020-01-31&group_by=system"
    )
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_chat_statistics_bad_date(authed_client: AsyncClient):
    """GET /chat/statistics?from=bad → 400."""
    resp = await authed_client.get("/api/v1/chat/statistics?from=not-a-date")
    assert resp.status_code == 400
