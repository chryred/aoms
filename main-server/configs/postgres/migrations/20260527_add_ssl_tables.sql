-- SSL 인증서 자동화 관리 — 신규 테이블 4개
-- 적용 대상: 기존 운영 DB
-- main-server/configs/postgres/init.sql 에도 동시 반영됨

CREATE TABLE IF NOT EXISTS ssl_ha_groups (
    id          SERIAL PRIMARY KEY,
    group_name  VARCHAR(50)  UNIQUE NOT NULL,
    system_code VARCHAR(20),
    serial_size INTEGER DEFAULT 1,
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ssl_servers (
    id            SERIAL PRIMARY KEY,
    system_code   VARCHAR(20)  NOT NULL,
    system_name   VARCHAR(100) NOT NULL,
    host          VARCHAR(100) NOT NULL,
    account       VARCHAR(50)  NOT NULL,
    instance_role VARCHAR(50),
    web_type      VARCHAR(30)  NOT NULL,
    cert_type     VARCHAR(20)  NOT NULL DEFAULT 'wildcard',
    domain        VARCHAR(200),
    config_file   VARCHAR(200),
    cert_dir      VARCHAR(200),
    webtob_home   VARCHAR(200),
    ssh_port      INTEGER      NOT NULL DEFAULT 22,
    ha_group_id   INTEGER REFERENCES ssl_ha_groups(id) ON DELETE SET NULL,
    serial_order  INTEGER      DEFAULT 1,
    network_zone  VARCHAR(10)  NOT NULL DEFAULT 'internal',
    status        VARCHAR(20)  NOT NULL DEFAULT 'active',
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ssl_servers_ha_group ON ssl_servers(ha_group_id);
CREATE INDEX IF NOT EXISTS idx_ssl_servers_zone     ON ssl_servers(network_zone, status);

CREATE TABLE IF NOT EXISTS ssl_deployments (
    id            SERIAL PRIMARY KEY,
    server_id     INTEGER REFERENCES ssl_servers(id) ON DELETE SET NULL,
    trigger_type  VARCHAR(20)  NOT NULL,
    cert_type     VARCHAR(20),
    cert_expiry   DATE,
    status        VARCHAR(20)  NOT NULL,
    duration_sec  NUMERIC(6,2),
    deploy_log    TEXT,
    steps_result  TEXT,
    rule_analysis TEXT,
    llm_analysis  TEXT,
    deployed_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ssl_deployments_server ON ssl_deployments(server_id, deployed_at);

CREATE TABLE IF NOT EXISTS ssl_cert_snapshots (
    id          SERIAL PRIMARY KEY,
    server_id   INTEGER REFERENCES ssl_servers(id) ON DELETE CASCADE,
    expiry_date DATE,
    days_left   INTEGER,
    is_valid    BOOLEAN,
    checked_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ssl_cert_snapshots_server ON ssl_cert_snapshots(server_id, checked_at);
