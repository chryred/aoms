-- D4 결정(2026-05-01): system_collector_config 테이블 제거
-- 수집기 설정은 agent_instances.label_info에서 on-the-fly로 derive함
-- (GET /api/v1/collector-config 응답 형식은 하위 호환 유지)

DROP INDEX IF EXISTS idx_collector_config_system;
DROP TABLE IF EXISTS system_collector_config;
