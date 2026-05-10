-- 챗봇 ReAct 도구 추가: prometheus_range_query
-- 24시간 추이, 1주일 변화 등 시계열 조회용 (Prometheus /api/v1/query_range)
-- 기존 prometheus_query는 instant only (한 시점), 본 도구는 range (시계열)
--
-- 관련 변경:
--  - admin-api: services/chat_tools/executors/prometheus.py — _run_range_query 추가

INSERT INTO chat_tools (name, display_name, description, input_schema, executor)
VALUES (
    'prometheus_range_query',
    'Prometheus 시계열 추이 조회',
    'Prometheus 시계열 데이터를 instance_role별로 분리 반환. 24시간 CPU 추이, 1주일 메모리 변화 등 ''추이''·''변화''·''히스토리''·''지난 N시간'' 키워드 질문에 사용. 보관 기간(운영 15일) 이내. start_time/end_time은 KST 자연어 또는 ISO 형식. step은 시점 간격 (기본 5m, 24시간이면 5m~30m 권장). 데이터 포인트 1000개 한도.',
    '{"type":"object","properties":{"system_name":{"type":"string","description":"시스템명 (예: cxm)"},"metric_group":{"type":"string","enum":["cpu","memory","disk","network","log","web","db"],"description":"메트릭 그룹"},"start_time":{"type":"string","description":"조회 시작 시각 (KST). 예: ''24시간 전'', ''어제 0시'', ''2026-05-09 00:00''"},"end_time":{"type":"string","description":"조회 종료 시각 (KST). 생략 시 현재."},"step":{"type":"string","default":"5m","description":"시점 간격 (Prometheus 기간 표현). 24시간이면 5m~30m 권장. 1주일이면 1h~6h."},"aggregation":{"type":"string","enum":["avg","max","min","p95","sum"],"default":"avg","description":"집계 방식 (각 step 윈도우 내)"}},"required":["system_name","metric_group","start_time"]}'::jsonb,
    'prometheus'
)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
