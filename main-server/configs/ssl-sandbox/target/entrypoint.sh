#!/bin/bash
set -e

CERT_DIR=/etc/nginx/ssl
mkdir -p "$CERT_DIR"

# 최초 부팅: 배포 전에도 nginx가 443을 리슨하도록 self-signed 인증서 생성.
# (배포되면 ssl_deployer가 이 파일들을 CA 서명 인증서로 덮어쓴다)
if [ ! -f "$CERT_DIR/fullchain.cer" ] || [ ! -f "$CERT_DIR/cert.key" ]; then
  echo "[entrypoint] self-signed 부트 인증서 생성"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$CERT_DIR/cert.key" \
    -out "$CERT_DIR/fullchain.cer" \
    -days 7 -subj "/CN=ssl-target.local" >/dev/null 2>&1
fi

# SSH host key 생성 + sshd 기동 (백그라운드)
ssh-keygen -A >/dev/null 2>&1
/usr/sbin/sshd
echo "[entrypoint] sshd 기동 (port 22)"

# nginx 포그라운드 실행 (컨테이너 PID1)
echo "[entrypoint] nginx 기동 (port 443)"
exec nginx -g 'daemon off;'
