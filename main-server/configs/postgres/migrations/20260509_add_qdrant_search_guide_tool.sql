-- 챗봇 ReAct 도구 추가: qdrant_search_guide
-- ADR-011 Hybrid 통일에 따라 knowledge_guides 컬렉션이 log-analyzer에서 인덱싱되며,
-- 챗봇은 ReAct 루프에서 능동적으로 가이드를 검색한다.
--
-- 관련 변경:
--  - log-analyzer: guides_vector_client.py + routes/guides.py 신규 (Hybrid Dense+BM25)
--  - admin-api: services/qdrant_guides.py → log-analyzer 프록시로 전환
--  - admin-api: chat.py 사전 가이드 검색 코드 제거
--  - admin-api: prompts.py 가이드 트리거 추가, chat_agent._HELP_ALLOWED_TOOLS 확장

INSERT INTO chat_tools (name, display_name, description, input_schema, executor)
VALUES (
    'qdrant_search_guide',
    '운영 가이드 검색',
    'knowledge_guides 컬렉션 Hybrid 검색. 기능 사용법·UI 조작·시스템 운영 매뉴얼·절차 안내 등 가이드 문서를 의미+키워드 조합으로 조회. 세션의 system_ids가 자동 주입되며, 시스템별 가이드와 전체 공용 가이드(system_id=NULL)가 함께 검색된다.',
    '{"type":"object","properties":{"query":{"type":"string","description":"검색할 가이드 내용 (한국어 자연어, 예: 알림 임계값 설정 방법)"},"system_ids":{"type":"array","items":{"type":"integer"},"description":"시스템 ID 다중 필터 (선택, 자동 주입됨)"},"limit":{"type":"integer","default":5,"description":"최대 반환 건수 (1-10)"}},"required":["query"]}'::jsonb,
    'qdrant'
)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
