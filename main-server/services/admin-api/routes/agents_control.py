"""에이전트 제어·설치·상태 조회 API (routes/agents.py에서 분리)

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

에이전트 라이브 상태:
  - GET  /api/v1/agents/{id}/live-status
"""

import asyncio
import json
import logging
import os
import re
import shlex
import textwrap
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AgentInstance, AgentInstallJob, System
from schemas import (
    AgentConfigUpload,
    AgentInstallJobOut,
    AgentInstallRequest,
    AgentStatusOut,
)
from services.ssh_session import (
    SSHError,
    get_session,
    ssh_exec,
    ssh_get_file,
    ssh_put_binary,
    ssh_put_file,
    ssh_read_file,
)
from services.agent_utils import sanitize_promql_label

router = APIRouter(prefix="/api/v1", tags=["agents"])

# 실행 중인 Job의 실시간 로그 버퍼 (DB는 완료 후 갱신)
_live_jobs: dict[str, dict] = {}


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


def _assert_session_account(agent, session: dict) -> None:
    """에이전트 등록 계정과 SSH 세션 계정이 일치하지 않으면 422. ssh_username=NULL이면 스킵(기존 레코드 하위호환)."""
    if agent.ssh_username and session.get("username") != agent.ssh_username:
        raise HTTPException(
            status_code=422,
            detail=(
                f"SSH 세션 계정({session['username']})이 "
                f"에이전트 등록 계정({agent.ssh_username})과 다릅니다. "
                f"'{agent.ssh_username}' 계정으로 다시 로그인하세요."
            ),
        )


# ── 에이전트 제어 (동기) ──────────────────────────────────────────────────────

async def _get_agent_or_404(agent_id: int, db: AsyncSession) -> AgentInstance:
    agent = await db.get(AgentInstance, agent_id)
    if not agent:
        raise HTTPException(404, "에이전트를 찾을 수 없습니다.")
    return agent


def _shell_path(p: str) -> str:
    """경로를 원격 쉘 명령어에 삽입할 때 tilde를 $HOME으로 치환. ~ 시작 경로는 shlex.quote가 단일 따옴표로 감싸 tilde 확장이 안 되므로 이중 따옴표 + $HOME 방식을 사용."""
    if p.startswith("~/"):
        return '"$HOME/' + p[2:].replace("\\", "\\\\").replace('"', '\\"') + '"'
    if p == "~":
        return '"$HOME"'
    return shlex.quote(p)


def _make_start_cmd(agent: AgentInstance) -> str:
    """에이전트 타입별 실행 명령어 생성."""
    if agent.agent_type == "db":
        raise HTTPException(400, "DB 에이전트는 프로세스 관리가 불필요합니다.")
    ip = _shell_path(agent.install_path)
    cp = _shell_path(agent.config_path) if agent.config_path else ""
    pf = _shell_path(agent.pid_file)
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
    _assert_session_account(agent, session)
    if not agent.pid_file:
        raise HTTPException(400, "pid_file 경로가 설정되어 있지 않습니다.")

    cmd = _make_start_cmd(agent)

    try:
        chk, _, _ = await asyncio.wait_for(
            asyncio.to_thread(
                ssh_exec, session["host"], session["port"], session["username"], session["password"],
                f"test -f {_shell_path(agent.install_path)}",
            ),
            timeout=30.0,
        )
    except (asyncio.TimeoutError, SSHError):
        chk = 1
    if chk != 0:
        raise HTTPException(422, "바이너리 파일이 원격 서버에 없습니다. 설치를 먼저 실행해 주세요.")

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
    _assert_session_account(agent, session)
    if not agent.pid_file:
        raise HTTPException(400, "pid_file 경로가 설정되어 있지 않습니다.")

    pf = _shell_path(agent.pid_file)
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
    _assert_session_account(agent, session)
    if not agent.pid_file:
        raise HTTPException(400, "pid_file 경로가 설정되어 있지 않습니다.")

    pf = _shell_path(agent.pid_file)
    stop_cmd = f"kill $(cat {pf}) 2>/dev/null; rm -f {pf}; sleep 1"
    start_cmd = _make_start_cmd(agent)

    try:
        chk, _, _ = await asyncio.wait_for(
            asyncio.to_thread(
                ssh_exec, session["host"], session["port"], session["username"], session["password"],
                f"test -f {_shell_path(agent.install_path)}",
            ),
            timeout=30.0,
        )
    except (asyncio.TimeoutError, SSHError):
        chk = 1
    if chk != 0:
        raise HTTPException(422, "바이너리 파일이 원격 서버에 없습니다. 설치를 먼저 실행해 주세요.")

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
    _assert_session_account(agent, session)
    pid: Optional[int] = None
    agent_status = "unknown"
    message = ""

    if agent.pid_file:
        pf = _shell_path(agent.pid_file)
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
    _assert_session_account(agent, session)
    config_path = agent.config_path or ""
    try:
        if "~" in config_path:
            code, home_stdout, _ = await asyncio.to_thread(
                ssh_exec, session["host"], session["port"], session["username"], session["password"], "echo $HOME"
            )
            if code == 0 and home_stdout.strip():
                config_path = config_path.replace("~", home_stdout.strip())
        content = await asyncio.to_thread(
            ssh_get_file, session["host"], session["port"], session["username"], session["password"], config_path
        )
    except SSHError as exc:
        logger.warning("SSH operation failed: %s", exc)
        raise HTTPException(502, "원격 서버 연결에 실패했습니다.")
    except Exception as exc:
        raise HTTPException(502, f"설정 파일 조회 실패: {exc}")
    return {"agent_id": agent_id, "config_path": config_path, "content": content}


def _extract_full_label_info_from_toml(toml_content: str) -> dict | None:
    """config.toml에서 label_info 관련 필드 전체 파싱 (collectors + log_monitors + web_servers)."""
    try:
        import tomllib
        data = tomllib.loads(toml_content)
        result: dict = {}
        if "collectors" in data:
            result["collectors"] = {k: bool(v) for k, v in data["collectors"].items()}
        if "log_monitor" in data:
            lms = data["log_monitor"]
            if isinstance(lms, list):
                result["log_monitors"] = [
                    {
                        "paths": lm.get("paths", []),
                        "keywords": lm.get("keywords", []),
                        "log_type": lm.get("log_type", "app"),
                    }
                    for lm in lms
                ]
        if "web_servers" in data:
            wss = data["web_servers"]
            if isinstance(wss, list):
                result["web_servers"] = [
                    {
                        "name": ws.get("name", ""),
                        "display_name": ws.get("display_name", ""),
                        "log_path": ws.get("log_path", ""),
                        "log_format": ws.get("log_format", "combined"),
                        "slow_threshold_ms": ws.get("slow_threshold_ms", 1000),
                        "was_services": ws.get("was_services", []),
                    }
                    for ws in wss
                ]
        return result if result else None
    except Exception:
        return None


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
    _assert_session_account(agent, session)
    config_path = agent.config_path or ""
    try:
        if "~" in config_path:
            code, home_stdout, _ = await asyncio.to_thread(
                ssh_exec, session["host"], session["port"], session["username"], session["password"], "echo $HOME"
            )
            if code == 0 and home_stdout.strip():
                config_path = config_path.replace("~", home_stdout.strip())
        await asyncio.to_thread(
            ssh_put_file,
            session["host"], session["port"], session["username"], session["password"],
            config_path, body.config_content,
        )
    except SSHError as exc:
        logger.warning("SSH operation failed: %s", exc)
        raise HTTPException(502, "원격 서버 연결에 실패했습니다.")

    # synapse_agent: 업로드된 TOML에서 전체 label_info 동기화 (collectors + log_monitors + web_servers)
    if agent.agent_type == "synapse_agent":
        parsed = _extract_full_label_info_from_toml(body.config_content)
        if parsed is not None:
            try:
                label_info: dict = json.loads(agent.label_info or "{}")
            except Exception:
                label_info = {}
            label_info.update(parsed)
            await db.execute(
                update(AgentInstance)
                .where(AgentInstance.id == agent_id)
                .values(label_info=json.dumps(label_info, ensure_ascii=False))
            )
            await db.commit()

    return AgentStatusOut(
        agent_id=agent_id,
        status=agent.status,
        pid=None,
        message="설정 파일 업로드 완료.",
    )


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
        _check_host_match(agent, session)
        _assert_session_account(agent, session)
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).replace(tzinfo=None)

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


async def _run_cli_install(job_id: str, agent: AgentInstance, session: dict) -> None:
    """Synapse CLI 바이너리 배포 (mkdir + scp + chmod + PATH 등록). 데몬 없음."""
    from database import AsyncSessionLocal
    from pathlib import Path

    _STANDARD_PATH = {"/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/sbin"}

    def _log(msg: str):
        _live_jobs[job_id]["logs"] += f"{msg}\n"

    install_path_raw = agent.install_path or "~/bin/synapse"

    async with AsyncSessionLocal() as db:
        try:
            _log("[1/4] 홈 디렉터리 확인 및 설치 경로 준비 중...")
            # SFTP는 tilde 미지원 → 절대경로로 확장
            install_path = await _expand_remote_tilde(session, install_path_raw)
            install_dir = install_path.rsplit("/", 1)[0]
            _log(f"  → 설치 경로: {install_path}")

            _log("[2/4] 설치 디렉터리 생성 중...")
            mkdir_cmd = f"mkdir -p {_shell_path(install_dir)}"
            code, _, stderr = await asyncio.to_thread(
                ssh_exec,
                session["host"], session["port"], session["username"], session["password"],
                mkdir_cmd,
            )
            if code != 0:
                raise RuntimeError(f"mkdir -p 실패: {stderr.strip()}")
            _log(f"  → 완료: {install_dir}")

            _log("[3/4] CLI 바이너리 업로드 중 (SFTP)...")
            _default_cli = "/app/bin/synapse"
            bin_path = Path(os.environ.get("SYNAPSE_CLI_BINARY_PATH", _default_cli))
            if not bin_path.exists():
                raise RuntimeError(
                    f"synapse CLI 바이너리를 찾을 수 없습니다 ({bin_path}). "
                    "Docker 이미지: make build-api로 재빌드, "
                    "로컬 개발: SYNAPSE_CLI_BINARY_PATH 환경변수를 설정하세요."
                )
            binary_content = await asyncio.to_thread(bin_path.read_bytes)
            await asyncio.to_thread(
                ssh_put_binary,
                session["host"], session["port"], session["username"], session["password"],
                install_path, binary_content,
            )
            _log(f"  → 업로드 완료: {install_path}")

            _log("[4/4] 실행 권한 설정 중...")
            code, _, stderr = await asyncio.to_thread(
                ssh_exec,
                session["host"], session["port"], session["username"], session["password"],
                f"chmod +x {shlex.quote(install_path)}",
            )
            if code != 0:
                raise RuntimeError(f"chmod +x 실패: {stderr.strip()}")

            if install_dir not in _STANDARD_PATH:
                path_line = f'export PATH="{install_dir}:$PATH"'
                add_cmd = (
                    f'grep -qF {shlex.quote(install_dir)} ~/.bashrc || '
                    f'echo {shlex.quote(path_line)} >> ~/.bashrc'
                )
                await asyncio.to_thread(
                    ssh_exec,
                    session["host"], session["port"], session["username"], session["password"],
                    add_cmd,
                )
                _log(f"  → ~/.bashrc에 PATH 등록 완료. 'source ~/.bashrc' 또는 재로그인 후 'synapse --help'로 확인하세요.")
            else:
                _log(f"  → 완료. 대상 서버에서 'synapse --help'로 확인하세요.")

            _live_jobs[job_id]["status"] = "done"
            job = await db.get(AgentInstallJob, None)
            jobs = await db.execute(
                select(AgentInstallJob).where(AgentInstallJob.job_id == job_id)
            )
            job = jobs.scalar_one_or_none()
            if job:
                job.status = "done"
                job.logs = _live_jobs[job_id]["logs"]
            agent_row = await db.get(AgentInstance, agent.id)
            if agent_row:
                agent_row.status = "installed"
            await db.commit()

        except Exception as exc:
            _log(f"\n[오류] {exc}")
            _live_jobs[job_id]["status"] = "failed"
            jobs = await db.execute(
                select(AgentInstallJob).where(AgentInstallJob.job_id == job_id)
            )
            job = jobs.scalar_one_or_none()
            if job:
                job.status = "failed"
                job.logs = _live_jobs[job_id]["logs"]
                job.error = str(exc)
            await db.commit()


def _build_config_toml(label_info: dict, agent_host: str, config_path: str) -> str:
    """
    label_info + agent_host + config_path → synapse_agent config.toml 문자열 생성.
    wal_dir / log_dir는 config_path의 dirname 기준으로 자동 결정.
    """
    system_name = label_info.get("system_name", "unknown")
    display_name = label_info.get("display_name", system_name)
    instance_role = label_info.get("instance_role", "default")
    prometheus_url = os.environ.get(
        "AGENT_PROMETHEUS_URL",
        os.environ.get("PROMETHEUS_URL", "http://prometheus:9090"),
    )
    wal_dir = os.path.dirname(config_path) + "/wal"
    log_dir = os.path.dirname(config_path) + "/logs"

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

    def _toml_escape(s: str) -> str:
        return str(s).replace("\\", "\\\\").replace('"', '\\"')

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
        paths_str = ", ".join(f'"{_toml_escape(p)}"' for p in lm.get("paths", []))
        kw_str = ", ".join(f'"{_toml_escape(k)}"' for k in lm.get("keywords", ["ERROR", "CRITICAL", "PANIC", "Fatal", "Exception"]))
        log_monitor_toml += (
            f"\n[[log_monitor]]\n"
            f"paths = [{paths_str}]\n"
            f"keywords = [{kw_str}]\n"
            f'log_type = "{_toml_escape(lm.get("log_type", "app"))}"\n'
        )

    # web_servers 섹션 — label_info.web_servers 배열이 있을 때만 렌더링
    web_servers_list = label_info.get("web_servers", []) or []
    web_servers_toml = ""
    for ws in web_servers_list:
        if not isinstance(ws, dict):
            continue
        ws_name = (ws.get("name") or "").strip()
        ws_log_path = (ws.get("log_path") or "").strip()
        if not ws_name or not ws_log_path:
            continue
        ws_display = (ws.get("display_name") or ws_name).strip()
        ws_format = (ws.get("log_format") or "combined").strip() or "combined"
        try:
            ws_slow = int(ws.get("slow_threshold_ms", 1000))
        except (TypeError, ValueError):
            ws_slow = 1000
        if ws_slow < 1:
            ws_slow = 1
        svc_raw = ws.get("was_services") or []
        if isinstance(svc_raw, list):
            svc_items = [str(s).strip() for s in svc_raw if str(s).strip()]
        else:
            svc_items = []
        svc_str = ", ".join(f'"{_toml_escape(s)}"' for s in svc_items)
        web_servers_toml += (
            f"\n[[web_servers]]\n"
            f'name = "{_toml_escape(ws_name)}"\n'
            f'display_name = "{_toml_escape(ws_display)}"\n'
            f'log_path = "{_toml_escape(ws_log_path)}"\n'
            f'log_format = "{_toml_escape(ws_format)}"\n'
            f'slow_threshold_ms = {ws_slow}\n'
            f'was_services = [{svc_str}]\n'
        )

    return (
        f'[agent]\n'
        f'system_name = "{system_name}"\n'
        f'display_name = "{display_name}"\n'
        f'instance_role = "{instance_role}"\n'
        f'host = "{agent_host}"\n'
        f'collect_interval_secs = 15\n'
        f'top_process_count = 10\n'
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
    ) + log_monitor_toml + web_servers_toml


async def _run_db_connect(job_id: str, agent: AgentInstance) -> None:
    """db 에이전트 '설치' = DB 연결 테스트 후 status 업데이트."""
    from services.crypto import decrypt_password
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
            await db.execute(
                update(AgentInstallJob)
                .where(AgentInstallJob.job_id == job_id)
                .values(
                    status="done",
                    logs=_live_jobs[job_id]["logs"],
                    updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
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
                    updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
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

    # Agent-T (Java APM 에이전트) 설치
    if agent.agent_type == "agent_t":
        from services import agent_t_installer  # 순환 import 방지: 호출 시점에 로드
        await agent_t_installer.run_install(job_id, agent, session)
        return

    # Synapse CLI 배포 (단순 scp + chmod, 데몬 없음)
    if agent.agent_type == "cli":
        await _run_cli_install(job_id, agent, session)
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

            # 설치 경로 충돌 검사 — tilde 확장 후 절대경로 기준으로 비교
            if install_path:
                conflict_result = await db.execute(
                    select(AgentInstance).where(
                        AgentInstance.id != agent.id,
                        AgentInstance.host == agent.host,
                        AgentInstance.install_path == install_path,
                    )
                )
                conflicting = conflict_result.scalar_one_or_none()
                if conflicting:
                    try:
                        conflict_info = json.loads(conflicting.label_info or "{}")
                        conflict_role = conflict_info.get("instance_role", f"ID {conflicting.id}")
                    except Exception:
                        conflict_role = f"ID {conflicting.id}"
                    raise RuntimeError(
                        f"설치 경로 충돌: 같은 호스트의 다른 에이전트({conflict_role})가 "
                        f"동일한 경로({install_path})를 사용 중입니다. "
                        "에이전트별로 고유한 설치 경로를 지정하세요."
                    )

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
                label_info: dict = {}
                if agent.label_info:
                    try:
                        label_info = json.loads(agent.label_info)
                    except Exception:
                        pass
                wal_dir = os.path.dirname(config_path) + "/wal"
                log_dir = os.path.dirname(config_path) + "/logs"

                # WAL + 로그 디렉터리 생성
                await asyncio.to_thread(
                    ssh_exec,
                    session["host"], session["port"], session["username"], session["password"],
                    f"mkdir -p {wal_dir} {log_dir}",
                )

                config_content = _build_config_toml(label_info, agent.host, config_path)
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

            await db.execute(
                update(AgentInstallJob)
                .where(AgentInstallJob.job_id == job_id)
                .values(
                    status="done",
                    logs=_live_jobs[job_id]["logs"],
                    updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
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
                    updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
                )
            )
            await db.commit()


# ── Live Status (Prometheus heartbeat 기반) ───────────────────────────────────

def _calc_live_status(age_secs: float) -> str:
    """경과 시간(초) → live_status 문자열. 1분(60s) 기준."""
    if age_secs < 60:
        return "collecting"
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
    최근 1분 내 데이터가 있으면 live=True를 반환한다.
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
        system_name = sanitize_promql_label(label_info.get("system_name", ""))
        instance_role = sanitize_promql_label(label_info.get("instance_role", ""))
        host = sanitize_promql_label(agent.host)

        role_filter = f',instance_role="{instance_role}"' if instance_role else ""
        # timestamp() 함수로 실제 샘플 수집 시각을 value[1]에서 추출.
        # 일반 instant query의 value[0]은 평가 시각(지금)이라 age 계산이 항상 0이 됨.
        query = f'timestamp(agent_up{{system_name="{system_name}",host="{host}"{role_filter}}})'
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
            ts = float(results[0]["value"][1])  # value[1] = 실제 샘플 Unix timestamp
            last_seen = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            age_secs = time.time() - ts
            live_status = _calc_live_status(age_secs)
        else:
            last_seen = None
            live_status = "no_data"

        collectors_active = []
        try:
            hb_query = f'timestamp(agent_heartbeat{{system_name="{system_name}",host="{host}"{role_filter}}})'
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    f"{prometheus_url}/api/v1/query",
                    params={"query": hb_query},
                )
            now = time.time()
            for r in resp.json().get("data", {}).get("result", []):
                hb_ts = float(r.get("value", [0, "0"])[1])
                if now - hb_ts < 60:
                    collector = r.get("metric", {}).get("collector", "")
                    if collector:
                        collectors_active.append(collector)
        except Exception:
            pass

        return {
            "agent_id": agent_id,
            "type": "synapse_agent",
            "status": agent.status,
            "live": live_status == "collecting",
            "live_status": live_status,
            "last_seen": last_seen,
            "collectors_active": collectors_active,
        }

    # ── db 에이전트 ──────────────────────────────────────────────────────────
    if agent.agent_type == "db":
        # system_name은 Systems 테이블에서 조회
        sys_result = await db.execute(select(System).where(System.id == agent.system_id))
        system = sys_result.scalar_one_or_none()
        system_name = sanitize_promql_label(system.system_name if system else "")

        query = f'timestamp(db_connections_active{{system_name="{system_name}"}})'
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
            ts = float(results[0]["value"][1])  # value[1] = 실제 샘플 Unix timestamp
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
            "live": live_status == "collecting",
            "live_status": live_status,
            "last_seen": last_seen,
            "collectors_active": [],
        }

    # ── Agent-T (gateway snapshot 기반) ──────────────────────────────────────
    if agent.agent_type == "agent_t":
        from services import agent_t_installer
        info = {}
        try:
            info = json.loads(agent.label_info or "{}")
        except Exception:
            pass
        instance_role = info.get("instance_role", "was")
        instances = await agent_t_installer.fetch_snapshot(agent.system_id, current_user)
        inst = agent_t_installer.find_instance(instances, agent.system_id, instance_role)
        last_seen, age_secs = agent_t_installer.last_seen_age(inst.get("last_seen") if inst else None)
        live_status = _calc_live_status(age_secs) if age_secs is not None else "no_data"
        return {
            "agent_id": agent_id,
            "type": "agent_t",
            "status": agent.status,
            "live": live_status == "collecting",
            "live_status": live_status,
            "last_seen": last_seen,
            "instance_role": instance_role,
            "collectors_active": [],
        }

    # ── 기타 타입 (SSH 기반 제어 에이전트) ────────────────────────────────────
    return {"agent_id": agent_id, "type": agent.agent_type, "status": agent.status, "live": False}


# ── 완전 삭제 (원격 포함) ─────────────────────────────────────────────────────────

_PURGE_BLOCKED_DIRS = frozenset({"/", "/home", "/usr", "/opt", "/etc", "/var", "/tmp", "/root"})


@router.delete("/agents/{agent_id}/purge", status_code=204)
async def purge_agent(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    session: dict = Depends(_require_session),
    current_user=Depends(get_current_user),
):
    """
    프로세스 종료 + 원격 설치 디렉터리 삭제 + DB 삭제를 한 번에 수행한다.
    synapse_agent 전용. SSH 세션 필수.
    """
    agent = await _get_agent_or_404(agent_id, db)
    if agent.agent_type != "synapse_agent":
        raise HTTPException(400, "완전 삭제는 synapse_agent 타입만 지원합니다.")
    _check_host_match(agent, session)

    host, port, username, password = (
        session["host"], session["port"], session["username"], session["password"]
    )

    # 1. tilde 확장 (install_path, pid_file 공통)
    home_dir = ""
    if (agent.install_path and "~" in agent.install_path) or (agent.pid_file and "~" in agent.pid_file):
        try:
            _, home_out, _ = await asyncio.to_thread(ssh_exec, host, port, username, password, "echo $HOME")
            home_dir = home_out.strip()
        except SSHError as exc:
            raise HTTPException(502, f"SSH 연결 실패: {exc}")

    def expand(p: str) -> str:
        return p.replace("~", home_dir) if home_dir else p

    # 2. 프로세스 종료
    if agent.pid_file:
        pf = _shell_path(expand(agent.pid_file))
        stop_cmd = f"kill $(cat {pf} 2>/dev/null) 2>/dev/null || true; sleep 1; rm -f {pf}"
        try:
            await asyncio.to_thread(ssh_exec, host, port, username, password, stop_cmd)
        except SSHError:
            pass  # 이미 중지 상태여도 계속 진행

    # 3. 설치 디렉터리 전체 삭제 (binary + config + wal + logs)
    if agent.install_path:
        install_dir = os.path.dirname(expand(agent.install_path))
        if install_dir and install_dir not in _PURGE_BLOCKED_DIRS:
            rm_cmd = f"rm -rf {shlex.quote(install_dir)}"
            try:
                code, _, stderr = await asyncio.to_thread(ssh_exec, host, port, username, password, rm_cmd)
            except SSHError as exc:
                raise HTTPException(502, f"원격 파일 삭제 실패: {exc}")
            if code != 0:
                raise HTTPException(502, f"원격 파일 삭제 실패: {stderr.strip()}")

    # 4. DB 삭제
    await db.delete(agent)
    await db.commit()


# ── Agent-T 설치 공용 헬퍼 (services/agent_t_installer.py 가 사용) ─────────────────

_ENV_FILE_DEFAULT = "agent-t-env.sh"
_PATH_WHITELIST_RE = re.compile(r"^[A-Za-z0-9/_.\-]+$")

# Tomcat setenv.sh에 append/갱신할 때 사용하는 마커 블록.
# 기존 운영팀 설정(heap, GC, encoding, CLASSPATH 등)을 보존하기 위해 덮어쓰기 대신
# 블록 치환(append + 기존 블록만 제거)으로 동작한다.
_TOMCAT_MARKER_BEGIN = "# === synapse-agent-t BEGIN ==="
_TOMCAT_MARKER_END = "# === synapse-agent-t END ==="


def _strip_tomcat_marker_block(content: str) -> str:
    """기존 setenv.sh에서 synapse-agent-t 마커 블록만 제거한다 (멱등성 보장)."""
    if not content:
        return ""
    pattern = re.compile(
        rf"^[ \t]*{re.escape(_TOMCAT_MARKER_BEGIN)}.*?{re.escape(_TOMCAT_MARKER_END)}[ \t]*\n?",
        re.DOTALL | re.MULTILINE,
    )
    return pattern.sub("", content)


def _build_tomcat_setenv(existing: str, install_dir: str, env_file: str = _ENV_FILE_DEFAULT) -> str:
    """기존 setenv.sh 내용 + 우리 마커 블록을 결합.

    - 기존 내용에 우리 블록이 이미 있으면 제거 후 파일 끝에 한 벌만 append
    - shebang이 원본에 없으면 우리는 추가하지 않음 (CATALINA_OPTS는 source만 되면 되므로 불필요)
    """
    base = _strip_tomcat_marker_block(existing or "").rstrip()
    block = (
        f"\n\n{_TOMCAT_MARKER_BEGIN} (admin-api 자동 관리 — 수동 편집 금지)\n"
        f". {install_dir}/{env_file}\n"
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


def _build_service_env_inject(
    service_type: str, service_path: str, install_dir: str, env_file: str = _ENV_FILE_DEFAULT
) -> str:
    """서비스 타입별 env 주입 파일 내용 생성."""
    env_source = f". {shlex.quote(install_dir)}/{env_file}"
    if service_type == "tomcat":
        return (
            f"#!/bin/sh\n# agent-t.sh — Tomcat setenv.sh 용 Agent-T 환경변수\n"
            f"{env_source}\n"
            f'CATALINA_OPTS="$CATALINA_OPTS $JAVA_OPTS"\n'
        )
    elif service_type == "jboss":
        return (
            f"#!/bin/sh\n# agent-t.conf — JBoss standalone.conf.d 용\n"
            f"{env_source}\n"
            f'JAVA_OPTS="$JAVA_OPTS"\n'
        )
    elif service_type == "jeus":
        return (
            f"#!/bin/sh\n# agent-t.sh — JEUS JEUS_OPTS 용\n"
            f"{env_source}\n"
            f'JEUS_OPTS="$JEUS_OPTS $JAVA_OPTS"\n'
        )
    elif service_type == "systemd":
        return (
            "[Service]\n"
            f"EnvironmentFile={install_dir}/{env_file}\n"
        )
    else:  # standalone
        return (
            f"#!/bin/sh\n# agent-t-launch.sh — standalone 앱 기동 래퍼\n"
            f"{env_source}\nexec \"$@\"\n"
        )


def _get_inject_path(service_type: str, service_path: str, install_dir: str, sys_name: str) -> str | None:
    """서비스 타입별 env 주입 파일의 원격 경로 반환."""
    if service_type == "tomcat" and service_path:
        return f"{service_path}/bin/setenv.sh"
    elif service_type == "jboss" and service_path:
        return f"{service_path}/bin/standalone.conf.d/agent-t.conf"
    elif service_type == "jeus" and service_path:
        return f"{service_path}/agent-t.sh"
    elif service_type == "systemd":
        unit = sys_name.replace(" ", "_")
        return f"/etc/systemd/system/{unit}.service.d/agent-t.conf"
    else:
        return f"{install_dir}/agent-t-launch.sh"
