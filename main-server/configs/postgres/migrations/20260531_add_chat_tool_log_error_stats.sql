-- admin_get_log_error_stats 챗봇 도구 등록
-- 로그 실에러 건수 조회 (Prometheus log_error_total의 알림성 포함 문제 해결)

INSERT INTO chat_tools (name, display_name, description, input_schema, executor) VALUES
    ('admin_get_log_error_stats', '로그 실에러 건수 조회',
     '시스템별 실에러(알림성 제외) 건수를 log_analysis_history DB에서 조회합니다. **Prometheus의 log_error_total은 알림성(notification) 로그를 포함한 원시 카운터이므로, 실에러만 집계하려면 반드시 이 도구를 사용하세요.** "최근 N시간 실에러 몇 건이야?", "오늘 로그 에러 얼마나 났어?", "알림성 제외 에러 건수 알려줘" 같은 요청에 사용합니다.',
     '{"type":"object","properties":{"system_name":{"type":"string","description":"시스템명(system_name 또는 display_name). 예: cxm, 고객경험시스템"},"hours":{"type":"integer","description":"최근 N시간 기준 (기본 24)","default":24}},"required":["system_name"]}'::jsonb,
     'admin')
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
