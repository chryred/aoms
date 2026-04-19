-- Synapse PostgreSQL 초기 스키마
-- Phase 1 (T1.9)에서 실행: docker exec -i synapse-postgres psql -U synapse -d synapse < init.sql

-- ── 시스템 정보 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS systems (
    id              SERIAL PRIMARY KEY,
    system_name     VARCHAR(100) UNIQUE NOT NULL,   -- Prometheus label과 동일
    display_name    VARCHAR(200) NOT NULL,
    description     TEXT,
    host            VARCHAR(200) NOT NULL DEFAULT '',
    os_type         VARCHAR(20)  NOT NULL DEFAULT 'linux',  -- 'linux' | 'windows'
    system_type     VARCHAR(50)  NOT NULL DEFAULT 'was',    -- 'web' | 'was' | 'db' | 'middleware' | 'other'
    status          VARCHAR(20)  DEFAULT 'active',
    teams_webhook_url TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- ── 담당자 정보 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(200),
    teams_upn   VARCHAR(200),          -- Teams mention용 UPN
    webhook_url TEXT,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

COMMENT ON COLUMN contacts.teams_upn IS 'Microsoft Teams UPN (알림 멘션용)';

-- ── LLM Agent Config (업무 영역별 agent_code 관리) ───────────────────
CREATE TABLE IF NOT EXISTS llm_agent_configs (
    id          SERIAL PRIMARY KEY,
    area_code   VARCHAR(50) UNIQUE NOT NULL,   -- log_analysis, metric_hourly_aggregation, ...
    area_name   VARCHAR(200) NOT NULL,         -- 한국어 표시명
    agent_code  VARCHAR(200) NOT NULL,         -- DevX agent code
    description TEXT,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

INSERT INTO llm_agent_configs (area_code, area_name, agent_code, description) VALUES
    ('log_analysis',                  '실시간 로그 분석',   'custom_8f9ee032e5594452bff5602c03e966eb', '5분 주기 로그 에러 분석'),
    ('metric_hourly_aggregation',     '시간별 메트릭 집계', 'custom_8f9ee032e5594452bff5602c03e966eb', '매 시간 Prometheus 메트릭 집계 분석'),
    ('metric_daily_aggregation',      '일별 메트릭 집계',   'custom_8f9ee032e5594452bff5602c03e966eb', '매일 07:30 일별 롤업 집계'),
    ('metric_weekly_aggregation',     '주별 메트릭 집계',   'custom_8f9ee032e5594452bff5602c03e966eb', '매주 월요일 08:00 주간 리포트'),
    ('metric_monthly_aggregation',    '월별 메트릭 집계',   'custom_8f9ee032e5594452bff5602c03e966eb', '매월 1일 08:00 월간 리포트'),
    ('metric_longperiod_aggregation', '장기 메트릭 집계',   'custom_8f9ee032e5594452bff5602c03e966eb', '매월 1일 09:00 분기/반기/연간 리포트'),
    ('trend_alert',                   '추세 이상 알림',     'custom_8f9ee032e5594452bff5602c03e966eb', '4시간 주기 지속 이상 감지'),
    ('infra_analysis',                '인프라 메트릭 분석', 'custom_8f9ee032e5594452bff5602c03e966eb', 'Prometheus 호스트별 교차 분석'),
    ('incident_report',               '장애보고서 생성',    'custom_8f9ee032e5594452bff5602c03e966eb', '장애 알림 기반 한국어 보고서')
ON CONFLICT (area_code) DO NOTHING;

-- ── 시스템-담당자 매핑 (N:M) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_contacts (
    id               SERIAL PRIMARY KEY,
    system_id        INTEGER REFERENCES systems(id)  ON DELETE CASCADE,
    contact_id       INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    role             VARCHAR(50) DEFAULT 'primary',     -- 'primary' | 'secondary'
    notify_channels  VARCHAR(200) NOT NULL DEFAULT 'teams',
    UNIQUE(system_id, contact_id)
);

-- ── 알림 이력 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_history (
    id                  SERIAL PRIMARY KEY,
    system_id           INTEGER REFERENCES systems(id),
    alert_type          VARCHAR(50) NOT NULL DEFAULT 'metric',  -- 'metric' | 'log_analysis'
    severity            VARCHAR(20) NOT NULL,
    alertname           VARCHAR(100),
    title               VARCHAR(500) NOT NULL,
    description         TEXT,
    instance_role       VARCHAR(50),                            -- 이중화 역할 (was1, was2 ...)
    host                VARCHAR(100),
    metric_name         VARCHAR(100),
    metric_value        FLOAT,
    notified_contacts   TEXT,                                   -- JSON 배열 (담당자명)
    -- Phase 4b: 벡터 유사도 분석 필드
    anomaly_type        VARCHAR(20),
    similarity_score    FLOAT,
    qdrant_point_id     VARCHAR(36),
    resolved_at         TIMESTAMP,                              -- 복구 시각 (Alertmanager resolved)
    acknowledged        BOOLEAN DEFAULT FALSE,
    acknowledged_at     TIMESTAMP,
    acknowledged_by     VARCHAR(100),
    escalated           BOOLEAN DEFAULT FALSE,
    error_message       TEXT,                                   -- LLM/분석 실패 이력: NULL=성공, 값=실패 사유
    -- Phase OTel: 메트릭 알림 ↔ trace 링크
    related_trace_ids   JSONB,                                  -- Alertmanager 수신 시점 ±60s 에러 trace top 3 (NULL = OTel 미적용)
    created_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_history_system  ON alert_history(system_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_created ON alert_history(created_at DESC);

-- ── LLM 분석 결과 이력 ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS log_analysis_history (
    id               SERIAL PRIMARY KEY,
    system_id        INTEGER REFERENCES systems(id),
    instance_role    VARCHAR(50),
    log_content      TEXT NOT NULL,
    analysis_result  TEXT NOT NULL,
    severity         VARCHAR(20) NOT NULL,
    root_cause       TEXT,
    recommendation   TEXT,
    model_used       VARCHAR(100),
    processing_time  FLOAT,
    alert_sent       BOOLEAN DEFAULT FALSE,
    -- Phase 4b: 벡터 유사도 분석 필드
    anomaly_type     VARCHAR(20),
    similarity_score FLOAT,
    qdrant_point_id  VARCHAR(36),
    has_solution     BOOLEAN DEFAULT FALSE,
    error_message    TEXT,                                     -- LLM/분석 실패 이력: NULL=성공, 값=실패 사유
    -- Phase OTel: 분산 추적 상관 컬럼
    referenced_trace_ids  JSONB,                              -- ["a1b2c3d4…", ...] 최대 5개 (NULL = OTel 미적용)
    trace_summary_text    TEXT,                               -- 프롬프트 주입 원문 (감사·디버그용, NULL = OTel 미적용)
    created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_log_analysis_system ON log_analysis_history(system_id, created_at DESC);

-- ── 알림 쿨다운 추적 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_cooldown (
    id           SERIAL PRIMARY KEY,
    system_id    INTEGER REFERENCES systems(id),
    alert_key    VARCHAR(500) NOT NULL,   -- "{system_name}:{instance_role}:{alertname}:{severity}"
    last_sent_at TIMESTAMP NOT NULL,
    UNIQUE(system_id, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_cooldown_lookup ON alert_cooldown(system_id, alert_key);

-- ── 피드백 (Phase 4c: WF3 n8n 워크플로우에서 INSERT) ─────────────────
CREATE TABLE IF NOT EXISTS alert_feedback (
    id               SERIAL PRIMARY KEY,
    system_id        INTEGER REFERENCES systems(id),
    alert_history_id INTEGER REFERENCES alert_history(id),
    error_type       VARCHAR(100) NOT NULL,
    solution         TEXT NOT NULL,
    resolver         VARCHAR(200) NOT NULL,
    qdrant_point_id  VARCHAR(36),     -- 해결책 임베딩 후 저장된 Qdrant point ID
    created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_feedback_system ON alert_feedback(system_id, created_at DESC);

-- ── Phase 5: 수집기 유연 레지스트리 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS system_collector_config (
    id             SERIAL PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
    collector_type VARCHAR(50)  NOT NULL,   -- node_exporter | jmx_exporter | db_exporter | custom
    metric_group   VARCHAR(100) NOT NULL,   -- cpu | memory | disk | network | jvm_heap | thread_pool | ...
    enabled        BOOLEAN DEFAULT TRUE,
    prometheus_job VARCHAR(200),            -- Prometheus job label (쿼리 범위 한정)
    custom_config  TEXT,                    -- JSON 형태 파라미터 (선택)
    created_at     TIMESTAMP DEFAULT NOW(),
    updated_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(system_id, collector_type, metric_group)
);

CREATE INDEX IF NOT EXISTS idx_collector_config_system ON system_collector_config(system_id, collector_type);

-- ── Phase 5: 1시간 메트릭 집계 ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_hourly_aggregations (
    id             SERIAL PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id),
    hour_bucket    TIMESTAMP NOT NULL,      -- 시간 단위 truncate (UTC)
    collector_type VARCHAR(50)  NOT NULL,
    metric_group   VARCHAR(100) NOT NULL,
    metrics_json   TEXT NOT NULL,           -- JSON: avg/max/min/p95 등 집계값
    -- LLM 분석 (이상 감지 시에만 채워짐)
    llm_summary    TEXT,
    llm_severity   VARCHAR(20),             -- normal | warning | critical
    llm_trend      TEXT,                    -- 추세 설명 (1문장)
    llm_prediction TEXT,                    -- 임계치 도달 예측 ("3.2시간 후 85% 도달 예상")
    llm_model_used VARCHAR(100),
    qdrant_point_id VARCHAR(36),            -- metric_hourly_patterns 컬렉션 UUID
    created_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(system_id, hour_bucket, collector_type, metric_group)
);

CREATE INDEX IF NOT EXISTS idx_hourly_agg_system_time ON metric_hourly_aggregations(system_id, hour_bucket DESC);
CREATE INDEX IF NOT EXISTS idx_hourly_agg_severity    ON metric_hourly_aggregations(llm_severity, hour_bucket DESC);

-- ── Phase 5: 1일 메트릭 집계 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_daily_aggregations (
    id             SERIAL PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id),
    day_bucket     TIMESTAMP NOT NULL,      -- 날짜 단위 truncate (UTC)
    collector_type VARCHAR(50)  NOT NULL,
    metric_group   VARCHAR(100) NOT NULL,
    metrics_json   TEXT NOT NULL,           -- 일간 통계 (peak_hour, anomaly_hours 등 포함)
    llm_summary    TEXT,
    llm_severity   VARCHAR(20),
    llm_trend      TEXT,
    qdrant_point_id VARCHAR(36),
    created_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(system_id, day_bucket, collector_type, metric_group)
);

CREATE INDEX IF NOT EXISTS idx_daily_agg_system_time ON metric_daily_aggregations(system_id, day_bucket DESC);

-- ── Phase 5: 7일 메트릭 집계 ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metric_weekly_aggregations (
    id             SERIAL PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id),
    week_start     TIMESTAMP NOT NULL,      -- 해당 주 월요일 00:00 UTC
    collector_type VARCHAR(50)  NOT NULL,
    metric_group   VARCHAR(100) NOT NULL,
    metrics_json   TEXT NOT NULL,
    llm_summary    TEXT,
    llm_severity   VARCHAR(20),
    llm_trend      TEXT,
    qdrant_point_id VARCHAR(36),
    created_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(system_id, week_start, collector_type, metric_group)
);

CREATE INDEX IF NOT EXISTS idx_weekly_agg_system_time ON metric_weekly_aggregations(system_id, week_start DESC);

-- ── Phase 5: 월/분기/반기/연간 메트릭 집계 ───────────────────────────
CREATE TABLE IF NOT EXISTS metric_monthly_aggregations (
    id             SERIAL PRIMARY KEY,
    system_id      INTEGER NOT NULL REFERENCES systems(id),
    period_start   TIMESTAMP NOT NULL,      -- 해당 기간 시작일
    period_type    VARCHAR(20) NOT NULL,    -- monthly | quarterly | half_year | annual
    collector_type VARCHAR(50)  NOT NULL,
    metric_group   VARCHAR(100) NOT NULL,
    metrics_json   TEXT NOT NULL,
    llm_summary    TEXT,
    llm_severity   VARCHAR(20),
    llm_trend      TEXT,
    qdrant_point_id VARCHAR(36),
    created_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(system_id, period_start, period_type, collector_type, metric_group)
);

CREATE INDEX IF NOT EXISTS idx_monthly_agg_system_time ON metric_monthly_aggregations(system_id, period_start DESC, period_type);

-- ── Phase 5: 집계 리포트 발송 이력 ───────────────────────────────────
CREATE TABLE IF NOT EXISTS aggregation_report_history (
    id           SERIAL PRIMARY KEY,
    report_type  VARCHAR(20) NOT NULL,   -- daily | weekly | monthly | quarterly | half_year | annual
    period_start TIMESTAMP NOT NULL,
    period_end   TIMESTAMP NOT NULL,
    sent_at      TIMESTAMP DEFAULT NOW(),
    teams_status VARCHAR(20),            -- sent | failed
    llm_summary  TEXT,
    system_count INTEGER,
    UNIQUE(report_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_report_history_type_time ON aggregation_report_history(report_type, period_start DESC);

-- ── 에이전트 인스턴스 (Phase 6 / Phase 9) ────────────────────────────
CREATE TABLE IF NOT EXISTS agent_instances (
    id           SERIAL PRIMARY KEY,
    system_id    INTEGER REFERENCES systems(id) ON DELETE CASCADE,
    host         VARCHAR(200) NOT NULL,
    ssh_username VARCHAR(100),               -- SSH 접속 계정 (password 저장 금지; db 에이전트는 NULL)
    agent_type   VARCHAR(50)  NOT NULL,      -- synapse_agent | db
    install_path VARCHAR(500),               -- 바이너리 경로 (db 에이전트는 NULL)
    config_path  VARCHAR(500),               -- 설정파일 경로 (db 에이전트는 NULL)
    port         INTEGER,                    -- 메트릭 노출 포트
    os_type      VARCHAR(20),               -- 'linux' | 'windows' — 에이전트 설치 서버 OS (Phase 9)
    server_type  VARCHAR(50),               -- 'web' | 'was' | 'db' | 'middleware' | 'other' (Phase 9)
    pid_file     VARCHAR(500),               -- PID 파일 경로
    label_info   TEXT,                       -- JSON: system_name, instance_role 등
    status       VARCHAR(20) DEFAULT 'unknown',  -- installed | running | stopped | unknown
    created_at   TIMESTAMP DEFAULT NOW(),
    updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_instances_system ON agent_instances(system_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_instances_host   ON agent_instances(host);

-- ── 에이전트 설치 Job 이력 (Phase 6) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_install_jobs (
    id         SERIAL PRIMARY KEY,
    job_id     VARCHAR(36) UNIQUE NOT NULL,
    agent_id   INTEGER REFERENCES agent_instances(id) ON DELETE SET NULL,
    status     VARCHAR(20) DEFAULT 'pending',  -- pending | running | done | failed
    logs       TEXT,
    error      TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_install_jobs_job_id ON agent_install_jobs(job_id);

-- ── 챗봇 (ReAct) 관련 테이블 ───────────────────────────────────────────
-- UUID PK 위해 pgcrypto 확장 필요
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 챗봇 도구 레지스트리
CREATE TABLE IF NOT EXISTS chat_tools (
    name          VARCHAR(100) PRIMARY KEY,
    display_name  VARCHAR(200) NOT NULL,
    description   TEXT NOT NULL,
    input_schema  JSONB NOT NULL DEFAULT '{}'::jsonb,     -- JSON Schema draft-07
    executor      VARCHAR(20)  NOT NULL,                  -- 'ems' | 'admin' | 'log_analyzer'
    is_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT NOW(),
    updated_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_tools_exec ON chat_tools(executor, is_enabled);

-- 챗봇 executor 자격증명/설정
CREATE TABLE IF NOT EXISTS chat_executor_configs (
    executor      VARCHAR(20) PRIMARY KEY,                -- 'ems' | 'admin' | 'log_analyzer'
    config        JSONB NOT NULL DEFAULT '{}'::jsonb,     -- secret 필드는 Fernet 암호문 문자열
    config_schema JSONB NOT NULL DEFAULT '[]'::jsonb,     -- 프론트 폼 렌더용
    updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at    TIMESTAMP DEFAULT NOW()
);

-- 챗봇 세션
CREATE TABLE IF NOT EXISTS chat_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL DEFAULT '새 대화',
    area_code   VARCHAR(50)  NOT NULL DEFAULT 'chat_assistant',
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);

-- 챗봇 메시지
CREATE TABLE IF NOT EXISTS chat_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role         VARCHAR(20) NOT NULL,                    -- 'user' | 'assistant' | 'tool'
    content      TEXT NOT NULL DEFAULT '',
    thought      TEXT,
    tool_name    VARCHAR(100),
    tool_args    JSONB,
    tool_result  JSONB,
    attachments  JSONB NOT NULL DEFAULT '[]'::jsonb,      -- [{type:'image', key, mime, size, w, h}]
    created_at   TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);

-- chat_assistant LLM agent 시드
INSERT INTO llm_agent_configs (area_code, area_name, agent_code, description) VALUES
    ('chat_assistant', 'ReAct 챗봇 어시스턴트',
     'custom_8f9ee032e5594452bff5602c03e966eb',
     '운영 어시스턴트: EMS/admin/log-analyzer 도구를 활용한 대화형 분석')
ON CONFLICT (area_code) DO NOTHING;

-- chat_executor_configs 시드 (ems는 URL/ID/비밀번호 필드, admin/log_analyzer는 비자격증명)
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

-- chat_tools 시드 (EMS 9 + admin 3 + log_analyzer 2)
INSERT INTO chat_tools (name, display_name, description, input_schema, executor) VALUES
    -- EMS executor
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
    -- admin executor
    ('admin_list_systems', '시스템 목록 조회', 'Synapse-V에 등록된 모니터링 시스템 목록 조회.',
     '{"type":"object","properties":{"system_type":{"type":"string"},"status":{"type":"string"}}}'::jsonb, 'admin'),
    ('admin_search_alert_history', '알림 이력 검색', '최근 알림 이력 조회 (시스템/심각도/기간).',
     '{"type":"object","properties":{"system_id":{"type":"integer"},"severity":{"type":"string","enum":["info","warning","critical"]},"since_hours":{"type":"integer","default":24},"limit":{"type":"integer","default":20}}}'::jsonb, 'admin'),
    ('admin_list_contacts', '담당자 조회', '시스템 담당자 목록 조회.',
     '{"type":"object","properties":{"system_id":{"type":"integer"}}}'::jsonb, 'admin'),
    -- log_analyzer executor
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

-- ── 샘플 데이터 (선택) ────────────────────────────────────────────────
-- INSERT INTO systems(system_name, display_name, host, os_type, system_type)
-- VALUES ('customer-experience', '고객 경험 시스템', 'cx-was01', 'linux', 'was');
