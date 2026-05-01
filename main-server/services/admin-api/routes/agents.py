"""
에이전트(수집기) 설치·제어 API

SSH 인증:
  - POST /api/v1/ssh/session     계정 등록 → session_token 발급 (30분 슬라이딩)
  - DELETE /api/v1/ssh/session   세션 삭제 (로그아웃)
  - 모든 에이전트 제어 요청은 X-SSH-Session 헤더에 token 포함

에이전트 CRUD:
  - GET/POST /api/v1/agents
  - GET/PATCH/DELETE /api/v1/agents/{id}

에이전트 제어·설치·라이브 상태·OTel 설치는 routes/agents_control.py 참조.
"""

import asyncio
import json
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AgentInstance, System, SystemCollectorConfig
from schemas import (
    AgentInstanceCreate,
    AgentInstanceOut,
    AgentInstanceUpdate,
    SSHSessionCreate,
    SSHSessionOut,
)
from services.ssh_session import (
    SSHError,
    create_session,
    delete_session,
    ssh_exec,
)
from services.agent_utils import sanitize_promql_label

router = APIRouter(prefix="/api/v1", tags=["agents"])


# ── SSH 세션 ─────────────────────────────────────────────────────────────────

@router.post("/ssh/session", response_model=SSHSessionOut)
async def create_ssh_session(
    body: SSHSessionCreate,
    current_user=Depends(get_current_user),
):
    """계정 정보를 인메모리에 등록하고 session_token을 반환한다."""
    # 연결 가능 여부 사전 검증
    try:
        await asyncio.to_thread(
            ssh_exec, body.host, body.port, body.username, body.password, "echo ok"
        )
    except SSHError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    token, expires_at = create_session(body.host, body.port, body.username, body.password)
    return SSHSessionOut(
        session_token=token,
        host=body.host,
        port=body.port,
        username=body.username,
        expires_in=300,
    )


@router.delete("/ssh/session", status_code=204)
async def delete_ssh_session(
    x_ssh_session: Optional[str] = Header(None),
    current_user=Depends(get_current_user),
):
    if x_ssh_session:
        delete_session(x_ssh_session)


# ── 에이전트 CRUD ─────────────────────────────────────────────────────────────

@router.get("/agents", response_model=list[AgentInstanceOut])
async def list_agents(
    system_id: Optional[int] = None,
    agent_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    q = select(AgentInstance)
    if system_id is not None:
        q = q.where(AgentInstance.system_id == system_id)
    if agent_type is not None:
        q = q.where(AgentInstance.agent_type == agent_type)
    result = await db.execute(q.order_by(AgentInstance.id))
    return result.scalars().all()


@router.post("/agents", response_model=AgentInstanceOut, status_code=201)
async def create_agent(
    body: AgentInstanceCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # db 에이전트: label_info의 평문 password를 Fernet으로 암호화 후 저장
    if body.agent_type == "db" and body.label_info:
        import os as _os
        if not _os.getenv("ENCRYPTION_KEY"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="ENCRYPTION_KEY 환경변수가 설정되지 않았습니다. DB 수집기를 등록하려면 서버에 ENCRYPTION_KEY를 설정하세요.",
            )
        from services.crypto import encrypt_password, decrypt_password
        from services.db_backends import BACKENDS, DB_TYPE_PORTS, get_db_identifier_key
        try:
            info = json.loads(body.label_info)
            if "password" in info:
                plain_pw = info.pop("password")
                info["encrypted_password"] = encrypt_password(plain_pw)
                body.label_info = json.dumps(info)
            else:
                plain_pw = decrypt_password(info["encrypted_password"])
        except json.JSONDecodeError:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="label_info가 유효한 JSON이 아닙니다.")

        # db_type별 백엔드 연결 테스트 — 실패 시 등록 거부
        db_type = info.get("db_type", "oracle")
        backend = BACKENDS.get(db_type)
        if not backend:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"지원하지 않는 db_type: {db_type}")
        id_key = get_db_identifier_key(db_type)
        default_port = DB_TYPE_PORTS.get(db_type, 1521)
        try:
            await asyncio.to_thread(
                backend.test_connection,
                body.host,
                body.port or default_port,
                info.get(id_key, ""),
                info.get("username", ""),
                plain_pw,
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"DB 연결 실패 ({db_type}): {e}",
            )
        # 연결 테스트 성공 → 등록과 동시에 running (수집 시작)
        body.status = "running"

    agent = AgentInstance(**body.model_dump())
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.get("/agents/health-summary")
async def get_agent_health_summary(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    시스템 단위 에이전트 수집 상태 요약.
    total = 전체 등록 시스템 수,
    collecting = 에이전트가 최근 10분 내 데이터를 보내고 있는 시스템 수 (시스템 내 에이전트 수 무관).
    """
    import httpx
    from sqlalchemy import func as sqlfunc

    prometheus_url = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090")

    # DB: 전체 등록 시스템 수
    total_result = await db.execute(select(sqlfunc.count(System.id)))
    total_systems = total_result.scalar() or 0

    if total_systems == 0:
        return {"total": 0, "collecting": 0, "stale": 0}

    # DB: 에이전트가 있는 시스템의 타입별 존재 여부
    has_synapse = await db.execute(
        select(sqlfunc.count()).select_from(
            select(AgentInstance.system_id)
            .where(AgentInstance.agent_type == "synapse_agent")
            .distinct()
            .subquery()
        )
    )
    has_synapse_count = has_synapse.scalar() or 0

    has_db = await db.execute(
        select(sqlfunc.count()).select_from(
            select(AgentInstance.system_id)
            .where(AgentInstance.agent_type == "db")
            .distinct()
            .subquery()
        )
    )
    has_db_count = has_db.scalar() or 0

    # Prometheus: system_name 단위로 수집 중인 시스템 수
    alive_systems: set[str] = set()
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            if has_synapse_count > 0:
                resp = await client.get(
                    f"{prometheus_url}/api/v1/query",
                    params={"query": 'count by (system_name)(count_over_time(agent_up[10m]))'},
                )
                for item in resp.json().get("data", {}).get("result", []):
                    sn = item.get("metric", {}).get("system_name", "")
                    if sn:
                        alive_systems.add(sn)

            if has_db_count > 0:
                resp = await client.get(
                    f"{prometheus_url}/api/v1/query",
                    params={"query": 'count by (system_name)(count_over_time(db_connections_active[10m]))'},
                )
                for item in resp.json().get("data", {}).get("result", []):
                    sn = item.get("metric", {}).get("system_name", "")
                    if sn:
                        alive_systems.add(sn)
    except Exception:
        pass

    collecting = min(len(alive_systems), total_systems)
    return {
        "total": total_systems,
        "collecting": collecting,
        "stale": total_systems - collecting,
    }


@router.get("/agents/system-live/{system_id}")
async def get_system_live_status(
    system_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    시스템에 속한 에이전트(synapse_agent / db)의 Prometheus 기반 수집 여부를 반환한다.
    하나라도 최근 10분 내 데이터를 보내고 있으면 is_live=True.
    """
    import httpx
    import time

    prometheus_url = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090")

    agents_result = await db.execute(
        select(AgentInstance).where(
            AgentInstance.system_id == system_id,
            AgentInstance.agent_type.in_(["synapse_agent", "db"]),
        )
    )
    agents = agents_result.scalars().all()

    if not agents:
        return {"is_live": False, "agent_count": 0}

    # system_name 조회 (db 에이전트용)
    sys_result = await db.execute(select(System).where(System.id == system_id))
    system = sys_result.scalar_one_or_none()
    system_name = system.system_name if system else ""

    is_live = False
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            for agent in agents:
                if is_live:
                    break
                if agent.agent_type == "synapse_agent":
                    label_info = {}
                    if agent.label_info:
                        try:
                            label_info = json.loads(agent.label_info)
                        except Exception:
                            pass
                    sn = sanitize_promql_label(label_info.get("system_name", system_name))
                    h = sanitize_promql_label(agent.host)
                    query = f'agent_up{{system_name="{sn}",host="{h}"}}'
                elif agent.agent_type == "db":
                    query = f'db_connections_active{{system_name="{sanitize_promql_label(system_name)}"}}'
                else:
                    continue

                resp = await client.get(
                    f"{prometheus_url}/api/v1/query",
                    params={"query": query},
                )
                results = resp.json().get("data", {}).get("result", [])
                if results:
                    age_secs = time.time() - float(results[0]["value"][0])
                    if age_secs < 600:
                        is_live = True
    except Exception:
        pass

    return {"is_live": is_live, "agent_count": len(agents)}


@router.get("/agents/{agent_id}", response_model=AgentInstanceOut)
async def get_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    agent = await db.get(AgentInstance, agent_id)
    if not agent:
        raise HTTPException(404, "에이전트를 찾을 수 없습니다.")
    return agent


@router.patch("/agents/{agent_id}", response_model=AgentInstanceOut)
async def update_agent(
    agent_id: int,
    body: AgentInstanceUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    agent = await db.get(AgentInstance, agent_id)
    if not agent:
        raise HTTPException(404, "에이전트를 찾을 수 없습니다.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(agent, field, value)
    await db.commit()
    await db.refresh(agent)
    return agent


@router.delete("/agents/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    agent = await db.get(AgentInstance, agent_id)
    if not agent:
        raise HTTPException(404, "에이전트를 찾을 수 없습니다.")
    collector_type = "db_exporter" if agent.agent_type == "db" else "synapse_agent"
    await db.execute(
        delete(SystemCollectorConfig).where(
            SystemCollectorConfig.system_id == agent.system_id,
            SystemCollectorConfig.collector_type == collector_type,
        )
    )
    await db.delete(agent)
    await db.commit()
