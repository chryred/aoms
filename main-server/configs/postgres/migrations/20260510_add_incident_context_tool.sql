-- 챗봇 ReAct 도구 추가: admin_get_incident_context
-- 화면 컨텍스트에 incident_id가 있을 때 LLM이 첫 도구 호출로 사용.
-- 인시던트 기본 정보 + 연결 알림(20) + LLM 분석(10) + 타임라인(30) + MTTA/MTTR + 다음 권장 액션을 종합 반환.
--
-- 관련 변경:
--  - admin-api: services/chat_tools/executors/admin.py — _get_incident_context 추가
--  - admin-api: services/prompts.py — decision_prompt 에 인시던트 컨텍스트 가이드 추가

INSERT INTO chat_tools (name, display_name, description, input_schema, executor)
VALUES (
    'admin_get_incident_context',
    '인시던트 컨텍스트 조회',
    '특정 incident_id의 종합 컨텍스트를 반환합니다. 화면 컨텍스트(`사용자 화면 컨텍스트:`)에 "인시던트: <id>" 가 있을 때 LLM이 답변 전에 자동으로 호출해야 합니다. 응답에는 인시던트 기본 정보(title/severity/status/MTTA/MTTR), 연결된 알림 최대 20건, 연결된 LLM 로그 분석 최대 10건, 타임라인 이벤트 최대 30건, 진행률(%), 다음 권장 액션이 포함됩니다. 이미 같은 incident_id의 결과가 대화 이력에 있으면 재호출하지 마세요.',
    '{"type":"object","properties":{"incident_id":{"type":"integer","description":"조회할 인시던트 ID. 화면 컨텍스트의 incident_id를 그대로 사용."}},"required":["incident_id"]}'::jsonb,
    'admin'
)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
