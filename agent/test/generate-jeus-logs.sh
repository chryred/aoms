#!/bin/bash
# JEUS 스타일 로그 생성기 — 환경변수로 경로/시스템명 파라미터화
# 환경변수:
#   LOG_FILE    - 로그 파일 경로 (기본: /var/log/app/app.log)
#   LOG_SYSTEM  - 시스템 구분용 태그 (기본: test-system)

LOG_FILE="${LOG_FILE:-/var/log/app/app.log}"
LOG_SYSTEM="${LOG_SYSTEM:-test-system}"

# 로그 디렉터리 생성
mkdir -p "$(dirname "$LOG_FILE")"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO [${LOG_SYSTEM}] container started, log file: ${LOG_FILE}" >> "$LOG_FILE"

i=0
while true; do
  i=$((i + 1))
  TS=$(date '+%Y-%m-%d %H:%M:%S')

  # INFO 로그 (매 tick)
  echo "[$TS] INFO [${LOG_SYSTEM}] request processed id=$i latency=$((RANDOM % 200 + 10))ms" >> "$LOG_FILE"

  # ERROR (3회에 1번)
  if [ $((i % 3)) -eq 0 ]; then
    echo "[$TS] ERROR [${LOG_SYSTEM}] DB connection timeout after 5000ms — retrying (attempt $((i / 3)))" >> "$LOG_FILE"
  fi

  # CRITICAL (10회에 1번)
  if [ $((i % 10)) -eq 0 ]; then
    echo "[$TS] CRITICAL [${LOG_SYSTEM}] memory usage exceeded 90%% — heap dump triggered" >> "$LOG_FILE"
  fi

  # Exception (7회에 1번)
  if [ $((i % 7)) -eq 0 ]; then
    echo "[$TS] ERROR [${LOG_SYSTEM}] java.lang.NullPointerException at com.example.Service.process(Service.java:42)" >> "$LOG_FILE"
  fi

  # FATAL (20회에 1번)
  if [ $((i % 20)) -eq 0 ]; then
    echo "[$TS] FATAL [${LOG_SYSTEM}] unrecoverable error — shutting down worker thread" >> "$LOG_FILE"
  fi

  sleep 2
done
