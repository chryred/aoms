-- Chatbot (ReAct) 테이블 및 시드
-- 실행: docker exec -i synapse-postgres psql -U synapse -d synapse < migrations/20260418_chat_assistant.sql

-- UUID PK 용 pgcrypto 확장
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) chat_tools
CREATE TABLE IF NOT EXISTS chat_tools (
    name          VARCHAR(100) PRIMARY KEY,
    display_name  VARCHAR(200) NOT NULL,
    description   TEXT NOT NULL,
    input_schema  JSONB NOT NULL DEFAULT '{}'::jsonb,
    executor      VARCHAR(20)  NOT NULL,
    is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT NOW(),
    updated_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_tools_exec ON chat_tools(executor, is_enabled);

-- 2) chat_executor_configs
CREATE TABLE IF NOT EXISTS chat_executor_configs (
    executor      VARCHAR(20) PRIMARY KEY,
    config        JSONB NOT NULL DEFAULT '{}'::jsonb,
    config_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at    TIMESTAMP DEFAULT NOW()
);

-- 3) chat_sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL DEFAULT '새 대화',
    area_code   VARCHAR(50)  NOT NULL DEFAULT 'chat_assistant',
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);

-- 4) chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role         VARCHAR(20) NOT NULL,
    content      TEXT NOT NULL DEFAULT '',
    thought      TEXT,
    tool_name    VARCHAR(100),
    tool_args    JSONB,
    tool_result  JSONB,
    attachments  JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);

-- 5) chat_assistant LLM agent 시드
INSERT INTO llm_agent_configs (area_code, area_name, agent_code, description) VALUES
    ('chat_assistant', 'ReAct 챗봇 어시스턴트',
     'custom_8f9ee032e5594452bff5602c03e966eb',
     '운영 어시스턴트: EMS/admin/log-analyzer 도구를 활용한 대화형 분석')
ON CONFLICT (area_code) DO NOTHING;

-- 6) chat_executor_configs 시드
INSERT INTO chat_executor_configs (executor, config, config_schema) VALUES
    ('ems', '{}'::jsonb, '[
        {"key":"base_url","label":"EMS URL","type":"url","required":true},
        {"key":"username","label":"ID","type":"string","required":true},
        {"key":"password","label":"비밀번호","type":"password","required":true,"secret":true}
     ]'::jsonb),
    ('admin', '{}'::jsonb, '[]'::jsonb),
    ('log_analyzer', '{}'::jsonb, '[
        {"key":"base_url","label":"log-analyzer URL","type":"url","required":false}
     ]'::jsonb)
ON CONFLICT (executor) DO NOTHING;

-- 7) chat_tools 시드
INSERT INTO chat_tools (name, display_name, description, input_schema, executor) VALUES
    ('ems_login', 'EMS 로그인', 'Polestar EMS에 로그인하여 세션을 확보합니다.',
     '{"type":"object","properties":{},"required":[]}'::jsonb, 'ems'),
    ('ems_get_team_group_id', 'EMS 팀 그룹 ID 조회', '팀명을 입력해 EMS 그룹 ID 후보를 반환.',
     '{"type":"object","properties":{"teamname":{"type":"string","description":"팀명"}},"required":["teamname"]}'::jsonb, 'ems'),
    ('ems_list_servers_by_team', 'EMS 팀별 서버 목록', '팀명 또는 그룹 ID로 서버 목록을 조회.',
     '{"type":"object","properties":{"teamnames":{"type":"array","items":{"type":"string"}},"groupIds":{"type":"array","items":{"type":"string"}}}}'::jsonb, 'ems'),
    ('ems_find_server_by_ip', 'EMS IP로 서버 찾기', 'IP를 입력해 EMS 서버 정보를 반환.',
     '{"type":"object","properties":{"ip":{"type":"string"}},"required":["ip"]}'::jsonb, 'ems'),
    ('ems_get_server_detail', 'EMS 서버 상세', '서버 resourceId 또는 IP로 상세 정보 조회.',
     '{"type":"object","properties":{"resourceId":{"type":"string"},"ip":{"type":"string"}}}'::jsonb, 'ems'),
    ('ems_get_summary_usage', 'EMS 사용률 요약', 'CPU/메모리/디스크 사용률 요약(day/week/month).',
     '{"type":"object","properties":{"resourceId":{"type":"string"},"ip":{"type":"string"},"timeSelector":{"type":"string","enum":["day","week","month"]}}}'::jsonb, 'ems'),
    ('ems_get_period_usage', 'EMS 기간별 사용률', '임의 시작/종료 시각 범위의 사용률.',
     '{"type":"object","properties":{"resourceId":{"type":"string"},"ip":{"type":"string"},"fromTime":{"type":"string"},"toTime":{"type":"string"}},"required":["fromTime","toTime"]}'::jsonb, 'ems'),
    ('ems_get_alarm_report', 'EMS 알람 조회', 'EMS 알람 리포트 조회.',
     '{"type":"object","properties":{"searchType":{"type":"string"},"alarmLevel":{"type":"string","enum":["ATTENTION","TROUBLE","CRITICAL"]}}}'::jsonb, 'ems'),
    ('ems_get_top_processes', 'EMS Top 프로세스', '서버의 CPU/메모리 상위 프로세스 조회.',
     '{"type":"object","properties":{"resourceId":{"type":"string"},"ip":{"type":"string"},"topN":{"type":"integer","default":5},"sortBy":{"type":"string","enum":["cpu","memory"],"default":"cpu"}}}'::jsonb, 'ems'),
    ('admin_list_systems', '시스템 목록 조회', 'Synapse-V에 등록된 모니터링 시스템 목록 조회.',
     '{"type":"object","properties":{"system_type":{"type":"string"},"status":{"type":"string"}}}'::jsonb, 'admin'),
    ('admin_search_alert_history', '알림 이력 검색', '최근 알림 이력 조회 (시스템/심각도/기간).',
     '{"type":"object","properties":{"system_id":{"type":"integer"},"severity":{"type":"string","enum":["info","warning","critical"]},"since_hours":{"type":"integer","default":24},"limit":{"type":"integer","default":20}}}'::jsonb, 'admin'),
    ('admin_list_contacts', '담당자 조회', '시스템 담당자 목록 조회.',
     '{"type":"object","properties":{"system_id":{"type":"integer"}}}'::jsonb, 'admin'),
    ('log_analyzer_recent_analyses', '최근 로그 분석 결과', 'log-analyzer LLM 분석 이력 요약.',
     '{"type":"object","properties":{"system_id":{"type":"integer"},"since_hours":{"type":"integer","default":24},"limit":{"type":"integer","default":10}}}'::jsonb, 'log_analyzer'),
    ('log_analyzer_log_error_rate', '로그 에러 추이', '특정 시스템의 최근 로그 에러 추이 요약.',
     '{"type":"object","properties":{"system_name":{"type":"string"},"minutes":{"type":"integer","default":60}},"required":["system_name"]}'::jsonb, 'log_analyzer')
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema,
    executor     = EXCLUDED.executor,
    updated_at   = NOW();
