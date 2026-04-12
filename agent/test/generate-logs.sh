#!/bin/bash
# 테스트용 에러 로그 생성기
# 환경변수:
#   LOG_FILE   - 로그 파일 경로
#   LOG_SYSTEM - 시스템/서비스 태그

LOG_FILE="${LOG_FILE:-/tmp/app.log}"
LOG_SYSTEM="${LOG_SYSTEM:-test-system}"

mkdir -p "$(dirname "$LOG_FILE")"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO  [${LOG_SYSTEM}] started, writing to ${LOG_FILE}" >> "$LOG_FILE"

i=0
while true; do
  i=$((i + 1))
  TS=$(date '+%Y-%m-%d %H:%M:%S')

  # INFO — 매 tick
  echo "[$TS] INFO  [${LOG_SYSTEM}] request processed id=$i latency=$((RANDOM % 300 + 20))ms" >> "$LOG_FILE"

  # ERROR — 2회에 1번
  if [ $((i % 2)) -eq 0 ]; then
    echo "[$TS] ERROR [${LOG_SYSTEM}] DB connection timeout after 5000ms (attempt $i)" >> "$LOG_FILE"
  fi

  # Exception — 3회에 1번
  if [ $((i % 3)) -eq 0 ]; then
    echo "[$TS] ERROR [${LOG_SYSTEM}] java.lang.NullPointerException at com.example.Service.process(Service.java:$((RANDOM % 200 + 10)))" >> "$LOG_FILE"
  fi

  # PANIC — 5회에 1번
  if [ $((i % 5)) -eq 0 ]; then
    echo "[$TS] ERROR [${LOG_SYSTEM}] PANIC: index out of range [$i] with length $((RANDOM % 100))" >> "$LOG_FILE"
  fi

  # Fatal — 7회에 1번
  if [ $((i % 7)) -eq 0 ]; then
    echo "[$TS] FATAL [${LOG_SYSTEM}] unrecoverable state — worker thread $((RANDOM % 8)) terminated" >> "$LOG_FILE"
  fi

  # Deadlock — 10회에 1번
  if [ $((i % 10)) -eq 0 ]; then
    echo "[$TS] ERROR [${LOG_SYSTEM}] Deadlock detected on transaction_id=$((RANDOM % 9999 + 1000)) — rolling back" >> "$LOG_FILE"
  fi

  # CRITICAL — 15회에 1번
  if [ $((i % 15)) -eq 0 ]; then
    echo "[$TS] CRITICAL [${LOG_SYSTEM}] heap memory usage exceeded 90%% — GC overhead limit" >> "$LOG_FILE"
  fi

  sleep 1
done
