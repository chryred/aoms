"""챗봇 조회 범위(scope) 판정·SSE scope 이벤트·도구 인자 주입·프롬프트 표기 테스트."""

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from models import ChatSession, System
from schemas import ScreenContext
from services import chat_agent
from services.chat_agent import _inject_scope_args, resolve_chat_scope
from services.prompts import _format_screen_context_line, decision_prompt


# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
async def systems(db_session):
    pay = System(system_name="pay", display_name="결제")
    crm = System(system_name="crm", display_name="CRM")
    db_session.add_all([pay, crm])
    await db_session.commit()
    await db_session.refresh(pay)
    await db_session.refresh(crm)
    return pay, crm


async def _make_session(db, system_ids=None, area_code="chat_assistant"):
    s = ChatSession(user_id=None, title="새 대화", area_code=area_code, system_ids=system_ids or [])
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


def _sys(i, name, display):
    return {"id": i, "system_name": name, "display_name": display}


# ── HISTORY_WINDOW ──────────────────────────────────────────────────────────

def test_history_window_default_is_8():
    assert chat_agent.HISTORY_WINDOW == 8


# ── 범위 판정 3분기 ─────────────────────────────────────────────────────────

async def test_scope_screen_wins_over_session(db_session, systems):
    pay, crm = systems
    session = await _make_session(db_session, [crm.id])
    scope = await resolve_chat_scope(db_session, session, ScreenContext(system_id=str(pay.id)))
    assert scope == {"source": "screen", "systems": [_sys(pay.id, "pay", "결제")]}


async def test_scope_screen_from_incident_when_no_system_id(db_session, systems):
    """인시던트 화면은 incident_id 만 보내도 인시던트의 시스템이 화면 범위가 된다."""
    from models import Incident

    pay, crm = systems
    inc = Incident(system_id=pay.id, title="t", severity="warning", status="open",
                   detected_at=datetime.now(timezone.utc).replace(tzinfo=None))
    db_session.add(inc)
    await db_session.commit()
    await db_session.refresh(inc)
    session = await _make_session(db_session, [crm.id])
    scope = await resolve_chat_scope(db_session, session, ScreenContext(incident_id=str(inc.id)))
    assert scope == {"source": "screen", "systems": [_sys(pay.id, "pay", "결제")]}
    # 존재하지 않는 인시던트면 세션 범위로
    scope2 = await resolve_chat_scope(db_session, session, ScreenContext(incident_id="999999"))
    assert scope2["source"] == "session"


def test_extract_system_id_does_not_fall_back_to_session_scope():
    """시스템과 무관한 도구 호출을 세션 기본 시스템으로 기록하지 않는다 ("조회:" 표시 오류 방지)."""
    from services.chat_agent import _extract_system_id_from_tool

    assert _extract_system_id_from_tool({}, {"items": []}, [7]) is None
    assert _extract_system_id_from_tool({"system_id": "5"}, None, [7]) == 5
    assert _extract_system_id_from_tool({"system_ids": [9]}, None, [7]) == 9
    assert _extract_system_id_from_tool({"system_ids": [9, 10]}, None, [7]) is None


async def test_scope_session_when_no_screen_system(db_session, systems):
    pay, crm = systems
    session = await _make_session(db_session, [crm.id, pay.id])
    scope = await resolve_chat_scope(db_session, session, ScreenContext(screen="dashboard"))
    assert scope["source"] == "session"
    assert [s["id"] for s in scope["systems"]] == [crm.id, pay.id]  # 세션 순서 유지


async def test_scope_session_when_screen_system_invalid(db_session, systems):
    pay, _ = systems
    session = await _make_session(db_session, [pay.id])
    for bad in ("9999", "abc"):
        scope = await resolve_chat_scope(db_session, session, ScreenContext(system_id=bad))
        assert scope["source"] == "session"
        assert scope["systems"][0]["id"] == pay.id


async def test_scope_all_when_nothing(db_session, systems):
    session = await _make_session(db_session, [])
    assert await resolve_chat_scope(db_session, session, None) == {"source": "all", "systems": []}


# ── scope 이벤트 emit ───────────────────────────────────────────────────────

async def _run_stream(db, session, message="안녕", screen_context=None):
    llm = AsyncMock(return_value=json.dumps({"thought": "끝", "final_answer_ready": True}))

    async def fake_stream(*_a, **_k):
        yield "답변"

    with patch.object(chat_agent, "call_llm_text", llm), \
         patch.object(chat_agent, "call_llm_stream", fake_stream), \
         patch.object(chat_agent, "list_enabled_tools", AsyncMock(return_value=[])):
        events = [e async for e in chat_agent.run_react_stream(
            db, session, message, screen_context=screen_context)]
    return events, llm


async def test_scope_event_emitted_before_first_iter(db_session, systems):
    pay, _ = systems
    session = await _make_session(db_session, [])
    events, llm = await _run_stream(db_session, session, screen_context=ScreenContext(system_id=str(pay.id)))
    types = [e["type"] for e in events]
    assert types.count("scope") == 1
    assert types.index("scope") < types.index("iter_start")
    scope_evt = next(e for e in events if e["type"] == "scope")
    assert scope_evt["data"] == {"source": "screen", "systems": [_sys(pay.id, "pay", "결제")]}
    # 프롬프트에 범위 블록이 들어갔는지
    prompt = llm.call_args.args[0]
    assert f"[조회 범위] 기본 대상 시스템: 결제(pay) [system_name=pay, system_id={pay.id}] (출처: 현재 화면)" in prompt


async def test_scope_event_all_has_no_scope_block(db_session):
    session = await _make_session(db_session, [])
    events, llm = await _run_stream(db_session, session)
    scope_evt = next(e for e in events if e["type"] == "scope")
    assert scope_evt["data"] == {"source": "all", "systems": []}
    assert "[조회 범위]" not in llm.call_args.args[0]


async def test_scope_event_emitted_in_auto_insight(authed_client, db_session, systems):
    """auto-insight 엔드포인트의 SSE 에도 scope 이벤트가 첫 iter_start 전에 나온다."""
    from models import Incident
    from routes import chat as chat_routes

    pay, _ = systems
    resp = await authed_client.post("/api/v1/chat/sessions", json={"system_ids": [pay.id]})
    assert resp.status_code == 201
    sid = resp.json()["id"]
    inc = Incident(
        system_id=pay.id, title="t", severity="warning", status="open",
        detected_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(inc)
    await db_session.commit()
    await db_session.refresh(inc)

    llm = AsyncMock(return_value=json.dumps({"thought": "끝", "final_answer_ready": True}))

    async def fake_stream(*_a, **_k):
        yield "ok"

    # 라우트가 자체 세션(AsyncSessionLocal)을 여므로 같은 db_session 을 돌려준다.
    class _Ctx:
        async def __aenter__(self_inner):
            return db_session

        async def __aexit__(self_inner, *a):
            return False

    with patch.object(chat_routes, "AsyncSessionLocal", lambda: _Ctx()), \
         patch.object(chat_agent, "call_llm_text", llm), \
         patch.object(chat_agent, "call_llm_stream", fake_stream), \
         patch.object(chat_agent, "list_enabled_tools", AsyncMock(return_value=[])):
        r = await authed_client.post(
            f"/api/v1/chat/sessions/{sid}/auto-insight", json={"incident_id": inc.id})
    assert r.status_code == 200
    body = r.text
    assert "event: scope" in body or '"type": "scope"' in body or '"type":"scope"' in body
    assert body.index("scope") < body.index("iter_start")


async def test_help_session_has_no_scope_event(db_session, systems):
    session = await _make_session(db_session, [], area_code="help_inquiry")
    events, _ = await _run_stream(db_session, session)
    assert "scope" not in [e["type"] for e in events]


# ── 도구 인자 주입 ──────────────────────────────────────────────────────────

_TOOLS = [
    {"name": "prometheus_query", "input_schema": {"properties": {"system_name": {}, "metric_group": {}}}},
    {"name": "admin_get_incident_context", "input_schema": {"properties": {"incident_id": {}}}},
    {"name": "apm_x", "input_schema": {"properties": {"system_id": {}}}},
    {"name": "both", "input_schema": {"properties": {"system_id": {}, "system_name": {}}}},
]
_ONE = {"source": "screen", "systems": [_sys(3, "pay", "결제")]}
_MANY = {"source": "session", "systems": [_sys(3, "pay", "결제"), _sys(4, "crm", "CRM")]}


def test_inject_single_scope_fills_system_name():
    args = _inject_scope_args("prometheus_query", {"metric_group": "cpu"}, _ONE, [], _TOOLS)
    assert args == {"metric_group": "cpu", "system_name": "pay"}


def test_inject_single_scope_fills_system_id_only_if_in_schema():
    assert _inject_scope_args("apm_x", {}, _ONE, [], _TOOLS) == {"system_id": 3}
    assert _inject_scope_args("both", {}, _ONE, [], _TOOLS) == {"system_id": 3, "system_name": "pay"}


def test_inject_skips_tool_without_system_keys():
    assert _inject_scope_args("admin_get_incident_context", {"incident_id": 1}, _ONE, [], _TOOLS) == {"incident_id": 1}


def test_inject_skips_unknown_tool():
    assert _inject_scope_args("nope", {}, _ONE, [], _TOOLS) == {}


def test_inject_multiple_scope_not_injected():
    assert _inject_scope_args("prometheus_query", {"metric_group": "cpu"}, _MANY, [3, 4], _TOOLS) == {"metric_group": "cpu"}


def test_inject_llm_explicit_value_wins():
    args = _inject_scope_args("prometheus_query", {"system_name": "crm"}, _ONE, [], _TOOLS)
    assert args["system_name"] == "crm"
    args = _inject_scope_args("apm_x", {"system_id": 9}, _ONE, [], _TOOLS)
    assert args["system_id"] == 9
    # system_name 을 LLM 이 줬다면 system_id 도 채우지 않는다 (이름-ID 불일치 방지)
    args = _inject_scope_args("both", {"system_name": "crm"}, _ONE, [], _TOOLS)
    assert args == {"system_name": "crm"}


def test_inject_all_scope_not_injected():
    assert _inject_scope_args("prometheus_query", {}, {"source": "all", "systems": []}, [], _TOOLS) == {}


def test_inject_qdrant_session_ids_setdefault():
    args = _inject_scope_args("qdrant_search_guide", {}, _MANY, [3, 4], [])
    assert args == {"system_ids": [3, 4]}
    # LLM 명시값 우선
    args = _inject_scope_args("qdrant_search_guide", {"system_ids": [4]}, _MANY, [3, 4], [])
    assert args == {"system_ids": [4]}


def test_inject_qdrant_screen_overrides_session_ids():
    args = _inject_scope_args("qdrant_search_guide", {}, _ONE, [3, 4], [])
    assert args == {"system_ids": [3]}


def test_inject_qdrant_all_scope_no_ids():
    assert _inject_scope_args("qdrant_search_guide", {"query": "x"}, {"source": "all", "systems": []}, [], []) == {"query": "x"}


async def test_run_loop_injects_into_run_tool(db_session, systems):
    """run 루프 통합: 단일 화면 범위 → run_tool 에 system_name 주입, tool 메시지 system_id 기록."""
    pay, _ = systems
    session = await _make_session(db_session, [])
    tools = [{"name": "prometheus_query", "description": "", "input_schema": {"properties": {"system_name": {}}}}]
    replies = iter([
        json.dumps({"thought": "조회", "action": "prometheus_query", "args": {}}),
        json.dumps({"thought": "끝", "final_answer_ready": True}),
    ])
    run_tool = AsyncMock(return_value={"ok": True})

    async def fake_stream(*_a, **_k):
        yield "x"

    with patch.object(chat_agent, "call_llm_text", AsyncMock(side_effect=lambda *a, **k: next(replies))), \
         patch.object(chat_agent, "call_llm_stream", fake_stream), \
         patch.object(chat_agent, "list_enabled_tools", AsyncMock(return_value=tools)), \
         patch.object(chat_agent, "run_tool", run_tool):
        events = [e async for e in chat_agent.run_react_stream(
            db_session, session, "CPU?", screen_context=ScreenContext(system_id=str(pay.id)))]
    assert run_tool.call_args.args[2] == {"system_name": "pay"}
    tc = next(e for e in events if e["type"] == "tool_call")
    assert tc["data"]["args"] == {"system_name": "pay"}


# ── 프롬프트 표기 ───────────────────────────────────────────────────────────

def test_screen_context_line_uses_resolved_label():
    line = _format_screen_context_line(ScreenContext(screen_label="시스템 상세", system_id="3"), "결제(pay)")
    assert line == "[현재 사용자 화면: 시스템 상세 / 시스템: 결제(pay)]"


def test_screen_context_line_falls_back_to_id():
    assert _format_screen_context_line(ScreenContext(system_id="3")) == "[현재 사용자 화면: 시스템: 3]"


def test_screen_context_line_trace_span():
    line = _format_screen_context_line(
        ScreenContext(screen_label="건별 상세", trace_id="t1", span_id="s1"))
    assert line == "[현재 사용자 화면: 건별 상세 / 트랜잭션: trace=t1 span=s1]"
    only_trace = _format_screen_context_line(ScreenContext(trace_id="t1"))
    assert only_trace == "[현재 사용자 화면: 트랜잭션: trace=t1]"


def test_decision_prompt_scope_block_session_multi():
    scope = {"source": "session", "systems": [_sys(3, "pay", "결제"), _sys(4, "crm", "CRM")]}
    prompt = decision_prompt([], "", "질문", None, scope)
    assert ("[조회 범위] 기본 대상 시스템: 결제(pay) [system_name=pay, system_id=3], "
            "CRM(crm) [system_name=crm, system_id=4] (출처: 담당 시스템)") in prompt
    assert "이름이 비슷한 다른 시스템" in prompt
    assert "질문에 다른 시스템 이름이 나오면 그 시스템을 우선한다" in prompt
    assert "어느 시스템인지 되묻는다" in prompt


def test_decision_prompt_scope_block_omitted_for_all_or_none():
    assert "[조회 범위]" not in decision_prompt([], "", "질문", None, {"source": "all", "systems": []})
    assert "[조회 범위]" not in decision_prompt([], "", "질문")


def test_decision_prompt_screen_context_shows_name():
    scope = {"source": "screen", "systems": [_sys(3, "pay", "결제")]}
    prompt = decision_prompt([], "", "질문", ScreenContext(screen_label="시스템 상세", system_id="3"), scope)
    assert "시스템: 결제(pay)" in prompt
