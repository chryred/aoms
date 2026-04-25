-- Migration: alert_exclusions에 count 임계값 + 자동 만료 컬럼 추가
-- ADR-014 보강 (count 폭증 대응 + stale 규칙 자동 만료)

ALTER TABLE alert_exclusions
    ADD COLUMN IF NOT EXISTS max_count_per_window INTEGER,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_alert_exclusions_expires_at ON alert_exclusions(expires_at);
