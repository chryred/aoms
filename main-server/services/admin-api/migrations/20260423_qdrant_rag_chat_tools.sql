-- ADR-011: Qdrant Hybrid Search 기반 RAG 챗봇 도구 추가
-- 배경: Ollama 임베딩 제거 → FastEmbed(bge-m3 Dense + BM25 Sparse) Hybrid 전환
-- 챗봇이 log_incidents / metric_baselines / aggregation_summaries 를 벡터 검색할 수 있도록
-- qdrant executor 및 관련 도구 2건 등록.

-- qdrant executor config 기본 레코드 (base_url 미지정 시 LOG_ANALYZER_URL 환경변수 사용)
INSERT INTO chat_executor_configs (executor, config, config_schema) VALUES
    ('qdrant', '{}'::jsonb, '[
        {"key":"base_url","label":"log-analyzer URL (Qdrant 프록시)","type":"url","required":false}
     ]'::jsonb)
ON CONFLICT (executor) DO NOTHING;

-- qdrant chat_tools 시드 2건
INSERT INTO chat_tools (name, display_name, description, input_schema, executor) VALUES
    ('qdrant_search_incident_knowledge',
     '과거 장애 이력 의미 검색',
     'Qdrant Hybrid 검색으로 과거 장애 패턴·원인·해결책을 의미+키워드 조합으로 조회. 사용자가 "이 에러 전에도 있었나?", "OOM 어떻게 해결했어?", "DB 연결 오류 원인" 같이 물을 때 사용. 결과는 log_incidents(LLM 로그 분석 이력)와 metric_baselines(메트릭 알림 이력)에서 통합 반환.',
     '{"type":"object","properties":{"query":{"type":"string","description":"검색할 장애 내용 (한국어 자연어, 예: 결제 서비스 OOM 이슈)"},"system_name":{"type":"string","description":"시스템명 필터 (선택)"},"limit":{"type":"integer","default":5,"description":"각 컬렉션별 최대 건수 (1-10)"}},"required":["query"]}'::jsonb,
     'qdrant'),
    ('qdrant_search_aggregation_summary',
     '기간별 시스템 요약 검색',
     'Qdrant Hybrid 검색으로 일/주/월 단위 시스템 분석 요약을 조회. 사용자가 "지난달 결제 서비스 상태", "3월 어떤 장애", "이번 주 DB 이슈" 같이 기간+시스템 조합으로 물을 때 사용.',
     '{"type":"object","properties":{"query":{"type":"string","description":"검색할 내용 (한국어 자연어, 예: 결제서비스 3월 OOM)"},"system_id":{"type":"integer","description":"시스템 ID 필터 (선택)"},"limit":{"type":"integer","default":5}},"required":["query"]}'::jsonb,
     'qdrant')
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
