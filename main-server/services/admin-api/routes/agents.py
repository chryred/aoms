"""
에이전트(수집기) 설치·제어 API

SSH 인증:
  - POST /api/v1/ssh/session     계정 등록 → session_token 발급 (30분 슬라이딩)
  - DELETE /api/v1/ssh/session   세션 삭제 (로그아웃)
  - 모든 에이전트 제어 요청은 X-SSH-Session 헤더에 token 포함

에이전트 CRUD:
  - GET/POST /api/v1/agents
  - GET/PATCH/DELETE /api/v1/agents/{id}

에이전트 제어 (동기):
  - POST /api/v1/agents/{id}/start
  - POST /api/v1/agents/{id}/stop
  - POST /api/v1/agents/{id}/restart
  - GET  /api/v1/agents/{id}/status
  - GET  /api/v1/agents/{id}/config
  - POST /api/v1/agents/{id}/config   (업로드 + reload)

설치 Job (비동기):
  - POST /api/v1/agents/install
  - GET  /api/v1/agents/jobs/{job_id}
"""

import asyncio
import json
import logging
import os
import shlex
import textwrap
import uuid

logger = logging.getLogger(__name__)
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AgentInstance, AgentInstallJob, System, SystemCollectorConfig
from schemas import (
    AgentConfigUpload,
    AgentInstallJobOut,
    AgentInstallRequest,
    AgentInstanceCreate,
    AgentInstanceOut,
    AgentInstanceUpdate,
    AgentStatusOut,
    SSHSessionCreate,
    SSHSessionOut,
)
from services.ssh_session import (
    SSHError,
    create_session,
    delete_session,
    get_session,
    ssh_exec,
    ssh_get_file,
    ssh_put_binary,
    ssh_put_file,
    ssh_read_file,
)

router = APIRouter(prefix="/api/v1", tags=["agents"])

import re
import re as _re
_PROMQL_LABEL_RE = _re.compile(r'[^a-zA-Z0-9_.\-]')


def _sanitize_promql_label(value: str) -> str:
    """PromQL label 값에서 주입 가능한 문자를 제거."""
    return _PROMQL_LABEL_RE.sub('', value)


# ── 인메모리 Job 저장소 (DB AgentInstallJob와 병행) ──────────────────────────
# 실행 중인 Job의 실시간 로그 버퍼 (DB는 완료 후 갱신)
_live_jobs: dict[str, dict] = {}


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
        expires_in=600,
    )


@router.delete("/ssh/session", status_code=204)
async def delete_ssh_session(
    x_ssh_session: Optional[str] = Header(None),
    current_user=Depends(get_current_user),
):
    if x_ssh_session:
        delete_session(x_ssh_session)


# ── SSH 세션 의존성 ───────────────────────────────────────────────────────────

def _require_session(x_ssh_session: Optional[str] = Header(None)) -> dict:
    if not x_ssh_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-SSH-Session 헤더가 필요합니다.",
        )
    entry = get_session(x_ssh_session)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="SSH 세션이 만료되었습니다. 다시 로그인해 주세요.",
        )
    return entry


def _optional_session(x_ssh_session: Optional[str] = Header(None)) -> Optional[dict]:
    """SSH 세션이 있으면 반환, 없으면 None. DB 에이전트처럼 SSH 불필요한 경우용."""
    if not x_ssh_session:
        return None
    return get_session(x_ssh_session)


def _check_host_match(agent, session: dict):
    """에이전트 호스트와 SSH 세션 호스트가 일치하는지 검증한다."""
    if agent.host != session["host"]:
        raise HTTPException(
            400,
            f"SSH 세션 호스트({session['host']})와 에이전트 호스트({agent.host})가 일치하지 않습니다.",
        )


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
        if not _os.getenv("DB_ENCRYPTION_KEY"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="DB_ENCRYPTION_KEY 환경변수가 설정되지 않았습니다. DB 수집기를 등록하려면 서버에 DB_ENCRYPTION_KEY를 설정하세요.",
            )
        from services.db_collector import encrypt_password, decrypt_password
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
                    sn = _sanitize_promql_label(label_info.get("system_name", system_name))
                    h = _sanitize_promql_label(agent.host)
                    query = f'agent_up{{system_name="{sn}",host="{h}"}}'
                elif agent.agent_type == "db":
                    query = f'db_connections_active{{system_name="{_sanitize_promql_label(system_name)}"}}'
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


# ── 에이전트 제어 (동기) ──────────────────────────────────────────────────────

async def _get_agent_or_404(agent_id: int, db: AsyncSession) -> AgentInstance:
    agent = await db.get(AgentInstance, agent_id)
    if not agent:
        raise HTTPException(404, "에이전트를 찾을 수 없습니다.")
    return agent


def _make_start_cmd(agent: AgentInstance) -> str:
    """에이전트 타입별 실행 명령어 생성. shlex.quote로 경로 이스케이프."""
    if agent.agent_type == "db":
        raise HTTPException(400, "DB 에이전트는 프로세스 관리가 불필요합니다.")
    ip = shlex.quote(agent.install_path)
    cp = shlex.quote(agent.config_path) if agent.config_path else ""
    pf = shlex.quote(agent.pid_file)
    if agent.agent_type == "synapse_agent":
        return f"nohup {ip} {cp} > /dev/null 2>&1 & echo $! > {pf}"
    if agent.agent_type == "alloy":
        return f"nohup {ip} run {cp} > {ip}.log 2>&1 & echo $! > {pf}"
    if agent.agent_type == "node_exporter":
        return f"nohup {ip} > {ip}.log 2>&1 & echo $! > {pf}"
    # jmx_exporter
    return f"nohup java -jar {ip} {agent.port} {cp} > {ip}.log 2>&1 & echo $! > {pf}"


@router.post("/agents/{agent_id}/start", response_model=AgentStatusOut)
async def start_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    session: Optional[dict] = Depends(_optional_session),
    current_user=Depends(get_current_user),
):
    agent = await _get_agent_or_404(agent_id, db)

    # DB 에이전트: SSH 없이 상태만 변경 → 수집 루프가 자동 재개
    if agent.agent_type == "db":
        await db.execute(
            update(AgentInstance).where(AgentInstance.id == agent_id).values(status="running")
        )
        await db.commit()
        return AgentStatusOut(agent_id=agent_id, status="running", pid=None, message="DB 수집을 시작했습니다.")

    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "X-SSH-Session 헤더가 필요합니다.")
    _check_host_match(agent, session)
    if not agent.pid_file:
        raise HTTPException(400, "pid_file 경로가 설정되어 있지 않습니다.")

    cmd = _make_start_cmd(agent)
    try:
        code, stdout, stderr = await asyncio.wait_for(
            asyncio.to_thread(
                ssh_exec, session["host"], session["port"], session["username"], session["password"], cmd
            ),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "SSH 명령 실행 시간이 초과되었습니다 (60초).")
    except SSHError as exc:
        logger.warning("SSH operation failed: %s", exc)
        raise HTTPException(502, "원격 서버 연결에 실패했습니다.")

    if code != 0:
        raise HTTPException(502, f"실행 실패: {stderr.strip()}")

    # 상태 갱신
    await db.execute(
        update(AgentInstance).where(AgentInstance.id == agent_id).values(status="running")
    )
    await db.commit()
    return AgentStatusOut(agent_id=agent_id, status="running", pid=None, message="에이전트를 시작했습니다.")


@router.post("/agents/{agent_id}/stop", response_model=AgentStatusOut)
async def stop_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    session: Optional[dict] = Depends(_optional_session),
    current_user=Depends(get_current_user),
):
    agent = await _get_agent_or_404(agent_id, db)

    # DB 에이전트: SSH 없이 상태만 변경 → 수집 루프가 자동 중단
    if agent.agent_type == "db":
        await db.execute(
            update(AgentInstance).where(AgentInstance.id == agent_id).values(status="stopped")
        )
        await db.commit()
        return AgentStatusOut(agent_id=agent_id, status="stopped", pid=None, message="DB 수집을 중지했습니다.")

    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "X-SSH-Session 헤더가 필요합니다.")
    _check_host_match(agent, session)
    if not agent.pid_file:
        raise HTTPException(400, "pid_file 경로가 설정되어 있지 않습니다.")

    pf = shlex.quote(agent.pid_file)
    cmd = f"kill $(cat {pf}) 2>/dev/null; rm -f {pf}; sleep 1"
    try:
        code, stdout, stderr = await asyncio.wait_for(
            asyncio.to_thread(
                ssh_exec, session["host"], session["port"], session["username"], session["password"], cmd
            ),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "SSH 명령 실행 시간이 초과되었습니다 (60초).")
    except SSHError as exc:
        logger.warning("SSH operation failed: %s", exc)
        raise HTTPException(502, "원격 서버 연결에 실패했습니다.")

    await db.execute(
        update(AgentInstance).where(AgentInstance.id == agent_id).values(status="stopped")
    )
    await db.commit()
    return AgentStatusOut(agent_id=agent_id, status="stopped", pid=None, message="에이전트를 종료했습니다.")


@router.post("/agents/{agent_id}/restart", response_model=AgentStatusOut)
async def restart_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    session: Optional[dict] = Depends(_optional_session),
    current_user=Depends(get_current_user),
):
    agent = await _get_agent_or_404(agent_id, db)

    # DB 에이전트: SSH 없이 상태만 running으로 설정
    if agent.agent_type == "db":
        await db.execute(
            update(AgentInstance).where(AgentInstance.id == agent_id).values(status="running")
        )
        await db.commit()
        return AgentStatusOut(agent_id=agent_id, status="running", pid=None, message="DB 수집을 재시작했습니다.")

    if session is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "X-SSH-Session 헤더가 필요합니다.")
    _check_host_match(agent, session)
    if not agent.pid_file:
        raise HTTPException(400, "pid_file 경로가 설정되어 있지 않습니다.")

    pf = shlex.quote(agent.pid_file)
    stop_cmd = f"kill $(cat {pf}) 2>/dev/null; rm -f {pf}; sleep 1"
    start_cmd = _make_start_cmd(agent)
    try:
        await asyncio.wait_for(
            asyncio.to_thread(
                ssh_exec, session["host"], session["port"], session["username"], session["password"], stop_cmd
            ),
            timeout=60.0,
        )
        code, stdout, stderr = await asyncio.wait_for(
            asyncio.to_thread(
                ssh_exec, session["host"], session["port"], session["username"], session["password"], start_cmd
            ),
            timeout=60.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "SSH 명령 실행 시간이 초과되었습니다 (60초).")
    except SSHError as exc:
        logger.warning("SSH operation failed: %s", exc)
        raise HTTPException(502, "원격 서버 연결에 실패했습니다.")

    if code != 0:
        raise HTTPException(502, f"재시작 실패: {stderr.strip()}")

    await db.execute(
        update(AgentInstance).where(AgentInstance.id == agent_id).values(status="running")
    )
    await db.commit()
    return AgentStatusOut(agent_id=agent_id, status="running", pid=None, message="에이전트를 재시작했습니다.")


@router.get("/agents/{agent_id}/status", response_model=AgentStatusOut)
async def get_agent_status(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(_require_session),
    current_user=Depends(get_current_user),
):
    agent = await _get_agent_or_404(agent_id, db)
    _check_host_match(agent, session)
    pid: Optional[int] = None
    agent_status = "unknown"
    message = ""

    if agent.pid_file:
        pf = shlex.quote(agent.pid_file)
        cmd = f"cat {pf} 2>/dev/null && ps -p $(cat {pf} 2>/dev/null) -o pid= 2>/dev/null"
        try:
            code, stdout, _ = await asyncio.to_thread(
                ssh_exec, session["host"], session["port"], session["username"], session["password"], cmd
            )
            if code == 0 and stdout.strip():
                lines = [l.strip() for l in stdout.strip().splitlines() if l.strip()]
                if lines:
                    try:
                        pid = int(lines[0])
                    except ValueError:
                        pass
                agent_status = "running" if pid else "stopped"
                message = f"PID {pid} 실행 중" if pid else "프로세스 없음"
            else:
                agent_status = "stopped"
                message = "프로세스 없음"
        except SSHError as exc:
            message = str(exc)
    else:
        message = "pid_file 미설정"

    # DB 상태 동기화
    await db.execute(
        update(AgentInstance).where(AgentInstance.id == agent_id).values(status=agent_status)
    )
    await db.commit()
    return AgentStatusOut(agent_id=agent_id, status=agent_status, pid=pid, message=message)


# ── 설정 파일 (조회 / 업로드 + Reload) ───────────────────────────────────────

@router.get("/agents/{agent_id}/config")
async def get_agent_config(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(_require_session),
    current_user=Depends(get_current_user),
):
    agent = await _get_agent_or_404(agent_id, db)
    _check_host_match(agent, session)
    try:
        content = await asyncio.to_thread(
            ssh_get_file, session["host"], session["port"], session["username"], session["password"], agent.config_path
        )
    except SSHError as exc:
        logger.warning("SSH operation failed: %s", exc)
        raise HTTPException(502, "원격 서버 연결에 실패했습니다.")
    except Exception as exc:
        raise HTTPException(502, f"설정 파일 조회 실패: {exc}")
    return {"agent_id": agent_id, "config_path": agent.config_path, "content": content}


@router.post("/agents/{agent_id}/config", response_model=AgentStatusOut)
async def upload_agent_config(
    agent_id: int,
    body: AgentConfigUpload,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(_require_session),
    current_user=Depends(get_current_user),
):
    agent = await _get_agent_or_404(agent_id, db)
    _check_host_match(agent, session)
    try:
        await asyncio.to_thread(
            ssh_put_file,
            session["host"], session["port"], session["username"], session["password"],
            agent.config_path, body.config_content,
        )
    except SSHError as exc:
        logger.warning("SSH operation failed: %s", exc)
        raise HTTPException(502, "원격 서버 연결에 실패했습니다.")

    # Reload: PID 파일이 있으면 재시작 (synapse_agent는 inotify 자동 감지 지원, 재시작이 더 안정적)
    reload_cmd: str
    if agent.pid_file:
        pf = shlex.quote(agent.pid_file)
        stop = f"kill $(cat {pf}) 2>/dev/null; rm -f {pf}; sleep 1"
        start = _make_start_cmd(agent)
        reload_cmd = f"{stop} && {start}"
    else:
        return AgentStatusOut(
            agent_id=agent_id, status="unknown", pid=None,
            message="설정 파일 업로드 완료. pid_file 미설정으로 reload를 건너뜁니다."
        )

    try:
        code, _, stderr = await asyncio.to_thread(
            ssh_exec, session["host"], session["port"], session["username"], session["password"], reload_cmd
        )
    except SSHError as exc:
        logger.warning("SSH operation failed: %s", exc)
        raise HTTPException(502, "원격 서버 연결에 실패했습니다.")

    if code != 0:
        raise HTTPException(502, f"Reload 실패: {stderr.strip()}")

    return AgentStatusOut(agent_id=agent_id, status="running", pid=None, message="설정 업로드 및 Reload 완료.")


# ── 설치 Job (비동기) ─────────────────────────────────────────────────────────

@router.post("/agents/install", response_model=AgentInstallJobOut, status_code=202)
async def install_agent(
    body: AgentInstallRequest,
    db: AsyncSession = Depends(get_db),
    x_ssh_session: Optional[str] = Header(None),
    current_user=Depends(get_current_user),
):
    agent = await _get_agent_or_404(body.agent_id, db)

    # db 에이전트는 SSH 불필요 — 그 외 타입은 SSH 세션 필수
    if agent.agent_type == "db":
        session: dict = {}
    else:
        if not x_ssh_session:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "X-SSH-Session 헤더가 필요합니다.")
        entry = get_session(x_ssh_session)
        if entry is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "SSH 세션이 만료되었습니다. 다시 로그인해 주세요.")
        session = entry
    job_id = str(uuid.uuid4())
    now = datetime.utcnow()

    # DB에 Job 레코드 생성
    job = AgentInstallJob(
        job_id=job_id,
        agent_id=agent.id,
        status="pending",
        created_at=now,
        updated_at=now,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # 실시간 로그 버퍼 초기화
    _live_jobs[job_id] = {"status": "pending", "logs": "", "error": None}

    # 백그라운드 설치 태스크 실행
    asyncio.create_task(
        _run_install(
            job_id=job_id,
            agent=agent,
            session=session,
        )
    )

    return AgentInstallJobOut(
        job_id=job_id,
        agent_id=agent.id,
        status="pending",
        logs=None,
        error=None,
        created_at=now,
        updated_at=now,
    )


@router.get("/agents/jobs/{job_id}", response_model=AgentInstallJobOut)
async def get_install_job(
    job_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    result = await db.execute(select(AgentInstallJob).where(AgentInstallJob.job_id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Job을 찾을 수 없습니다.")

    # 실행 중인 Job은 인메모리 로그로 보완
    live = _live_jobs.get(job_id)
    if live and job.status in ("pending", "running"):
        job.logs = live["logs"]
        job.status = live["status"]

    return job


async def _run_db_connect(job_id: str, agent: AgentInstance) -> None:
    """
    db 에이전트 '설치' = DB 연결 테스트 후 status 업데이트.
    성공 시 db_exporter system_collector_config 4개 자동 등록.
    """
    from services.db_collector import decrypt_password
    from services.db_backends import BACKENDS, DB_TYPE_PORTS, get_db_identifier_key
    from database import AsyncSessionLocal

    def _log(msg: str) -> None:
        _live_jobs[job_id]["logs"] += f"{msg}\n"

    async with AsyncSessionLocal() as db:
        try:
            info = json.loads(agent.label_info or "{}")
            db_type = info.get("db_type", "oracle")
            backend = BACKENDS.get(db_type)
            if not backend:
                raise ValueError(f"지원하지 않는 db_type: {db_type}")
            id_key = get_db_identifier_key(db_type)
            default_port = DB_TYPE_PORTS.get(db_type, 1521)

            _log(f"[1/1] {db_type.upper()} DB 연결 테스트 중...")
            pw = decrypt_password(info["encrypted_password"])
            await asyncio.to_thread(
                backend.test_connection,
                agent.host,
                int(agent.port or default_port),
                info.get(id_key, ""),
                info.get("username", ""),
                pw,
            )
            _log("[1/1] 연결 성공.")

            await db.execute(
                update(AgentInstance).where(AgentInstance.id == agent.id).values(status="installed")
            )
            # db_exporter collector_config 4개 자동 upsert
            for group in ["db_connections", "db_query", "db_cache", "db_replication"]:
                await db.execute(
                    pg_insert(SystemCollectorConfig)
                    .values(system_id=agent.system_id, collector_type="db_exporter", metric_group=group, enabled=True)
                    .on_conflict_do_update(
                        index_elements=["system_id", "collector_type", "metric_group"],
                        set_={"enabled": True, "updated_at": datetime.utcnow()},
                    )
                )
            await db.execute(
                update(AgentInstallJob)
                .where(AgentInstallJob.job_id == job_id)
                .values(
                    status="done",
                    logs=_live_jobs[job_id]["logs"],
                    updated_at=datetime.utcnow(),
                )
            )
            await db.commit()
            _live_jobs[job_id]["status"] = "done"

        except Exception as exc:
            err_msg = str(exc)
            _log(f"[오류] {err_msg}")
            _live_jobs[job_id]["status"] = "failed"
            _live_jobs[job_id]["error"] = err_msg
            await db.execute(
                update(AgentInstance).where(AgentInstance.id == agent.id).values(status="failed")
            )
            await db.execute(
                update(AgentInstallJob)
                .where(AgentInstallJob.job_id == job_id)
                .values(
                    status="failed",
                    logs=_live_jobs[job_id]["logs"],
                    error=err_msg,
                    updated_at=datetime.utcnow(),
                )
            )
            await db.commit()


async def _run_install(
    job_id: str,
    agent: AgentInstance,
    session: dict,
):
    """백그라운드 설치 태스크. DB Job 상태를 단계별로 갱신한다."""
    from database import AsyncSessionLocal

    def _log(msg: str):
        _live_jobs[job_id]["logs"] += f"{msg}\n"

    _live_jobs[job_id]["status"] = "running"

    # db 에이전트: SSH 불필요 — 연결 테스트 후 완료
    if agent.agent_type == "db":
        await _run_db_connect(job_id, agent)
        return

    # OTel Java Agent 설치
    if agent.agent_type == "otel_javaagent":
        await _run_otel_install(job_id, agent, session)
        return

    # 로컬 경로 변수 초기화 (tilde 해석 전)
    install_path = agent.install_path or ""
    config_path = agent.config_path or ""
    pid_file = agent.pid_file or ""

    async with AsyncSessionLocal() as db:
        try:
            # Step 0: ~ 해석 — SFTP는 tilde를 확장하지 않으므로 절대경로로 변환
            if "~" in install_path or "~" in config_path or "~" in pid_file:
                _log("[0/4] 홈 디렉터리 경로 확인 중...")
                code, home_stdout, _ = await asyncio.to_thread(
                    ssh_exec,
                    session["host"], session["port"], session["username"], session["password"],
                    "echo $HOME",
                )
                home_dir = home_stdout.strip()
                if code == 0 and home_dir:
                    install_path = install_path.replace("~", home_dir)
                    config_path = config_path.replace("~", home_dir)
                    pid_file = pid_file.replace("~", home_dir)
                    await db.execute(
                        update(AgentInstance).where(AgentInstance.id == agent.id).values(
                            install_path=install_path,
                            config_path=config_path,
                            pid_file=pid_file,
                        )
                    )
                    await db.commit()
                    _log(f"  → 홈 디렉터리: {home_dir}")
                else:
                    _log("  경고: 홈 디렉터리를 확인할 수 없습니다. ~ 경로를 그대로 사용합니다.")

            _log("[1/4] 디렉터리 생성 중...")
            install_dir = install_path.rsplit("/", 1)[0]
            code, _, stderr = await asyncio.to_thread(
                ssh_exec,
                session["host"], session["port"], session["username"], session["password"],
                f"mkdir -p {install_dir}",
            )
            if code != 0:
                raise RuntimeError(f"디렉터리 생성 실패: {stderr.strip()}")

            if agent.agent_type == "synapse_agent":
                _log("[2/4] 바이너리 업로드 중 (SFTP)...")
                from pathlib import Path
                _default_bin = "/app/bin/agent-v"
                bin_path = Path(os.environ.get("AGENT_BINARY_PATH", _default_bin))
                if not bin_path.exists():
                    raise RuntimeError(
                        f"agent-v 바이너리를 찾을 수 없습니다 ({bin_path}). "
                        "Docker 이미지: build-images.sh로 재빌드, "
                        "로컬 개발: AGENT_BINARY_PATH 환경변수를 agent/dist/agent-v 경로로 설정하세요."
                    )
                binary_content = await asyncio.to_thread(bin_path.read_bytes)
                await asyncio.to_thread(
                    ssh_put_binary,
                    session["host"], session["port"], session["username"], session["password"],
                    install_path, binary_content,
                )
                code, _, stderr = await asyncio.to_thread(
                    ssh_exec,
                    session["host"], session["port"], session["username"], session["password"],
                    f"chmod +x {install_path}",
                )
                if code != 0:
                    raise RuntimeError(f"chmod +x 실패: {stderr.strip()}")
                _log(f"  → 바이너리 업로드 및 실행 권한 설정 완료: {install_path}")
            else:
                _log("[2/4] 번들 바이너리 없음 — 업로드 건너뜀 (jmx_exporter 등)")

            _log("[3/4] PID 파일 디렉터리 생성 중...")
            if pid_file:
                pid_dir = pid_file.rsplit("/", 1)[0]
                await asyncio.to_thread(
                    ssh_exec,
                    session["host"], session["port"], session["username"], session["password"],
                    f"mkdir -p {pid_dir}",
                )

            # synapse_agent 타입: config.toml 자동생성 및 SFTP 업로드
            if agent.agent_type == "synapse_agent" and config_path:
                _log("[3.5/4] synapse_agent config.toml 생성 중...")
                label_info = {}
                if agent.label_info:
                    try:
                        label_info = json.loads(agent.label_info)
                    except Exception:
                        pass
                system_name = label_info.get("system_name", "unknown")
                display_name = label_info.get("display_name", system_name)
                instance_role = label_info.get("instance_role", "default")
                # synapse_agent config.toml remote_write.endpoint에는 AGENT_PROMETHEUS_URL 사용
                # (Docker 컨테이너가 호스트 Prometheus에 쓸 때 host.docker.internal 필요)
                # 미설정 시 PROMETHEUS_URL → 최종 기본값 http://prometheus:9090 순으로 폴백
                prometheus_url = os.environ.get(
                    "AGENT_PROMETHEUS_URL",
                    os.environ.get("PROMETHEUS_URL", "http://prometheus:9090"),
                )
                wal_dir = os.path.dirname(config_path) + "/wal"
                log_dir = os.path.dirname(config_path) + "/logs"

                # WAL + 로그 디렉터리 생성
                await asyncio.to_thread(
                    ssh_exec,
                    session["host"], session["port"], session["username"], session["password"],
                    f"mkdir -p {wal_dir} {log_dir}",
                )

                # 수집기 설정: label_info.collectors 우선, 없으면 기본값
                default_collectors: dict = {
                    "cpu": True,
                    "memory": True,
                    "disk": True,
                    "network": True,
                    "process": True,
                    "tcp_connections": True,
                    "log_monitor": True,
                    "web_servers": False,
                    "preprocessor": False,
                    "heartbeat": True,
                }
                for k, v in label_info.get("collectors", {}).items():
                    if k in default_collectors:
                        default_collectors[k] = bool(v)
                collectors_toml = "\n".join(
                    f"{k} = {'true' if v else 'false'}" for k, v in default_collectors.items()
                )

                # 다중 log_monitor 지원: label_info.log_monitors 배열 우선, 없으면 기본값
                log_monitors = label_info.get("log_monitors", [])
                if not log_monitors:
                    log_monitors = [{
                        "paths": ["/var/log/messages"],
                        "keywords": ["ERROR", "CRITICAL", "PANIC", "Fatal", "Exception"],
                        "log_type": "app",
                    }]

                log_monitor_toml = ""
                for lm in log_monitors:
                    paths_str = ", ".join(f'"{p}"' for p in lm.get("paths", []))
                    kw_str = ", ".join(f'"{k}"' for k in lm.get("keywords", ["ERROR", "CRITICAL", "PANIC", "Fatal", "Exception"]))
                    log_monitor_toml += (
                        f"\n[[log_monitor]]\n"
                        f"paths = [{paths_str}]\n"
                        f"keywords = [{kw_str}]\n"
                        f'log_type = "{lm.get("log_type", "app")}"\n'
                    )

                config_content = (
                    f'[agent]\n'
                    f'system_name = "{system_name}"\n'
                    f'display_name = "{display_name}"\n'
                    f'instance_role = "{instance_role}"\n'
                    f'host = "{agent.host}"\n'
                    f'collect_interval_secs = 15\n'
                    f'top_process_count = 5\n'
                    f'log_dir = "{log_dir}"\n'
                    f'log_retention_days = 7\n'
                    f'\n'
                    f'[remote_write]\n'
                    f'endpoint = "{prometheus_url}/api/v1/write"\n'
                    f'batch_size = 500\n'
                    f'timeout_secs = 10\n'
                    f'wal_dir = "{wal_dir}"\n'
                    f'wal_retention_hours = 2\n'
                    f'\n'
                    f'[collectors]\n'
                    f'{collectors_toml}\n'
                ) + log_monitor_toml
                await asyncio.to_thread(
                    ssh_put_file,
                    session["host"], session["port"], session["username"], session["password"],
                    config_path, config_content,
                )
                _log(f"  → config.toml 업로드 완료: {config_path}")

            _log("[4/4] 설치 완료.")
            await db.execute(
                update(AgentInstance).where(AgentInstance.id == agent.id).values(status="installed")
            )

            # synapse_agent 설치 완료 시 system_collector_config 자동 upsert
            if agent.agent_type == "synapse_agent":
                for group in ["cpu", "memory", "disk", "network", "log", "web"]:
                    await db.execute(
                        pg_insert(SystemCollectorConfig)
                        .values(system_id=agent.system_id, collector_type="synapse_agent", metric_group=group, enabled=True)
                        .on_conflict_do_update(
                            index_elements=["system_id", "collector_type", "metric_group"],
                            set_={"enabled": True, "updated_at": datetime.utcnow()},
                        )
                    )

            await db.execute(
                update(AgentInstallJob)
                .where(AgentInstallJob.job_id == job_id)
                .values(
                    status="done",
                    logs=_live_jobs[job_id]["logs"],
                    updated_at=datetime.utcnow(),
                )
            )
            await db.commit()
            _live_jobs[job_id]["status"] = "done"

        except Exception as exc:
            err_msg = str(exc)
            _log(f"[오류] {err_msg}")
            _live_jobs[job_id]["status"] = "failed"
            _live_jobs[job_id]["error"] = err_msg
            await db.execute(
                update(AgentInstallJob)
                .where(AgentInstallJob.job_id == job_id)
                .values(
                    status="failed",
                    logs=_live_jobs[job_id]["logs"],
                    error=err_msg,
                    updated_at=datetime.utcnow(),
                )
            )
            await db.commit()


# ── Live Status (Prometheus heartbeat 기반) ───────────────────────────────────

def _calc_live_status(age_secs: float) -> str:
    """경과 시간(초) → live_status 문자열. 10분(600s) 기준."""
    if age_secs < 60:
        return "collecting"
    elif age_secs < 600:
        return "delayed"
    else:
        return "stale"


@router.get("/agents/{agent_id}/live-status")
async def get_agent_live_status(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    synapse_agent / db: Prometheus에서 메트릭 수신 여부를 조회하여
    최근 10분 내 데이터가 있으면 live=True를 반환한다.
    다른 타입은 DB status를 그대로 반환한다.
    """
    import httpx
    import time
    from datetime import timezone

    result = await db.execute(select(AgentInstance).where(AgentInstance.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "에이전트를 찾을 수 없습니다.")

    prometheus_url = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090")

    # ── synapse_agent ─────────────────────────────────────────────────────────
    if agent.agent_type == "synapse_agent":
        label_info = {}
        if agent.label_info:
            try:
                label_info = json.loads(agent.label_info)
            except Exception:
                pass
        system_name = _sanitize_promql_label(label_info.get("system_name", ""))
        host = _sanitize_promql_label(agent.host)

        query = f'agent_up{{system_name="{system_name}",host="{host}"}}'
        results = []
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{prometheus_url}/api/v1/query",
                    params={"query": query},
                )
            results = resp.json().get("data", {}).get("result", [])
        except Exception:
            pass

        if results:
            ts = float(results[0]["value"][0])
            last_seen = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            age_secs = time.time() - ts
            live_status = _calc_live_status(age_secs)
        else:
            last_seen = None
            live_status = "no_data"

        collectors_active = []
        try:
            hb_query = f'agent_heartbeat{{system_name="{_sanitize_promql_label(system_name)}",host="{_sanitize_promql_label(host)}"}}'
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{prometheus_url}/api/v1/query",
                    params={"query": hb_query},
                )
            for r in resp.json().get("data", {}).get("result", []):
                collector = r.get("metric", {}).get("collector", "")
                if collector:
                    collectors_active.append(collector)
        except Exception:
            pass

        return {
            "agent_id": agent_id,
            "type": "synapse_agent",
            "status": agent.status,
            "live": live_status in ("collecting", "delayed"),
            "live_status": live_status,
            "last_seen": last_seen,
            "collectors_active": collectors_active,
        }

    # ── db 에이전트 ──────────────────────────────────────────────────────────
    if agent.agent_type == "db":
        # system_name은 Systems 테이블에서 조회
        sys_result = await db.execute(select(System).where(System.id == agent.system_id))
        system = sys_result.scalar_one_or_none()
        system_name = _sanitize_promql_label(system.system_name if system else "")

        query = f'db_connections_active{{system_name="{system_name}"}}'
        results = []
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{prometheus_url}/api/v1/query",
                    params={"query": query},
                )
            results = resp.json().get("data", {}).get("result", [])
        except Exception:
            pass

        if results:
            ts = float(results[0]["value"][0])
            last_seen = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            age_secs = time.time() - ts
            live_status = _calc_live_status(age_secs)
        else:
            last_seen = None
            live_status = "no_data"

        return {
            "agent_id": agent_id,
            "type": "db",
            "status": agent.status,
            "live": live_status in ("collecting", "delayed"),
            "live_status": live_status,
            "last_seen": last_seen,
            "collectors_active": [],
        }

    # ── OTel Java Agent ──────────────────────────────────────────────────────
    if agent.agent_type == "otel_javaagent":
        import httpx as _httpx
        info = json.loads(agent.label_info or "{}")
        service_name = info.get("tempo_service_name") or system_name
        tempo_url = os.getenv("TEMPO_URL", "http://tempo:3200")
        live_status = "no_data"
        last_seen = None
        try:
            # Tempo /api/echo 헬스 체크 + 최근 5분 내 해당 service.name span 존재 여부
            end_ns = int(time.time() * 1e9)
            start_ns = int((time.time() - 300) * 1e9)
            async with _httpx.AsyncClient(timeout=5.0) as tc:
                echo_resp = await tc.get(f"{tempo_url}/api/echo")
                echo_ok = echo_resp.status_code == 200
            if echo_ok:
                async with _httpx.AsyncClient(timeout=5.0) as tc:
                    sr = await tc.get(
                        f"{tempo_url}/api/search",
                        params={"q": f'{{ resource.service.name="{service_name}" }}',
                                "start": start_ns, "end": end_ns, "limit": 1},
                    )
                    sr.raise_for_status()
                    traces = sr.json().get("traces", [])
                if traces:
                    live_status = "collecting"
                    last_seen = traces[0].get("rootSpanTime")
                else:
                    live_status = "stale"
            else:
                live_status = "no_data"
        except Exception as exc:
            logger.debug("OTel live-status check failed: %s", exc)
            live_status = "no_data"

        return {
            "agent_id": agent_id,
            "type": "otel_javaagent",
            "status": agent.status,
            "live": live_status == "collecting",
            "live_status": live_status,
            "last_seen": last_seen,
            "service_name": service_name,
            "collectors_active": [],
        }

    # ── 기타 타입 (SSH 기반 제어 에이전트) ────────────────────────────────────
    return {"agent_id": agent_id, "type": agent.agent_type, "status": agent.status, "live": False}


# ── OTel Java Agent 설치 ────────────────────────────────────────────────────────

_PATH_WHITELIST_RE = re.compile(r"^[A-Za-z0-9/_.\-]+$")

# Tomcat setenv.sh에 append/갱신할 때 사용하는 마커 블록.
# 기존 운영팀 설정(heap, GC, encoding, CLASSPATH 등)을 보존하기 위해 덮어쓰기 대신
# 블록 치환(append + 기존 블록만 제거)으로 동작한다.
_TOMCAT_MARKER_BEGIN = "# === synapse-otel BEGIN ==="
_TOMCAT_MARKER_END = "# === synapse-otel END ==="


def _strip_tomcat_marker_block(content: str) -> str:
    """기존 setenv.sh에서 synapse-otel 마커 블록만 제거한다 (멱등성 보장)."""
    if not content:
        return ""
    pattern = re.compile(
        rf"^[ \t]*{re.escape(_TOMCAT_MARKER_BEGIN)}.*?{re.escape(_TOMCAT_MARKER_END)}[ \t]*\n?",
        re.DOTALL | re.MULTILINE,
    )
    return pattern.sub("", content)


def _build_tomcat_setenv(existing: str, install_dir: str) -> str:
    """기존 setenv.sh 내용 + 우리 마커 블록을 결합.

    - 기존 내용에 우리 블록이 이미 있으면 제거 후 파일 끝에 한 벌만 append
    - shebang이 원본에 없으면 우리는 추가하지 않음 (CATALINA_OPTS는 source만 되면 되므로 불필요)
    """
    base = _strip_tomcat_marker_block(existing or "").rstrip()
    block = (
        f"\n\n{_TOMCAT_MARKER_BEGIN} (admin-api 자동 관리 — 수동 편집 금지)\n"
        f". {install_dir}/otel-env.sh\n"
        f'CATALINA_OPTS="$CATALINA_OPTS $JAVA_OPTS"\n'
        f"{_TOMCAT_MARKER_END}\n"
    )
    return (base + block).lstrip("\n")


_PATH_WITH_TILDE_RE = re.compile(r"^~[A-Za-z0-9/_.\-]*$")


def _validate_path(path: str, field: str) -> str:
    """서비스 경로 입력 화이트리스트 검증 + path traversal 거부. ~ 접두사 허용."""
    if not path:
        return path
    if not (_PATH_WHITELIST_RE.match(path) or _PATH_WITH_TILDE_RE.match(path)):
        raise ValueError(f"{field}: 허용되지 않는 문자가 포함되어 있습니다 ({path!r})")
    if ".." in path.split("/"):
        raise ValueError(f"{field}: 상위 디렉터리 접근(../) 금지")
    return path


async def _expand_remote_tilde(session: dict, path: str) -> str:
    """~/xxx → /home/<user>/xxx 치환 (SSH echo $HOME 사용)."""
    if not path or not path.startswith("~"):
        return path
    _, home_out, _ = await asyncio.to_thread(
        ssh_exec, session["host"], session["port"], session["username"], session["password"],
        "echo $HOME"
    )
    home = home_out.strip()
    if not home:
        return path
    # path가 "~" 또는 "~/..." 형태
    return home + path[1:]


async def _run_otel_install(job_id: str, agent: AgentInstance, session: dict) -> None:
    """
    OTel Java Agent 설치 태스크.
    - JAR 선택: JDK 8 → v1.33.x + RMI disable, 나머지 → v2.x
    - otel-env.sh 생성 (shlex.quote 이스케이프)
    - service_type별 env 주입 파일 생성
    - SHA256 업로드 및 타겟 검증
    """
    from database import AsyncSessionLocal

    OTEL_AGENT_V2 = os.getenv("OTEL_AGENT_V2_JAR", "/app/artifacts/otel/opentelemetry-javaagent-2.x.x.jar")
    OTEL_AGENT_V1 = os.getenv("OTEL_AGENT_V1_JAR", "/app/artifacts/otel/opentelemetry-javaagent-1.33.x.jar")
    MAIN_SERVER_IP = os.getenv("MAIN_SERVER_IP", "127.0.0.1")

    def _log(msg: str) -> None:
        _live_jobs[job_id]["logs"] += f"{msg}\n"

    async with AsyncSessionLocal() as db:
        try:
            info = json.loads(agent.label_info or "{}")
            # UI(AgentFormModal)는 jdk_version="8"|"11"|"17"|"21" 문자열 전달, 레거시 호환 유지
            jdk_raw = info.get("jdk_version") or info.get("target_jdk_major") or 11
            try:
                jdk_major = int(jdk_raw)
            except (TypeError, ValueError):
                jdk_major = 11
            service_type = info.get("service_type", "standalone")
            service_path = _validate_path(info.get("service_path", ""), "service_path")
            # 기본 설치 경로: 서비스 계정 홈 디렉토리(~/otel) — synapse-agent 배포 원칙과 동일
            install_dir = _validate_path(
                info.get("install_path") or info.get("install_dir", "~/otel"),
                "install_dir",
            )
            sampling_override = float(info.get("sampling_rate_override", 0.0))

            # systemd 시스템 유닛은 root 권한이 필요하므로 SSH 계정이 root가 아니면 차단
            if service_type == "systemd" and session["username"] != "root":
                raise PermissionError(
                    "systemd 시스템 유닛은 root SSH 계정이 필요합니다. "
                    "standalone/tomcat/jboss/jeus 방식을 사용하거나 root SSH로 재등록하세요."
                )

            # ~ 를 원격 서버의 홈으로 치환 (SFTP는 ~ 전개 안 함)
            install_dir = await _expand_remote_tilde(session, install_dir)
            service_path = await _expand_remote_tilde(session, service_path)

            # 시스템 정보 조회
            sys_result = await db.execute(select(System).where(System.id == agent.system_id))
            sys_obj = sys_result.scalar_one_or_none()
            sys_name = sys_obj.system_name if sys_obj else "unknown"
            display_name = sys_obj.display_name if sys_obj else sys_name

            instance_role = info.get("instance_role", "was")
            tempo_service_name = info.get("tempo_service_name") or f"{sys_name}-{instance_role}"
            host = agent.host or "unknown"

            # shlex.quote로 shell injection 방지
            q_service_name = shlex.quote(tempo_service_name)
            q_display = shlex.quote(display_name)
            q_role = shlex.quote(instance_role)
            q_host = shlex.quote(host)
            q_sys = shlex.quote(sys_name)

            # JAR 선택
            use_v1 = jdk_major == 8
            jar_local = OTEL_AGENT_V1 if use_v1 else OTEL_AGENT_V2
            jar_label = "v1.33.x (JDK 8 레거시)" if use_v1 else "v2.x (권장)"

            _log(f"[1/5] JDK {jdk_major} → {jar_label} 선택")

            if not os.path.exists(jar_local):
                raise FileNotFoundError(
                    f"JAR 파일을 찾을 수 없습니다: {jar_local}\n"
                    "main-server/artifacts/otel/README.md를 참고하여 JAR를 배치하세요."
                )

            jar_bytes = open(jar_local, "rb").read()

            # Step 1: install_dir 생성
            _log(f"[2/5] 설치 디렉터리 생성: {install_dir}")
            await asyncio.to_thread(
                ssh_exec, session["host"], session["port"], session["username"], session["password"],
                f"mkdir -p {shlex.quote(install_dir)}"
            )

            # Step 2: JAR SFTP 업로드
            remote_jar = f"{install_dir}/opentelemetry-javaagent.jar"
            _log(f"[3/5] JAR 업로드: {remote_jar}")
            await asyncio.to_thread(
                ssh_put_binary, session["host"], session["port"], session["username"], session["password"],
                remote_jar, jar_bytes
            )

            # SHA256 계산 및 업로드
            import hashlib
            jar_sha256 = hashlib.sha256(jar_bytes).hexdigest()
            sha_content = f"{jar_sha256}  opentelemetry-javaagent.jar\n"
            remote_sha = f"{install_dir}/SHA256SUMS"
            await asyncio.to_thread(
                ssh_put_file, session["host"], session["port"], session["username"], session["password"],
                remote_sha, sha_content
            )
            # 타겟 서버에서 무결성 검증
            code, _, sha_err = await asyncio.to_thread(
                ssh_exec, session["host"], session["port"], session["username"], session["password"],
                f"cd {shlex.quote(install_dir)} && sha256sum -c SHA256SUMS"
            )
            if code != 0:
                raise RuntimeError(f"SHA256 검증 실패: {sha_err}")
            _log("[3/5] SHA256 검증 완료")

            # Step 3: otel-env.sh 생성 (공통 환경변수)
            rmi_line = "export OTEL_INSTRUMENTATION_RMI_ENABLED='false'" if use_v1 else "# v2.x: CVE-2026-33701 패치됨 — RMI disable 불필요"
            # SDK는 모든 trace를 Collector로 전송 — 실제 sampling 결정은 Collector의 tail_sampling processor에서
            sampler_line = (
                f"export OTEL_TRACES_SAMPLER='parentbased_traceidratio'\n"
                f"export OTEL_TRACES_SAMPLER_ARG='{sampling_override}'"
            ) if sampling_override > 0 else "export OTEL_TRACES_SAMPLER='parentbased_always_on'"

            otel_env_content = textwrap.dedent(f"""\
                #!/bin/sh
                # otel-env.sh — admin-api 자동 생성 (수동 편집 금지)
                INSTALL_DIR={shlex.quote(install_dir)}
                export JAVA_OPTS="${{JAVA_OPTS}} -javaagent:${{INSTALL_DIR}}/opentelemetry-javaagent.jar"
                export OTEL_SERVICE_NAME={q_service_name}
                export OTEL_RESOURCE_ATTRIBUTES='service.name='${{OTEL_SERVICE_NAME}}',display.name='{display_name}',instance.role='{instance_role}',host.name='{host}''
                export OTEL_EXPORTER_OTLP_ENDPOINT='http://{MAIN_SERVER_IP}:4317'
                export OTEL_EXPORTER_OTLP_PROTOCOL='grpc'
                {sampler_line}
                export OTEL_METRICS_EXPORTER='none'
                export OTEL_LOGS_EXPORTER='none'
                {rmi_line}
            """)
            remote_env = f"{install_dir}/otel-env.sh"
            _log(f"[4/5] otel-env.sh 업로드: {remote_env}")
            await asyncio.to_thread(
                ssh_put_file, session["host"], session["port"], session["username"], session["password"],
                remote_env, otel_env_content
            )

            # Step 4: service_type별 env 주입 파일
            _log(f"[5/5] {service_type} 서비스 env 주입 파일 생성")
            inject_remote_path = _get_inject_path(service_type, service_path, install_dir, sys_name)

            if service_type == "tomcat" and inject_remote_path:
                # Tomcat은 기존 setenv.sh가 있을 수 있으므로 덮어쓰기 금지.
                # 기존 내용을 읽어 우리 마커 블록만 교체/추가한다.
                existing = await asyncio.to_thread(
                    ssh_read_file, session["host"], session["port"], session["username"], session["password"],
                    inject_remote_path,
                )
                if existing is None:
                    _log(f"    기존 {inject_remote_path} 없음 → 새로 생성")
                    existing = ""
                else:
                    _log(f"    기존 {inject_remote_path} 발견 → 마커 블록만 갱신 (기존 설정 보존)")

                parent = "/".join(inject_remote_path.split("/")[:-1])
                if parent:
                    await asyncio.to_thread(
                        ssh_exec, session["host"], session["port"], session["username"], session["password"],
                        f"mkdir -p {shlex.quote(parent)}"
                    )
                new_content = _build_tomcat_setenv(existing, install_dir)
                await asyncio.to_thread(
                    ssh_put_file, session["host"], session["port"], session["username"], session["password"],
                    inject_remote_path, new_content,
                )
            else:
                inject_content = _build_service_env_inject(service_type, service_path, install_dir)
                if inject_content and inject_remote_path:
                    # 부모 디렉터리 생성
                    parent = "/".join(inject_remote_path.split("/")[:-1])
                    if parent:
                        await asyncio.to_thread(
                            ssh_exec, session["host"], session["port"], session["username"], session["password"],
                            f"mkdir -p {shlex.quote(parent)}"
                        )
                    await asyncio.to_thread(
                        ssh_put_file, session["host"], session["port"], session["username"], session["password"],
                        inject_remote_path, inject_content
                    )

            # JMX/RMI 포트 노출 체크 (JDK 8 + v1.33.x)
            if use_v1:
                _, jmx_out, _ = await asyncio.to_thread(
                    ssh_exec, session["host"], session["port"], session["username"], session["password"],
                    "ss -tlnp 2>/dev/null | grep -E '1099|9999' || true"
                )
                if jmx_out.strip():
                    _log(f"[경고] JMX/RMI 포트가 노출되어 있습니다. 방화벽에서 차단하세요:\n{jmx_out.strip()}")
                _log("[주의] JDK 8 + v1.33.x: CVE-2026-33701 미패치. otel-env.sh에 RMI disable 주입됨. 방화벽 차단 필수.")

            _log("[완료] OTel Java Agent 설치 완료.")

            # service_type별 다음 단계 안내 (DB update 전에 기록 — 모든 로그 포함)
            if service_type == "tomcat":
                _log(
                    "→ Tomcat 재시작: catalina.sh 가 "
                    f"{inject_remote_path} 를 자동 source 합니다. "
                    "재시작만 하면 trace 수신 시작."
                )
                _log(
                    "  (기존 setenv.sh가 있으면 synapse-otel 마커 블록만 append/교체되므로 "
                    "기존 JVM 설정은 보존됩니다.)"
                )
            elif service_type == "jboss":
                _log(
                    "→ JBoss/WildFly 재시작: standalone.sh 가 "
                    f"{inject_remote_path} 를 자동 로드합니다. "
                    "재시작만 하면 trace 수신 시작."
                )
            elif service_type == "jeus":
                _log("⚠ JEUS는 자동 로드 규약이 없습니다. 아래 한 줄을 JEUS 기동 스크립트의 JAVA 실행 이전에 수동 추가하세요:")
                _log(f"    . {inject_remote_path}")
                _log("   대상 예시: $JEUS_HOME/bin/startJeusServer, $JEUS_HOME/domains/<domain>/bin/startManagedServer")
                _log("   추가 후 JEUS 재시작.")
            elif service_type == "systemd":
                _log("→ systemd 반영:")
                _log("    sudo systemctl daemon-reload")
                _log("    sudo systemctl restart <your-unit>.service")
            else:  # standalone
                _log("⚠ 기존 기동 명령을 아래 wrapper로 감싸 실행하세요 (자동 로드 없음):")
                _log(f"    {install_dir}/otel-launch.sh <기존 java 기동 명령>")
                _log(f"   예: {install_dir}/otel-launch.sh java -jar /path/to/app.jar")

            _log("→ 이후 Tempo 대시보드에서 service.name 별 trace 수신을 확인하세요.")

            # DB 상태 업데이트 (모든 로그가 기록된 후 커밋 — logs 필드가 안내까지 포함)
            await db.execute(
                update(AgentInstance).where(AgentInstance.id == agent.id).values(status="installed")
            )
            await db.execute(
                update(AgentInstallJob)
                .where(AgentInstallJob.job_id == job_id)
                .values(status="done", logs=_live_jobs[job_id]["logs"], updated_at=datetime.utcnow())
            )
            await db.commit()
            _live_jobs[job_id]["status"] = "done"

        except Exception as exc:
            err_msg = str(exc)
            _log(f"[오류] {err_msg}")
            _live_jobs[job_id]["status"] = "failed"
            _live_jobs[job_id]["error"] = err_msg
            async with AsyncSessionLocal() as db2:
                await db2.execute(
                    update(AgentInstallJob)
                    .where(AgentInstallJob.job_id == job_id)
                    .values(status="failed", logs=_live_jobs[job_id]["logs"], error=err_msg, updated_at=datetime.utcnow())
                )
                await db2.commit()


def _build_service_env_inject(service_type: str, service_path: str, install_dir: str) -> str:
    """서비스 타입별 env 주입 파일 내용 생성."""
    env_source = f". {shlex.quote(install_dir)}/otel-env.sh"
    if service_type == "tomcat":
        return (
            f"#!/bin/sh\n# otel.sh — Tomcat setenv.sh 용 OTel 환경변수\n"
            f"{env_source}\n"
            f'CATALINA_OPTS="$CATALINA_OPTS $JAVA_OPTS"\n'
        )
    elif service_type == "jboss":
        return (
            f"#!/bin/sh\n# otel.conf — JBoss standalone.conf.d 용\n"
            f"{env_source}\n"
            f'JAVA_OPTS="$JAVA_OPTS"\n'
        )
    elif service_type == "jeus":
        return (
            f"#!/bin/sh\n# otel.sh — JEUS JEUS_OPTS 용\n"
            f"{env_source}\n"
            f'JEUS_OPTS="$JEUS_OPTS $JAVA_OPTS"\n'
        )
    elif service_type == "systemd":
        return (
            "[Service]\n"
            f"EnvironmentFile={install_dir}/otel-env.sh\n"
        )
    else:  # standalone
        return (
            f"#!/bin/sh\n# otel-launch.sh — standalone 앱 기동 래퍼\n"
            f"{env_source}\nexec \"$@\"\n"
        )


def _get_inject_path(service_type: str, service_path: str, install_dir: str, sys_name: str) -> str | None:
    """서비스 타입별 env 주입 파일의 원격 경로 반환."""
    if service_type == "tomcat" and service_path:
        return f"{service_path}/bin/setenv.sh"
    elif service_type == "jboss" and service_path:
        return f"{service_path}/bin/standalone.conf.d/otel.conf"
    elif service_type == "jeus" and service_path:
        return f"{service_path}/otel.sh"
    elif service_type == "systemd":
        unit = sys_name.replace(" ", "_")
        return f"/etc/systemd/system/{unit}.service.d/otel.conf"
    else:
        return f"{install_dir}/otel-launch.sh"


# ── OTel 전용 설정 파일 조회 엔드포인트 ──────────────────────────────────────────
#
# AgentDetailPage의 설정 파일 편집기가 OTel 타입일 때 호출.
# kind=env   → {install_path}/otel-env.sh (공통 환경변수)
# kind=inject → service_type별 WAS inject 파일 (setenv.sh / otel.conf / otel.sh / otel-launch.sh)
#
# ssh_exec + `cat` 방식으로 읽기 (ssh_read_file 의존 없음).

@router.get("/agents/{agent_id}/otel-config")
async def get_otel_config(
    agent_id: int,
    kind: str = "env",
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(_require_session),
    current_user=Depends(get_current_user),
):
    if kind not in ("env", "inject"):
        raise HTTPException(400, "kind는 env 또는 inject 이어야 합니다.")
    agent = await _get_agent_or_404(agent_id, db)
    if agent.agent_type != "otel_javaagent":
        raise HTTPException(400, "OTel Java 수집기 에이전트가 아닙니다.")
    _check_host_match(agent, session)

    try:
        info = json.loads(agent.label_info or "{}")
    except Exception:
        info = {}

    # install_path / service_path 는 ~ 포함 가능 → 원격 홈으로 확장
    install_dir_raw = agent.install_path or "~/otel"
    install_dir = await _expand_remote_tilde(session, _validate_path(install_dir_raw, "install_path"))

    if kind == "env":
        target_path = f"{install_dir}/otel-env.sh"
    else:  # inject
        service_type = info.get("service_type", "standalone")
        service_path = _validate_path(info.get("service_path", ""), "service_path")
        if service_path:
            service_path = await _expand_remote_tilde(session, service_path)
        sys_result = await db.execute(select(System).where(System.id == agent.system_id))
        sys_obj = sys_result.scalar_one_or_none()
        sys_name = sys_obj.system_name if sys_obj else "unknown"
        target_path = _get_inject_path(service_type, service_path, install_dir, sys_name)
        if not target_path:
            raise HTTPException(404, "현재 service_type에 대한 inject 파일 경로를 결정할 수 없습니다.")

    try:
        code, stdout, stderr = await asyncio.wait_for(
            asyncio.to_thread(
                ssh_exec,
                session["host"], session["port"], session["username"], session["password"],
                f"cat {shlex.quote(target_path)}",
            ),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        raise HTTPException(504, "SSH 명령 실행 시간이 초과되었습니다.")
    except SSHError as exc:
        logger.warning("SSH otel-config read failed: %s", exc)
        raise HTTPException(502, "원격 서버 연결에 실패했습니다.")

    if code != 0:
        raise HTTPException(
            404,
            f"파일을 읽지 못했습니다: {target_path} — {stderr.strip() or '존재하지 않음 또는 권한 없음'}",
        )
    return {"agent_id": agent_id, "kind": kind, "config_path": target_path, "content": stdout}
