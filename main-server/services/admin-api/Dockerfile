# ── Stage 1: synapse CLI Go 빌드 ────────────────────────────────────────────
# agent-v는 agent/build.sh (rust:1.88, musl static)로 사전 빌드 후 agent/dist/agent-v에 위치
# CGO_ENABLED=0 → GLIBC 의존성 없는 정적 바이너리 (어느 Linux에서나 실행 가능)
FROM golang:1.23-alpine AS cli-builder
WORKDIR /build
COPY synapse-cli/ .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o synapse .

# ── Stage 2: 최종 admin-api 이미지 ─────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# 오프라인 환경: pip-packages 디렉토리가 있으면 그쪽에서 설치
COPY main-server/services/admin-api/requirements/ requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt

COPY main-server/services/admin-api/ .

# agent-v: agent/build.sh로 사전 빌드된 musl static 바이너리
COPY agent/dist/agent-v          /app/bin/agent-v
COPY --from=cli-builder /build/synapse /app/bin/synapse

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
