#!/bin/bash
# 다양한 레벨의 로그를 /var/log/app/app.log 에 지속적으로 생성
LOG_FILE="/var/log/app/app.log"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] INFO agent-test container started" >> "$LOG_FILE"

i=0
while true; do
  i=$((i + 1))
  TS=$(date '+%Y-%m-%d %H:%M:%S')

  # INFO 로그 (항상)
  echo "[$TS] INFO request processed successfully id=$i latency=42ms" >> "$LOG_FILE"

  # ERROR (3회에 1번)
  if [ $((i % 3)) -eq 0 ]; then
    echo "[$TS] ERROR DB connection timeout after 5000ms — retrying (attempt $((i/3)))" >> "$LOG_FILE"
  fi

  # CRITICAL (10회에 1번)
  if [ $((i % 10)) -eq 0 ]; then
    echo "[$TS] CRITICAL memory usage exceeded 90% — heap dump triggered" >> "$LOG_FILE"
  fi

  # Exception (7회에 1번)
  if [ $((i % 7)) -eq 0 ]; then
    echo "[$TS] ERROR java.lang.NullPointerException at com.example.Service.process(Service.java:42)" >> "$LOG_FILE"
  fi

  # FATAL (20회에 1번)
  if [ $((i % 20)) -eq 0 ]; then
    echo "[$TS] FATAL unrecoverable error — shutting down worker thread" >> "$LOG_FILE"
  fi

  sleep 2
done
