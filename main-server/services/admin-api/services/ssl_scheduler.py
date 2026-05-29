"""
SSL 인증서 자동 갱신 배치 — 매일 02:00 KST
1. 전체 서버 openssl 폴링 → cert_snapshots 갱신
2. days_left < 30 서버의 유니크 도메인에 대해 acme.sh 갱신
3. 갱신된 도메인 사용 서버 전체 paramiko 배포
4. 이상 감지 + Teams 알림
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from database import AsyncSessionLocal
from models import SslServer, SslDeployment, SslCertSnapshot
from services import ssl_monitor, ssl_issuer, ssl_deployer, ssl_analyzer

logger = logging.getLogger(__name__)

_KST = timezone(timedelta(hours=9))


async def _get_unique_domains_needing_renewal(threshold_days: int = 30) -> set[str]:
    """days_left < threshold 서버에서 유니크 도메인 집합 추출"""
    async with AsyncSessionLocal() as db:
        # 서버별 최신 스냅샷 서브쿼리
        from sqlalchemy import func
        from sqlalchemy.orm import aliased

        subq = (
            select(
                SslCertSnapshot.server_id,
                func.max(SslCertSnapshot.checked_at).label("latest_at"),
            ).group_by(SslCertSnapshot.server_id).subquery()
        )
        rows = (
            await db.execute(
                select(SslServer, SslCertSnapshot)
                .join(subq, SslServer.id == subq.c.server_id)
                .join(
                    SslCertSnapshot,
                    (SslCertSnapshot.server_id == subq.c.server_id)
                    & (SslCertSnapshot.checked_at == subq.c.latest_at),
                )
                .where(SslServer.status == "active")
                .where(SslServer.network_zone == "internal")
            )
        ).all()

        domains: set[str] = set()
        for server, snap in rows:
            if snap.days_left is not None and snap.days_left < threshold_days:
                if server.cert_type == "wildcard":
                    domains.add("*.shinsegae.com")
                elif server.domain:
                    domains.add(server.domain)
        return domains


async def _get_servers_by_domain(domain: str) -> list[SslServer]:
    """해당 도메인을 사용하는 active 서버 목록"""
    async with AsyncSessionLocal() as db:
        if domain == "*.shinsegae.com":
            rows = (
                await db.execute(
                    select(SslServer)
                    .where(SslServer.status == "active")
                    .where(SslServer.cert_type == "wildcard")
                    .where(SslServer.network_zone == "internal")
                )
            ).scalars().all()
        else:
            rows = (
                await db.execute(
                    select(SslServer)
                    .where(SslServer.status == "active")
                    .where(SslServer.cert_type == "individual")
                    .where(SslServer.domain == domain)
                    .where(SslServer.network_zone == "internal")
                )
            ).scalars().all()
        return list(rows)


async def run_ssl_daily_batch() -> None:
    """SSL 자동 갱신 배치 1회 실행"""
    logger.info("SSL 배치 시작")

    # 1. 전체 서버 openssl 폴링
    results = await ssl_monitor.check_all_servers()
    logger.info("폴링 완료: %d개", len(results))

    # 2. 갱신 필요 도메인 추출
    domains_to_renew = await _get_unique_domains_needing_renewal(threshold_days=30)
    if not domains_to_renew:
        logger.info("갱신 필요 도메인 없음")
        await ssl_analyzer.analyze_and_notify()
        return

    logger.info("갱신 대상 도메인: %s", domains_to_renew)

    # 3. 도메인별 acme.sh 1회 실행
    for domain in domains_to_renew:
        res = await ssl_issuer.issue_or_renew(domain)
        if res["rc"] != 0:
            logger.error("acme.sh 갱신 실패 (domain=%s): %s", domain, res["output"][-300:])
        else:
            logger.info("acme.sh 갱신 성공: %s", domain)

    # 4. 갱신된 도메인 사용 서버 전체 배포
    for domain in domains_to_renew:
        servers = await _get_servers_by_domain(domain)
        for server in servers:
            try:
                result = await ssl_deployer.deploy(server, ws_cb=None)
                async with AsyncSessionLocal() as db:
                    dep = SslDeployment(
                        server_id=server.id,
                        trigger_type="auto_batch",
                        cert_type=server.cert_type,
                        status=result["status"],
                        duration_sec=round(result.get("duration_sec", 0), 2),
                        deploy_log=result.get("log", ""),
                    )
                    db.add(dep)
                    await db.commit()
                logger.info("배포 완료: %s → %s", server.host, result["status"])
            except Exception as e:
                logger.error("배포 실패 (server=%s): %s", server.host, e)

    # 5. 이상 감지 + Teams 알림
    await ssl_analyzer.analyze_and_notify()
    logger.info("SSL 배치 완료")


async def run_ssl_scheduler_loop() -> None:
    """백그라운드 루프 — lifespan에서 asyncio.create_task로 실행"""
    logger.info("SSL 스케줄러 시작 (매일 02:00 KST)")
    while True:
        try:
            now_kst = datetime.now(_KST)
            next_run = now_kst.replace(hour=2, minute=0, second=0, microsecond=0)
            if next_run <= now_kst:
                next_run += timedelta(days=1)
            wait_sec = (next_run - now_kst).total_seconds()
            logger.info("다음 SSL 배치: %s KST (%.0f초 후)", next_run.strftime("%Y-%m-%d %H:%M"), wait_sec)
            await asyncio.sleep(wait_sec)
            await run_ssl_daily_batch()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("SSL 배치 오류: %s", e, exc_info=True)
            await asyncio.sleep(60)
