-- OCR 진행률 컬럼 추가 (2026-05-08)
-- alert_feedback_attachments 테이블에 ocr_progress(0~100) 컬럼 추가.
-- 기존 처리 중(processing) 첨부는 0으로 초기화 (폴링 시 상태 확인 가능).
ALTER TABLE alert_feedback_attachments
    ADD COLUMN IF NOT EXISTS ocr_progress INTEGER NOT NULL DEFAULT 0;
