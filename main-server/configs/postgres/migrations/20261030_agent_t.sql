-- Agent-T: systems 기준정보 3컬럼 + APM 대시보드 + 에이전트 명령 큐
-- 멱등(IF NOT EXISTS). agent_instances 의 otel_javaagent 행은 변환하지 않는다(운영 0건).

ALTER TABLE systems ADD COLUMN IF NOT EXISTS environment VARCHAR(10) NOT NULL DEFAULT 'prod';
ALTER TABLE systems ADD COLUMN IF NOT EXISTS tx_slow_threshold_ms INTEGER NOT NULL DEFAULT 3000;
ALTER TABLE systems ADD COLUMN IF NOT EXISTS tx_retention_days INTEGER NOT NULL DEFAULT 7;

-- ── APM 대시보드 (Agent-T) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS apm_dashboards (
    id                SERIAL PRIMARY KEY,
    owner_user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name              VARCHAR(100) NOT NULL,
    layout            JSONB NOT NULL DEFAULT '[]'::jsonb,
    filters           JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_shared_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_apm_dashboards_owner ON apm_dashboards(owner_user_id);

-- ── Agent-T 원격 명령 큐 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_commands (
    id                SERIAL PRIMARY KEY,
    agent_instance_id INTEGER NOT NULL REFERENCES agent_instances(id) ON DELETE CASCADE,
    command           VARCHAR(30) NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | sent | done | failed
    result_ref        VARCHAR(100),
    requested_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMP DEFAULT NOW(),
    updated_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_commands_agent_status ON agent_commands(agent_instance_id, status);
