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

-- ── 샘플 데이터 (선택) ────────────────────────────────────────────────
-- INSERT INTO systems(system_name, display_name, host, os_type, system_type)
-- VALUES ('customer-experience', '고객 경험 시스템', 'cx-was01', 'linux', 'was');
