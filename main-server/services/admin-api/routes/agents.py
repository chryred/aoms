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
import os
import textwrap
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AgentInstance, AgentInstallJob
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
    ssh_put_file,
)

router = APIRouter(prefix="/api/v1", tags=["agents"])

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
        expires_in=1800,
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
    agent = AgentInstance(**body.model_dump())
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


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
    await db.delete(agent)
    await db.commit()


# ── 에이전트 제어 (동기) ──────────────────────────────────────────────────────

async def _get_agent_or_404(agent_id: int, db: AsyncSession) -> AgentInstance:
    agent = await db.get(AgentInstance, agent_id)
    if not agent:
        raise HTTPException(404, "에이전트를 찾을 수 없습니다.")
    return agent


def _make_start_cmd(agent: AgentInstance) -> str:
    """에이전트 타입별 실행 명령어 생성."""
    if agent.agent_type == "alloy":
        return (
            f"nohup {agent.install_path} run {agent.config_path}"
            f" > {agent.install_path}.log 2>&1 & echo $! > {agent.pid_file}"
        )
    if agent.agent_type == "node_exporter":
        return (
            f"nohup {agent.install_path}"
            f" > {agent.install_path}.log 2>&1 & echo $! > {agent.pid_file}"
        )
    # jmx_exporter
    return (
        f"nohup java -jar {agent.install_path} {agent.port} {agent.config_path}"
        f" > {agent.install_path}.log 2>&1 & echo $! > {agent.pid_file}"
    )


@router.post("/agents/{agent_id}/start", response_model=AgentStatusOut)
async def start_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(_require_session),
    current_user=Depends(get_current_user),
):
    agent = await _get_agent_or_404(agent_id, db)
    if not agent.pid_file:
        raise HTTPException(400, "pid_file 경로가 설정되어 있지 않습니다.")

    cmd = _make_start_cmd(agent)
    try:
        code, stdout, stderr = await asyncio.to_thread(
            ssh_exec, session["host"], session["port"], session["username"], session["password"], cmd
        )
    except SSHError as exc:
        raise HTTPException(502, str(exc))

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
    session: dict = Depends(_require_session),
    current_user=Depends(get_current_user),
):
    agent = await _get_agent_or_404(agent_id, db)
    if not agent.pid_file:
        raise HTTPException(400, "pid_file 경로가 설정되어 있지 않습니다.")

    cmd = f"kill $(cat {agent.pid_file}) && rm -f {agent.pid_file}"
    try:
        code, stdout, stderr = await asyncio.to_thread(
            ssh_exec, session["host"], session["port"], session["username"], session["password"], cmd
        )
    except SSHError as exc:
        raise HTTPException(502, str(exc))

    await db.execute(
        update(AgentInstance).where(AgentInstance.id == agent_id).values(status="stopped")
    )
    await db.commit()
    return AgentStatusOut(agent_id=agent_id, status="stopped", pid=None, message="에이전트를 종료했습니다.")


@router.post("/agents/{agent_id}/restart", response_model=AgentStatusOut)
async def restart_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(_require_session),
    current_user=Depends(get_current_user),
):
    agent = await _get_agent_or_404(agent_id, db)
    if not agent.pid_file:
        raise HTTPException(400, "pid_file 경로가 설정되어 있지 않습니다.")

    stop_cmd = f"kill $(cat {agent.pid_file}) 2>/dev/null; rm -f {agent.pid_file}; sleep 1"
    start_cmd = _make_start_cmd(agent)
    try:
        await asyncio.to_thread(
            ssh_exec, session["host"], session["port"], session["username"], session["password"], stop_cmd
        )
        code, stdout, stderr = await asyncio.to_thread(
            ssh_exec, session["host"], session["port"], session["username"], session["password"], start_cmd
        )
    except SSHError as exc:
        raise HTTPException(502, str(exc))

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
    pid: Optional[int] = None
    agent_status = "unknown"
    message = ""

    if agent.pid_file:
        cmd = f"cat {agent.pid_file} 2>/dev/null && ps -p $(cat {agent.pid_file} 2>/dev/null) -o pid= 2>/dev/null"
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
    try:
        content = await asyncio.to_thread(
            ssh_get_file, session["host"], session["port"], session["username"], session["password"], agent.config_path
        )
    except SSHError as exc:
        raise HTTPException(502, str(exc))
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
    try:
        await asyncio.to_thread(
            ssh_put_file,
            session["host"], session["port"], session["username"], session["password"],
            agent.config_path, body.config_content,
        )
    except SSHError as exc:
        raise HTTPException(502, str(exc))

    # Reload: Alloy는 SIGHUP, node_exporter/jmx_exporter는 재시작
    reload_cmd: str
    if agent.agent_type == "alloy" and agent.pid_file:
        reload_cmd = f"kill -HUP $(cat {agent.pid_file})"
    elif agent.pid_file:
        stop = f"kill $(cat {agent.pid_file}) 2>/dev/null; rm -f {agent.pid_file}; sleep 1"
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
        raise HTTPException(502, str(exc))

    if code != 0:
        raise HTTPException(502, f"Reload 실패: {stderr.strip()}")

    return AgentStatusOut(agent_id=agent_id, status="running", pid=None, message="설정 업로드 및 Reload 완료.")


# ── 설치 Job (비동기) ─────────────────────────────────────────────────────────

@router.post("/agents/install", response_model=AgentInstallJobOut, status_code=202)
async def install_agent(
    body: AgentInstallRequest,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(_require_session),
    current_user=Depends(get_current_user),
):
    agent = await _get_agent_or_404(body.agent_id, db)
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
            binary_url=body.binary_url,
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


async def _run_install(
    job_id: str,
    agent: AgentInstance,
    session: dict,
    binary_url: Optional[str],
):
    """백그라운드 설치 태스크. DB Job 상태를 단계별로 갱신한다."""
    from database import AsyncSessionLocal

    def _log(msg: str):
        _live_jobs[job_id]["logs"] += f"{msg}\n"

    _live_jobs[job_id]["status"] = "running"

    async with AsyncSessionLocal() as db:
        try:
            _log("[1/4] 디렉터리 생성 중...")
            install_dir = agent.install_path.rsplit("/", 1)[0]
            code, _, stderr = await asyncio.to_thread(
                ssh_exec,
                session["host"], session["port"], session["username"], session["password"],
                f"mkdir -p {install_dir}",
            )
            if code != 0:
                raise RuntimeError(f"디렉터리 생성 실패: {stderr.strip()}")

            if binary_url:
                _log(f"[2/4] 바이너리 다운로드 중: {binary_url}")
                code, _, stderr = await asyncio.to_thread(
                    ssh_exec,
                    session["host"], session["port"], session["username"], session["password"],
                    f"curl -fsSL -o {agent.install_path} {binary_url} && chmod +x {agent.install_path}",
                )
                if code != 0:
                    raise RuntimeError(f"다운로드 실패: {stderr.strip()}")
            else:
                _log("[2/4] binary_url 미제공 — 바이너리 다운로드 건너뜀")

            _log("[3/4] PID 파일 디렉터리 생성 중...")
            if agent.pid_file:
                pid_dir = agent.pid_file.rsplit("/", 1)[0]
                await asyncio.to_thread(
                    ssh_exec,
                    session["host"], session["port"], session["username"], session["password"],
                    f"mkdir -p {pid_dir}",
                )

            # synapse_agent 타입: config.toml 자동생성 및 SFTP 업로드
            if agent.agent_type == "synapse_agent" and agent.config_path:
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
                prometheus_url = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090")
                wal_dir = os.path.dirname(agent.config_path) + "/wal"

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
                    log_monitor_toml += f"""
[[log_monitor]]
paths = [{paths_str}]
keywords = [{kw_str}]
log_type = "{lm.get('log_type', 'app')}"
"""

                config_content = textwrap.dedent(f"""
                    [agent]
                    system_name = "{system_name}"
                    display_name = "{display_name}"
                    instance_role = "{instance_role}"
                    host = "{agent.host}"
                    collect_interval_secs = 15
                    top_process_count = 20

                    [remote_write]
                    endpoint = "{prometheus_url}/api/v1/write"
                    batch_size = 500
                    timeout_secs = 10
                    wal_dir = "{wal_dir}"
                    wal_retention_hours = 2

                    [collectors]
                    cpu = true
                    memory = true
                    disk = true
                    network = true
                    process = true
                    tcp_connections = true
                    log_monitor = true
                    web_servers = false
                    preprocessor = false
                    heartbeat = true
                """).strip() + log_monitor_toml
                await asyncio.to_thread(
                    ssh_put_file,
                    session["host"], session["port"], session["username"], session["password"],
                    agent.config_path, config_content,
                )
                _log(f"  → config.toml 업로드 완료: {agent.config_path}")

            _log("[4/4] 설치 완료.")
            await db.execute(
                update(AgentInstance).where(AgentInstance.id == agent.id).values(status="installed")
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

@router.get("/agents/{agent_id}/live-status")
async def get_agent_live_status(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    synapse_agent 전용: Prometheus에서 agent_up/agent_heartbeat 메트릭을 조회하여
    에이전트의 실제 수집 상태를 반환한다.
    다른 타입은 DB status를 그대로 반환한다.
    """
    import httpx
    import time

    result = await db.execute(select(AgentInstance).where(AgentInstance.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, "에이전트를 찾을 수 없습니다.")

    if agent.agent_type != "synapse_agent":
        return {"agent_id": agent_id, "type": agent.agent_type, "status": agent.status, "live": False}

    label_info = {}
    if agent.label_info:
        try:
            label_info = json.loads(agent.label_info)
        except Exception:
            pass
    system_name = label_info.get("system_name", "")
    host = agent.host

    prometheus_url = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090")
    query = f'agent_up{{system_name="{system_name}",host="{host}"}}'

    results = []
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{prometheus_url}/api/v1/query",
                params={"query": query},
            )
        data = resp.json()
        results = data.get("data", {}).get("result", [])
    except Exception:
        pass

    if results:
        from datetime import timezone
        ts = float(results[0]["value"][0])
        last_seen = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        age_secs = time.time() - ts
        if age_secs < 30:
            live_status = "collecting"
        elif age_secs < 90:
            live_status = "delayed"
        else:
            live_status = "stale"
    else:
        last_seen = None
        live_status = "no_data"

    collectors_active = []
    try:
        collectors_query = f'agent_heartbeat{{system_name="{system_name}",host="{host}"}}'
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{prometheus_url}/api/v1/query",
                params={"query": collectors_query},
            )
        cdata = resp.json()
        for r in cdata.get("data", {}).get("result", []):
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
