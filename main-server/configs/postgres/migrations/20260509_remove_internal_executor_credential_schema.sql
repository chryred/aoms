-- log_analyzer, qdrant executor는 내부 시스템이므로 자격증명 UI 불필요.
-- URL은 환경변수(LOG_ANALYZER_URL)로 결정됨 — executor 코드에 fallback 내장.
UPDATE chat_executor_configs
SET config_schema = '[]'::jsonb
WHERE executor IN ('log_analyzer', 'qdrant');
