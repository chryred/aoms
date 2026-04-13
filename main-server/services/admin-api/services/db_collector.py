"""
DB 메트릭 수집 서비스 (Strategy + Registry 패턴)

admin-api 백그라운드 루프로 실행되며, agent_type='db'인 AgentInstance를 주기적으로
조회해 db_type에 맞는 백엔드로 메트릭을 수집 후 prometheus_client Gauge에 업데이트한다.
Prometheus가 /metrics 엔드포인트를 scrape하면 이 값이 노출된다.

메트릭명은 log-analyzer PROMQL_MAP의 db_exporter 섹션과 호환된다.
"""

import asyncio
import json
import logging
import os
import time

from cryptography.fernet import Fernet
from prometheus_client import Gauge
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from services.db_backends import (
    DB_AGENT_TYPE,
    BACKENDS,
    get_db_identifier_key,
)

logger = logging.getLogger(__name__)

# 전역 기본 수집 주기 (에이전트별 label_info.collect_interval_secs 미설정 시 사용)
DEFAULT_INTERVAL = int(
    os.getenv("DB_COLLECT_INTERVAL_SECS", os.getenv("ORACLE_COLLECT_INTERVAL_SECS", "60"))
)

# 에이전트별 마지막 수집 시각 추적 { agent_id: last_collected_monotonic }
_last_collected: dict[int, float] = {}

# TPS 델타 계산용 상태 { agent_id: (prev_counter, prev_monotonic) }
_tps_state: dict[int, tuple[float, float]] = {}

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
        "Replication lag in seconds",
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


def _compute_tps(agent_id: int, raw_counter: float) -> float:
    """누적 카운터로부터 TPS 델타를 계산한다. 첫 수집 시 0.0 반환."""
    now = time.monotonic()
    prev = _tps_state.get(agent_id)
    _tps_state[agent_id] = (raw_counter, now)
    if prev is None:
        return 0.0
    prev_counter, prev_time = prev
    elapsed = now - prev_time
    if elapsed <= 0:
        return 0.0
    return max(0.0, round((raw_counter - prev_counter) / elapsed, 2))


async def db_collection_loop(session_factory) -> None:
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
                    .where(AgentInstance.agent_type == DB_AGENT_TYPE)
                    .where(AgentInstance.status == "installed")
                )
                rows = result.all()

            now = time.monotonic()
            for agent, system in rows:
                try:
                    info = json.loads(agent.label_info or "{}")
                    db_type = info.get("db_type", "oracle")
                    backend = BACKENDS.get(db_type)
                    if not backend:
                        logger.warning("unknown db_type '%s' for agent %s", db_type, agent.id)
                        continue

                    interval = int(info.get("collect_interval_secs", DEFAULT_INTERVAL))
                    last = _last_collected.get(agent.id, 0.0)
                    if now - last < interval:
                        continue  # 아직 수집 주기 미도달

                    pw = decrypt_password(info["encrypted_password"])
                    id_key = get_db_identifier_key(db_type)
                    db_identifier = info.get(id_key, "")

                    metrics = await asyncio.get_event_loop().run_in_executor(
                        None,
                        backend.collect_sync,
                        agent.host,
                        int(agent.port or 0),
                        db_identifier,
                        info.get("username", ""),
                        pw,
                    )

                    # TPS 델타 계산 (oracle은 직접 TPS 반환하므로 _raw_tps_counter 없음)
                    raw_tps = metrics.pop("_raw_tps_counter", None)
                    if raw_tps is not None:
                        metrics["db_transactions_per_second"] = _compute_tps(agent.id, raw_tps)

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
                        "db collect failed [%s]: %s", system.system_name, e
                    )
        except Exception as e:
            logger.error("db_collection_loop error: %s", e)

        await asyncio.sleep(_TICK)
