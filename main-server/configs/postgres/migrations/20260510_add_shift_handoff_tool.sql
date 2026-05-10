-- 챗봇 ReAct 도구 추가: generate_shift_handoff
-- 사용자가 "오늘 인수인계 보고서 만들어줘", "야간 교대 보고서", "오전 인수인계" 등을 요청하면
-- 지정된 교대 시간대(또는 현재 시각 자동 판정)의 알림·LLM 분석·진행 중 이상을
-- Markdown 인수인계 보고서로 정리합니다. 결과의 export=true 플래그를 프론트엔드가
-- 감지해서 다운로드 버튼을 렌더링 (Feature 2 export_chat_markdown 패턴 재사용).
--
-- 교대 시간 정의 (KST): morning(06-14), afternoon(14-22), night(22-익일 06)
--
-- 관련 변경:
--  - admin-api: services/chat_tools/executors/admin.py — _generate_shift_handoff 추가

INSERT INTO chat_tools (name, display_name, description, input_schema, executor)
VALUES (
    'generate_shift_handoff',
    '인수인계 보고서 생성',
    '지정된 교대 시간대의 메트릭 알림·LLM 로그 분석·진행 중 이상을 정리해 Markdown 인수인계 보고서를 생성합니다. 사용자가 "인수인계 보고서 만들어줘", "오전 교대 보고서", "야간 인수인계 정리해줘" 등을 요청할 때 사용하세요. 교대 시간(KST): morning(06-14), afternoon(14-22), night(22-익일 06). shift를 지정하지 않으면 현재 시각으로 자동 판정. target_date 미지정 시 오늘. slug 파라미터에 영문 kebab-case 식별자(예: "incident-night-summary")를 추가로 전달하면 파일명에 포함됩니다.',
    '{"type":"object","properties":{"shift":{"type":"string","enum":["morning","afternoon","night"],"description":"교대 시간 (선택). 미지정 시 현재 시각 자동 판정."},"target_date":{"type":"string","description":"대상 날짜 (KST, YYYY-MM-DD). 미지정 시 오늘. night이면서 새벽(0-6시)에 호출하면 전날 야간으로 자동 보정."},"slug":{"type":"string","description":"파일명에 추가할 영문 kebab-case 식별자 (예: incident-night-summary). 영문 소문자/숫자/하이픈, 50자 이내. 미지정 시 shift+date 기반 기본 파일명."}},"required":[]}'::jsonb,
    'admin'
)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
