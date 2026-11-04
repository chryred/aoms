-- tx_sql.db: SQL 이 실행된 DB 접속 표시명(host:port/db). Agent-T 가 JDBC URL 에서 추출해 배치 sql[].db 로 전송.
-- 새 gateway(db 컬럼 INSERT) 배포 전에 운영 ClickHouse 에 적용한다. 멱등(IF NOT EXISTS) — 여러 번 실행해도 안전.
-- 신규 설치는 init/001_agent_t.sql 에 이미 포함되어 있어 실행해도 무해하다.
-- 적용: clickhouse-client --multiquery < 20261104_tx_sql_db.sql
--
-- ORDER BY (system_id, start_ts, span_id) 는 변경하지 않는다(정렬키 변경은 테이블 재생성이 필요). tx_sql 은 이미 같은 span 안에서
-- 같은 sql_id 가 여러 행일 수 있는 구조(행 단위 적재, 집계·중복 제거 키 아님)이므로 (sql_id, db) 를 별도 키로 둘 필요가 없다.
-- 조회는 GROUP BY sql_id, db 로 합산한다. 기존 행은 DEFAULT '' 로 읽힌다(소급 채우기 없음).
ALTER TABLE agent_t.tx_sql ADD COLUMN IF NOT EXISTS db LowCardinality(String) DEFAULT '' AFTER err;
