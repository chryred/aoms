"""
Oracle DB 메트릭 수집 서비스

admin-api 백그라운드 루프로 실행되며, agent_type='oracle_db'인 AgentInstance를 주기적으로
조회해 Oracle DB에서 메트릭을 수집 후 prometheus_client Gauge에 업데이트한다.
Prometheus가 /metrics 엔드포인트를 scrape하면 이 값이 노출된다.

메트릭명은 log-analyzer PROMQL_MAP의 db_exporter 섹션과 호환된다.
"""

import asyncio
import json
import logging
import os
import time

import oracledb
from cryptography.fernet import Fernet
from prometheus_client import Gauge
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# 전역 기본 수집 주기 (에이전트별 label_info.collect_interval_secs 미설정 시 사용)
DEFAULT_INTERVAL = int(os.getenv("ORACLE_COLLECT_INTERVAL_SECS", "60"))

# 에이전트별 마지막 수집 시각 추적 { agent_id: last_collected_monotonic }
_last_collected: dict[int, float] = {}

# 루프 tick 간격 — 에이전트 주기 확인 최소 단위
_TICK = 10

# Gauge 정의 — db_exporter PROMQL_MAP 메트릭명과 일치
_GAUGES: dict[str, Gauge] = {
    "db_connections_active_percent": Gauge(
        "db_connections_active_percent",
        "Active sessions as percent of max sessions",
        ["system_name", "instance_role"],
    ),
    "db_connections_active": Gauge(
        "db_connections_active",
        "Active user session count",
        ["system_name", "instance_role"],
    ),
    "db_transactions_per_second": Gauge(
        "db_transactions_per_second",
        "User transactions per second",
        ["system_name", "instance_role"],
    ),
    "db_slow_queries_total": Gauge(
        "db_slow_queries_total",
        "Slow queries count (elapsed > 1s)",
        ["system_name", "instance_role"],
    ),
    "db_cache_hit_rate_percent": Gauge(
        "db_cache_hit_rate_percent",
        "Buffer cache hit rate percent",
        ["system_name", "instance_role"],
    ),
    "db_replication_lag_seconds": Gauge(
        "db_replication_lag_seconds",
        "DataGuard replication lag in seconds",
        ["system_name", "instance_role"],
    ),
}


def encrypt_password(plain: str) -> str:
    """Fernet AES 암호화. DB_ENCRYPTION_KEY 환경변수 필수."""
    key = os.environ["DB_ENCRYPTION_KEY"]
    return Fernet(key.encode()).encrypt(plain.encode()).decode()


def decrypt_password(encrypted: str) -> str:
    """Fernet 복호화."""
    key = os.environ["DB_ENCRYPTION_KEY"]
    return Fernet(key.encode()).decrypt(encrypted.encode()).decode()


def test_connection(host: str, port: int, service_name: str, username: str, password: str) -> None:
    """Oracle 연결 테스트. 실패 시 예외 발생."""
    conn = oracledb.connect(
        user=username,
        password=password,
        dsn=f"{host}:{port}/{service_name}",
    )
    conn.close()


def _collect_sync(
    host: str,
    port: int,
    service_name: str,
    username: str,
    decrypted_pw: str,
) -> dict:
    """
    Oracle DB 동기 수집. run_in_executor로 래핑해 event loop 블로킹 방지.
    반환: {메트릭명: float} dict
    """
    conn = oracledb.connect(
        user=username,
        password=decrypted_pw,
        dsn=f"{host}:{port}/{service_name}",
    )
    metrics: dict = {}
    try:
        cur = conn.cursor()

        # 활성 세션 수 / 세션 최대치
        cur.execute(
            "SELECT COUNT(*) FROM v$session WHERE status='ACTIVE' AND type='USER'"
        )
        active = cur.fetchone()[0]
        cur.execute("SELECT value FROM v$parameter WHERE name='sessions'")
        row = cur.fetchone()
        max_sess = int(row[0]) if row else 1
        metrics["db_connections_active"] = float(active)
        metrics["db_connections_active_percent"] = (
            round(active / max_sess * 100, 2) if max_sess else 0.0
        )

        # TPS (User Transaction Per Sec — v$sysmetric GROUP_ID=2 는 60초 평균)
        cur.execute(
            "SELECT value FROM v$sysmetric"
            " WHERE metric_name='User Transaction Per Sec' AND group_id=2"
        )
        row = cur.fetchone()
        metrics["db_transactions_per_second"] = float(row[0]) if row else 0.0

        # 슬로우 쿼리 (elapsed > 1s, 시스템 세션 제외)
        cur.execute(
            "SELECT COUNT(*) FROM v$sql"
            " WHERE elapsed_time / 1000000 > 1 AND parsing_user_id > 0"
        )
        metrics["db_slow_queries_total"] = float(cur.fetchone()[0])

        # 버퍼 캐시 히트율
        cur.execute(
            "SELECT ROUND((1 - physical_reads / NULLIF(db_block_gets + consistent_gets, 0)) * 100, 2)"
            " FROM v$buffer_pool_statistics WHERE name = 'DEFAULT'"
        )
        row = cur.fetchone()
        metrics["db_cache_hit_rate_percent"] = float(row[0]) if row and row[0] is not None else 0.0

        # DataGuard 복제 지연 (없으면 0)
        cur.execute(
            "SELECT value FROM v$dataguard_stats WHERE name = 'apply lag'"
        )
        row = cur.fetchone()
        metrics["db_replication_lag_seconds"] = float(row[0]) if row and row[0] is not None else 0.0

        cur.close()
    finally:
        conn.close()

    return metrics


async def oracle_collection_loop(session_factory) -> None:
    """
    lifespan에서 asyncio.create_task()로 실행되는 백그라운드 루프.
    _TICK(10초)마다 에이전트 목록을 확인하고, 에이전트별 수집 주기(label_info.collect_interval_secs,
    기본값 DEFAULT_INTERVAL)가 경과한 에이전트만 수집한다.
    """
    from models import AgentInstance, System  # noqa: PLC0415

    while True:
        try:
            async with session_factory() as db:
                result = await db.execute(
                    select(AgentInstance, System)
                    .join(System, AgentInstance.system_id == System.id)
                    .where(AgentInstance.agent_type == "oracle_db")
                    .where(AgentInstance.status == "installed")
                )
                rows = result.all()

            now = time.monotonic()
            for agent, system in rows:
                try:
                    info = json.loads(agent.label_info or "{}")
                    interval = int(info.get("collect_interval_secs", DEFAULT_INTERVAL))
                    last = _last_collected.get(agent.id, 0.0)
                    if now - last < interval:
                        continue  # 아직 수집 주기 미도달

                    pw = decrypt_password(info["encrypted_password"])
                    metrics = await asyncio.get_event_loop().run_in_executor(
                        None,
                        _collect_sync,
                        agent.host,
                        int(agent.port or 1521),
                        info["service_name"],
                        info["username"],
                        pw,
                    )
                    labels = {
                        "system_name": system.system_name,
                        "instance_role": info.get("instance_role", "primary"),
                    }
                    for metric_name, value in metrics.items():
                        if metric_name in _GAUGES:
                            _GAUGES[metric_name].labels(**labels).set(value)
                    _last_collected[agent.id] = time.monotonic()
                except Exception as e:
                    logger.warning(
                        "oracle collect failed [%s]: %s", system.system_name, e
                    )
        except Exception as e:
            logger.error("oracle_collection_loop error: %s", e)

        await asyncio.sleep(_TICK)
