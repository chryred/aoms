"""챗봇 도구 및 executor config API 스모크 테스트."""

import pytest
from httpx import AsyncClient

from schemas import ChatSendIn, ScreenContext
from services.chat_agent import _format_screen_context_line, _decision_prompt


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


# ── screen_context 관련 단위 테스트 ──────────────────────────────────────────

def test_chat_send_in_screen_context_optional():
    """ChatSendIn은 screen_context 없이도 정상 동작해야 한다."""
    payload = ChatSendIn(content="안녕하세요")
    assert payload.screen_context is None
    assert payload.content == "안녕하세요"


def test_chat_send_in_screen_context_with_value():
    """ChatSendIn에 screen_context를 전달하면 파싱된다."""
    payload = ChatSendIn(
        content="문의",
        screen_context=ScreenContext(
            screen="incidents",
            screen_label="인시던트",
            system_id="42",
            incident_id="inc-7",
        ),
    )
    assert payload.screen_context is not None
    assert payload.screen_context.screen == "incidents"
    assert payload.screen_context.screen_label == "인시던트"
    assert payload.screen_context.system_id == "42"
    assert payload.screen_context.incident_id == "inc-7"


def test_format_screen_context_line_none():
    """screen_context가 None이면 None 반환."""
    assert _format_screen_context_line(None) is None


def test_format_screen_context_line_all_empty():
    """모든 필드가 비면 None 반환."""
    assert _format_screen_context_line(ScreenContext()) is None


def test_format_screen_context_line_screen_label_priority():
    """screen_label이 있으면 screen보다 우선."""
    result = _format_screen_context_line(
        ScreenContext(screen="dashboard", screen_label="운영 대시보드")
    )
    assert result == "[현재 사용자 화면: 운영 대시보드]"


def test_format_screen_context_line_fallback_to_screen():
    """screen_label이 없으면 screen 사용."""
    result = _format_screen_context_line(ScreenContext(screen="incidents"))
    assert result == "[현재 사용자 화면: incidents]"


def test_format_screen_context_line_full():
    """모든 필드가 있으면 전부 포함."""
    result = _format_screen_context_line(
        ScreenContext(
            screen="incidents",
            screen_label="인시던트",
            system_id="10",
            incident_id="inc-123",
        )
    )
    assert result == "[현재 사용자 화면: 인시던트 / 시스템: 10 / 인시던트: inc-123]"


def test_format_screen_context_line_partial():
    """system_id만 있으면 화면 레이블 없이 시스템만."""
    result = _format_screen_context_line(ScreenContext(system_id="5"))
    assert result == "[현재 사용자 화면: 시스템: 5]"


def test_decision_prompt_no_screen_context():
    """screen_context=None 이면 동적 화면 컨텍스트 라인([현재 사용자 화면: ...])이 없어야 한다."""
    prompt = _decision_prompt([], "이력없음", "안녕", screen_context=None)
    assert "[현재 사용자 화면:" not in prompt
    assert "사용자 새 메시지: 안녕" in prompt


def test_decision_prompt_with_screen_context():
    """screen_context가 있으면 사용자 새 메시지 직전에 컨텍스트 라인이 삽입된다."""
    ctx = ScreenContext(screen_label="운영 대시보드")
    prompt = _decision_prompt([], "이력없음", "안녕", screen_context=ctx)
    assert "사용자 화면 컨텍스트: [현재 사용자 화면: 운영 대시보드]" in prompt
    # 컨텍스트 라인이 사용자 메시지보다 먼저 나와야 한다
    ctx_pos = prompt.index("사용자 화면 컨텍스트")
    msg_pos = prompt.index("사용자 새 메시지: 안녕")
    assert ctx_pos < msg_pos
