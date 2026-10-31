-- Agent-T final fix: dict TTL 제거 + 중복 적재 방지.
-- 2026-10-31 이전의 init SQL 로 초기화된 ClickHouse 에만 **한 번** 적용한다.
-- 신규 설치(현재 init/001_agent_t.sql 은 이미 dict TTL 이 없음)는 실행하지 말 것:
-- 테이블에 TTL 이 없으면 REMOVE TTL 이 "Code: 36 Table doesn't have any table TTL expression" 으로 실패한다.
-- 두 번째 실행도 마찬가지다. MODIFY SETTING 문장은 멱등이다.
-- 적용: clickhouse-client --multiquery < 20261031_dict_no_ttl.sql
--   일부만 적용된 경우: clickhouse-client --multiquery --ignore-error < 20261031_dict_no_ttl.sql

-- dict_*: last_seen 은 최초 1회만 기록되므로 TTL 이 사용 중인 ID 의 텍스트를 삭제했다.
ALTER TABLE agent_t.dict_sql REMOVE TTL;
ALTER TABLE agent_t.dict_uri REMOVE TTL;

-- 청크 재시도(insert_deduplication_token) 중복 제거를 위한 비복제 dedup window.
ALTER TABLE agent_t.tx_summary MODIFY SETTING non_replicated_deduplication_window = 1000;
ALTER TABLE agent_t.tx_sql MODIFY SETTING non_replicated_deduplication_window = 1000;
ALTER TABLE agent_t.tx_detail MODIFY SETTING non_replicated_deduplication_window = 1000;
ALTER TABLE agent_t.jvm_thread_dump MODIFY SETTING non_replicated_deduplication_window = 1000;
