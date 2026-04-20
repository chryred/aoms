-- EMS 도구를 system_display_name + role_label 기반 composite 구조로 개편.
-- DevX LLM이 IP/resource_id를 DLP 목적으로 마스킹하는 문제를 우회.

-- 1) 구 IP/resource_id 기반 도구 삭제
DELETE FROM chat_tools WHERE name IN (
    'ems_find_server_by_ip',
    'ems_get_server_detail',
    'ems_get_summary_usage',
    'ems_get_period_usage',
    'ems_get_alarm_report',
    'ems_get_top_processes'
);

-- 2) ems_get_resources_by_system 스키마/설명 업데이트 (role_label 선택 인자 추가)
UPDATE chat_tools
SET description = 'AOMS에 등록된 시스템 표시명(display_name)으로 연결된 서버 목록(role_label)을 조회합니다. role_label 지정 시 특정 서버만 조회. 이후 다른 EMS 도구들은 system_display_name + role_label 조합으로 사용합니다.',
    input_schema = '{"type":"object","properties":{"system_display_name":{"type":"string","description":"조회할 시스템 표시명 (부분 일치). 예: 고객경험시스템"},"role_label":{"type":"string","description":"특정 서버만 조회할 때 사용 (예: was1, db1). 생략 시 전체."}},"required":["system_display_name"]}'::jsonb
WHERE name = 'ems_get_resources_by_system';

-- 3) 신규 composite 도구 등록
INSERT INTO chat_tools (name, display_name, description, input_schema, executor, is_enabled) VALUES
    ('ems_get_system_server_detail', 'EMS 시스템 서버 상세',
     '시스템 표시명으로 해당 시스템의 모든(또는 지정 role) 서버 상세 정보(OS, 가동시간 등) 조회.',
     '{"type":"object","properties":{"system_display_name":{"type":"string"},"role_label":{"type":"string"}},"required":["system_display_name"]}'::jsonb,
     'ems', TRUE),
    ('ems_get_system_usage_summary', 'EMS 시스템 사용률 요약',
     '시스템 표시명으로 해당 시스템 서버들의 CPU/메모리/디스크 사용률 요약(day/week/month)을 한 번에 조회. role_label 지정 시 해당 서버만.',
     '{"type":"object","properties":{"system_display_name":{"type":"string"},"role_label":{"type":"string"},"timeSelector":{"type":"string","enum":["day","week","month"],"default":"day"}},"required":["system_display_name"]}'::jsonb,
     'ems', TRUE),
    ('ems_get_system_period_usage', 'EMS 시스템 기간별 사용률',
     '시스템 표시명으로 임의 기간(fromTime~toTime)의 서버 사용률을 조회. fromTime/toTime은 반드시 YYYYMMDD 형식(예: 20260418)으로 전달.',
     '{"type":"object","properties":{"system_display_name":{"type":"string"},"role_label":{"type":"string"},"fromTime":{"type":"string","description":"시작 일자 (YYYYMMDD 형식, 예: 20260418)"},"toTime":{"type":"string","description":"종료 일자 (YYYYMMDD 형식, 예: 20260420)"}},"required":["system_display_name","fromTime","toTime"]}'::jsonb,
     'ems', TRUE),
    ('ems_get_system_alarm_report', 'EMS 시스템 알람 조회',
     '시스템 표시명으로 해당 시스템 서버들의 알람 리포트 조회.',
     '{"type":"object","properties":{"system_display_name":{"type":"string"},"role_label":{"type":"string"},"searchType":{"type":"string"},"alarmLevel":{"type":"string","enum":["ATTENTION","TROUBLE","CRITICAL"]},"alarmLevels":{"type":"array","items":{"type":"string"}},"fromTime":{"type":"string"},"toTime":{"type":"string"}},"required":["system_display_name"]}'::jsonb,
     'ems', TRUE),
    ('ems_get_system_top_processes', 'EMS 시스템 Top 프로세스',
     '시스템 표시명으로 각 서버의 CPU/메모리 상위 프로세스 조회.',
     '{"type":"object","properties":{"system_display_name":{"type":"string"},"role_label":{"type":"string"},"topN":{"type":"integer","default":5},"sortBy":{"type":"string","enum":["cpu","memory"],"default":"cpu"}},"required":["system_display_name"]}'::jsonb,
     'ems', TRUE)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    is_enabled   = EXCLUDED.is_enabled;
