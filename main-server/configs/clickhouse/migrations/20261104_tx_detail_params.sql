-- tx_detail.params: 에이전트 opt-in(capture.params)으로 수집한 마스킹된 요청 파라미터 JSON {"q","p","t"}. 없으면 ''.
-- 새 gateway(params 컬럼 INSERT) 배포 전에 운영 ClickHouse 에 적용한다. 멱등(IF NOT EXISTS) — 여러 번 실행해도 안전.
-- 신규 설치는 init/001_agent_t.sql 에 이미 포함되어 있어 실행해도 무해하다.
-- 적용: clickhouse-client --multiquery < 20261104_tx_detail_params.sql
-- 기존 행은 DEFAULT '' 로 읽힌다(소급 채우기 없음). 정렬키 변경 없음.
ALTER TABLE agent_t.tx_detail ADD COLUMN IF NOT EXISTS params String DEFAULT '' CODEC(ZSTD(3)) AFTER stacks;
