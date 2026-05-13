-- Migration: alert_exclusions.exclusion_type 컬럼 추가
-- 'skip': 완전 제외 (기존 동작 유지)
-- 'force_real': LLM이 알림성으로 분류해도 강제 분석

ALTER TABLE alert_exclusions
  ADD COLUMN IF NOT EXISTS exclusion_type VARCHAR(20) NOT NULL DEFAULT 'skip';

COMMENT ON COLUMN alert_exclusions.exclusion_type IS
  'skip: 완전 제외 | force_real: 알림성 오판 정정, LLM 분석 강제';
