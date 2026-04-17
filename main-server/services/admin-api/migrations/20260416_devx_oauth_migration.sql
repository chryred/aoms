-- DevX OAuth 마이그레이션: 담당자별 api_key/agent_code → 시스템 OAuth + 업무영역별 agent_code
-- 실행: docker exec -i synapse-postgres psql -U synapse -d synapse < migrations/20260416_devx_oauth_migration.sql

-- 1) 업무 영역별 LLM agent_code 관리 테이블
CREATE TABLE IF NOT EXISTS llm_agent_configs (
    id          SERIAL PRIMARY KEY,
    area_code   VARCHAR(50) UNIQUE NOT NULL,
    area_name   VARCHAR(200) NOT NULL,
    agent_code  VARCHAR(200) NOT NULL,
    description TEXT,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW()
);

-- 2) 시드 데이터 (9개 호출 영역)
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

-- 3) contacts 테이블에서 더 이상 사용하지 않는 LLM 관련 컬럼 제거
ALTER TABLE contacts DROP COLUMN IF EXISTS llm_api_key;
ALTER TABLE contacts DROP COLUMN IF EXISTS agent_code;
