-- 챗봇 ReAct 도구 추가: admin_create_feedback
-- 사용자가 "이 인시던트 해결책으로 [내용] 등록해줘"라고 요청하면
-- alert_feedback 테이블에 status=pending row를 INSERT.
-- 인시던트가 resolved/closed 상태여야 하며, approver는 활성 User에 매핑된 Contact여야 함.
-- 첨부파일은 처리하지 않음 (텍스트만).
--
-- 관련 변경:
--  - admin-api: services/chat_tools/executors/admin.py — _create_feedback 추가

INSERT INTO chat_tools (name, display_name, description, input_schema, executor)
VALUES (
    'admin_create_feedback',
    '인시던트 피드백 등록',
    '인시던트 해결책 피드백을 alert_feedback 테이블에 등록합니다 (status=pending). 사용자가 "이 인시던트 해결책으로 [내용] 등록해줘", "사후 피드백 작성해줘", "이 해결 절차 등록" 등을 요청할 때 사용하세요. **인시던트가 resolved 또는 closed 상태여야 함**. approver_contact_id 미지정 시 시스템의 primary 담당자가 자동 선택됨. solution은 최소 30자. 첨부파일은 처리하지 않으므로 텍스트 본문에 모든 내용을 포함해야 함. 등록 후 승인자가 검토·승인하면 Qdrant에 임베딩되어 RAG 검색에 활용됨.',
    '{"type":"object","properties":{"incident_id":{"type":"integer","description":"피드백을 등록할 인시던트 ID. 화면 컨텍스트의 incident_id 또는 사용자가 명시한 ID."},"error_type":{"type":"string","description":"장애 유형 (간결한 카테고리, 예: ''메모리 누수'', ''DB 연결 풀 고갈'', ''캐시 무효화 지연''). 최대 100자."},"solution":{"type":"string","description":"해결 절차/방법 본문. 단계별 markdown 권장. 최소 30자, 최대 10,000자."},"resolver":{"type":"string","description":"해결 담당자/팀 (예: ''결제팀 김OO''). 미지정 시 ''챗봇 자동 등록''."},"approver_contact_id":{"type":"integer","description":"승인 검토자 contact_id. 미지정 시 시스템의 primary 담당자 자동 선택."}},"required":["incident_id","error_type","solution"]}'::jsonb,
    'admin'
)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
