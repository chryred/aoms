-- Agent-T ClickHouse 스키마 (spec §7.3). 멱등: 모든 문장 IF NOT EXISTS.
-- 시간은 UTC 저장. 보관일은 gateway 가 계산한 expire_at 으로 행 단위 TTL 삭제.
-- dict_sql/dict_uri 는 TTL 없음(last_seen 이 최초 1회만 기록돼 TTL 이면 사용 중 ID 가 삭제됨).
-- 이벤트 4개 테이블은 insert_deduplication_token 중복 제거(window 1000 블록).
CREATE DATABASE IF NOT EXISTS agent_t;

CREATE TABLE IF NOT EXISTS agent_t.tx_summary
(
    system_id      UInt32,
    instance_role  LowCardinality(String),
    host           LowCardinality(String),
    start_ts       DateTime64(3, 'UTC'),
    trace_id       FixedString(32),
    span_id        FixedString(16),
    parent_span    String,
    uri_id         UInt64,
    method         LowCardinality(String),
    status         UInt16,
    error          UInt8,
    exc_class      LowCardinality(String),
    elapsed_ms     UInt32,
    cpu_ms         UInt32,
    sql_ms         UInt32,
    sql_cnt        UInt32,
    fetch_cnt      UInt32,
    fetch_ms       UInt32,
    ext_ms         UInt32,
    ext_cnt        UInt16,
    conn_open      UInt16,
    conn_close     UInt16,
    conn_leak      UInt16,
    conn_uncommit  UInt16,
    user_ip        String,
    user_id        String,
    biz_key        String,
    has_detail     UInt8,
    expire_at      DateTime('UTC'),
    INDEX idx_trace trace_id TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(start_ts)
ORDER BY (system_id, start_ts)
TTL expire_at DELETE
SETTINGS non_replicated_deduplication_window = 1000;

CREATE TABLE IF NOT EXISTS agent_t.tx_sql
(
    system_id  UInt32,
    start_ts   DateTime64(3, 'UTC'),
    trace_id   FixedString(32),
    span_id    FixedString(16),
    sql_id     UInt64,
    cnt        UInt32,
    ms         UInt32,
    max_ms     UInt32,
    fetch_cnt  UInt32,
    fetch_ms   UInt32,
    err        UInt16,
    expire_at  DateTime('UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(start_ts)
ORDER BY (system_id, start_ts, span_id)
TTL expire_at DELETE
SETTINGS non_replicated_deduplication_window = 1000;

CREATE TABLE IF NOT EXISTS agent_t.tx_detail
(
    system_id  UInt32,
    start_ts   DateTime64(3, 'UTC'),
    trace_id   FixedString(32),
    span_id    FixedString(16),
    nodes      String CODEC(ZSTD(3)),
    stacks     String CODEC(ZSTD(3)),
    expire_at  DateTime('UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(start_ts)
ORDER BY (system_id, span_id)
TTL expire_at DELETE
SETTINGS non_replicated_deduplication_window = 1000;

CREATE TABLE IF NOT EXISTS agent_t.jvm_thread_dump
(
    system_id      UInt32,
    instance_role  LowCardinality(String),
    ts             DateTime64(3, 'UTC'),
    cmd_id         UInt64,
    text           String CODEC(ZSTD(3)),
    truncated      UInt8,
    expire_at      DateTime('UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (system_id, ts)
TTL expire_at DELETE
SETTINGS non_replicated_deduplication_window = 1000;

CREATE TABLE IF NOT EXISTS agent_t.dict_sql
(
    id         UInt64,
    text       String,
    last_seen  DateTime('UTC')
)
ENGINE = ReplacingMergeTree(last_seen)
ORDER BY id;

CREATE TABLE IF NOT EXISTS agent_t.dict_uri
(
    id         UInt64,
    text       String,
    last_seen  DateTime('UTC')
)
ENGINE = ReplacingMergeTree(last_seen)
ORDER BY id;
