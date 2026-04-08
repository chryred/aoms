-- AOMS PostgreSQL 초기 스키마
-- Phase 1 (T1.9)에서 실행: docker exec -i aoms-postgres psql -U aoms -d aoms < init.sql

-- ── 시스템 정보 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS systems (
    id              SERIAL PRIMARY KEY,
    system_name     VARCHAR(100) UNIQUE NOT NULL,   -- Prometheus label과 동일
    display_name    VARCHAR(200) NOT NULL,
    description     TEXT,
    host            VARCHAR(200) NOT NULL DEFAULT '',
    os_type         VARCHAR(20)  NOT NULL DEFAULT 'linux',  -- 'linux' | 'windows'
    system_type     VARCHAR(50)  NOT NULL DEFAULT 'was',    -- 'web' | 'was' | 'db' | 'middleware' | 'other'
    status          VARCHAR(20)  DEFAULT 'active',
    teams_webhook_url TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- ── 담당자 정보 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(200),
    teams_upn   VARCHAR(200),          -- Teams mention용 UPN
    webhook_url TEXT,
    llm_api_key     VARCHAR(500),
    agent_code      VARCHAR(100),
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

COMMENT ON COLUMN contacts.teams_upn IS 'Microsoft Teams UPN (알림 멘션용)';
COMMENT ON COLUMN contacts.llm_api_key IS '담당자별 LLM API key — NULL이면 .env 기본값 사용';
COMMENT ON COLUMN contacts.agent_code IS 'LLM AGENT CODE';

-- ── 시스템-담당자 매핑 (N:M) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_contacts (
    id               SERIAL PRIMARY KEY,
    system_id        INTEGER REFERENCES systems(id)  ON DELETE CASCADE,
    contact_id       INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    role             VARCHAR(50) DEFAULT 'primary',     -- 'primary' | 'secondary'
    notify_channels  VARCHAR(200) NOT NULL DEFAULT 'teams',
    UNIQUE(system_id, contact_id)
);

-- ── 알림 이력 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_history (
    id                  SERIAL PRIMARY KEY,
    system_id           INTEGER REFERENCES systems(id),
    alert_type          VARCHAR(50) NOT NULL DEFAULT 'metric',  -- 'metric' | 'log_analysis'
    severity            VARCHAR(20) NOT NULL,
    alertname           VARCHAR(100),
    title               VARCHAR(500) NOT NULL,
    description         TEXT,
    instance_role       VARCHAR(50),                            -- 이중화 역할 (was1, was2 ...)
    host                VARCHAR(100),
    metric_name         VARCHAR(100),
    metric_value        FLOAT,
    notified_contacts   TEXT,                                   -- JSON 배열 (담당자명)
    -- Phase 4b: 벡터 유사도 분석 필드
    anomaly_type        VARCHAR(20),
    similarity_score    FLOAT,
    qdrant_point_id     VARCHAR(36),
    acknowledged        BOOLEAN DEFAULT FALSE,
    acknowledged_at     TIMESTAMP,
    acknowledged_by     VARCHAR(100),
    escalated           BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_history_system  ON alert_history(system_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_created ON alert_history(created_at DESC);

-- ── LLM 분석 결과 이력 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS log_analysis_history (
    id               SERIAL PRIMARY KEY,
    system_id        INTEGER REFERENCES systems(id),
    instance_role    VARCHAR(50),
    log_content      TEXT NOT NULL,
    analysis_result  TEXT NOT NULL,
    severity         VARCHAR(20) NOT NULL,
    root_cause       TEXT,
    recommendation   TEXT,
    model_used       VARCHAR(100),
    processing_time  FLOAT,
    alert_sent       BOOLEAN DEFAULT FALSE,
    -- Phase 4b: 벡터 유사도 분석 필드
    anomaly_type     VARCHAR(20),
    similarity_score FLOAT,
    qdrant_point_id  VARCHAR(36),
    has_solution     BOOLEAN DEFAULT FALSE,
    created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_log_analysis_system ON log_analysis_history(system_id, created_at DESC);

-- ── 알림 쿨다운 추적 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_cooldown (
    id           SERIAL PRIMARY KEY,
    system_id    INTEGER REFERENCES systems(id),
    alert_key    VARCHAR(500) NOT NULL,   -- "{system_name}:{instance_role}:{alertname}:{severity}"
    last_sent_at TIMESTAMP NOT NULL,
    UNIQUE(system_id, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_cooldown_lookup ON alert_cooldown(system_id, alert_key);

-- ── 피드백 (Phase 4c: WF3 n8n 워크플로우에서 INSERT) ─────────────────
CREATE TABLE IF NOT EXISTS alert_feedback (
    id               SERIAL PRIMARY KEY,
    system_id        INTEGER REFERENCES systems(id),
    alert_history_id INTEGER REFERENCES alert_history(id),
    error_type       VARCHAR(100) NOT NULL,
    solution         TEXT NOT NULL,
    resolver         VARCHAR(200) NOT NULL,
    qdrant_point_id  VARCHAR(36),     -- 해결책 임베딩 후 저장된 Qdrant point ID
    created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_feedback_system ON alert_feedback(system_id, created_at DESC);

-- ── Phase 5: 수집기 유연 레지스트리 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS system_collector_config (
    id             SERIAL PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    collector_type VARCHAR(50)  NOT NULL,   -- node_exporter | jmx_exporter | db_exporter | custom
    metric_group   VARCHAR(100) NOT NULL,   -- cpu | memory | disk | network | jvm_heap | thread_pool | ...
    enabled        BOOLEAN DEFAULT TRUE,
    prometheus_job VARCHAR(200),            -- Prometheus job label (쿼리 범위 한정)
    custom_config  TEXT,                    -- JSON 형태 파라미터 (선택)
    created_at     TIMESTAMP DEFAULT NOW(),
    updated_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(system_id, collector_type, metric_group)
);

CREATE INDEX IF NOT EXISTS idx_collector_config_system ON system_collector_config(system_id, collector_type);

-- ── Phase 5: 1시간 메트릭 집계 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_hourly_aggregations (
    id             SERIAL PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id),
    hour_bucket    TIMESTAMP NOT NULL,      -- 시간 단위 truncate (UTC)
    collector_type VARCHAR(50)  NOT NULL,
    metric_group   VARCHAR(100) NOT NULL,
    metrics_json   TEXT NOT NULL,           -- JSON: avg/max/min/p95 등 집계값
    -- LLM 분석 (이상 감지 시에만 채워짐)
    llm_summary    TEXT,
    llm_severity   VARCHAR(20),             -- normal | warning | critical
    llm_trend      TEXT,                    -- 추세 설명 (1문장)
    llm_prediction TEXT,                    -- 임계치 도달 예측 ("3.2시간 후 85% 도달 예상")
    llm_model_used VARCHAR(100),
    qdrant_point_id VARCHAR(36),            -- metric_hourly_patterns 컬렉션 UUID
    created_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(system_id, hour_bucket, collector_type, metric_group)
);

CREATE INDEX IF NOT EXISTS idx_hourly_agg_system_time ON metric_hourly_aggregations(system_id, hour_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_hourly_agg_severity    ON metric_hourly_aggregations(llm_severity, hour_bucket DESC);

-- ── Phase 5: 1일 메트릭 집계 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_daily_aggregations (
    id             SERIAL PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id),
    day_bucket     TIMESTAMP NOT NULL,      -- 날짜 단위 truncate (UTC)
    collector_type VARCHAR(50)  NOT NULL,
    metric_group   VARCHAR(100) NOT NULL,
    metrics_json   TEXT NOT NULL,           -- 일간 통계 (peak_hour, anomaly_hours 등 포함)
    llm_summary    TEXT,
    llm_severity   VARCHAR(20),
    llm_trend      TEXT,
    qdrant_point_id VARCHAR(36),
    created_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(system_id, day_bucket, collector_type, metric_group)
);

CREATE INDEX IF NOT EXISTS idx_daily_agg_system_time ON metric_daily_aggregations(system_id, day_bucket DESC);

-- ── Phase 5: 7일 메트릭 집계 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_weekly_aggregations (
    id             SERIAL PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id),
    week_start     TIMESTAMP NOT NULL,      -- 해당 주 월요일 00:00 UTC
    collector_type VARCHAR(50)  NOT NULL,
    metric_group   VARCHAR(100) NOT NULL,
    metrics_json   TEXT NOT NULL,
    llm_summary    TEXT,
    llm_severity   VARCHAR(20),
    llm_trend      TEXT,
    qdrant_point_id VARCHAR(36),
    created_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(system_id, week_start, collector_type, metric_group)
);

CREATE INDEX IF NOT EXISTS idx_weekly_agg_system_time ON metric_weekly_aggregations(system_id, week_start DESC);

-- ── Phase 5: 월/분기/반기/연간 메트릭 집계 ───────────────────────────
CREATE TABLE IF NOT EXISTS metric_monthly_aggregations (
    id             SERIAL PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id),
    period_start   TIMESTAMP NOT NULL,      -- 해당 기간 시작일
    period_type    VARCHAR(20) NOT NULL,    -- monthly | quarterly | half_year | annual
    collector_type VARCHAR(50)  NOT NULL,
    metric_group   VARCHAR(100) NOT NULL,
    metrics_json   TEXT NOT NULL,
    llm_summary    TEXT,
    llm_severity   VARCHAR(20),
    llm_trend      TEXT,
    qdrant_point_id VARCHAR(36),
    created_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(system_id, period_start, period_type, collector_type, metric_group)
);

CREATE INDEX IF NOT EXISTS idx_monthly_agg_system_time ON metric_monthly_aggregations(system_id, period_start DESC, period_type);

-- ── Phase 5: 집계 리포트 발송 이력 ───────────────────────────────────
CREATE TABLE IF NOT EXISTS aggregation_report_history (
    id           SERIAL PRIMARY KEY,
    report_type  VARCHAR(20) NOT NULL,   -- daily | weekly | monthly | quarterly | half_year | annual
    period_start TIMESTAMP NOT NULL,
    period_end   TIMESTAMP NOT NULL,
    sent_at      TIMESTAMP DEFAULT NOW(),
    teams_status VARCHAR(20),            -- sent | failed
    llm_summary  TEXT,
    system_count INTEGER,
    UNIQUE(report_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_report_history_type_time ON aggregation_report_history(report_type, period_start DESC);

-- ── 에이전트 인스턴스 (Phase 6) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_instances (
    id           SERIAL PRIMARY KEY,
    system_id    INTEGER REFERENCES systems(id) ON DELETE CASCADE,
    host         VARCHAR(200) NOT NULL,
    ssh_username VARCHAR(100) NOT NULL,      -- SSH 접속 계정 (password 저장 금지)
    agent_type   VARCHAR(50)  NOT NULL,      -- alloy | node_exporter | jmx_exporter
    install_path VARCHAR(500) NOT NULL,      -- 바이너리 경로
    config_path  VARCHAR(500) NOT NULL,      -- 설정파일 경로
    port         INTEGER,                    -- 메트릭 노출 포트
    pid_file     VARCHAR(500),               -- PID 파일 경로
    label_info   TEXT,                       -- JSON: system_name, instance_role 등
    status       VARCHAR(20) DEFAULT 'unknown',  -- installed | running | stopped | unknown
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_instances_system ON agent_instances(system_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_instances_host   ON agent_instances(host);

-- ── 에이전트 설치 Job 이력 (Phase 6) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_install_jobs (
    id         SERIAL PRIMARY KEY,
    job_id     VARCHAR(36) UNIQUE NOT NULL,
    agent_id   INTEGER REFERENCES agent_instances(id) ON DELETE SET NULL,
    status     VARCHAR(20) DEFAULT 'pending',  -- pending | running | done | failed
    logs       TEXT,
    error      TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_install_jobs_job_id ON agent_install_jobs(job_id);

-- ── 샘플 데이터 (선택) ────────────────────────────────────────────────
-- INSERT INTO systems(system_name, display_name, host, os_type, system_type)
-- VALUES ('customer-experience', '고객 경험 시스템', 'cx-was01', 'linux', 'was');
