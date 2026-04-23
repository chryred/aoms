-- metric_hourly_patterns Hybrid 전환 + 챗봇 RAG 툴 추가
-- 배경: metric_hourly_patterns를 Dense 전용 → Dense+Sparse Hybrid로 전환하고,
--       챗봇이 1시간 집계 패턴을 검색할 수 있도록 qdrant_search_hourly_patterns 도구 등록.

INSERT INTO chat_tools (name, display_name, description, input_schema, executor) VALUES
    ('qdrant_search_hourly_patterns',
     '시간별 메트릭 패턴 검색',
     'Qdrant Hybrid 검색으로 최근 1시간 단위 시스템 메트릭 집계 패턴을 조회. 사용자가 "오늘 오후 3시 결제 서버 CPU 상태", "아까 DB 메모리 어땠어?", "오전에 로그 에러 급증한 시스템 있었나?" 같이 당일 또는 최근 몇 시간 이내 패턴을 물을 때 사용. 결과는 시간대별 LLM 분석 요약(심각도·추세·예측 포함)을 반환.',
     '{"type":"object","properties":{"query":{"type":"string","description":"검색할 메트릭 패턴 내용 (한국어 자연어, 예: 결제 서비스 CPU 급증 패턴)"},"system_name":{"type":"string","description":"시스템명 필터 (선택, 예: cxm)"},"limit":{"type":"integer","default":5,"description":"최대 반환 건수 (1-10)"}},"required":["query"]}'::jsonb,
     'qdrant')
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
