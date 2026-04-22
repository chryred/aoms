"""
SSH 세션 매니저 — 계정 정보 인메모리 관리 (DB 저장 금지)

- 세션 생성 시 UUID 토큰 발급, 5분 슬라이딩 TTL
- 작업마다 last_used 갱신 (슬라이딩)
- 백그라운드 정리 태스크: 60초 주기로 만료 세션 삭제
- Paramiko SSH 연결은 호출 시점에 생성 후 즉시 닫음 (상태 없는 단발성 연결)
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import paramiko

# 인메모리 세션 저장소 (DB 저장 금지)
_sessions: dict[str, dict] = {}
_SESSION_TTL_MINUTES = 5
_CLEANUP_INTERVAL_SECONDS = 60


def create_session(host: str, port: int, username: str, password: str) -> tuple[str, datetime]:
    """SSH 세션 등록. 토큰과 만료 시각을 반환한다."""
    token = str(uuid.uuid4())
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    _sessions[token] = {
        "host": host,
        "port": port,
        "username": username,
        "password": password,
        "last_used": now,
        "expires_at": now + timedelta(minutes=_SESSION_TTL_MINUTES),
    }
    return token, _sessions[token]["expires_at"]


def get_session(token: str) -> Optional[dict]:
    """세션 조회. 만료되었거나 없으면 None."""
    entry = _sessions.get(token)
    if entry is None:
        return None
    if datetime.now(timezone.utc).replace(tzinfo=None) > entry["expires_at"]:
        _sessions.pop(token, None)
        return None
    # 슬라이딩 TTL 갱신
    entry["last_used"] = datetime.now(timezone.utc).replace(tzinfo=None)
    entry["expires_at"] = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=_SESSION_TTL_MINUTES)
    return entry


def delete_session(token: str) -> bool:
    return _sessions.pop(token, None) is not None


def _cleanup_expired():
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    expired = [t for t, e in _sessions.items() if now > e["expires_at"]]
    for t in expired:
        _sessions.pop(t, None)


async def run_cleanup_loop():
    """lifespan에서 실행할 백그라운드 정리 루프."""
    while True:
        await asyncio.sleep(_CLEANUP_INTERVAL_SECONDS)
        _cleanup_expired()


# ── Paramiko SSH 실행 헬퍼 ──────────────────────────────────────────────────

class SSHError(Exception):
    pass


def _ssh_connect(host: str, port: int, username: str, password: str) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            timeout=10,
            allow_agent=False,
            look_for_keys=False,
        )
    except Exception as exc:
        raise SSHError(f"SSH 연결 실패 ({host}:{port}): {exc}") from exc
    return client


def ssh_exec(host: str, port: int, username: str, password: str, command: str) -> tuple[int, str, str]:
    """SSH 명령 실행 → (exit_code, stdout, stderr). 동기 함수 — asyncio.to_thread로 호출."""
    client = _ssh_connect(host, port, username, password)
    try:
        _, stdout, stderr = client.exec_command(command, timeout=30)
        exit_code = stdout.channel.recv_exit_status()
        return exit_code, stdout.read().decode("utf-8", errors="replace"), stderr.read().decode("utf-8", errors="replace")
    finally:
        client.close()


def ssh_put_file(host: str, port: int, username: str, password: str, remote_path: str, content: str) -> None:
    """파일 내용을 원격 경로에 쓴다. 동기 함수 — asyncio.to_thread로 호출."""
    import io
    client = _ssh_connect(host, port, username, password)
    try:
        sftp = client.open_sftp()
        buf = io.BytesIO(content.encode("utf-8"))
        sftp.putfo(buf, remote_path)
        sftp.close()
    finally:
        client.close()


def ssh_put_binary(host: str, port: int, username: str, password: str, remote_path: str, content: bytes) -> None:
    """바이너리 내용을 원격 경로에 SFTP로 업로드한다. 동기 함수 — asyncio.to_thread로 호출."""
    import io
    client = _ssh_connect(host, port, username, password)
    try:
        sftp = client.open_sftp()
        sftp.putfo(io.BytesIO(content), remote_path)
        sftp.close()
    finally:
        client.close()


def ssh_get_file(host: str, port: int, username: str, password: str, remote_path: str) -> str:
    """원격 파일 내용을 읽어 반환한다. 동기 함수 — asyncio.to_thread로 호출."""
    import io
    client = _ssh_connect(host, port, username, password)
    try:
        sftp = client.open_sftp()
        buf = io.BytesIO()
        sftp.getfo(remote_path, buf)
        sftp.close()
        return buf.getvalue().decode("utf-8", errors="replace")
    finally:
        client.close()


def ssh_read_file(host: str, port: int, username: str, password: str, remote_path: str) -> Optional[str]:
    """원격 파일 내용을 반환. 파일이 없으면 None. 동기 함수 — asyncio.to_thread로 호출.

    - 파일이 존재하지 않는 경우(FileNotFoundError/IOError)만 None을 반환한다.
    - 권한 오류 등 기타 예외는 그대로 re-raise 한다.
    """
    client = _ssh_connect(host, port, username, password)
    try:
        sftp = client.open_sftp()
        try:
            with sftp.open(remote_path, "r") as f:
                data = f.read()
        except FileNotFoundError:
            return None
        except IOError as exc:
            # paramiko는 "No such file" 케이스를 IOError로 올리기도 함
            msg = str(exc).lower()
            if "no such file" in msg or "not found" in msg:
                return None
            raise
        finally:
            sftp.close()
        if isinstance(data, bytes):
            return data.decode("utf-8", errors="replace")
        return data
    finally:
        client.close()
