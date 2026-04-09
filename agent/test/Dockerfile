# ── 1단계: Rust 빌드 ──────────────────────────────────────────────────────────
FROM rust:1.86-slim AS builder

WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Cargo.toml / Cargo.lock 먼저 복사해 의존성 캐시
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release 2>/dev/null; rm -f target/release/agent

# 실제 소스 복사 후 빌드 (build.rs 포함)
COPY build.rs ./
COPY proto ./proto
COPY src ./src
RUN cargo build --release

# ── 2단계: 실행 이미지 ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y bash && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/agent ./agent

# 로그 디렉토리 / WAL 디렉토리
RUN mkdir -p /var/log/app /var/lib/aoms-agent/wal /etc/aoms-agent

# 로그 생성 스크립트 (ERROR, CRITICAL, INFO 혼합)
COPY test/generate-logs.sh /app/generate-logs.sh
RUN chmod +x /app/generate-logs.sh

ENTRYPOINT ["/bin/bash", "-c"]
CMD ["/app/generate-logs.sh & exec /app/agent /etc/aoms-agent/config.toml"]
