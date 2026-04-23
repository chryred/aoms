"""챗봇 도구 레지스트리 및 디스패처.

`chat_tools` 테이블에서 활성 도구 메타를 조회해 ReAct 프롬프트에 주입하고,
LLM이 선택한 tool을 executor별로 디스패치한다.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ChatTool
from services.chat_tools.executors import admin as admin_exec
from services.chat_tools.executors import ems as ems_exec
from services.chat_tools.executors import log_analyzer as log_exec
from services.chat_tools.executors import qdrant as qdrant_exec

try:  # 선택 의존성. 없으면 기본 validation 생략.
    import jsonschema  # type: ignore

    _HAS_JSONSCHEMA = True
except Exception:  # noqa: BLE001
    _HAS_JSONSCHEMA = False


_EXECUTORS = {
    "ems": ems_exec.execute,
    "admin": admin_exec.execute,
    "log_analyzer": log_exec.execute,
    "qdrant": qdrant_exec.execute,
}


async def list_enabled_tools(db: AsyncSession) -> list[dict[str, Any]]:
    """프롬프트 주입용: 활성 도구의 name/description/input_schema."""
    rows = (
        await db.execute(select(ChatTool).where(ChatTool.is_enabled.is_(True)).order_by(ChatTool.name))
    ).scalars().all()
    return [
        {"name": r.name, "description": r.description, "input_schema": r.input_schema or {}}
        for r in rows
    ]


async def run_tool(db: AsyncSession, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """도구 이름 → DB lookup → is_enabled/schema 검증 → executor 디스패치."""
    row = (
        await db.execute(select(ChatTool).where(ChatTool.name == name))
    ).scalar_one_or_none()
    if row is None:
        return {"error": f"도구를 찾을 수 없습니다: {name}"}
    if not row.is_enabled:
        return {"error": f"도구가 비활성화되어 있습니다: {name}"}

    # JSON Schema 검증 (선택)
    if _HAS_JSONSCHEMA and row.input_schema:
        try:
            jsonschema.validate(instance=args or {}, schema=row.input_schema)
        except jsonschema.ValidationError as e:
            return {"error": f"도구 인자 검증 실패: {e.message}"}

    executor_fn = _EXECUTORS.get(row.executor)
    if executor_fn is None:
        return {"error": f"지원하지 않는 executor: {row.executor}"}

    return await executor_fn(db, name, args or {})
