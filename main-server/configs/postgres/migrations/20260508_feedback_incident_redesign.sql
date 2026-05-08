-- Wave 1A alert_feedback 인시던트 단위 통합 재정의 (2026-05-08)
-- Wave 1 (20260507_feedback_approval.sql) 미배포 상태 가정 — DROP 후 재생성

DROP TABLE IF EXISTS alert_feedback_attachments CASCADE;
DROP TABLE IF EXISTS alert_feedback CASCADE;

CREATE TABLE alert_feedback (
    id               SERIAL PRIMARY KEY,
    incident_id      INTEGER      NOT NULL REFERENCES incidents(id),
    error_type       VARCHAR(100) NOT NULL,
    solution         TEXT         NOT NULL,
    resolver         VARCHAR(200) NOT NULL,
    qdrant_point_id  VARCHAR(36),
    status           VARCHAR(20)  NOT NULL DEFAULT 'pending',
    approver_id      INTEGER      REFERENCES contacts(id) ON DELETE SET NULL,
    approved_by      INTEGER      REFERENCES contacts(id) ON DELETE SET NULL,
    approved_at      TIMESTAMP,
    rejection_reason TEXT,
    rejected_at      TIMESTAMP,
    revision_count   INTEGER      NOT NULL DEFAULT 0,
    created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_feedback_incident ON alert_feedback(incident_id, status);
CREATE INDEX idx_alert_feedback_status   ON alert_feedback(status, created_at);

CREATE TABLE alert_feedback_attachments (
    id                SERIAL PRIMARY KEY,
    feedback_id       INTEGER      NOT NULL REFERENCES alert_feedback(id) ON DELETE CASCADE,
    file_path         VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255),
    sort_order        INTEGER      NOT NULL DEFAULT 0,
    ocr_text          TEXT,
    ocr_status        VARCHAR(20)  DEFAULT 'pending',
    created_at        TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_attachments_feedback ON alert_feedback_attachments(feedback_id);

-- 챗봇 도구 등록 (인시던트 사후분석 검색)
INSERT INTO chat_tools (name, display_name, executor, is_enabled, input_schema, description)
VALUES (
    'qdrant_search_incident_postmortem',
    '인시던트 사후분석 검색',
    'qdrant',
    true,
    '{"type":"object","properties":{"query":{"type":"string"},"system_id":{"type":"integer"},"severity":{"type":"string"},"limit":{"type":"integer","default":5}},"required":["query"]}'::jsonb,
    '인시던트 사후분석(원인·해결책·첨부 OCR 통합) 시맨틱 검색. 비슷한 사건 사례·해결책 자료 조회용'
)
ON CONFLICT (name) DO UPDATE
    SET is_enabled   = EXCLUDED.is_enabled,
        input_schema = EXCLUDED.input_schema,
        description  = EXCLUDED.description;
