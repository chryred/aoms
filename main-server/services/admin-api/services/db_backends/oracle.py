"""Oracle DB 백엔드 — oracledb Thin Mode 사용."""

import oracledb


class OracleBackend:
    def test_connection(
        self, host: str, port: int, db_identifier: str, username: str, password: str,
    ) -> None:
        conn = oracledb.connect(
            user=username,
            password=password,
            dsn=f"{host}:{port}/{db_identifier}",
        )
        conn.close()

    def collect_sync(
        self, host: str, port: int, db_identifier: str, username: str, password: str,
    ) -> dict[str, float]:
        conn = oracledb.connect(
            user=username,
            password=password,
            dsn=f"{host}:{port}/{db_identifier}",
        )
        metrics: dict[str, float] = {}
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
