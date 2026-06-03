#!/usr/bin/env bash
# SSL 샌드박스 부트스트랩 — CA 생성 + deploy 키 + 와일드카드 인증서(직접 서명).
# admin-api(호스트)의 ssl_issuer.sign_leaf를 재사용해 와일드카드를 발급한다(단일 서명 헬퍼).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS="$ROOT_DIR/main-server/secrets"
SSL_DIR="$SECRETS/ssl"
CERT_DIR="$SECRETS/certs"
VENV_PY="$ROOT_DIR/venv/bin/python"
ADMIN_API_DIR="$ROOT_DIR/main-server/services/admin-api"

mkdir -p "$SSL_DIR" "$CERT_DIR/wildcard"

# 1. 사설 CA 생성 (root + intermediate, 무암호 PEM — cryptography 통일)
if [ ! -f "$SSL_DIR/intermediate_ca_key" ]; then
  echo "→ [1/3] 사설 CA 생성 (root + intermediate)"
  "$VENV_PY" "$ROOT_DIR/scripts/ssl_ca_gen.py" "$SSL_DIR"
else
  echo "→ [1/3] CA 이미 존재 — 건너뜀 ($SSL_DIR)"
fi

# 2. deploy 키쌍 (paramiko 배포용)
if [ ! -f "$SSL_DIR/deploy_key" ]; then
  echo "→ [2/3] deploy 키쌍 생성"
  ssh-keygen -t rsa -b 4096 -N "" -C synapse-ssl-deploy -f "$SSL_DIR/deploy_key" >/dev/null
else
  echo "→ [2/3] deploy 키 이미 존재 — 건너뜀"
fi

# 3. 와일드카드 인증서 = ssl_issuer.sign_leaf 재사용 (직접 서명)
echo "→ [3/3] 와일드카드 인증서 직접 서명 (*.shinsegae.com)"
cd "$ADMIN_API_DIR"
STEP_CA_INTERMEDIATE_CERT="$SSL_DIR/intermediate_ca.crt" \
STEP_CA_INTERMEDIATE_KEY="$SSL_DIR/intermediate_ca_key" \
  "$VENV_PY" -c "from services.ssl_issuer import sign_leaf; sign_leaf('*.shinsegae.com', '$CERT_DIR/wildcard')"

echo ""
echo "✓ 부트스트랩 완료"
echo "  CA          : $SSL_DIR/{root_ca.crt,intermediate_ca.crt}"
echo "  deploy key  : $SSL_DIR/deploy_key(.pub)"
echo "  wildcard    : $CERT_DIR/wildcard/{fullchain.cer,cert.key,ca.cer}"
echo ""
echo "서버 등록 시 password로 authorized_keys가 자동 등록됩니다 (account=root, pw=sandbox-root-pw)."
