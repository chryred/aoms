"""Agent-T 설치 Job (spec §8.1 [1]~[7]).

SSH 세션 → JVM 탐색 → JDK 판별 → SFTP 업로드 → attach(즉시 적용) → 영구 적용 → gateway 확인.
원격 명령은 `_exec` 하나로 실행하며, exec 채널이 거부되면 PTY 셸(`ssh_shell_exec`)로 폴백한다.
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import shlex
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import paramiko
from sqlalchemy import select, update

from models import AgentInstallJob, AgentInstance, System
from routes.agents_control import (
    _build_service_env_inject,
    _build_tomcat_setenv,
    _get_inject_path,
    _live_jobs,
    _validate_path,
)
from services import jeus_domain
from services.ssh_session import (
    SSHError,
    ssh_exec,
    ssh_put_binary,
    ssh_put_file,
    ssh_read_file,
    ssh_shell_exec,
)

logger = logging.getLogger(__name__)

_KST = timezone(timedelta(hours=9))
_CONFIRM_TIMEOUT_S = 90
_CONFIRM_INTERVAL_S = 3
_ENV_FILE = "agent-t-env.sh"
_ATTACHER_JAR = "agent-t-attacher.jar"
_SAFE_VALUE_RE = re.compile(r"[A-Za-z0-9_.-]{1,100}")  # fullmatch 로만 사용 ($ 는 끝 개행을 허용한다)
_UNREACHABLE_GATEWAY_HOSTS = frozenset({"agent-t-gateway", "localhost", "127.0.0.1", "::1"})


# ── 원격 실행 ────────────────────────────────────────────────────────────────

async def _exec(session: dict, cmd: str) -> tuple[int, str, str]:
    """ssh_exec, exec 채널 거부(SSHError/SSHException) 시 ssh_shell_exec 로 재시도."""
    args = (session["host"], session["port"], session["username"], session["password"])
    try:
        return await asyncio.to_thread(ssh_exec, *args, cmd)
    except (SSHError, paramiko.SSHException) as exc:
        if str(exc).startswith("SSH 연결 실패"):
            raise
        logger.info("ssh_exec 실패(%s) → PTY 셸 폴백", exc)
        return await asyncio.to_thread(ssh_shell_exec, *args, cmd)


async def _expand_tilde(session: dict, path: str) -> str:
    if not path or not path.startswith("~"):
        return path
    _, out, _ = await _exec(session, "echo $HOME")
    home = out.strip()
    return home + path[1:] if home else path


# ── JVM·JDK 판별 ─────────────────────────────────────────────────────────────

def parse_java_major(version_output: str) -> int:
    """`java -version` 출력에서 major 버전 추출. 1.7.0_79 → 7, 11.0.2 → 11, 17 → 17."""
    m = re.search(r'version "(\d+)(?:\.(\d+))?', version_output)
    if not m:
        raise ValueError(f"java 버전을 해석할 수 없습니다: {version_output.strip()[:120]}")
    first = int(m.group(1))
    if first == 1 and m.group(2) is not None:
        return int(m.group(2))
    return first


_URI_GLOB_RE = re.compile(r"[A-Za-z0-9_./*?~%{}:;@=+-]{1,200}")  # fullmatch; 쉼표·공백·개행·'#'·'\\' 금지(properties 주입 방지)


def _glob_list(value, field: str) -> list[str]:
    if value is None or value == "":
        return []
    items = value.split(",") if isinstance(value, str) else value
    if not isinstance(items, list):
        raise ValueError(f"label_info.{field} 는 문자열 목록이어야 합니다.")
    out = []
    for it in items:
        if not isinstance(it, str):
            raise ValueError(f"label_info.{field} 는 문자열 목록이어야 합니다.")
        it = it.strip()
        if not it:
            continue
        if not _URI_GLOB_RE.fullmatch(it):
            raise ValueError(f"label_info.{field} 항목이 올바르지 않습니다: {it!r}")
        out.append(it)
    return out


def capture_properties(info: dict) -> str:
    """label_info 의 capture_params(bool)/capture_params_include/_exclude, pool_metrics(false 만) → agent-t.properties 줄들.

    파라미터 수집은 opt-in 이라 capture_params 가 정확히 True 일 때만 켠다(미지정·false → 명시적 false).
    """
    enabled = info.get("capture_params") is True
    include = _glob_list(info.get("capture_params_include"), "capture_params_include")
    exclude = _glob_list(info.get("capture_params_exclude"), "capture_params_exclude")
    lines = f"capture.params={'true' if enabled else 'false'}\n"
    if enabled and include:
        lines += f"capture.params.uri.include={','.join(include)}\n"
    if enabled and exclude:
        lines += f"capture.params.uri.exclude={','.join(exclude)}\n"
    # DB 커넥션 풀 지표(JMX)는 기본 켬. label_info.pool_metrics 가 정확히 False 일 때만 끈다(킬 스위치)
    if info.get("pool_metrics") is False:
        lines += "pool.metrics=false\n"
    return lines


def _artifact_dir() -> str:
    return os.getenv("AGENT_T_ARTIFACT_DIR", "/app/bin/agent-t")


def _read_artifact(name: str) -> bytes:
    path = os.path.join(_artifact_dir(), name)
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Agent-T 아티팩트를 찾을 수 없습니다: {path} (agent-t/build.sh jar 로 agent-t/dist/ 생성 후 admin-api 이미지 재빌드)"
        )
    with open(path, "rb") as f:
        return f.read()


def _verify_against_sums(name: str, data: bytes) -> str:
    """아티팩트 SHA256SUMS 가 있으면 대조하고, sha256 hex 를 반환."""
    digest = hashlib.sha256(data).hexdigest()
    sums_path = os.path.join(_artifact_dir(), "SHA256SUMS")
    if os.path.exists(sums_path):
        with open(sums_path, encoding="utf-8") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2 and parts[1].lstrip("*") == name and parts[0] != digest:
                    raise RuntimeError(f"아티팩트 SHA256 불일치: {name}")
    return digest


# ── gateway ─────────────────────────────────────────────────────────────────

def _gateway_internal_url() -> str:
    return os.getenv("AGENT_T_GATEWAY_INTERNAL_URL") or "http://agent-t-gateway:8330"


def _service_principal() -> SimpleNamespace:
    """설치 Job 용 단기 토큰 발급 주체 (gateway 는 서명·type·exp 만 검증)."""
    return SimpleNamespace(id=0, email="agent-t-installer@system", role="admin")


async def fetch_snapshot(system_id: int, user) -> list[dict]:
    """gateway `GET /t/v1/snapshot?system_ids=<id>` → instances 목록. 실패 시 빈 목록."""
    from auth import create_access_token

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{_gateway_internal_url()}/t/v1/snapshot",
                params={"system_ids": str(system_id)},
                headers={"Authorization": f"Bearer {create_access_token(user)}"},
            )
        resp.raise_for_status()
        return resp.json().get("instances", []) or []
    except Exception as exc:
        logger.debug("agent-t gateway snapshot 조회 실패: %s", exc)
        return []


def find_instance(
    instances: list[dict], system_id: int, instance_role: str, host: str | None = None
) -> dict | None:
    """host 를 주면 gateway 스냅샷의 host 까지 일치해야 한다 (다른 서버의 같은 role 오인 방지)."""
    for inst in instances:
        if inst.get("system_id") != system_id or inst.get("instance_role") != instance_role:
            continue
        if host is not None and inst.get("host") != host:
            continue
        return inst
    return None


def last_seen_age(last_seen) -> tuple[str | None, float | None]:
    """gateway last_seen(epoch ms/s 또는 ISO 문자열) → (UTC ISO 문자열, 경과 초)."""
    if last_seen in (None, "", 0):
        return None, None
    try:
        if isinstance(last_seen, (int, float)):
            ts = last_seen / 1000.0 if last_seen > 1e11 else float(last_seen)
        else:
            ts = datetime.fromisoformat(str(last_seen).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None, None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(), time.time() - ts


_FRESH_WITHIN_S = 30


def is_fresh(inst: dict | None) -> bool:
    """gateway 는 유휴 인스턴스를 오래 보관하므로, last_seen 이 30초 이내일 때만 수신 중으로 본다."""
    if not inst:
        return False
    _, age = last_seen_age(inst.get("last_seen"))
    return age is not None and age <= _FRESH_WITHIN_S


# ── 영구 적용 ────────────────────────────────────────────────────────────────

def _env_file_content(service_type: str, javaagent: str) -> str:
    if service_type == "systemd":  # EnvironmentFile 형식
        return f"JAVA_OPTS=-javaagent:{javaagent.split(':', 1)[1]}\n"
    return (
        "#!/bin/sh\n# agent-t-env.sh — admin-api 자동 생성 (수동 편집 금지)\n"
        f'export JAVA_OPTS="${{JAVA_OPTS}} {javaagent}"\n'
    )


def _jeus_server_name(info: dict, jvm_match: str) -> str:
    name = info.get("server_name") or re.sub(r"^-D", "", jvm_match).split("=")[0]
    return name.strip()


def default_instance_role(info: dict, host: str) -> str:
    """instance_role 미지정 시 기본값: jvm_match 의 JEUS 서버명(`-Dsic_server1` → `sic_server1`),
    안전하지 않은 값이면 호스트 짧은 이름(IP 는 그대로)."""
    cand = _jeus_server_name(info, (info.get("jvm_match") or "").strip())
    if _SAFE_VALUE_RE.fullmatch(cand):
        return cand
    return host if re.fullmatch(r"[\d.]+", host or "") else (host or "").split(".")[0]


def validate_gateway_url(url: str) -> str:
    """WAS 에서 접근 가능한 gateway URL 인지 확인한다 (컨테이너 내부 이름·루프백은 WAS 에서 닿지 않는다)."""
    from urllib.parse import urlparse

    url = (url or "").strip()
    if not url:
        raise ValueError(
            "AGENT_T_GATEWAY_URL 이 비어 있습니다. WAS 에서 접근 가능한 gateway 주소(예: http://<server-a-ip>:8330)를 설정하세요."
        )
    if not re.fullmatch(r"https?://\S+", url):
        raise ValueError(f"AGENT_T_GATEWAY_URL 형식이 올바르지 않습니다: {url[:80]!r}")
    host = (urlparse(url).hostname or "").lower()
    if not host or host in _UNREACHABLE_GATEWAY_HOSTS:
        raise ValueError(
            f"AGENT_T_GATEWAY_URL 의 호스트 {host!r} 는 WAS 에서 접근할 수 없습니다. "
            "Server A 의 IP/호스트명으로 설정하세요 (예: http://<server-a-ip>:8330)."
        )
    return url


# ── JVM 후보 판별 ────────────────────────────────────────────────────────────

_WORD_CHARS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_")
_HELPER_EXES = frozenset({"ps", "grep", "egrep", "fgrep", "ssh", "sshd", "sh", "bash", "zsh", "dash", "sudo", "su"})
_SERVER_NAME_RE = re.compile(r"-D(?:jeus\.server\.name|weblogic\.Name|server\.name)=(\S+)")
_CANDIDATE_CMD_MAX = 500
_CANDIDATES_MARKER = "[JVM_CANDIDATES] "
JOB_STATUS_NEEDS_TARGET = "needs_target"


def _has_boundary_match(args: str, jvm_match: str) -> bool:
    """jvm_match 가 args 안에 경계를 지켜 등장하는지 판정한다.

    오른쪽: 다음 문자가 [A-Za-z0-9_] 가 아니거나 끝 (sic_server1 이 sic_server10 에 걸리지 않게).
    왼쪽: 이전 문자가 [A-Za-z0-9_] 가 아니거나 시작, 또는 바로 앞이 `-D`
    (sic_server1 이 -Dsic_server1 에 걸리게). jvm_match 의 해당 쪽 끝 문자가 단어 문자가 아니면
    (예: `-Dfoo=`, `/opt/x/`) 그 쪽 경계는 이미 만족한 것으로 본다.
    """
    n = len(jvm_match)
    check_left = jvm_match[0] in _WORD_CHARS
    check_right = jvm_match[-1] in _WORD_CHARS
    start = args.find(jvm_match)
    while start != -1:
        end = start + n
        right_ok = (not check_right) or end >= len(args) or args[end] not in _WORD_CHARS
        left_ok = (
            (not check_left) or start == 0 or args[start - 1] not in _WORD_CHARS
            or args[max(0, start - 2):start] == "-D"
        )
        if left_ok and right_ok:
            return True
        start = args.find(jvm_match, start + 1)
    return False


def filter_jvm_candidates(ps_out: str, jvm_match: str) -> list[dict]:
    """`ps -eo pid,user,args` 출력에서 jvm_match 에 경계 일치하는 java 프로세스만 후보로 추린다.

    ps/grep/ssh/sh 등 탐색 명령 자신과 java 가 아닌 프로세스는 제외한다.
    반환: [{"pid": int, "user": str, "command": str(전체 명령행), "server_name": str|None}]
    """
    result: list[dict] = []
    if not jvm_match:
        return result
    for ln in ps_out.splitlines():
        parts = ln.split(None, 2)
        if len(parts) < 3 or not parts[0].isdigit():
            continue
        pid, user, args = int(parts[0]), parts[1], parts[2].strip()
        exe = args.split(None, 1)[0].rsplit("/", 1)[-1]
        if exe in _HELPER_EXES or "java" not in args.lower():
            continue
        if not _has_boundary_match(args, jvm_match):
            continue
        m = _SERVER_NAME_RE.search(args)
        result.append({
            "pid": pid, "user": user,
            "command": args,
            "server_name": m.group(1) if m else None,
        })
    return result


# ── 설치 Job ─────────────────────────────────────────────────────────────────

async def run_install(job_id: str, agent: AgentInstance, session: dict, target_pid: int | None = None) -> None:
    """target_pid: 1회성 대상 PID (후보가 2개 이상일 때 사용자가 선택). label_info 에 저장하지 않는다."""
    from database import AsyncSessionLocal

    def _log(msg: str) -> None:
        _live_jobs[job_id]["logs"] += f"{msg}\n"

    async def _finish(status: str, error: str | None = None, agent_status: str | None = None) -> None:
        async with AsyncSessionLocal() as db:
            if agent_status:
                await db.execute(
                    update(AgentInstance).where(AgentInstance.id == agent.id).values(status=agent_status)
                )
            await db.execute(
                update(AgentInstallJob)
                .where(AgentInstallJob.job_id == job_id)
                .values(
                    status=status,
                    logs=_live_jobs[job_id]["logs"],
                    error=error,
                    updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
                )
            )
            await db.commit()

    try:
        info = json.loads(agent.label_info or "{}")
        jvm_match = (info.get("jvm_match") or "").strip()
        if not jvm_match:
            raise ValueError("jvm_match 가 필요합니다 (대상 JVM 식별 문자열, 예: -Dsic_server1).")
        service_type = info.get("service_type", "standalone")
        service_path = _validate_path(info.get("service_path", ""), "service_path")
        install_dir = _validate_path(info.get("install_dir") or "~/agent-t", "install_dir")
        instance_role = info.get("instance_role") or default_instance_role(info, agent.host)
        immediate = info.get("immediate", True) is not False
        permanent = info.get("permanent", True) is not False
        kill_switch_on = info.get("enabled", True) is False  # 킬 스위치: 에이전트는 떠 있어도 수집하지 않는다
        capture_properties(info)  # 잘못된 capture_params_* 는 접속·업로드 전에 실패시킨다

        if service_type == "systemd" and permanent and session["username"] != "root":
            raise PermissionError(
                "systemd 시스템 유닛은 root SSH 계정이 필요합니다. 다른 service_type 을 사용하세요."
            )

        async with AsyncSessionLocal() as db:
            sys_obj = (await db.execute(select(System).where(System.id == agent.system_id))).scalar_one_or_none()
        sys_name = sys_obj.system_name if sys_obj else "unknown"
        # properties 줄바꿈 주입 방지 — 원격 작업 전에 검증
        for field, value in (("instance_role", instance_role), ("system_name", sys_name)):
            if not _SAFE_VALUE_RE.fullmatch(str(value)):
                raise ValueError(f"{field}: 영문·숫자·_.- 만 허용되며 1~100자여야 합니다 ({str(value)[:40]!r})")

        gateway_url = validate_gateway_url(os.getenv("AGENT_T_GATEWAY_URL", ""))

        async with AsyncSessionLocal() as db:
            others = (await db.execute(
                select(AgentInstance).where(
                    AgentInstance.system_id == agent.system_id,
                    AgentInstance.agent_type == "agent_t",
                    AgentInstance.id != agent.id,
                )
            )).scalars().all()
        for other in others:
            try:
                other_role = (json.loads(other.label_info or "{}") or {}).get("instance_role")
            except (TypeError, ValueError, AttributeError):
                continue
            if other_role == instance_role:
                raise ValueError(
                    f"같은 시스템에 instance_role '{instance_role}' 인 Agent-T 가 이미 있습니다 (agent {other.id}). "
                    "label_info.instance_role 을 다르게 지정하세요."
                )

        install_dir = await _expand_tilde(session, install_dir)
        service_path = await _expand_tilde(session, service_path)

        # [2] 대상 JVM 탐색
        _log(f"[1/7] 대상 JVM 탐색: {jvm_match}")
        code, out, err = await _exec(
            session, f"ps -eo pid,user,args | grep -F -- {shlex.quote(jvm_match)} | grep -v grep"
        )
        candidates = filter_jvm_candidates(out, jvm_match)
        if target_pid is not None:
            chosen = next((c for c in candidates if c["pid"] == target_pid), None)
            if chosen is None:
                raise RuntimeError(
                    f"선택한 PID {target_pid} 는 더 이상 jvm_match({jvm_match})와 일치하는 JVM 이 아닙니다 "
                    "(재기동되었을 수 있습니다). 설치를 다시 실행해 대상을 선택하세요."
                )
        elif not candidates:
            raise RuntimeError(f"jvm_match 와 일치하는 JVM 프로세스가 0개입니다: {jvm_match}")
        elif len(candidates) > 1:
            _log(f"    jvm_match 와 일치하는 JVM 이 {len(candidates)}개입니다. 설치할 JVM 을 선택하세요.")
            for c in candidates:
                _log(f"      PID={c['pid']} 계정={c['user']} {c['server_name'] or ''}".rstrip())
            # 로그(화면 표시)에는 명령행을 잘라서 남긴다 — 판별(-javaagent 탐지 등)은 전체 명령행으로 한다
            shown = [{**c, "command": c["command"][:_CANDIDATE_CMD_MAX]} for c in candidates]
            _log(_CANDIDATES_MARKER + json.dumps(shown, ensure_ascii=False))
            await _finish(JOB_STATUS_NEEDS_TARGET)  # 에이전트 상태는 바꾸지 않는다 (설치 시도 전)
            _live_jobs[job_id]["status"] = JOB_STATUS_NEEDS_TARGET  # DB 커밋 후 노출 (UI 가 즉시 refetch 하므로)
            return
        else:
            chosen = candidates[0]
        pid, proc_user, proc_args = str(chosen["pid"]), chosen["user"], chosen["command"]
        _log(f"    PID={pid} 계정={proc_user}")
        existing_agents = re.findall(r"-javaagent:\S+", proc_args)
        if existing_agents:
            _log(f"    기존 -javaagent: {', '.join(existing_agents)}")
        if any("opentelemetry" in a.lower() for a in existing_agents):
            _log("[경고] 같은 JVM 에 OpenTelemetry agent 가 있습니다. 중복 계측을 피하려면 제거하세요.")

        # [3] JDK 판별
        code, exe_out, _ = await _exec(session, f"readlink /proc/{pid}/exe")
        java_bin = exe_out.strip()
        if code != 0 or not java_bin:
            raise RuntimeError(f"java 실행 파일 경로를 확인하지 못했습니다 (/proc/{pid}/exe)")
        _, ver_out, _ = await _exec(session, f"{shlex.quote(java_bin)} -version 2>&1")
        major = parse_java_major(ver_out)
        if major <= 5:
            raise RuntimeError(f"지원하지 않는 JDK 입니다 (major={major}). JDK 6 이상이 필요합니다.")
        jar_name = "agent-t-legacy.jar" if major <= 7 else "agent-t.jar"
        _log(f"[2/7] JDK {major} ({java_bin}) → {jar_name} 선택")

        # JEUS 영구 적용 사전 검증 — 업로드·attach 전에 설정 오류를 확정한다
        jeus_ctx = None
        if permanent and service_type == "jeus":
            jeus_ctx = await _jeus_precheck(
                session, (session["host"], session["port"], session["username"], session["password"]),
                info, jvm_match, service_path, f"-javaagent:{install_dir}/{jar_name}",
            )

        # [4] 업로드
        jar_bytes = _read_artifact(jar_name)
        attacher_bytes = _read_artifact(_ATTACHER_JAR)
        sums = (
            f"{_verify_against_sums(jar_name, jar_bytes)}  {jar_name}\n"
            f"{_verify_against_sums(_ATTACHER_JAR, attacher_bytes)}  {_ATTACHER_JAR}\n"
        )
        conn = (session["host"], session["port"], session["username"], session["password"])
        q_dir = shlex.quote(install_dir)
        props_path = f"{install_dir}/agent-t.properties"
        q_props = shlex.quote(props_path)
        tmp_props_path = f"{props_path}.tmp"
        q_tmp_props = shlex.quote(tmp_props_path)

        # 재실행(jeus_confirm 등) 시 실행 중 에이전트의 토큰을 바꾸지 않는다
        token = None
        if info.get("agent_token_sha256"):
            existing_props = await asyncio.to_thread(ssh_read_file, *conn, props_path)
            for ln in (existing_props or "").splitlines():
                if ln.startswith("agent.token="):
                    cand = ln.split("=", 1)[1].strip()
                    if hashlib.sha256(cand.encode("utf-8")).hexdigest() == info["agent_token_sha256"]:
                        token = cand
                        _log("    기존 토큰 유지 (재실행)")
        if token is None:
            token = secrets.token_urlsafe(32)
        token_sha = hashlib.sha256(token.encode("utf-8")).hexdigest()
        properties = (
            f"gateway.url={gateway_url}\n"
            f"agent.token={token}\n"
            f"instance.role={instance_role}\n"
            f"system.name={sys_name}\n"
            f"log.dir={install_dir}/logs\n"
            f"{capture_properties(info)}"
        )
        _log(f"[3/7] 설치 디렉터리 생성 및 업로드: {install_dir}")
        code, _, err = await _exec(session, f"mkdir -p {q_dir}/logs")
        if code != 0:
            raise RuntimeError(f"설치 디렉터리 생성 실패: {err.strip()}")
        # 토큰 파일은 임시 파일(.tmp)에 600 으로 만들어 채우고 검증한 뒤 mv 로 교체한다.
        # 실행 중인 에이전트가 읽는 기존 properties 는 업로드가 성공하기 전까지 건드리지 않는다.
        code, _, err = await _exec(session, f"umask 077; : > {q_tmp_props}; chmod 600 {q_tmp_props}")
        if code != 0:
            raise RuntimeError(f"agent-t.properties 임시 파일 생성 실패: {err.strip()}")
        # jar 는 실행 중인 JVM 이 열어 둔 파일일 수 있어 덮어쓰지 않는다: .tmp 업로드 후 mv -f (원자적 rename,
        # 실행 중 JVM 은 이전 inode 를 계속 사용). 업로드 직후 mv 하고, sha256 검증은 최종 파일에 대해 수행한다.
        for name, data in ((jar_name, jar_bytes), (_ATTACHER_JAR, attacher_bytes)):
            final_path = f"{install_dir}/{name}"
            await asyncio.to_thread(ssh_put_binary, *conn, f"{final_path}.tmp", data)
            code, _, err = await _exec(session, f"mv -f {shlex.quote(final_path + '.tmp')} {shlex.quote(final_path)}")
            if code != 0:
                raise RuntimeError(f"{name} 교체 실패: {err.strip()}")
        await asyncio.to_thread(ssh_put_file, *conn, f"{install_dir}/SHA256SUMS", sums)
        await asyncio.to_thread(ssh_put_file, *conn, tmp_props_path, properties)
        code, mode_out, err = await _exec(session, f"stat -c %a {q_tmp_props}")
        if code != 0 or mode_out.strip() != "600":
            await _exec(session, f"rm -f {q_tmp_props}")
            raise RuntimeError(
                f"agent-t.properties 권한이 600 이 아닙니다 ({mode_out.strip() or err.strip() or '확인 실패'})"
            )
        code, _, err = await _exec(session, f"mv -f {q_tmp_props} {q_props}")
        if code != 0:
            raise RuntimeError(f"agent-t.properties 교체 실패: {err.strip()}")
        code, _, err = await _exec(session, f"cd {q_dir} && sha256sum -c SHA256SUMS")
        if code != 0:
            raise RuntimeError(f"SHA256 검증 실패: {err.strip()}")
        _log("    SHA256 검증 완료")

        # 토큰 해시 저장 (평문은 원격 properties 에만 존재)
        new_info = {
            **info, "instance_role": instance_role,
            "agent_token_sha256": token_sha, "jdk_major": major, "jar": jar_name,
        }
        async with AsyncSessionLocal() as db:
            await db.execute(
                update(AgentInstance).where(AgentInstance.id == agent.id).values(label_info=json.dumps(new_info))
            )
            await db.commit()
        agent.label_info = json.dumps(new_info)

        # [5] 즉시 적용
        javaagent = f"-javaagent:{install_dir}/{jar_name}"
        attached = False
        already_live = False
        foreign_loaded = False
        if immediate:
            _log("[4/7] 즉시 적용(attach) 사전 점검")
            _, chk_out, chk_err = await _exec(
                session, f"{shlex.quote(java_bin)} -jar {q_dir}/{_ATTACHER_JAR} --check {pid} 2>&1"
            )
            check_lines = [ln.strip() for ln in f"{chk_out}\n{chk_err}".splitlines() if ln.strip()]
            precheck = next((ln for ln in check_lines if ln.startswith("PRECHECK:")), None)
            loaded = next((ln[len("LOADED:"):] for ln in check_lines if ln.startswith("LOADED:")), None)
            fresh = is_fresh(find_instance(
                await fetch_snapshot(agent.system_id, _service_principal()), agent.system_id, instance_role, agent.host
            ))
            if loaded is not None:
                # 대상 JVM 에 Agent-T 가 이미 로드됨 — AgentMain 은 중복 로드를 조용히 무시하므로 attach 하지 않는다.
                # 마커 값이 install_dir 의 jar 경로면 같은 설치, 그 외(다른 디렉터리·구버전 "true")는 재기동 필요.
                if os.path.dirname(os.path.normpath(loaded)) == os.path.normpath(install_dir):
                    _log(f"    이미 로드됨 — 대상 JVM 에 {loaded} 가 로드되어 있어 attach 를 건너뜁니다.")
                    already_live = fresh
                else:
                    foreign_loaded = True
                    _log(
                        f"    다른 경로의 Agent-T 가 이미 로드되어 있습니다 ({loaded}) — attach 하지 않습니다. "
                        f"{install_dir} 의 에이전트는 WAS 재기동 후 적용됩니다 (영구 적용만 진행)."
                    )
            elif fresh:
                already_live = True
                _log("    이미 적용됨 — gateway 에서 인스턴스가 확인되어 attach 를 건너뜁니다.")
            elif precheck:
                _log(f"    사전 점검 불충족 ({precheck}) — attach 를 건너뜁니다. 재기동 후 적용됩니다 (영구 적용만 진행).")
            elif "OK" in check_lines:
                code, att_out, att_err = await _exec(
                    session,
                    f"{shlex.quote(java_bin)} -jar {q_dir}/{_ATTACHER_JAR} {pid} {q_dir}/{jar_name} 2>&1",
                )
                if code == 0:
                    attached = True
                    _log("    attach 완료 — 계측 시작")
                else:
                    _log(f"    attach 실패(exit={code}): {(att_out + att_err).strip()[:300]} — 재기동 후 적용됩니다.")
            else:
                _log(f"    사전 점검 결과를 해석하지 못했습니다: {' '.join(check_lines)[:200]} — 재기동 후 적용됩니다.")
        else:
            _log("[4/7] 즉시 적용 생략 (immediate=false)")

        # [6] 영구 적용
        needs_confirm = False
        if permanent:
            _log(f"[5/7] 영구 적용: service_type={service_type}")
            env_content = _env_file_content(service_type, javaagent)
            if service_type == "jeus":
                needs_confirm = await _apply_jeus(session, conn, info, javaagent, jeus_ctx, _log)
            else:
                await asyncio.to_thread(ssh_put_file, *conn, f"{install_dir}/{_ENV_FILE}", env_content)
                await _apply_inject(session, conn, service_type, service_path, install_dir, sys_name, _log)
        else:
            _log("[5/7] 영구 적용 생략 (permanent=false)")

        # [7] 확인
        agent_status = "installed"
        if kill_switch_on:
            agent_status = "stopped"
            _log("[6/7] 킬 스위치(enabled=false) 상태 — 수집 비활성. gateway 수신 확인을 생략하고 stopped 로 표시합니다.")
        elif foreign_loaded:
            _log("[6/7] 다른 경로의 에이전트가 로드되어 있어 이 설치본은 수신 확인 생략 (WAS 재기동 후 적용)")
        elif already_live:
            agent_status = "running"
        elif attached:
            _log(f"[6/7] gateway 수신 확인 대기 (최대 {_CONFIRM_TIMEOUT_S}초)")
            deadline = time.monotonic() + _CONFIRM_TIMEOUT_S
            while True:
                inst = find_instance(
                    await fetch_snapshot(agent.system_id, _service_principal()), agent.system_id, instance_role, agent.host
                )
                if is_fresh(inst):
                    agent_status = "running"
                    _log("    gateway 에서 인스턴스 수신 확인 → running")
                    break
                if time.monotonic() >= deadline:
                    _log(f"    {_CONFIRM_TIMEOUT_S}초 내 수신 확인 실패 — installed 상태로 유지합니다.")
                    break
                await asyncio.sleep(_CONFIRM_INTERVAL_S)
        else:
            _log("[6/7] 즉시 적용되지 않아 수신 확인 생략 (다음 WAS 재기동부터 적용)")

        if needs_confirm:
            _log("[확인 필요] domain.xml 변경 diff 를 검토한 뒤 jeus_confirm=true 로 다시 설치하세요.")
        _log("[완료] Agent-T 설치 완료.")
        await _finish("done", agent_status=agent_status)
        _live_jobs[job_id]["status"] = "done"  # DB 커밋 후 노출 (UI 가 즉시 refetch 하므로)

    except Exception as exc:
        err_msg = str(exc)
        _log(f"[오류] {err_msg}")
        _live_jobs[job_id]["error"] = err_msg
        async with AsyncSessionLocal() as db2:
            await db2.execute(
                update(AgentInstance).where(AgentInstance.id == agent.id).values(status="failed")
            )
            await db2.execute(
                update(AgentInstallJob)
                .where(AgentInstallJob.job_id == job_id)
                .values(
                    status="failed",
                    logs=_live_jobs[job_id]["logs"],
                    error=err_msg,
                    updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
                )
            )
            await db2.commit()
        _live_jobs[job_id]["status"] = "failed"  # DB 커밋 후 노출 (UI 가 즉시 refetch 하므로)


async def _apply_inject(session, conn, service_type, service_path, install_dir, sys_name, _log) -> None:
    inject_path = _get_inject_path(service_type, service_path, install_dir, sys_name)
    if not inject_path:
        _log("    inject 파일 경로를 결정할 수 없어 영구 적용을 건너뜁니다.")
        return
    parent = inject_path.rpartition("/")[0]
    if parent:
        await _exec(session, f"mkdir -p {shlex.quote(parent)}")

    if service_type == "tomcat":
        existing = await asyncio.to_thread(ssh_read_file, *conn, inject_path)
        content = _build_tomcat_setenv(existing or "", install_dir, _ENV_FILE)
        _log(f"    {inject_path} 마커 블록 갱신 (기존 설정 보존)")
    else:
        content = _build_service_env_inject(service_type, service_path, install_dir, _ENV_FILE)
        _log(f"    {inject_path} 생성")
    await asyncio.to_thread(ssh_put_file, *conn, inject_path, content)

    if service_type == "systemd":
        _log("→ sudo systemctl daemon-reload && sudo systemctl restart <unit> (운영 일정에 맞춰 재기동)")
    elif service_type == "standalone":
        _log(f"→ 기존 기동 명령을 {inject_path} 로 감싸 실행하세요 (자동 로드 없음).")
    else:
        _log("→ 다음 WAS 재기동부터 기동 옵션으로 적용됩니다.")


async def _jeus_precheck(session, conn, info, jvm_match, service_path, javaagent) -> tuple[str, str, str]:
    """(domain_xml 경로, 서버명, 원문). service_path·서버명·domain.xml 내 서버 존재를 검증한다."""
    if not service_path:
        raise ValueError("JEUS 영구 적용에는 service_path(도메인 디렉터리)가 필요합니다.")
    server_name = _jeus_server_name(info, jvm_match)
    if not server_name or not _SAFE_VALUE_RE.fullmatch(server_name):
        raise ValueError(f"jvm_match 에서 JEUS 서버명을 알 수 없습니다. label_info.server_name 을 지정하세요 ({jvm_match!r}).")
    domain_xml = f"{service_path}/config/domain.xml"
    xml_text = await asyncio.to_thread(ssh_read_file, *conn, domain_xml)
    if xml_text is None:
        raise FileNotFoundError(f"domain.xml 을 찾을 수 없습니다: {domain_xml}")
    jeus_domain.add_javaagent(xml_text, server_name, javaagent)  # 서버 부재·XML 오류면 ValueError
    return domain_xml, server_name, xml_text


async def _apply_jeus(session, conn, info, javaagent, ctx, _log) -> bool:
    """JEUS domain.xml 반자동 주입. 확인 필요(미적용)면 True."""
    domain_xml, server_name, xml_text = ctx
    new_xml, diff = jeus_domain.add_javaagent(xml_text, server_name, javaagent)
    if not diff:
        _log(f"    domain.xml 의 {server_name} 에 이미 agent-t 가 등록되어 있습니다 (변경 없음).")
        return False
    _log(f"    domain.xml 변경 미리보기 (서버 {server_name}):\n{diff}")
    if info.get("jeus_confirm") is not True:
        _log("    jeus_confirm 이 true 가 아니므로 domain.xml 을 변경하지 않았습니다.")
        return True
    backup = f"{domain_xml}_{datetime.now(_KST).strftime('%Y%m%d')}_agentt"
    code, _, err = await _exec(session, f"cp -p {shlex.quote(domain_xml)} {shlex.quote(backup)}")
    if code != 0:
        raise RuntimeError(f"domain.xml 백업 실패: {err.strip()}")
    _log(f"    백업: {backup}")
    await asyncio.to_thread(ssh_put_file, *conn, domain_xml, new_xml)
    _log("    domain.xml 반영 완료. 도메인 관리 서버(config.lck)가 다시 쓸 수 있으니 jeusadmin 으로 설정 동기화를 확인하세요.")
    return False
