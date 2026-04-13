"""MySQL 백엔드 — mysql-connector-python 사용."""

import mysql.connector


def _status_value(cur, variable_name: str) -> float:
    """SHOW GLOBAL STATUS에서 특정 변수 값을 float로 반환."""
    cur.execute(f"SHOW GLOBAL STATUS LIKE '{variable_name}'")
    row = cur.fetchone()
    return float(row[1]) if row else 0.0


class MySQLBackend:
    def test_connection(
        self, host: str, port: int, db_identifier: str, username: str, password: str,
    ) -> None:
        conn = mysql.connector.connect(
            host=host, port=port, database=db_identifier,
            user=username, password=password, connection_timeout=10,
        )
        conn.close()

    def collect_sync(
        self, host: str, port: int, db_identifier: str, username: str, password: str,
    ) -> dict[str, float]:
        conn = mysql.connector.connect(
            host=host, port=port, database=db_identifier,
            user=username, password=password, connection_timeout=10,
        )
        metrics: dict[str, float] = {}
        try:
            cur = conn.cursor()

            # 활성 스레드 수
            active = _status_value(cur, "Threads_running")
            metrics["db_connections_active"] = active

            # max_connections
            cur.execute("SELECT @@max_connections")
            max_conn = int(cur.fetchone()[0]) or 1
            metrics["db_connections_active_percent"] = round(active / max_conn * 100, 2)

            # TPS — Com_commit 누적 카운터 (수집 루프에서 델타 계산)
            metrics["_raw_tps_counter"] = _status_value(cur, "Com_commit")
            metrics["db_transactions_per_second"] = 0.0

            # 슬로우 쿼리 (누적)
            metrics["db_slow_queries_total"] = _status_value(cur, "Slow_queries")

            # InnoDB 버퍼 풀 히트율
            read_requests = _status_value(cur, "Innodb_buffer_pool_read_requests")
            reads = _status_value(cur, "Innodb_buffer_pool_reads")
            if read_requests > 0:
                metrics["db_cache_hit_rate_percent"] = round(
                    (read_requests - reads) / read_requests * 100, 2
                )
            else:
                metrics["db_cache_hit_rate_percent"] = 100.0

            # 복제 지연
            try:
                cur.execute("SHOW REPLICA STATUS")
                row = cur.fetchone()
                if row:
                    # Seconds_Behind_Source 는 컬럼 인덱스가 버전마다 다를 수 있으므로
                    # description에서 찾기
                    col_names = [d[0] for d in cur.description]
                    # MySQL 8.0.22+: Seconds_Behind_Source, 이전: Seconds_Behind_Master
                    for col_name in ("Seconds_Behind_Source", "Seconds_Behind_Master"):
                        if col_name in col_names:
                            idx = col_names.index(col_name)
                            val = row[idx]
                            metrics["db_replication_lag_seconds"] = float(val) if val is not None else 0.0
                            break
                    else:
                        metrics["db_replication_lag_seconds"] = 0.0
                else:
                    metrics["db_replication_lag_seconds"] = 0.0
            except Exception:
                # SHOW REPLICA STATUS 권한 없거나 replica 아닌 경우
                metrics["db_replication_lag_seconds"] = 0.0

            cur.close()
        finally:
            conn.close()

        return metrics
