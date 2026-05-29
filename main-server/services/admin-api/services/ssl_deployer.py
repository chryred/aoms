"""
paramiko 배포 엔진 — SFTP 인증서 복사 + SSH 웹서버 reload
- webtob: wscfl 컴파일 → wsadmin reconfig
- nginx: nginx -t → systemctl reload nginx
- apache: apachectl configtest → systemctl reload httpd
"""
import asyncio
import logging
import os
import time
from typing import Callable, Awaitable, Optional

import paramiko

logger = logging.getLogger(__name__)

CERT_BASE        = os.getenv("STEP_CA_CERT_DIR", "/app/ssl/certs")
DEPLOY_KEY_PATH  = os.getenv("SSL_DEPLOY_KEY_PATH", "/app/secrets/ssl/deploy_key")


class DeployError(Exception):
    pass


WEB_TEMPLATES = {
    "webtob": {
        "compile_cmd":   "{webtob_home}/bin/wscfl -i {config_file}",
        "reload_cmd":    "{webtob_home}/bin/wsadmin -c reconfig",
        "needs_compile": True,
    },
    "nginx": {
        "compile_cmd":   "nginx -t",
        "reload_cmd":    "systemctl reload nginx",
        "needs_compile": False,
    },
    "apache": {
        "compile_cmd":   "apachectl configtest",
        "reload_cmd":    "systemctl reload httpd",
        "needs_compile": False,
    },
    "lets_encrypt_http01": {
        "compile_cmd":   "",
        "reload_cmd":    "",
        "needs_compile": False,
    },
}


def _exec_ssh(ssh: paramiko.SSHClient, cmd: str) -> tuple[int, str]:
    _, stdout, stderr = ssh.exec_command(cmd)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode(errors="replace") + stderr.read().decode(errors="replace")
    return rc, out


def _fmt(template: str, server) -> str:
    return template.format(
        webtob_home=server.webtob_home or "",
        config_file=server.config_file or "",
        cert_dir=server.cert_dir or "",
        host=server.host,
    )


async def deploy(server, ws_cb: Optional[Callable[[str], Awaitable[None]]] = None) -> dict:
    """
    인증서를 SFTP로 복사하고 웹서버를 재로드한다.
    ws_cb: 진행 로그를 실시간으로 전달할 async callback (옵션)
    반환: {"status": "success"|"failed", "log": str, "duration_sec": float}
    """
    async def _log(msg: str):
        logger.info("[ssl_deploy][%s] %s", server.host, msg)
        if ws_cb:
            await ws_cb(msg)

    start = time.monotonic()
    log_lines: list[str] = []

    async def emit(msg: str):
        log_lines.append(msg)
        await _log(msg)

    # cert 소스 경로
    if server.cert_type == "wildcard":
        src_dir = f"{CERT_BASE}/wildcard"
    else:
        src_dir = f"{CERT_BASE}/{server.domain}"

    ssh_port = getattr(server, "ssh_port", 22) or 22
    try:
        pkey = await asyncio.to_thread(
            paramiko.RSAKey.from_private_key_file, DEPLOY_KEY_PATH
        )
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        await asyncio.to_thread(
            ssh.connect,
            server.host,
            port=ssh_port,
            username=server.account,
            pkey=pkey,
            timeout=15,
        )
    except Exception as e:
        await emit(f"SSH 연결 실패: {e}")
        return {"status": "failed", "log": "\n".join(log_lines), "duration_sec": time.monotonic() - start}

    try:
        # 1. 인증서 SFTP 복사
        cert_dir = server.cert_dir or "/etc/ssl"

        # 원격 cert_dir이 없으면 생성
        rc_mkdir, out_mkdir = await asyncio.to_thread(
            _exec_ssh, ssh, f"mkdir -p {cert_dir}"
        )
        if rc_mkdir != 0:
            raise DeployError(f"cert_dir 생성 실패 (rc={rc_mkdir}): {out_mkdir[:200]}")

        sftp = ssh.open_sftp()

        def _put_files():
            sftp.put(f"{src_dir}/fullchain.cer", f"{cert_dir}/fullchain.cer")
            sftp.put(f"{src_dir}/cert.key",      f"{cert_dir}/cert.key")
            sftp.close()

        await asyncio.to_thread(_put_files)
        await emit("인증서 복사 완료")

        tpl = WEB_TEMPLATES.get(server.web_type, {})
        if not tpl:
            await emit(f"알 수 없는 web_type: {server.web_type}")
            return {"status": "failed", "log": "\n".join(log_lines), "duration_sec": time.monotonic() - start}

        # lets_encrypt_http01 는 DMZ 자체 갱신 — 배포 불필요
        if server.web_type == "lets_encrypt_http01":
            await emit("DMZ 서버: 직접 배포 스킵 (자체 갱신)")
            return {"status": "success", "log": "\n".join(log_lines), "duration_sec": time.monotonic() - start}

        # 2. 컴파일 (webtob만)
        if tpl["needs_compile"]:
            cmd = _fmt(tpl["compile_cmd"], server)
            rc, out = await asyncio.to_thread(_exec_ssh, ssh, cmd)
            await emit(f"컴파일: rc={rc}\n{out[:300]}")
            if rc != 0:
                raise DeployError(f"컴파일 실패 (rc={rc}): {out[:200]}")

        # 3. reload
        rc, out = await asyncio.to_thread(_exec_ssh, ssh, _fmt(tpl["reload_cmd"], server))
        await emit(f"리로드: rc={rc}\n{out[:200]}")
        if rc != 0:
            raise DeployError(f"리로드 실패 (rc={rc}): {out[:200]}")

        # 4. SSL 응답 확인
        verify_cmd = (
            f"echo | openssl s_client -connect {server.host}:443 -brief 2>&1 | head -5"
        )
        rc_v, out_v = await asyncio.to_thread(_exec_ssh, ssh, verify_cmd)
        await emit("SSL 검증 완료" if rc_v == 0 else f"SSL 응답 확인 실패 (rc={rc_v})")

        status = "success" if rc_v == 0 else "failed"
        return {"status": status, "log": "\n".join(log_lines), "duration_sec": time.monotonic() - start}

    except DeployError as e:
        await emit(str(e))
        return {"status": "failed", "log": "\n".join(log_lines), "duration_sec": time.monotonic() - start}
    except Exception as e:
        await emit(f"배포 오류: {e}")
        return {"status": "failed", "log": "\n".join(log_lines), "duration_sec": time.monotonic() - start}
    finally:
        try:
            ssh.close()
        except Exception:
            pass


async def verify_key_auth(host: str, account: str, port: int = 22) -> None:
    """키 기반 접속 검증 (등록 후 확인용)"""
    pkey = await asyncio.to_thread(
        paramiko.RSAKey.from_private_key_file, DEPLOY_KEY_PATH
    )
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        await asyncio.to_thread(
            ssh.connect, host, port=port, username=account, pkey=pkey, timeout=10
        )
    finally:
        try:
            ssh.close()
        except Exception:
            pass
