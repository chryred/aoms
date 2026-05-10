-- migration: 20260510_add_guide_status.sql
-- 목적: knowledge_guides 테이블에 status 컬럼 추가 (draft/published 워크플로우)
--       draft = LLM 자동 저장(Qdrant 미인덱싱, 운영자 검토 필요)
--       published = 운영자 승인 완료(Qdrant 인덱싱, RAG 검색 노출)
-- 기존 운영 DB: 기존 레코드 모두 published로 처리 (server_default 적용)

ALTER TABLE knowledge_guides
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'published';

-- chat_tools description 업데이트: admin_save_guide가 draft 저장임을 LLM에 명시
UPDATE chat_tools
SET
    display_name = '운영 가이드 초안 저장',
    description  = '대화 내용에서 추출한 운영 가이드/해결책/매뉴얼을 knowledge_guides에 **초안(draft)으로 저장**합니다. 사용자가 "이 해결책을 가이드로 저장해줘", "이 절차 매뉴얼로 등록", "이 내용 지식베이스에 추가해줘" 등을 요청할 때 사용하세요. **title은 한국어 짧은 제목**, **content는 가이드 본문(마크다운, 단계별 절차 권장)**, system_id는 관련 시스템 ID(전체 공용이면 생략), category는 ''incident''/''manual''/''policy''/''troubleshooting'' 등 자유 입력, tags는 검색용 키워드 배열. ⚠️ **초안으로만 저장됩니다** — Qdrant 인덱싱이 즉시 일어나지 않으며, 운영자가 관리 화면(/admin/guides)에서 검토·게시(Publish) 승인 후 RAG 검색에 노출됩니다. content는 최소 30자, title은 최대 255자.',
    updated_at   = NOW()
WHERE name = 'admin_save_guide';
