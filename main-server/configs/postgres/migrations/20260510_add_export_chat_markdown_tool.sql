-- 챗봇 ReAct 도구 추가: export_chat_markdown
-- 사용자가 "대화 내용을 markdown으로 저장해줘"라고 요청하면
-- 현재 세션의 user/assistant 메시지 전체를 Markdown 형식으로 내보냅니다.
-- 결과의 export=true 플래그를 프론트엔드 ToolCallCard가 감지하여 다운로드 버튼을 렌더링.
--
-- 관련 변경:
--  - admin-api: services/chat_tools/executors/admin.py — _export_chat_markdown 추가 + slug 지원
--  - admin-api: services/chat_agent.py — _session_id 주입 (line 365 직전)
--  - frontend: components/chat/ToolCallCard.tsx — export:true 결과 다운로드 UI

INSERT INTO chat_tools (name, display_name, description, input_schema, executor)
VALUES (
    'export_chat_markdown',
    '대화 Markdown 내보내기',
    '현재 챗봇 세션의 user/assistant 대화 내용을 Markdown 형식으로 내보냅니다. 사용자가 "대화 내용을 markdown으로 저장해줘", "이 대화 .md 파일로 받고 싶어", "여기까지 정리해서 파일로 줘" 등 대화 기록을 파일로 저장하려 할 때 사용하세요. slug 파라미터에는 대화 주제를 영문 kebab-case로 요약한 짧은 식별자를 전달하세요 (예: "cpu-spike-investigation", "deployment-procedure-review", "incident-postmortem-db1"). 슬러그는 영문 소문자/숫자/하이픈만 사용, 50자 이내. 누락 시 타임스탬프만으로 파일명이 생성됩니다.',
    '{"type":"object","properties":{"slug":{"type":"string","description":"대화 주제를 요약한 영문 kebab-case 식별자 (예: cpu-spike-investigation). 영문 소문자·숫자·하이픈만, 50자 이내. 파일명에 포함되어 사용자가 어떤 대화인지 식별할 수 있게 합니다."}},"required":[]}'::jsonb,
    'admin'
)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
