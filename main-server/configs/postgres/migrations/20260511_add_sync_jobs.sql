-- P2-C: Jira/Confluence 단건 강제 재동기화 비동기 Job 테이블 추가
-- 적용 대상: 기존 운영 DB (신규 설치는 init.sql에서 자동 생성)

CREATE TABLE IF NOT EXISTS knowledge_sync_jobs (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    source         VARCHAR(20)  NOT NULL,                  -- 'jira' | 'confluence'
    ref_id         VARCHAR(200) NOT NULL,                  -- issue_key 또는 page_id
    status         VARCHAR(20)  NOT NULL DEFAULT 'pending',-- pending | processing | done | failed
    progress       INTEGER      NOT NULL DEFAULT 0,        -- 0~100
    result_json    JSONB,                                  -- 완료 시 결과 (synced, chunks 등)
    error_message  TEXT,
    triggered_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    started_at     TIMESTAMP,
    completed_at   TIMESTAMP,
    created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_source_ref  ON knowledge_sync_jobs(source, ref_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status      ON knowledge_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_created_at  ON knowledge_sync_jobs(created_at);
