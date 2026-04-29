-- 챗봇 다중 시스템 스코프 + 메시지별 system_id (Wave 1)
-- 적용: psql -U synapse -d synapse < 20260429_chat_multi_system.sql

-- chat_sessions: 다중 시스템 선택 + 소프트 삭제
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS system_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_system_ids
    ON chat_sessions USING GIN (system_ids);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_active
    ON chat_sessions(user_id, updated_at DESC)
    WHERE deleted_at IS NULL;

-- chat_messages: 메시지별 실제 조회 시스템 추적 (통계용)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS system_id INTEGER
    REFERENCES systems(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_system
    ON chat_messages(system_id, created_at)
    WHERE system_id IS NOT NULL;
