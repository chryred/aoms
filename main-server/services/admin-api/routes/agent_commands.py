"""Agent-T 원격 명령 — 스레드 덤프 요청·목록·본문 조회 (본문은 ClickHouse jvm_thread_dump)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AgentCommand, AgentInstance, User
from routes.apm import clickhouse_guard
from schemas import ThreadDumpCommandOut, ThreadDumpListItem, ThreadDumpOut
from services import clickhouse_client

router = APIRouter(
    prefix="/api/v1/agents", tags=["agent-commands"], dependencies=[Depends(clickhouse_guard)],
)

_COMMAND = "thread_dump"


async def _get_agent_t(db: AsyncSession, agent_id: int) -> AgentInstance:
    agent = await db.get(AgentInstance, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="에이전트를 찾을 수 없습니다")
    if agent.agent_type != "agent_t":
        raise HTTPException(status_code=400, detail="Agent-T 인스턴스만 지원합니다")
    return agent


@router.post("/{agent_id}/thread-dump", response_model=ThreadDumpCommandOut, status_code=201)
async def request_thread_dump(
    agent_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user),
):
    await _get_agent_t(db, agent_id)
    inflight = (await db.execute(
        select(AgentCommand.id).where(
            AgentCommand.agent_instance_id == agent_id,
            AgentCommand.command == _COMMAND,
            AgentCommand.status.in_(["pending", "sent"]),
        ).limit(1)
    )).scalar_one_or_none()
    if inflight is not None:
        raise HTTPException(status_code=409, detail="이미 처리 중인 스레드 덤프 요청이 있습니다")
    cmd = AgentCommand(
        agent_instance_id=agent_id, command=_COMMAND, status="pending", requested_by=user.id,
    )
    db.add(cmd)
    await db.commit()
    await db.refresh(cmd)
    return ThreadDumpCommandOut(command_id=cmd.id)


@router.get("/{agent_id}/thread-dumps", response_model=list[ThreadDumpListItem])
async def list_thread_dumps(
    agent_id: int,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    agent = await _get_agent_t(db, agent_id)
    cmds = (await db.execute(
        select(AgentCommand).where(
            AgentCommand.agent_instance_id == agent_id, AgentCommand.command == _COMMAND,
        ).order_by(AgentCommand.id.desc()).limit(limit)
    )).scalars().all()

    done_ids = [c.id for c in cmds if c.status == "done"]
    truncated: dict[int, bool] = {}
    if done_ids:
        rows = await clickhouse_client.query(
            "SELECT cmd_id, truncated FROM agent_t.jvm_thread_dump "
            "WHERE system_id = {system_id:UInt32} AND cmd_id IN {cmd_ids:Array(UInt64)}",
            {"system_id": agent.system_id, "cmd_ids": done_ids},
        )
        truncated = {int(r["cmd_id"]): bool(r["truncated"]) for r in rows}
    return [
        ThreadDumpListItem(
            command_id=c.id, status=c.status, requested_at=c.created_at,
            truncated=truncated.get(c.id) if c.status == "done" else None,
        )
        for c in cmds
    ]


@router.get("/{agent_id}/thread-dumps/{command_id}", response_model=ThreadDumpOut)
async def get_thread_dump(
    agent_id: int, command_id: int,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    agent = await _get_agent_t(db, agent_id)
    cmd = await db.get(AgentCommand, command_id)
    if cmd is None or cmd.agent_instance_id != agent_id or cmd.command != _COMMAND:
        raise HTTPException(status_code=404, detail="스레드 덤프를 찾을 수 없습니다")
    rows = await clickhouse_client.query(
        "SELECT text, truncated, ts FROM agent_t.jvm_thread_dump "
        "WHERE system_id = {system_id:UInt32} AND cmd_id = {cmd_id:UInt64} "
        "ORDER BY ts DESC LIMIT 1",
        {"system_id": agent.system_id, "cmd_id": command_id},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="스레드 덤프를 찾을 수 없습니다")
    row = rows[0]
    return ThreadDumpOut(text=row["text"], truncated=bool(row["truncated"]), ts=row["ts"])
