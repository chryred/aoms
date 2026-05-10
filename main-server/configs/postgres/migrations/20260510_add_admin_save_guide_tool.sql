-- 챗봇 ReAct 도구 추가: admin_save_guide
-- 사용자가 "이 해결책을 가이드로 저장해줘", "운영 매뉴얼로 등록해줘" 등을 요청하면
-- LLM이 대화 컨텍스트에서 title/content/system_id/category/tags를 추출해
-- knowledge_guides 테이블에 저장하고 Qdrant에 Hybrid 임베딩한다.
--
-- 저장된 가이드는 다음 대화에서 qdrant_search_guide 도구로 RAG 검색에 활용됨.
--
-- 관련 변경:
--  - admin-api: services/chat_tools/executors/admin.py — _save_guide 추가

INSERT INTO chat_tools (name, display_name, description, input_schema, executor)
VALUES (
    'admin_save_guide',
    '운영 가이드 저장',
    '대화 내용에서 추출한 운영 가이드/해결책/매뉴얼을 knowledge_guides 컬렉션에 저장합니다. 사용자가 "이 해결책을 가이드로 저장해줘", "이 절차 매뉴얼로 등록", "이 내용 지식베이스에 추가해줘" 등을 요청할 때 사용하세요. **title은 한국어 짧은 제목**, **content는 가이드 본문(마크다운, 단계별 절차 권장)**, system_id는 관련 시스템 ID(전체 공용이면 생략), category는 ''incident''/''manual''/''policy''/''troubleshooting'' 등 자유 입력, tags는 검색용 키워드 배열. 저장된 가이드는 향후 qdrant_search_guide 도구로 RAG 검색됩니다. content는 최소 30자, title은 최대 255자.',
    '{"type":"object","properties":{"title":{"type":"string","description":"가이드 제목 (한국어, 1줄, 최대 255자)"},"content":{"type":"string","description":"가이드 본문 (마크다운). 단계별 절차·해결책·점검 항목을 풍부하게 작성. 최소 30자."},"system_id":{"type":"integer","description":"관련 시스템 ID. 모든 시스템에 공용이면 생략."},"category":{"type":"string","description":"카테고리 (예: incident, manual, policy, troubleshooting). 자유 입력, 50자 이내."},"tags":{"type":"array","items":{"type":"string"},"description":"검색용 태그 배열 (최대 10개, 각 50자)."}},"required":["title","content"]}'::jsonb,
    'admin'
)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
