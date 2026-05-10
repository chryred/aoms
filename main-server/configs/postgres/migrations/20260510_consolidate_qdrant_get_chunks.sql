-- 챗봇 ReAct 도구 통합: qdrant_get_*_chunks 3개 → qdrant_get_chunks 1개
-- 청크 조회 패턴이 동일하므로 source 파라미터로 분기.
-- 컨텍스트 토큰 ~250-300 절감 + 향후 청크 컬렉션 추가 시 source enum만 추가.
--
-- 관련 변경:
--  - admin-api: services/chat_tools/executors/qdrant.py — _get_chunks 추가, execute 분기 통합
--  - admin-api: services/prompts.py — _CHUNK_FETCH_GUIDE 업데이트

-- 기존 3개 도구 제거
DELETE FROM chat_tools WHERE name IN (
    'qdrant_get_guide_chunks',
    'qdrant_get_document_chunks',
    'qdrant_get_confluence_chunks'
);

-- 통합 도구 등록
INSERT INTO chat_tools (name, display_name, description, input_schema, executor)
VALUES (
    'qdrant_get_chunks',
    '청크 조회 (통합)',
    'Qdrant 청크 컬렉션의 청크를 source 별로 분기 조회하는 통합 도구. qdrant_search_guide / qdrant_search_knowledge 결과의 chunk_index/total_chunks를 비교해 빠진 청크 보강 시 사용. **chunk_indexes 명시로 surgical fetch (1-3개 청크만 — 컨텍스트 절약 권장)**, 생략 시 전체 (max_chunks 상한 적용). source=''guide''면 id에 guide_id(UUID), source=''document''면 id에 file_hash, source=''confluence''면 id에 page_id 입력. 단순 요약 질문에는 추가 호출하지 마세요.',
    '{"type":"object","properties":{"source":{"type":"string","enum":["guide","document","confluence"],"description":"청크 컬렉션 종류"},"id":{"type":"string","description":"source에 따라 guide_id(UUID) | file_hash(sha256) | page_id"},"chunk_indexes":{"type":"array","items":{"type":"integer"},"description":"가져올 청크 인덱스 배열 (예: [2,4,5]). 생략 시 전체."},"max_chunks":{"type":"integer","default":50,"description":"chunk_indexes 미지정 시 상한 (기본 50, 최대 100). document에는 영향 없음."}},"required":["source","id"]}'::jsonb,
    'qdrant'
)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
