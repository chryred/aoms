"""MSSQL 백엔드 — pymssql 사용."""

import pymssql


class MSSQLBackend:
    def test_connection(
        self, host: str, port: int, db_identifier: str, username: str, password: str,
    ) -> None:
        conn = pymssql.connect(
            server=host, port=port, database=db_identifier,
            user=username, password=password, login_timeout=10,
        )
        conn.close()

    def collect_sync(
        self, host: str, port: int, db_identifier: str, username: str, password: str,
    ) -> dict[str, float]:
        conn = pymssql.connect(
            server=host, port=port, database=db_identifier,
            user=username, password=password, login_timeout=10,
        )
        metrics: dict[str, float] = {}
        try:
            cur = conn.cursor()

            # 활성 세션 수 (running 상태 요청)
            cur.execute("SELECT COUNT(*) FROM sys.dm_exec_requests WHERE status = 'running'")
            active = cur.fetchone()[0]
            metrics["db_connections_active"] = float(active)

            # max connections
            cur.execute(
                "SELECT CAST(value_in_use AS INT) FROM sys.configurations"
                " WHERE name = 'user connections'"
            )
            row = cur.fetchone()
            # user connections = 0 이면 동적(기본 32767)
            max_conn = int(row[0]) if row and int(row[0]) > 0 else 32767
            metrics["db_connections_active_percent"] = round(active / max_conn * 100, 2)

            # TPS — 누적 카운터 (수집 루프에서 델타 계산)
            cur.execute(
                "SELECT cntr_value FROM sys.dm_os_performance_counters"
                " WHERE counter_name = 'Transactions/sec'"
                " AND instance_name = '_Total'"
            )
            row = cur.fetchone()
            metrics["_raw_tps_counter"] = float(row[0]) if row else 0.0
            metrics["db_transactions_per_second"] = 0.0

            # 슬로우 쿼리 (1초 이상 실행 중)
            cur.execute(
                "SELECT COUNT(*) FROM sys.dm_exec_requests"
                " WHERE status = 'running' AND total_elapsed_time > 1000"
            )
            metrics["db_slow_queries_total"] = float(cur.fetchone()[0])

            # 버퍼 캐시 히트율
            cur.execute(
                "SELECT CASE WHEN b.cntr_value = 0 THEN 100.0"
                " ELSE ROUND(a.cntr_value * 100.0 / b.cntr_value, 2) END"
                " FROM"
                " (SELECT cntr_value FROM sys.dm_os_performance_counters"
                "  WHERE object_name LIKE '%Buffer Manager%'"
                "  AND counter_name = 'Buffer cache hit ratio') a,"
                " (SELECT cntr_value FROM sys.dm_os_performance_counters"
                "  WHERE object_name LIKE '%Buffer Manager%'"
                "  AND counter_name = 'Buffer cache hit ratio base') b"
            )
            row = cur.fetchone()
            metrics["db_cache_hit_rate_percent"] = float(row[0]) if row else 0.0

            # 복제 지연 (Always On AG)
            try:
                cur.execute(
                    "SELECT DATEDIFF(SECOND, last_commit_time, GETUTCDATE())"
                    " FROM sys.dm_hadr_database_replica_states"
                    " WHERE is_local = 1 AND is_primary_replica = 0"
                )
                row = cur.fetchone()
                metrics["db_replication_lag_seconds"] = float(row[0]) if row and row[0] is not None else 0.0
            except Exception:
                metrics["db_replication_lag_seconds"] = 0.0

            cur.close()
        finally:
            conn.close()

        return metrics
