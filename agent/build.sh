#!/bin/bash
# =============================================================================
# synapse-agent 빌드 + 배포 스크립트
#
# 사용법:
#   ./build.sh                      # 빌드만 (dist/ 에 바이너리 생성)
#   ./build.sh deploy               # 빌드 + 대상 서버 배포
#   ./build.sh deploy --start       # 빌드 + 배포 + 에이전트 시작
#   ./build.sh clean                # 빌드 캐시 이미지 삭제
#
# 환경변수 (deploy 시):
#   TARGET_HOST     대상 서버 IP/호스트명  (필수)
#   TARGET_USER     SSH 사용자            (기본: root)
#   TARGET_PORT     SSH 포트              (기본: 22)
#   TARGET_PASS     SSH 비밀번호          (설정 시 sshpass 사용, 미설정 시 키 인증)
#   INSTALL_DIR     설치 경로             (기본: /opt/synapse-agent)
#   CONFIG_PATH     config.toml 경로      (기본: INSTALL_DIR/config.toml)
#   PROMETHEUS_URL  Remote Write URL      (기본: http://localhost:9090)
#   SYSTEM_NAME     시스템 이름           (기본: 호스트명)
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
BINARY_NAME="agent-v"          # 서버 설치 파일명 (서비스명과 일치)
CARGO_BIN="agent"                 # Cargo.toml [[bin]] name
BUILDER_IMAGE="synapse-agent-builder:cache"

# ── 색상 출력 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $1"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
step()    { echo -e "${CYAN}[STEP]${NC}  $1"; }
err()     { echo -e "${RED}[ERR]${NC}   $1"; exit 1; }

# ── 인자 파싱 ──────────────────────────────────────────────────────────────────
CMD="${1:-build}"
DO_START=false
[[ "$2" == "--start" ]] && DO_START=true

# ── clean ─────────────────────────────────────────────────────────────────────
if [[ "$CMD" == "clean" ]]; then
  info "빌드 캐시 이미지 삭제 중..."
  docker rmi "$BUILDER_IMAGE" 2>/dev/null && ok "삭제 완료" || warn "이미지 없음"
  exit 0
fi

# ── Step 1: Docker로 musl static 바이너리 빌드 ────────────────────────────────
step "1/3  musl static 바이너리 빌드 (Docker)"
info "타겟: x86_64-unknown-linux-musl (RHEL 8.9 호환)"
echo ""

# 빌더 Dockerfile (인라인 — 파일로 저장 안 함)
BUILDER_DOCKERFILE=$(cat <<'DOCKEREOF'
FROM rust:1.86-slim

RUN apt-get update && \
    apt-get install -y musl-tools musl-dev pkg-config && \
    rm -rf /var/lib/apt/lists/* && \
    rustup target add x86_64-unknown-linux-musl

WORKDIR /build

# 의존성 캐시 레이어 (Cargo.toml/Cargo.lock 변경 없으면 재사용)
COPY Cargo.toml Cargo.lock ./
COPY build.rs ./
COPY proto ./proto
RUN mkdir src && echo 'fn main(){}' > src/main.rs && \
    cargo build --release --target x86_64-unknown-linux-musl 2>/dev/null; \
    rm -f target/x86_64-unknown-linux-musl/release/agent

# 실제 소스 빌드
COPY src ./src
RUN cargo build --release --target x86_64-unknown-linux-musl

RUN strip target/x86_64-unknown-linux-musl/release/agent
DOCKEREOF
)

# 캐시 이미지를 활용한 빌드
echo "$BUILDER_DOCKERFILE" | docker build \
  --platform linux/amd64 \
  -t "$BUILDER_IMAGE" \
  -f - \
  "$SCRIPT_DIR" \
  2>&1 | grep -E "^(#[0-9]+ \[|Step|error|Error|warning| ---> |Successfully)" || true

echo ""

# 바이너리 추출
mkdir -p "$DIST_DIR"
CONTAINER_ID=$(docker create --platform linux/amd64 "$BUILDER_IMAGE")
docker cp "$CONTAINER_ID:/build/target/x86_64-unknown-linux-musl/release/$CARGO_BIN" \
  "$DIST_DIR/$BINARY_NAME"
docker rm "$CONTAINER_ID" >/dev/null

# 결과 확인
BINARY_SIZE=$(du -h "$DIST_DIR/$BINARY_NAME" | cut -f1)
ok "빌드 완료: dist/$BINARY_NAME ($BINARY_SIZE)"

# 바이너리 정보 출력
echo ""
echo "  경로  : $DIST_DIR/$BINARY_NAME"
echo "  크기  : $BINARY_SIZE"
echo "  타입  : $(file "$DIST_DIR/$BINARY_NAME" | sed 's|.*/build/||')"
echo ""

# build만이면 종료
[[ "$CMD" == "build" ]] && { ok "빌드 완료. 배포하려면: ./build.sh deploy"; exit 0; }

# ── Step 2: 배포 설정 확인 ────────────────────────────────────────────────────
step "2/3  배포 설정 확인"

TARGET_HOST="${TARGET_HOST:-}"
TARGET_USER="${TARGET_USER:-root}"
TARGET_PORT="${TARGET_PORT:-22}"
TARGET_PASS="${TARGET_PASS:-}"
INSTALL_DIR="${INSTALL_DIR:-/opt/synapse-agent}"
CONFIG_PATH="${CONFIG_PATH:-$INSTALL_DIR/config.toml}"
WAL_DIR="$(dirname "$CONFIG_PATH")/wal"
PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
SYSTEM_NAME="${SYSTEM_NAME:-}"

if [[ -z "$TARGET_HOST" ]]; then
  echo ""
  read -rp "  대상 서버 IP/호스트: " TARGET_HOST
  [[ -z "$TARGET_HOST" ]] && err "TARGET_HOST 가 필요합니다."
fi

if [[ -z "$SYSTEM_NAME" ]]; then
  DEFAULT_SYSNAME=$(echo "$TARGET_HOST" | tr '.' '-')
  read -rp "  system_name [$DEFAULT_SYSNAME]: " SYSTEM_NAME
  SYSTEM_NAME="${SYSTEM_NAME:-$DEFAULT_SYSNAME}"
fi

if [[ -z "$TARGET_PASS" ]]; then
  read -rsp "  SSH 비밀번호 (키 인증이면 Enter): " TARGET_PASS
  echo ""
fi

echo ""
info "배포 대상  : $TARGET_USER@$TARGET_HOST:$TARGET_PORT"
info "설치 경로  : $INSTALL_DIR"
info "설정 파일  : $CONFIG_PATH"
info "system_name: $SYSTEM_NAME"
info "Prometheus : $PROMETHEUS_URL"
echo ""

# SSH 공통 옵션
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -p $TARGET_PORT"
if [[ -n "$TARGET_PASS" ]]; then
  if ! command -v sshpass &>/dev/null; then
    err "sshpass 가 필요합니다: brew install sshpass"
  fi
  SSH_CMD="sshpass -p '$TARGET_PASS' ssh $SSH_OPTS"
  SCP_CMD="sshpass -p '$TARGET_PASS' scp -P $TARGET_PORT -o StrictHostKeyChecking=no"
else
  SSH_CMD="ssh $SSH_OPTS"
  SCP_CMD="scp -P $TARGET_PORT -o StrictHostKeyChecking=no"
fi

_ssh() { eval "$SSH_CMD $TARGET_USER@$TARGET_HOST \"$1\""; }
_scp() { eval "$SCP_CMD $1 $TARGET_USER@$TARGET_HOST:$2"; }

# 연결 테스트
info "SSH 연결 확인..."
_ssh "echo ok" >/dev/null && ok "SSH 연결 성공" || err "SSH 연결 실패"

# ── Step 3: 파일 전송 + config.toml 생성 ──────────────────────────────────────
step "3/3  파일 전송 및 설정"

# 디렉터리 생성
info "디렉터리 생성: $INSTALL_DIR, $WAL_DIR"
_ssh "mkdir -p $INSTALL_DIR $WAL_DIR /var/log/synapse-agent"

# 바이너리 전송
info "바이너리 전송 중..."
_scp "$DIST_DIR/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
_ssh "chmod +x $INSTALL_DIR/$BINARY_NAME"
ok "바이너리 전송 완료"

# config.toml 생성 (서버에 없는 경우에만, 있으면 덮어쓰지 않음)
CONFIG_EXISTS=$(_ssh "test -f $CONFIG_PATH && echo yes || echo no")
if [[ "$CONFIG_EXISTS" == "yes" ]]; then
  warn "config.toml 이미 존재 — 덮어쓰지 않음: $CONFIG_PATH"
else
  info "config.toml 생성 중..."

  # 서버의 실제 IP 수집
  SERVER_IP=$(_ssh "hostname -I | awk '{print \$1}'" 2>/dev/null || echo "$TARGET_HOST")

  CONFIG_CONTENT=$(cat <<TOMLEOF
[agent]
system_name           = "${SYSTEM_NAME}"
display_name          = "${SYSTEM_NAME}"
instance_role         = "default"
host                  = "${SERVER_IP}"
collect_interval_secs = 15
top_process_count     = 20

[remote_write]
endpoint            = "${PROMETHEUS_URL}/api/v1/write"
batch_size          = 500
timeout_secs        = 10
wal_dir             = "${WAL_DIR}"
wal_retention_hours = 2

[collectors]
cpu             = true
memory          = true
disk            = true
network         = true
process         = true
tcp_connections = true
log_monitor     = true
web_servers     = false
preprocessor    = false
heartbeat       = true

[log_monitor]
paths    = ["/var/log/messages"]
keywords = ["ERROR", "CRITICAL", "PANIC", "Fatal", "Exception"]
log_type = "app"
TOMLEOF
)

  # 서버에 직접 파일 기록
  _ssh "cat > $CONFIG_PATH << 'HEREDOC'
$CONFIG_CONTENT
HEREDOC"
  ok "config.toml 생성 완료: $CONFIG_PATH"
fi

# systemd 서비스 파일 생성 (systemd 있는 경우)
SYSTEMD_AVAILABLE=$(_ssh "command -v systemctl &>/dev/null && echo yes || echo no")
if [[ "$SYSTEMD_AVAILABLE" == "yes" ]]; then
  info "systemd 서비스 등록 중..."
  UNIT_CONTENT="[Unit]
Description=Synapse Agent
After=network.target

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/${BINARY_NAME} ${CONFIG_PATH}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target"

  _ssh "echo '$UNIT_CONTENT' > /etc/systemd/system/synapse-agent.service && \
        systemctl daemon-reload && \
        systemctl enable synapse-agent"
  ok "systemd 서비스 등록 완료 (synapse-agent)"
else
  warn "systemd 없음 — nohup 방식으로 실행됩니다"
fi

echo ""
ok "========================================="
ok " 배포 완료!"
ok "========================================="
echo ""
echo "  바이너리   : $INSTALL_DIR/$BINARY_NAME"
echo "  설정 파일  : $CONFIG_PATH"
echo ""

# --start 옵션
if $DO_START; then
  echo ""
  info "에이전트 시작 중..."
  if [[ "$SYSTEMD_AVAILABLE" == "yes" ]]; then
    _ssh "systemctl restart synapse-agent"
    sleep 3
    STATUS=$(_ssh "systemctl is-active synapse-agent")
    [[ "$STATUS" == "active" ]] && ok "synapse-agent 실행 중 (systemd)" \
                                 || warn "상태: $STATUS — journalctl -u synapse-agent 확인"
  else
    _ssh "pkill -f '$BINARY_NAME $CONFIG_PATH' 2>/dev/null; sleep 1; \
          nohup $INSTALL_DIR/$BINARY_NAME $CONFIG_PATH \
            > /var/log/synapse-agent/agent.log 2>&1 & echo \$! > /tmp/synapse-agent.pid"
    sleep 3
    ok "에이전트 시작됨 (PID: $(_ssh 'cat /tmp/synapse-agent.pid 2>/dev/null || echo ?'))"
  fi
else
  echo "  시작 명령:"
  if [[ "$SYSTEMD_AVAILABLE" == "yes" ]]; then
    echo "    ssh $TARGET_USER@$TARGET_HOST 'systemctl start synapse-agent'"
    echo "    ssh $TARGET_USER@$TARGET_HOST 'journalctl -u synapse-agent -f'"
  else
    echo "    ssh $TARGET_USER@$TARGET_HOST \\"
    echo "      'nohup $INSTALL_DIR/$BINARY_NAME $CONFIG_PATH > /var/log/synapse-agent/agent.log 2>&1 &'"
    echo "    ssh $TARGET_USER@$TARGET_HOST 'tail -f /var/log/synapse-agent/agent.log'"
  fi
fi

echo ""
