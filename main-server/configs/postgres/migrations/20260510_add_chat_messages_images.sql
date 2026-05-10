-- chat_messages에 images JSONB 컬럼 추가
-- 챗봇 응답에 포함된 가이드 이미지 등을 영구 저장 → 새로고침 후에도 표시
-- 도구 응답에 "images" 키가 있으면 run_react_stream이 자동 추적하여 final assistant 메시지에 저장.
--
-- 관련 변경:
--  - admin-api: models.py ChatMessage에 images 필드
--  - admin-api: schemas.py ChatMessageOut에 images 필드
--  - admin-api: services/chat_agent.py — _append_message + run_react_stream

ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb;
