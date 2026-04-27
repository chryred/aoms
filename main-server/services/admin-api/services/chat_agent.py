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
from services.chat_tools.registry import list_enabled_tools, run_tool
from services.llm_client import call_llm_stream, call_llm_text

logger = logging.getLogger(__name__)

MAX_ITERS = int(os.getenv("CHAT_MAX_ITERS", "5"))
HISTORY_WINDOW = int(os.getenv("CHAT_HISTORY_WINDOW", "20"))
TOOL_RESULT_MAX = int(os.getenv("CHAT_TOOL_RESULT_MAX", "8192"))  # observation bytes


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
                lines.append(f"assistant: {m.content}")
            elif m.thought:
                lines.append(f"assistant: (thought) {m.thought}")
    return "\n".join(lines)


async def _get_agent_code(db: AsyncSession, area_code: str) -> str:
    row = (
        await db.execute(select(LlmAgentConfig).where(LlmAgentConfig.area_code == area_code))
    ).scalar_one_or_none()
    return (row.agent_code if row and row.is_active else "") or ""


def _decision_prompt(tools: list[dict[str, Any]], history: str, user_message: str) -> str:
    tools_json = json.dumps(tools, ensure_ascii=False)
    return f"""역할: 당신은 Synapse-V 운영 어시스턴트입니다. 사용자 질문을 해결하기 위해
아래 도구를 사용할 수 있습니다.

출력 규약 (단일 JSON 객체만 반환, 코드펜스/설명 금지):
  도구 호출: {{"thought":"...","action":"<tool_name>","args":{{ ... }}}}
  최종 응답: {{"thought":"...","final_answer_ready":true}}

- 도구가 필요 없으면 바로 final_answer_ready=true 반환.
- args는 해당 도구의 input_schema를 준수.
- 사용자가 시스템 이름(예: "고객경험시스템", "주문시스템")을 언급하면 먼저 ems_get_resources_by_system으로 서버 목록(role_label)을 확인한다. 이후 EMS 도구는 모두 system_display_name + (선택) role_label 조합으로 호출한다. resource_id나 IP는 사용자/LLM이 직접 다루지 않는다.
- 시스템 전체를 조회할 때는 role_label 생략, 특정 서버(was1, db1 등)만 조회할 때는 role_label 지정.
  예: CPU 사용률 → ems_get_system_usage_summary(system_display_name="고객경험시스템", timeSelector="day")
  예: db1만 상세 → ems_get_system_server_detail(system_display_name="고객경험시스템", role_label="db1")
- ems_get_resources_by_system은 같은 시스템에 대해 대화 이력에 이미 결과가 있으면 재호출하지 않는다. 결과의 available_role_labels 필드로 사용 가능한 서버를 확인한다.
- 같은 도구의 결과가 대화 이력에 여러 번 있는 경우 가장 최근 observation을 사용하고, 이전 실패(null·에러)는 무시한다.
- admin_list_systems 호출 시 시스템명을 알고 있으면 반드시 display_name 파라미터를 지정해 해당 시스템만 조회한다 (전체 조회 금지).
- ems_get_team_group_id는 사용자가 EMS Polestar 자체의 팀/그룹명을 직접 지정한 경우에만 사용한다.
- 과거 장애 원인·해결책·재발 여부를 묻는 질문은 qdrant_search_incident_knowledge 를 사용한다 (Qdrant Hybrid 벡터 검색 — 의미 + 키워드).
  예: "이 에러 전에도 발생했나?", "OOM 이슈 어떻게 해결했어?", "DB 연결 오류 원인이 뭐야?", "이거랑 비슷한 장애 찾아줘"
- 특정 기간의 시스템 분석 요약·이슈를 묻는 질문은 qdrant_search_aggregation_summary 를 사용한다.
  예: "지난달 결제 서비스 상태 요약", "3월에 어떤 장애가 있었나?", "이번 주 DB 서버 이슈"
- 최근 몇 시간 이내의 시스템 메트릭 패턴·이상 징후를 묻는 질문은 qdrant_search_hourly_patterns 를 사용한다 (1시간 집계 LLM 분석 결과 Hybrid 검색).
  예: "오늘 오후 3시 결제 시스템 CPU 상태", "아까 DB 서버 메모리 어땠어?", "오전에 로그 에러 급증한 시스템 있었나?"
- 운영 매뉴얼·정책·Jira 티켓·Confluence 문서·사내 지식 관련 질문은 qdrant_search_knowledge 를 사용한다 (V1 knowledge 컬렉션 federated Hybrid+Reranker 검색).
  예: "배포 절차 어떻게 되나요?", "DB 점검 매뉴얼 알려줘", "이슈 처리 정책 찾아줘", "Confluence에 등록된 장애 대응 가이드"
  system_id 또는 system_name 필터를 사용하면 해당 시스템 지식만 조회한다.
- qdrant_* 도구는 admin_search_alert_history 보다 '의미 기반 검색'이 필요한 경우 우선 사용한다. admin_search_alert_history 는 특정 날짜·알림명·시스템으로 이력 정확 조회 시에만 사용한다.

사용 가능한 도구:
{tools_json}

대화 이력:
{history}

사용자 새 메시지: {user_message}

JSON:"""


def _final_prompt(history: str) -> str:
    return f"""역할: 당신은 Synapse-V 운영 어시스턴트입니다.
지금까지 도구 호출로 수집된 관측 결과를 바탕으로 사용자에게 한국어로 답변하세요.
- 필요한 수치·시간·서버명은 근거와 함께 간결히.
- 과장/추측 금지. 관측에 없는 내용은 "확인 필요"로 명시.
- 마크다운 사용 가능.

대화 이력 및 관측 결과:
{history}

최종 한국어 답변:"""


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
    )
    db.add(msg)
    await db.flush()
    return msg


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

        tools = await list_enabled_tools(db)
        history_msgs = [m for m in messages if m.id != user_msg.id]
        history = _history_lines(history_msgs)
        prompt = _decision_prompt(tools, history, user_message)

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

        yield {"type": "tool_call", "data": {"tool": action, "args": args}}
        result = await run_tool(db, action, args if isinstance(args, dict) else {})
        tool_msg = await _append_message(
            db,
            session_id=session.id,
            role="tool",
            thought=thought or None,
            tool_name=action,
            tool_args=args if isinstance(args, dict) else {},
            tool_result=result,
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
