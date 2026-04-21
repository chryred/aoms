-- 인시던트 라이프사이클 관리
-- Phase: 인시던트 (Incident Lifecycle)

CREATE TABLE IF NOT EXISTS incidents (
    id              SERIAL PRIMARY KEY,
    system_id       INTEGER REFERENCES systems(id) ON DELETE SET NULL,
    title           VARCHAR(500) NOT NULL,
    severity        VARCHAR(20)  NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'open',
    detected_at     TIMESTAMP    NOT NULL,
    acknowledged_at TIMESTAMP,
    resolved_at     TIMESTAMP,
    closed_at       TIMESTAMP,
    acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    root_cause      TEXT,
    resolution      TEXT,
    postmortem      TEXT,
    alert_count     INTEGER DEFAULT 1,
    recurrence_of   INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_system_status ON incidents(system_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_detected      ON incidents(detected_at);

CREATE TABLE IF NOT EXISTS incident_timeline (
    id          SERIAL PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    event_type  VARCHAR(50) NOT NULL,
    description TEXT,
    actor_name  VARCHAR(200),
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incident_timeline_incident ON incident_timeline(incident_id, created_at);

-- alert_history 에 인시던트 FK 추가
ALTER TABLE alert_history
    ADD COLUMN IF NOT EXISTS incident_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_alert_history_incident ON alert_history(incident_id);

-- log_analysis_history 에 인시던트 FK 추가
ALTER TABLE log_analysis_history
    ADD COLUMN IF NOT EXISTS incident_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL;
