-- knowledge_sync_status 테이블에 is_syncing 컬럼 추가
-- 동기화 진행 중 여부를 DB에 저장하여 모든 세션에서 정확한 상태 공유
ALTER TABLE knowledge_sync_status
    ADD COLUMN IF NOT EXISTS is_syncing BOOLEAN NOT NULL DEFAULT FALSE;
