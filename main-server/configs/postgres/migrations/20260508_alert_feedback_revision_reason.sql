-- 재등록 사유 컬럼 추가 (재승인 컨텍스트용, 최신만 보존)
ALTER TABLE alert_feedback
    ADD COLUMN IF NOT EXISTS revision_reason TEXT;
