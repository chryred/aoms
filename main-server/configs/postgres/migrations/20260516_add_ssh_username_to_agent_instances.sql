-- ADR: 에이전트 SSH 계정 바인딩 — 동일 IP에 서로 다른 OS 계정으로 등록된 에이전트 간 혼용 차단
-- 적용 대상: agent_instances
-- NULL 허용 — 기존 레코드는 ssh_username=NULL → 검증 스킵 (하위 호환)

ALTER TABLE agent_instances ADD COLUMN IF NOT EXISTS ssh_username VARCHAR(100);
