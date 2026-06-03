"""
openssl s_client 폴링 → ssl_cert_snapshots 갱신
내부망/DMZ 서버 동일 로직 (포트 443)
"""
import asyncio
import logging
import re
from datetime import datetime, date, timezone, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import SslServer, SslCertSnapshot

logger = logging.getLogger(__name__)

_KST = timezone(timedelta(hours=9))

# openssl 날짜 포맷: "notAfter=Jun 15 12:00:00 2026 GMT"
_DATE_RE = re.compile(r"notAfter=(.+)")


def _parse_expiry(output: str) -> Optional[date]:
    m = _DATE_RE.search(output)
    if not m:
        return None
    try:
        dt = datetime.strptime(m.group(1).strip(), "%b %d %H:%M:%S %Y %Z")
        return dt.date()
    except ValueError:
        return None


async def check_server(server: SslServer) -> dict:
    """단일 서버 openssl 폴링 결과 반환"""
    # 주의: -brief 는 PEM 인증서 블록을 억제하므로 절대 사용하지 말 것.
    # 억제되면 뒤의 `openssl x509`가 빈 입력을 받아 days_left 가 조용히 null 이 된다
    # (OpenSSL 3.x / LibreSSL 공통). 기본 출력은 leaf 인증서 PEM 을 포함한다.
    # -servername: SNI 기반 vhost 에서 와일드카드/대상 인증서를 정확히 받기 위함.
    cmd = (
        f"echo | openssl s_client -connect {server.host}:443 "
        f"-servername {server.host} 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null"
    )
    try:
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=15)
        output = stdout.decode(errors="replace")
        expiry = _parse_expiry(output)
        today = datetime.now(_KST).date()
        days_left = (expiry - today).days if expiry else None
        return {
            "expiry_date": expiry,
            "days_left": days_left,
            "is_valid": expiry is not None and days_left is not None and days_left > 0,
        }
    except asyncio.TimeoutError:
        logger.warning("openssl timeout for %s", server.host)
        return {"expiry_date": None, "days_left": None, "is_valid": False}
    except Exception as e:
        logger.warning("openssl error for %s: %s", server.host, e)
        return {"expiry_date": None, "days_left": None, "is_valid": False}


async def check_all_servers(db: Optional[AsyncSession] = None) -> list[dict]:
    """모든 active 서버 폴링 후 cert_snapshots 저장"""
    close_db = db is None
    if db is None:
        db = AsyncSessionLocal()

    try:
        servers = (
            await db.execute(
                select(SslServer).where(SslServer.status == "active")
            )
        ).scalars().all()

        results = []
        for server in servers:
            info = await check_server(server)
            snap = SslCertSnapshot(
                server_id=server.id,
                expiry_date=info["expiry_date"],
                days_left=info["days_left"],
                is_valid=info["is_valid"],
            )
            db.add(snap)
            results.append({"server_id": server.id, "host": server.host, **info})

        await db.commit()
        logger.info("cert_snapshots 갱신 완료: %d개", len(results))
        return results
    finally:
        if close_db:
            await db.close()
