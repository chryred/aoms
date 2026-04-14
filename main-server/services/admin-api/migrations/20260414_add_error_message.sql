-- 기존 운영 DB용 마이그레이션: log_analysis_history에 error_message 컬럼 추가
-- 2026-04-14 — LLM/분석 실패 이력 저장 및 UI 가시화
--
-- 사용법:
--   docker exec -i aoms-postgres psql -U aoms -d aoms < 20260414_add_error_message.sql
--   또는
--   docker exec dev-postgres psql -U synapse -d synapse -f /path/to/20260414_add_error_message.sql

ALTER TABLE log_analysis_history
    ADD COLUMN IF NOT EXISTS error_message TEXT;

COMMENT ON COLUMN log_analysis_history.error_message IS
    'LLM/분석 실패 이력: NULL=성공, 값=실패 사유 (UI "분석 실패" 뱃지 렌더링 조건)';

ALTER TABLE alert_history
    ADD COLUMN IF NOT EXISTS error_message TEXT;

COMMENT ON COLUMN alert_history.error_message IS
    'LLM/분석 실패 동반 이력: NULL=성공, 값=실패 사유 (피드백 관리 화면 뱃지)';
