-- 메트릭 알림(prometheus_analyzer) 예외 처리 규칙 신설
-- 기존 alert_exclusions 는 template(로그) 기반. 메트릭 알림은 (system_id + host + metric_type) 기반으로 별도 관리.
-- 동작: override_threshold IS NULL → 완전 차단 / 값 있으면 임계치 대체 (개발기 등 둔감화)

CREATE TABLE IF NOT EXISTS metric_exclusions (
    id                   SERIAL PRIMARY KEY,
    system_id            INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    host                 VARCHAR(255),
    metric_type          VARCHAR(30) NOT NULL,
    override_threshold   DOUBLE PRECISION,
    reason               TEXT,
    created_by           VARCHAR(100),
    created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
    active               BOOLEAN NOT NULL DEFAULT TRUE,
    deactivated_by       VARCHAR(100),
    deactivated_at       TIMESTAMP,
    skip_count           INTEGER NOT NULL DEFAULT 0,
    last_skipped_at      TIMESTAMP,
    expires_at           TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_metric_exclusions_lookup     ON metric_exclusions(system_id, active, metric_type);
CREATE INDEX IF NOT EXISTS idx_metric_exclusions_expires_at ON metric_exclusions(expires_at);

-- prometheus_analyzer 알림에 묶인 메트릭 종류 식별용 (UI 모달이 어떤 메트릭들이 묶였는지 표시·선택)
ALTER TABLE alert_history ADD COLUMN IF NOT EXISTS metric_types JSONB;
