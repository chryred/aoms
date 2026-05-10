"""ReAct 챗봇 오케스트레이터.

- 대화 이력과 활성 도구 스키마를 프롬프트에 주입
- LLM이 JSON으로 action 또는 final_answer 선택
- 최종 답변 단계는 토큰 스트리밍으로 전달 (SSE)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, AsyncIterator

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from models import ChatMessage, ChatSession, LlmAgentConfig
from schemas import ScreenContext
from services.chat_tools.registry import list_enabled_tools, run_tool
from services.llm_client import call_llm_stream, call_llm_text
from services.prompts import (
    decision_prompt as _decision_prompt,
    final_prompt as _final_prompt,
    help_decision_prompt as _help_decision_prompt,
    help_final_prompt as _help_final_prompt,
    _format_screen_context_line,
)

logger = logging.getLogger(__name__)

MAX_ITERS = int(os.getenv("CHAT_MAX_ITERS", "5"))
HISTORY_WINDOW = int(os.getenv("CHAT_HISTORY_WINDOW", "20"))
TOOL_RESULT_MAX = int(os.getenv("CHAT_TOOL_RESULT_MAX", "8192"))  # observation bytes

# run_react_stream이 저장하는 시스템 에러 메시지 prefix 목록.
# 이 prefix로 시작하는 assistant 메시지는 _history_lines에서 제외한다.
# LLM 실패 후 재시도 시 에러 텍스트가 ReAct 히스토리에 주입되어 JSON 파싱을 깨뜨리는 문제를 방지.
_SYSTEM_ERROR_PREFIXES = (
    "LLM 호출에 실패했습니다:",
    "응답 형식을 해석하지 못했습니다.",
    "응답 구조가 불완전합니다.",
    "최종 답변 생성 실패:",
    "도구 호출이 ",
)


def _truncate(text: str, limit: int) -> str:
    if not text:
        return ""
    return text if len(text) <= limit else text[:limit] + "...(truncated)"


def _history_lines(messages: list[ChatMessage]) -> str:
    lines: list[str] = []
    for m in messages:
        if m.role == "user":
            lines.append(f"user: {m.content}")
        elif m.role == "tool":
            args = json.dumps(m.tool_args or {}, ensure_ascii=False)
            result = json.dumps(m.tool_result or {}, ensure_ascii=False)
            lines.append(
                f"assistant: {{\"thought\":\"{(m.thought or '').replace(chr(34), '')}\","
                f"\"action\":\"{m.tool_name or ''}\",\"args\":{args}}}"
            )
            lines.append(f"observation: {_truncate(result, TOOL_RESULT_MAX)}")
        elif m.role == "assistant":
            if m.content:
                if not any(m.content.startswith(p) for p in _SYSTEM_ERROR_PREFIXES):
                    lines.append(f"assistant: {m.content}")
            elif m.thought:
                lines.append(f"assistant: (thought) {m.thought}")
    return "\n".join(lines)


async def _get_agent_code(db: AsyncSession, area_code: str) -> str:
    row = (
        await db.execute(select(LlmAgentConfig).where(LlmAgentConfig.area_code == area_code))
    ).scalar_one_or_none()
    return (row.agent_code if row and row.is_active else "") or ""


# ── 현업(help_inquiry) 전용 도구 필터 ───────────────────────────────────────

_HELP_ALLOWED_TOOLS = {
    "qdrant_search_knowledge",
    "qdrant_search_aggregation_summary",
    "qdrant_search_guide",
    "qdrant_get_guide_chunks",
    "qdrant_get_document_chunks",
    "qdrant_get_confluence_chunks",
}


async def _append_message(
    db: AsyncSession,
    *,
    session_id: str,
    role: str,
    content: str = "",
    thought: str | None = None,
    tool_name: str | None = None,
    tool_args: dict | None = None,
    tool_result: dict | None = None,
    attachments: list | None = None,
    system_id: int | None = None,
) -> ChatMessage:
    msg = ChatMessage(
        session_id=session_id,
        role=role,
        content=content,
        thought=thought,
        tool_name=tool_name,
        tool_args=tool_args,
        tool_result=tool_result,
        attachments=attachments or [],
        system_id=system_id,
    )
    db.add(msg)
    await db.flush()
    return msg


async def _resolve_system_id_from_name(db: AsyncSession, system_name: str) -> int | None:
    """system_name으로 systems 테이블 조회 → system_id 반환. 없으면 None."""
    from models import System
    from sqlalchemy import select as _select
    row = (
        await db.execute(
            _select(System).where(System.system_name == system_name)
        )
    ).scalar_one_or_none()
    if row is None:
        # display_name으로도 시도
        row = (
            await db.execute(
                _select(System).where(System.display_name == system_name)
            )
        ).scalar_one_or_none()
    return row.id if row else None


def _extract_system_id_from_tool(
    tool_args: dict,
    tool_result: dict | None,
    session_system_ids: list[int],
) -> int | None:
    """도구 호출 결과/인자에서 system_id를 추출한다.

    폴백 순서:
    1. tool_args.system_id
    2. tool_result에서 단일 system_id 노출
    3. 세션의 system_ids가 1개면 그것
    4. NULL
    tool_args.system_name은 비동기 DB 조회가 필요하므로 별도 처리.
    """
    # 1. tool_args.system_id
    sid = tool_args.get("system_id")
    if sid is not None:
        try:
            return int(sid)
        except (TypeError, ValueError):
            pass

    # 2. tool_result 단일 system_id
    if isinstance(tool_result, dict):
        sid = tool_result.get("system_id")
        if sid is not None:
            try:
                return int(sid)
            except (TypeError, ValueError):
                pass

    # 3. 세션 스코프가 단 1개
    if len(session_system_ids) == 1:
        return session_system_ids[0]

    return None


def _parse_json(text: str) -> dict | None:
    try:
        text = text.strip()
        # 중괄호 균형으로 첫 JSON 블록 추출
        start = text.find("{")
        if start < 0:
            return None
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(text)):
            ch = text[i]
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == '"':
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(text[start:i + 1])
        return None
    except Exception:  # noqa: BLE001
        return None


async def run_react_stream(
    db: AsyncSession,
    session: ChatSession,
    user_message: str,
    *,
    attachments: list | None = None,
    screen_context: ScreenContext | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """SSE 이벤트 async iterator. 각 dict는 `{type, data}` 구조."""

    # 1) user 메시지 저장
    user_msg = await _append_message(
        db,
        session_id=session.id,
        role="user",
        content=user_message,
        attachments=attachments or [],
    )
    if session.title in ("", "새 대화") and user_message:
        session.title = user_message[:30]
    await db.commit()

    yield {"type": "user_saved", "data": {"message_id": user_msg.id}}

    agent_code = await _get_agent_code(db, session.area_code or "chat_assistant")

    for iteration in range(1, MAX_ITERS + 1):
        yield {"type": "iter_start", "data": {"iteration": iteration}}

        # 이력 로드 (window 적용)
        messages = (
            (
                await db.execute(
                    select(ChatMessage)
                    .where(ChatMessage.session_id == session.id)
                    .order_by(ChatMessage.created_at.desc())
                    .limit(HISTORY_WINDOW)
                )
            )
            .scalars()
            .all()
        )
        messages = list(reversed(messages))

        all_tools = await list_enabled_tools(db)
        # help_inquiry 세션: RAG 도구만 허용
        if session.area_code == "help_inquiry":
            tools = [t for t in all_tools if t["name"] in _HELP_ALLOWED_TOOLS]
        else:
            tools = all_tools
        history_msgs = [m for m in messages if m.id != user_msg.id]
        history = _history_lines(history_msgs)
        if session.area_code == "help_inquiry":
            system_id = getattr(session, "visitor_system_id", None)
            prompt = _help_decision_prompt(tools, history, user_message, system_id, screen_context)
        else:
            prompt = _decision_prompt(tools, history, user_message, screen_context)

        try:
            raw = await call_llm_text(prompt, max_tokens=10000, agent_code=agent_code)
        except Exception as e:  # noqa: BLE001
            yield {"type": "error", "data": {"message": f"LLM 호출 실패: {e}"}}
            await _append_message(
                db,
                session_id=session.id,
                role="assistant",
                content=f"LLM 호출에 실패했습니다: {str(e)[:150]}",
            )
            await db.commit()
            return

        parsed = _parse_json(raw or "")
        if parsed is None:
            # 1회 재시도
            retry = await call_llm_text(
                prompt + "\n\n※ 반드시 유효한 JSON 한 객체만 반환하세요.",
                max_tokens=400,
                agent_code=agent_code,
            )
            parsed = _parse_json(retry or "")
        if parsed is None:
            logger.warning("ReAct JSON 파싱 실패: %s", (raw or "")[:200])
            content = f"응답 형식을 해석하지 못했습니다. 원문 일부: {(raw or '')[:150]}"
            await _append_message(db, session_id=session.id, role="assistant", content=content)
            await db.commit()
            yield {"type": "final", "data": {"content": content}}
            return

        thought = str(parsed.get("thought") or "").strip()
        if thought:
            yield {"type": "thought", "data": {"iteration": iteration, "thought": thought}}

        # 최종 답변 단계로 전환
        if parsed.get("final_answer_ready") or parsed.get("final_answer"):
            # 토큰 스트리밍
            history_full = _history_lines(messages)
            if session.area_code == "help_inquiry":
                final_prompt = _help_final_prompt(history_full)
            else:
                final_prompt = _final_prompt(history_full)
            acc_text = ""
            try:
                async for chunk in call_llm_stream(final_prompt, agent_code=agent_code):
                    acc_text += chunk
                    yield {"type": "token", "data": {"chunk": chunk}}
            except Exception as e:  # noqa: BLE001
                acc_text = acc_text or f"최종 답변 생성 실패: {e}"
            if not acc_text:
                # final_answer가 본문에 있으면 그걸 사용
                acc_text = str(parsed.get("final_answer") or "").strip() or "(답변 없음)"
                for i in range(0, len(acc_text), 24):
                    chunk = acc_text[i:i + 24]
                    yield {"type": "token", "data": {"chunk": chunk}}
                    await asyncio.sleep(0.02)

            final_msg = await _append_message(
                db,
                session_id=session.id,
                role="assistant",
                content=acc_text,
                thought=thought or None,
            )
            await db.commit()
            yield {
                "type": "final",
                "data": {"message_id": final_msg.id, "content": acc_text},
            }
            return

        # 도구 호출 단계
        action = str(parsed.get("action") or "").strip()
        args = parsed.get("args") or {}
        if not action:
            # action도 final도 없으면 종료
            msg = "응답 구조가 불완전합니다."
            await _append_message(db, session_id=session.id, role="assistant", content=msg)
            await db.commit()
            yield {"type": "final", "data": {"content": msg}}
            return

        # qdrant 도구에 세션의 system_ids 주입 (LLM이 명시한 값 우선)
        session_system_ids: list[int] = list(getattr(session, "system_ids", None) or [])
        if action.startswith("qdrant_") and session_system_ids:
            if isinstance(args, dict):
                args.setdefault("system_ids", session_system_ids)
            else:
                args = {"system_ids": session_system_ids}

        safe_args = args if isinstance(args, dict) else {}

        # export_chat_markdown 도구는 현재 세션 ID가 필요
        if action == "export_chat_markdown":
            safe_args["_session_id"] = str(session.id)

        yield {"type": "tool_call", "data": {"tool": action, "args": safe_args}}
        result = await run_tool(db, action, safe_args)

        # system_id 추출 (동기 우선 폴백)
        extracted_system_id = _extract_system_id_from_tool(safe_args, result, session_system_ids)
        # tool_args.system_name → DB 조회 폴백 (추출 못한 경우만)
        if extracted_system_id is None:
            system_name_hint = safe_args.get("system_name")
            if system_name_hint:
                try:
                    extracted_system_id = await _resolve_system_id_from_name(db, str(system_name_hint))
                except Exception as _sid_exc:  # noqa: BLE001
                    logger.debug("system_id 이름 조회 실패 (무시): %s", _sid_exc)

        tool_msg = await _append_message(
            db,
            session_id=session.id,
            role="tool",
            thought=thought or None,
            tool_name=action,
            tool_args=safe_args,
            tool_result=result,
            system_id=extracted_system_id,
        )

        # V1 RAG: qdrant_search_knowledge 결과의 top-1 점수를 직전 user 메시지에 기록
        if action == "qdrant_search_knowledge" and isinstance(result, dict) and "error" not in result:
            try:
                raw_results = result.get("results") or []
                top1_score: float | None = raw_results[0].get("score") if raw_results else None
                sources_count: int = result.get("count", len(raw_results))
                await db.execute(
                    text(
                        "UPDATE chat_messages"
                        " SET rag_top1_score = :score, rag_sources_count = :cnt"
                        " WHERE id = :uid"
                    ),
                    {"score": top1_score, "cnt": sources_count, "uid": user_msg.id},
                )
            except Exception as _rag_exc:  # noqa: BLE001
                logger.debug("rag_top1_score 업데이트 실패 (무시): %s", _rag_exc)

        await db.commit()
        yield {
            "type": "tool_result",
            "data": {"message_id": tool_msg.id, "tool": action, "result": result},
        }

    # MAX_ITERS 초과
    msg = f"도구 호출이 {MAX_ITERS}회 반복 한도를 초과했습니다. 질문을 좀 더 구체화해 주세요."
    await _append_message(db, session_id=session.id, role="assistant", content=msg)
    await db.commit()
    yield {"type": "final", "data": {"content": msg}}
