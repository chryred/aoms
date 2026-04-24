-- Migration: 에러 알림 예외 처리 기능
-- 적용 대상: 기존 운영 DB (init.sql 재실행 불가한 경우)

-- 1. alert_exclusions 테이블 신규 생성
CREATE TABLE IF NOT EXISTS alert_exclusions (
    id               SERIAL PRIMARY KEY,
    system_id        INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    instance_role    VARCHAR(50),
    template         TEXT NOT NULL,
    reason           TEXT,
    created_by       VARCHAR(100),
    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    deactivated_by   VARCHAR(100),
    deactivated_at   TIMESTAMP,
    skip_count       INTEGER NOT NULL DEFAULT 0,
    last_skipped_at  TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_exclusions_active_system ON alert_exclusions(system_id, active);

-- 2. log_analysis_history 컬럼 추가
ALTER TABLE log_analysis_history
    ADD COLUMN IF NOT EXISTS excluded          BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS exclusion_rule_id INTEGER REFERENCES alert_exclusions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS templates_json    JSONB;

CREATE INDEX IF NOT EXISTS idx_log_analysis_excluded ON log_analysis_history(excluded, system_id);

-- 3. alert_history 컬럼 추가
ALTER TABLE alert_history
    ADD COLUMN IF NOT EXISTS log_analysis_id INTEGER;

-- 4. alert_history.log_analysis_id FK 추가
DO $$ BEGIN
    ALTER TABLE alert_history
        ADD CONSTRAINT fk_alert_history_log_analysis
        FOREIGN KEY (log_analysis_id) REFERENCES log_analysis_history(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
