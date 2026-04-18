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

# SampleApp은 jeussic 계정으로 실행 (OTel env도 jeussic 홈에서 로드)
# admin-api가 ~/otel 설치 시 /home/jeussic/otel/otel-env.sh 및 opentelemetry-javaagent.jar 배치됨
runuser -u jeussic -- bash -c '
    OTEL_HOME=/home/jeussic/otel
    if [ -f "$OTEL_HOME/otel-env.sh" ]; then
        . "$OTEL_HOME/otel-env.sh"
        echo "[entrypoint] OTel 환경변수 로드 완료 (service.name=${OTEL_SERVICE_NAME})"
    fi
    if [ -f "$OTEL_HOME/opentelemetry-javaagent.jar" ]; then
        export JAVA_OPTS="${JAVA_OPTS} -javaagent:$OTEL_HOME/opentelemetry-javaagent.jar"
        echo "[entrypoint] OTel Java Agent 주입됨"
    fi
    java ${JAVA_OPTS} -jar /home/jeussic/sample-app/SampleApp.jar
' &
echo "[entrypoint] SampleApp 시작 완료 (jeussic 계정, 포트 8081)"

echo "[entrypoint] SSH 서버 시작 (포트 22)"

# sshd 포그라운드 실행
exec /usr/sbin/sshd -D -e
