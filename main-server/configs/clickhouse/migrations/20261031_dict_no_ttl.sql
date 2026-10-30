-- Agent-T final fix: dict TTL 제거 + 중복 적재 방지.
-- 기존 설치(001_agent_t.sql 이 이미 적용된 ClickHouse)에서 한 번 실행한다.
-- 신규 설치는 init/001_agent_t.sql 이 이미 반영되어 있으므로 실행해도 무해하다.

-- dict_*: last_seen 은 최초 1회만 기록되므로 TTL 이 사용 중인 ID 의 텍스트를 삭제했다.
ALTER TABLE agent_t.dict_sql REMOVE TTL;
ALTER TABLE agent_t.dict_uri REMOVE TTL;

-- 청크 재시도(insert_deduplication_token) 중복 제거를 위한 비복제 dedup window.
ALTER TABLE agent_t.tx_summary MODIFY SETTING non_replicated_deduplication_window = 1000;
ALTER TABLE agent_t.tx_sql MODIFY SETTING non_replicated_deduplication_window = 1000;
ALTER TABLE agent_t.tx_detail MODIFY SETTING non_replicated_deduplication_window = 1000;
ALTER TABLE agent_t.jvm_thread_dump MODIFY SETTING non_replicated_deduplication_window = 1000;
