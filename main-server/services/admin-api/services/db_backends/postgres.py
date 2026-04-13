"""PostgreSQL 백엔드 — psycopg2 사용."""

import psycopg2


class PostgresBackend:
    def test_connection(
        self, host: str, port: int, db_identifier: str, username: str, password: str,
    ) -> None:
        conn = psycopg2.connect(
            host=host, port=port, dbname=db_identifier, user=username, password=password,
            connect_timeout=10,
        )
        conn.close()

    def collect_sync(
        self, host: str, port: int, db_identifier: str, username: str, password: str,
    ) -> dict[str, float]:
        conn = psycopg2.connect(
            host=host, port=port, dbname=db_identifier, user=username, password=password,
            connect_timeout=10,
        )
        metrics: dict[str, float] = {}
        try:
            conn.autocommit = True
            cur = conn.cursor()

            # 활성 세션 수
            cur.execute(
                "SELECT count(*) FROM pg_stat_activity"
                " WHERE state = 'active' AND datname = current_database()"
            )
            active = cur.fetchone()[0]
            metrics["db_connections_active"] = float(active)

            # max_connections
            cur.execute("SHOW max_connections")
            max_conn = int(cur.fetchone()[0])
            metrics["db_connections_active_percent"] = (
                round(active / max_conn * 100, 2) if max_conn else 0.0
            )

            # TPS — pg_stat_database 누적 카운터 (수집 루프에서 델타 계산)
            cur.execute(
                "SELECT xact_commit + xact_rollback FROM pg_stat_database"
                " WHERE datname = current_database()"
            )
            row = cur.fetchone()
            metrics["_raw_tps_counter"] = float(row[0]) if row else 0.0
            metrics["db_transactions_per_second"] = 0.0  # 델타 미계산 시 0

            # 슬로우 쿼리 (1초 이상 실행 중)
            cur.execute(
                "SELECT count(*) FROM pg_stat_activity"
                " WHERE state = 'active' AND now() - query_start > interval '1 second'"
                " AND datname = current_database()"
            )
            metrics["db_slow_queries_total"] = float(cur.fetchone()[0])

            # 버퍼 캐시 히트율
            cur.execute(
                "SELECT CASE WHEN blks_hit + blks_read = 0 THEN 100.0"
                " ELSE round(blks_hit * 100.0 / (blks_hit + blks_read), 2) END"
                " FROM pg_stat_database WHERE datname = current_database()"
            )
            row = cur.fetchone()
            metrics["db_cache_hit_rate_percent"] = float(row[0]) if row else 0.0

            # 복제 지연 (replica면 값 존재, primary면 NULL → 0)
            cur.execute(
                "SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))"
            )
            row = cur.fetchone()
            metrics["db_replication_lag_seconds"] = float(row[0]) if row and row[0] is not None else 0.0

            cur.close()
        finally:
            conn.close()

        return metrics
