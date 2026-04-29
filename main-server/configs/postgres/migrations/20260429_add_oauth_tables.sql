-- ADR-014: OIDC IdP 기능 추가
-- Synapse가 타시스템의 SSO Identity Provider 역할을 하기 위한 테이블

CREATE TABLE IF NOT EXISTS oauth_clients (
    id            SERIAL       PRIMARY KEY,
    client_id     VARCHAR(100) UNIQUE NOT NULL,
    client_secret VARCHAR(255) NOT NULL,
    name          VARCHAR(200) NOT NULL,
    redirect_uris JSONB        NOT NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code         VARCHAR(100) PRIMARY KEY,
    client_id    VARCHAR(100) NOT NULL,
    user_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri TEXT         NOT NULL,
    scope        TEXT         NOT NULL DEFAULT 'openid profile email',
    nonce        VARCHAR(200),
    expires_at   TIMESTAMP    NOT NULL,
    used         BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_authorization_codes(expires_at);
