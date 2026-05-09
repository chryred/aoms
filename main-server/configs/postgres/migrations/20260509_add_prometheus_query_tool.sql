-- 챗봇 ReAct 도구 추가: prometheus_query
-- Prometheus 보관 기간(운영 15d, 개발 3d) 이내의 raw 메트릭 값을 instance_role 단위로 조회.
-- KST 입력 → UTC 변환 → Prometheus instant query → KST 포맷 응답.
-- 보관 기간 초과 시 ems_get_system_period_usage / qdrant_search_aggregation_summary로 폴백 안내.
--
-- 관련 변경:
--  - admin-api: services/chat_tools/executors/prometheus.py 신규
--  - admin-api: services/chat_tools/registry.py _EXECUTORS에 prometheus 등록
--  - admin-api: services/prompts.py 트리거 추가
--  - frontend: ChatToolsPage EXECUTOR_LABELS + types/chat.ts executor union 추가

-- 1) chat_executor_configs: prometheus 그룹이 어드민 UI에 노출되도록 행 추가 (자격증명 없음)
INSERT INTO chat_executor_configs (executor, config, config_schema)
VALUES ('prometheus', '{}'::jsonb, '[]'::jsonb)
ON CONFLICT (executor) DO NOTHING;

-- 2) chat_tools 도구 등록
INSERT INTO chat_tools (name, display_name, description, input_schema, executor)
VALUES (
    'prometheus_query',
    'Prometheus raw 메트릭 조회',
    'Prometheus에서 system_name + metric_group 기반으로 raw 메트릭 값을 조회. 보관 기간(운영 15일) 이내의 정확한 수치를 instance_role별로 분리하여 반환. KST 입력 → 내부 UTC 변환, 결과 timestamp는 KST 포맷. "지금 결제 시스템 CPU 얼마야", "오늘 3시 메모리 사용률" 같은 raw 수치 질문에 사용.',
    '{"type":"object","properties":{"system_name":{"type":"string","description":"시스템명 (Prometheus label, 예: cxm)"},"metric_group":{"type":"string","enum":["cpu","memory","disk","network","log","web","db"],"description":"메트릭 그룹"},"time":{"type":"string","description":"조회 시각 (KST). 예: ''now'', ''오늘 3시'', ''2026-05-09 14:00''. 생략 시 현재."},"window":{"type":"string","description":"집계 윈도우 (Prometheus 기간 표현). 예: 5m, 1h, 24h. 기본 5m."},"aggregation":{"type":"string","enum":["avg","max","min","p95","sum"],"default":"avg","description":"집계 방식"}},"required":["system_name","metric_group"]}'::jsonb,
    'prometheus'
)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
