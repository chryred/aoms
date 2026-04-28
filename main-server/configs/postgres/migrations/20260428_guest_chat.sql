-- V2 게스트 채팅 마이그레이션
-- chat_sessions.user_id nullable + 방문자 감사 정보 + incidents.source

-- 1) chat_sessions.user_id nullable (게스트 세션은 user 없음)
ALTER TABLE chat_sessions ALTER COLUMN user_id DROP NOT NULL;

-- 2) 방문자 감사 정보 컬럼
ALTER TABLE chat_sessions
    ADD COLUMN IF NOT EXISTS visitor_employee_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS visitor_email       VARCHAR(200),
    ADD COLUMN IF NOT EXISTS visitor_system_id   INTEGER REFERENCES systems(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_visitor
    ON chat_sessions(visitor_employee_id)
    WHERE visitor_employee_id IS NOT NULL;

-- 3) incidents 에스컬레이션 출처 구분
-- NULL=기존 alert/analysis 자동생성, 'help_inquiry'=현업 에스컬레이션
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT NULL;
