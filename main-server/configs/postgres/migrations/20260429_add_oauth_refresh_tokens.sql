-- Migration: OIDC Refresh Token 테이블 추가 (ADR-014)
-- 기존 운영 DB에 적용. 신규 설치는 init.sql로 자동 생성됨.

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    token        VARCHAR(200) PRIMARY KEY,
    client_id    VARCHAR(100) NOT NULL,
    user_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope        TEXT         NOT NULL DEFAULT 'openid profile email',
    expires_at   TIMESTAMP    NOT NULL,
    revoked      BOOLEAN      NOT NULL DEFAULT FALSE,
    replaced_by  VARCHAR(200),
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_rt_user_client ON oauth_refresh_tokens(user_id, client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_rt_expires ON oauth_refresh_tokens(expires_at);
