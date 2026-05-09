-- 챗봇 ReAct 도구 추가: qdrant_get_*_full (3종 청킹 컬렉션 전문 조회)
-- 검색 도구가 limit 컷오프로 일부 청크만 노출할 때, LLM이 가이드/문서/페이지 전문이
-- 필요하다고 판단하면 호출하는 fetch 도구. payload.total_chunks 와 받은 청크 수를
-- 비교해 LLM이 능동적으로 보강 호출.
--
-- 관련 변경:
--  - log-analyzer: guides_vector_client.get_guide_chunks + GET /guides/{id}/chunks
--  - log-analyzer: knowledge_vector_client.get_confluence_chunks + GET /knowledge/confluence/{id}/chunks
--  - log-analyzer: knowledge_documents 는 GET /knowledge/documents/{file_hash}/chunks 기존 endpoint 재사용
--  - admin-api: chat_tools/executors/qdrant.py — _get_*_full 3종 + 디스패처
--  - admin-api: chat_agent._HELP_ALLOWED_TOOLS 에 3종 추가 (게스트도 전문 조회 허용)
--  - admin-api: prompts.py — 호출 트리거 가이드 추가

INSERT INTO chat_tools (name, display_name, description, input_schema, executor) VALUES
    ('qdrant_get_guide_full', '운영 가이드 전문 조회',
     'qdrant_search_guide 결과에서 일부 청크만 받아 답변에 부족한 경우, 해당 가이드의 전체 청크를 chunk_index 순서로 반환. 사용자가 "전문/전체 보여줘"라고 명시하거나 절차가 끊겨 보일 때 사용.',
     '{"type":"object","properties":{"guide_id":{"type":"string","description":"검색 결과의 guide_id (UUID)"},"max_chunks":{"type":"integer","default":50,"description":"최대 청크 수 (기본 50, 최대 100)"}},"required":["guide_id"]}'::jsonb, 'qdrant'),
    ('qdrant_get_document_full', '문서 전문 조회',
     'qdrant_search_knowledge 결과 중 source=documents에 file_hash가 있을 때, 해당 문서의 모든 청크를 chunk_index 순서로 반환. 페이지/시트/슬라이드 메타도 포함.',
     '{"type":"object","properties":{"file_hash":{"type":"string","description":"검색 결과의 file_hash"}},"required":["file_hash"]}'::jsonb, 'qdrant'),
    ('qdrant_get_confluence_full', 'Confluence 페이지 전문 조회',
     'qdrant_search_knowledge 결과 중 source=confluence에 page_id가 있을 때, 해당 페이지의 모든 청크를 chunk_index 순서로 반환. 헤딩 구조 포함.',
     '{"type":"object","properties":{"page_id":{"type":"string","description":"검색 결과의 page_id"},"max_chunks":{"type":"integer","default":50,"description":"최대 청크 수 (기본 50, 최대 100)"}},"required":["page_id"]}'::jsonb, 'qdrant')
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
