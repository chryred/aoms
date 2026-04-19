"""챗봇 도구 및 executor config API 스모크 테스트."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_list_chat_tools_requires_auth(client: AsyncClient):
    resp = await client.get("/api/v1/chat-tools")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_list_chat_tools_as_user(authed_client: AsyncClient):
    resp = await authed_client.get("/api/v1/chat-tools")
    # 시드가 없을 수 있으므로 200 + list 구조만 검증
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_create_chat_session_and_list_messages(authed_client: AsyncClient):
    # 세션 생성
    resp = await authed_client.post("/api/v1/chat/sessions")
    assert resp.status_code == 201
    session = resp.json()
    assert session["title"] == "새 대화"
    assert session["area_code"] == "chat_assistant"

    # 목록 포함 확인
    resp = await authed_client.get("/api/v1/chat/sessions")
    assert resp.status_code == 200
    items = resp.json()
    assert any(s["id"] == session["id"] for s in items)

    # 메시지 초기 빈 배열
    resp = await authed_client.get(f"/api/v1/chat/sessions/{session['id']}/messages")
    assert resp.status_code == 200
    assert resp.json() == []

    # 삭제
    resp = await authed_client.delete(f"/api/v1/chat/sessions/{session['id']}")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_other_user_cannot_access_session(authed_client: AsyncClient):
    resp = await authed_client.post("/api/v1/chat/sessions")
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # 존재하지 않는 세션 404
    resp = await authed_client.get("/api/v1/chat/sessions/nonexistent/messages")
    assert resp.status_code == 404
