#!/bin/bash
set -e

# SSH 호스트 키 생성 (없으면)
ssh-keygen -A

# jeussic: app.log + batch.log 1초 주기 로그 생성
LOG_FILE=/home/jeussic/app.log \
LOG_SYSTEM=crm-app \
  /usr/local/bin/generate-logs.sh &

LOG_FILE=/home/jeussic/batch.log \
LOG_SYSTEM=crm-batch \
  /usr/local/bin/generate-logs.sh &

echo "[entrypoint] 로그 생성기 2개 시작 완료 (app.log, batch.log — 1초 주기)"
echo "[entrypoint] SSH 서버 시작 (포트 22)"

# sshd 포그라운드 실행
exec /usr/sbin/sshd -D -e
