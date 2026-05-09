-- 챗봇 도구 이름 변경: qdrant_get_*_full → qdrant_get_*_chunks
-- 함수가 chunk_indexes 파라미터를 받아 surgical(부분) 또는 full(전체) 둘 다 지원하므로
-- "_full"이라는 이름은 오해의 소지가 있어 "_chunks"로 통일.
--
-- 관련 변경:
--  - admin-api: services/chat_tools/executors/qdrant.py — 함수명 _get_*_chunks,
--    chunk_indexes 파라미터로 surgical fetch (LLM이 빠진 청크 인덱스만 명시)
--  - admin-api: services/prompts.py — 트리거를 "전문 조회"에서 "추가 청크 조회"로 변경,
--    chunk_indexes 명시 권장 (1-3개 청크만 받기로 컨텍스트 절약)
--  - admin-api: services/chat_agent._HELP_ALLOWED_TOOLS — 새 이름으로 갱신
--  - log-analyzer: get_guide_chunks/get_document_chunks/get_confluence_chunks 모두
--    chunk_indexes 파라미터 받도록 시그니처 확장 (Qdrant filter must any 추가)
--  - log-analyzer routes: ?chunk_indexes=2&chunk_indexes=4 형식 query 지원

DELETE FROM chat_tools WHERE name IN (
    'qdrant_get_guide_full',
    'qdrant_get_document_full',
    'qdrant_get_confluence_full'
);

INSERT INTO chat_tools (name, display_name, description, input_schema, executor) VALUES
    ('qdrant_get_guide_chunks', '운영 가이드 청크 조회',
     'qdrant_search_guide 결과의 chunk_index/total_chunks 비교로 빠진 청크를 보강 조회. chunk_indexes를 명시하면 surgical fetch (1-3개 권장, 컨텍스트 절약), 생략하면 가이드 전체 (사용자가 "전문/전체" 명시한 경우에만).',
     '{"type":"object","properties":{"guide_id":{"type":"string","description":"검색 결과의 guide_id (UUID)"},"chunk_indexes":{"type":"array","items":{"type":"integer"},"description":"가져올 청크 인덱스 (예: [2,4,5]). 생략 시 전체."},"max_chunks":{"type":"integer","default":50,"description":"chunk_indexes 미지정 시 상한 (기본 50, 최대 100)"}},"required":["guide_id"]}'::jsonb, 'qdrant'),
    ('qdrant_get_document_chunks', '문서 청크 조회',
     'qdrant_search_knowledge 결과 중 source=documents에 file_hash가 있을 때 청크를 보강 조회. chunk_indexes 명시로 surgical fetch 권장. 페이지/시트/슬라이드 메타 포함.',
     '{"type":"object","properties":{"file_hash":{"type":"string","description":"검색 결과의 file_hash"},"chunk_indexes":{"type":"array","items":{"type":"integer"},"description":"가져올 청크 인덱스. 생략 시 전체."}},"required":["file_hash"]}'::jsonb, 'qdrant'),
    ('qdrant_get_confluence_chunks', 'Confluence 페이지 청크 조회',
     'qdrant_search_knowledge 결과 중 source=confluence에 page_id가 있을 때 청크를 보강 조회. chunk_indexes 명시로 surgical fetch 권장. 헤딩 구조 포함.',
     '{"type":"object","properties":{"page_id":{"type":"string","description":"검색 결과의 page_id"},"chunk_indexes":{"type":"array","items":{"type":"integer"},"description":"가져올 청크 인덱스. 생략 시 전체."},"max_chunks":{"type":"integer","default":50,"description":"chunk_indexes 미지정 시 상한 (기본 50, 최대 100)"}},"required":["page_id"]}'::jsonb, 'qdrant')
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
