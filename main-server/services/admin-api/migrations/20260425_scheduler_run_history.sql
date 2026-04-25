-- 스케줄러 실행 이력 테이블
-- log-analyzer 재시작 시 메모리 손실 없이 과거 실행 결과를 관리자가 확인할 수 있도록 함

CREATE TABLE IF NOT EXISTS scheduler_run_history (
    id             SERIAL PRIMARY KEY,
    scheduler_type VARCHAR(20)  NOT NULL,   -- analysis | hourly | daily | weekly | monthly | longperiod | trend
    started_at     TIMESTAMP    NOT NULL,
    finished_at    TIMESTAMP    NOT NULL,
    status         VARCHAR(10)  NOT NULL,   -- ok | error
    error_count    INTEGER      DEFAULT 0,
    analyzed_count INTEGER      DEFAULT 0,
    summary_json   JSONB,
    error_message  TEXT,
    created_at     TIMESTAMP    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_run_type_started ON scheduler_run_history(scheduler_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduler_run_started      ON scheduler_run_history(started_at DESC);
