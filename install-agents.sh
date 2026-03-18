#!/bin/bash
# ============================================================
# AOMS Linux 에이전트 자동 설치 스크립트 (폐쇄망용)
# 대상 OS: RedHat 8.9 / CentOS 8 (x86_64)
#
# 사용법:
#   ./install-agents.sh \
#     --system-name <논리시스템명> \
#     --instance-role <서버역할번호> \
#     --host <호스트명> \
#     --monitoring-server <모니터링서버IP> \
#     --install-dir <설치경로> \
#     --jeus-log-base <JEUS로그상위경로> \
#     [--log-path <추가수집로그경로패턴>] \
#     [--type all|node|promtail|jmx] \
#     [--jmx-port <포트번호>]
#
# 예시:
#   ./install-agents.sh \
#     --system-name customer-experience \
#     --instance-role was1 \
#     --host cx-was01 \
#     --monitoring-server 192.168.10.5 \
#     --install-dir /opt/aoms-agents \
#     --jeus-log-base /apps/logs \
#     --type all \
#     --jmx-port 9404
# ============================================================
set -euo pipefail

# ── 기본값 설정 ──────────────────────────────────────────────
INSTALL_DIR="/opt/aoms-agents"
AGENT_TYPE="all"
JMX_PORT=9404
NODE_EXPORTER_PORT=9100
PROMTAIL_PORT=9080
LOG_PATH=""           # 선택적 추가 로그 경로
JEUS_LOG_BASE=""      # JEUS 로그 상위 경로 (예: /apps/logs)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 색상 출력 ────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 파라미터 파싱 ────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --system-name)       SYSTEM_NAME="$2";       shift 2 ;;
        --instance-role)     INSTANCE_ROLE="$2";     shift 2 ;;
        --host)              HOST_NAME="$2";          shift 2 ;;
        --monitoring-server) MONITORING_SERVER="$2"; shift 2 ;;
        --install-dir)       INSTALL_DIR="$2";        shift 2 ;;
        --jeus-log-base)     JEUS_LOG_BASE="$2";      shift 2 ;;
        --log-path)          LOG_PATH="$2";           shift 2 ;;
        --type)              AGENT_TYPE="$2";         shift 2 ;;
        --jmx-port)          JMX_PORT="$2";           shift 2 ;;
        *) error "알 수 없는 옵션: $1" ;;
    esac
done

# ── 필수 파라미터 검증 ────────────────────────────────────────
[[ -z "${SYSTEM_NAME:-}"       ]] && error "--system-name 필수"
[[ -z "${INSTANCE_ROLE:-}"     ]] && error "--instance-role 필수"
[[ -z "${HOST_NAME:-}"         ]] && error "--host 필수"
[[ -z "${MONITORING_SERVER:-}" ]] && error "--monitoring-server 필수"
[[ -z "${JEUS_LOG_BASE:-}"     ]] && error "--jeus-log-base 필수 (예: /apps/logs)"

info "=== AOMS 에이전트 설치 시작 ==="
info "시스템명       : $SYSTEM_NAME"
info "서버 역할      : $INSTANCE_ROLE"
info "호스트명       : $HOST_NAME"
info "모니터링 서버  : $MONITORING_SERVER"
info "설치 경로      : $INSTALL_DIR"
info "JEUS 로그 기준 : $JEUS_LOG_BASE"
[[ -n "$LOG_PATH" ]] && info "추가 로그 경로  : $LOG_PATH"
info "에이전트 유형  : $AGENT_TYPE"

# ════════════════════════════════════════════════════════════
# node_exporter 설치
# ════════════════════════════════════════════════════════════
install_node_exporter() {
    info "--- node_exporter 설치 ---"

    local AGENT_DIR="$INSTALL_DIR/node_exporter"
    local BIN_SRC="$SCRIPT_DIR/node_exporter-1.10.2.linux-amd64.tar.gz"
    local SERVICE_FILE="/etc/systemd/system/node_exporter.service"

    [[ -f "$BIN_SRC" ]] || error "node_exporter 바이너리 없음: $BIN_SRC"

    sudo mkdir -p "$AGENT_DIR"

    tar xzf "$BIN_SRC" -C /tmp/
    sudo cp /tmp/node_exporter-*/node_exporter "$AGENT_DIR/"
    sudo chmod +x "$AGENT_DIR/node_exporter"
    rm -rf /tmp/node_exporter-*/

    id node_exporter &>/dev/null || sudo useradd -r -s /bin/false node_exporter
    sudo chown node_exporter:node_exporter "$AGENT_DIR/node_exporter"

    sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=AOMS Node Exporter
Documentation=https://github.com/prometheus/node_exporter
After=network.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=$AGENT_DIR/node_exporter \\
  --web.listen-address=:$NODE_EXPORTER_PORT \\
  --collector.systemd \\
  --collector.processes
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable --now node_exporter

    sudo firewall-cmd --permanent --add-port=${NODE_EXPORTER_PORT}/tcp 2>/dev/null || true
    sudo firewall-cmd --reload 2>/dev/null || true

    sleep 2
    curl -sf "http://localhost:${NODE_EXPORTER_PORT}/metrics" | head -3 \
        && info "node_exporter 정상 기동 (포트 ${NODE_EXPORTER_PORT})" \
        || error "node_exporter 기동 실패"
}

# ════════════════════════════════════════════════════════════
# 공통 유틸: JEUS 서버 디렉토리 판별
# ════════════════════════════════════════════════════════════
_is_jeus_server_dir() {
    local sname="$1"
    # adminServer, *Server, *_server 패턴 매칭
    [[ "$sname" =~ [Ss]erver ]]
}

# ════════════════════════════════════════════════════════════
# ACL 설정 함수 (독립)
# ════════════════════════════════════════════════════════════
_setup_jeus_acl() {
    local base_dir="$1"

    if [[ ! -d "$base_dir" ]]; then
        warn "JEUS 로그 상위 디렉토리가 존재하지 않습니다: $base_dir"
        return 0
    fi

    info "JEUS 로그 ACL 설정 시작: $base_dir"

    # ── ACL 명령어 존재 여부 확인 ──
    if ! command -v setfacl &>/dev/null; then
        error "setfacl 명령어 없음. acl 패키지 설치 필요: sudo yum install -y acl"
    fi

    # ── 파일시스템 ACL 지원 여부 확인 (범용) ──
    # ext4: tune2fs, xfs: 기본 지원, 기타: 직접 시도
    _check_acl_support() {
        local test_dir="$1"
        local test_file
        test_file=$(mktemp -p "$test_dir" .acl_test.XXXXXX 2>/dev/null) || {
            warn "  ACL 지원 여부 사전 확인 불가 — setfacl 직접 시도합니다"
            return 0
        }
        if setfacl -m u:promtail:r-- "$test_file" 2>/dev/null; then
            rm -f "$test_file"
            return 0
        else
            rm -f "$test_file"
            error "파일시스템이 ACL을 지원하지 않습니다: $test_dir"
        fi
    }
    _check_acl_support "$base_dir"

    local cur_perm
    cur_perm=$(stat -c '%a' "$base_dir" 2>/dev/null)
    info "  상위 디렉토리 현재 권한: $cur_perm (변경하지 않음)"

    # ── 1) 상위 디렉토리 탐색 권한 ──
    if sudo setfacl -m u:promtail:r-x "$base_dir" 2>/dev/null; then
        info "  [OK] 상위 디렉토리 ACL 설정 완료 (promtail: r-x)"
    else
        error "ACL 설정 실패: $base_dir — 마운트 옵션에 acl 포함 여부를 확인하세요"
    fi

    local server_count=0

    for server_dir in "${base_dir}"/*/; do
        [[ -d "$server_dir" ]] || continue

        local sname
        sname=$(basename "$server_dir")

        if ! _is_jeus_server_dir "$sname"; then
            info "  -> 스킵 (서버 디렉토리 아님): $sname"
            continue
        fi

        info "  -- 서버 디렉토리 처리: $sname --"

        # ── 2) 서버 디렉토리 자체 ACL (탐색 권한) ──
        if sudo setfacl -m u:promtail:r-x "$server_dir" 2>/dev/null; then
            info "    [OK] [$sname] 디렉토리 ACL 설정 완료 (promtail: r-x)"
        else
            warn "    [FAIL] [$sname] 디렉토리 ACL 설정 실패"
            continue
        fi

        # ── 3) default ACL 설정 (로그 로테이션 후 신규 파일 자동 상속) ──
        if sudo setfacl -d -m u:promtail:r-x "$server_dir" 2>/dev/null; then
            info "    [OK] [$sname] Default ACL 설정 완료"
            info "      -> 로그 로테이션 후 신규 JeusServer.log 자동 적용"
        else
            warn "    [FAIL] [$sname] Default ACL 설정 실패"
        fi

        # ── 4) 현재 존재하는 JeusServer.log 즉시 ACL 적용 ──
        local log_file="${server_dir}JeusServer.log"
        if [[ -f "$log_file" ]]; then
            if sudo setfacl -m u:promtail:r-- "$log_file" 2>/dev/null; then
                local fsize
                fsize=$(stat -c '%s' "$log_file" 2>/dev/null || echo "?")
                info "    [OK] [$sname] JeusServer.log ACL 적용 완료 (크기: ${fsize} bytes)"
            else
                warn "    [FAIL] [$sname] JeusServer.log ACL 적용 실패"
            fi
        else
            warn "    [$sname] JeusServer.log 미존재 (서비스 미기동 상태)"
            warn "      -> Default ACL 설정으로 기동 후 자동 적용됩니다"
        fi

        # ── 5) 백업 로그 파일 ACL 적용 ──
        local backup_count=0
        local backup_fail=0
        for backup_log in "${server_dir}"JeusServer_*.log; do
            [[ -f "$backup_log" ]] || continue
            if sudo setfacl -m u:promtail:r-- "$backup_log" 2>/dev/null; then
                (( backup_count++ )) || true
            else
                (( backup_fail++ )) || true
            fi
        done
        [[ $backup_count -gt 0 ]] && \
            info "    [OK] [$sname] 백업 로그 ${backup_count}개 ACL 적용 완료"
        [[ $backup_fail -gt 0 ]] && \
            warn "    [FAIL] [$sname] 백업 로그 ${backup_fail}개 ACL 적용 실패"

        # ── 6) ACL 적용 결과 확인 출력 ──
        if command -v getfacl &>/dev/null; then
            info "    ACL 현황 [$sname]:"
            getfacl "$server_dir" 2>/dev/null \
                | grep -E "^(user|group|other|default)" \
                | sed 's/^/      /'
        fi

        (( server_count++ )) || true
    done

    # ── 7) 상위 디렉토리 권한 변경 여부 최종 확인 ──
    local new_perm
    new_perm=$(stat -c '%a' "$base_dir" 2>/dev/null)
    info ""
    info "  총 ${server_count}개 서버 디렉토리 ACL 적용 완료"

    if [[ "$cur_perm" == "$new_perm" ]]; then
        info "  [OK] 상위 디렉토리 기존 권한($cur_perm) 유지됨"
    else
        warn "  상위 디렉토리 권한 변경됨: $cur_perm -> $new_perm (확인 필요)"
    fi
}

# ════════════════════════════════════════════════════════════
# scrape_config 동적 생성 함수 (독립)
# ════════════════════════════════════════════════════════════
_build_jeus_scrape_configs() {
    local base_dir="$1"
    local found=0

    for server_dir in "${base_dir}"/*/; do
        [[ -d "$server_dir" ]] || continue

        local sname
        sname=$(basename "$server_dir")

        # 공통 필터 사용
        _is_jeus_server_dir "$sname" || continue

        local log_path="${server_dir}JeusServer.log"

        cat << SCRAPE

  # -- JEUS 서버: ${sname} --
  - job_name: jeus-${sname}
    static_configs:
      - targets:
          - localhost
        labels:
          system_name: "${SYSTEM_NAME}"
          instance_role: "${INSTANCE_ROLE}"
          host: "${HOST_NAME}"
          log_type: "jeus"
          server_name: "${sname}"
          __path__: "${log_path}"
    pipeline_stages:
      - multiline:
          firstline: '^\[\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}\]'
          max_wait_time: 3s
          max_lines: 500
      - drop:
          expression: '^\s*$'
      - drop:
          expression: >-
            (?i)^(?!.*(\berror\b|\bwarn(ing)?\b|\bfatal\b|\bcritical\b|\bexception\b|\bfail(ed|ure)?\b|\btimeout\b|\brefused\b|\bdenied\b|\bcorrupt\b|\bpanic\b|\bdead(lock)?\b|\bstack\s*trace\b|\bat\s+[\w\.]+\.\w+\())
      - regex:
          expression: '\[(?P<level>ERROR|WARN(?:ING)?|FATAL|CRITICAL|INFO|DEBUG)\]'
      - labels:
          level:
SCRAPE
        (( found++ )) || true
    done

    if [[ $found -eq 0 ]]; then
        warn "${base_dir} 하위에 서버 디렉토리가 없습니다." >&2
        warn "  JEUS 서비스 기동 후 promtail을 재시작하세요." >&2
    else
        info "  JEUS 서버 ${found}개 scrape_config 생성 완료" >&2
    fi
}

# ════════════════════════════════════════════════════════════
# promtail 설치 (메인)
# ════════════════════════════════════════════════════════════
install_promtail() {
    info "--- promtail 설치 ---"

    local AGENT_DIR="$INSTALL_DIR/promtail"
    local BIN_SRC="$SCRIPT_DIR/promtail-linux-amd64.zip"
    local CONFIG_FILE="$AGENT_DIR/promtail.yml"
    local POSITIONS_FILE="$AGENT_DIR/positions.yaml"
    local SERVICE_FILE="/etc/systemd/system/promtail.service"

    [[ -f "$BIN_SRC" ]] || error "promtail 바이너리 없음: $BIN_SRC"

    sudo mkdir -p "$AGENT_DIR"

    # ── 압축 해제 및 설치 (안전한 임시 디렉토리) ──
    local TMP_DIR
    TMP_DIR=$(mktemp -d /tmp/promtail_install.XXXXXX)
    # 함수 종료 시 또는 에러 시 임시 디렉토리 정리
    trap "rm -rf '$TMP_DIR'" RETURN

    if ! unzip -o "$BIN_SRC" -d "$TMP_DIR/"; then
        error "promtail 바이너리 압축 해제 실패: $BIN_SRC"
    fi

    local EXTRACTED_BIN="$TMP_DIR/promtail-linux-amd64"
    if [[ ! -f "$EXTRACTED_BIN" ]]; then
        error "압축 해제 후 바이너리를 찾을 수 없음: $EXTRACTED_BIN"
    fi

    sudo cp "$EXTRACTED_BIN" "$AGENT_DIR/promtail"
    sudo chmod +x "$AGENT_DIR/promtail"

    # 바이너리 실행 가능 여부 확인
    if ! "$AGENT_DIR/promtail" --version &>/dev/null; then
        error "promtail 바이너리 실행 불가 — 아키텍처 또는 라이브러리 확인 필요"
    fi
    info "promtail 버전: $("$AGENT_DIR/promtail" --version 2>&1 | head -1)"

    # ── 전용 사용자 생성 ──
    if ! id promtail &>/dev/null; then
        sudo useradd -r -s /bin/false promtail
        info "promtail 시스템 사용자 생성 완료"
    else
        info "promtail 시스템 사용자 이미 존재"
    fi
    sudo usermod -aG adm promtail 2>/dev/null || true

    # ── ACL 설정 실행 ──
    _setup_jeus_acl "$JEUS_LOG_BASE"

    # ── positions 파일 사전 생성 (쓰기 권한 보장) ──
    sudo touch "$POSITIONS_FILE"
    sudo chown promtail:promtail "$POSITIONS_FILE"
    sudo chmod 644 "$POSITIONS_FILE"

    # ════════════════════════════════════════════════════════
    # promtail 설정 파일 생성
    # ════════════════════════════════════════════════════════
    info "promtail 설정 파일 생성: $CONFIG_FILE"

    # ── 공통 헤더 작성 ──
    sudo tee "$CONFIG_FILE" > /dev/null << EOF
server:
  http_listen_port: ${PROMTAIL_PORT}
  grpc_listen_port: 0
  log_level: warn

positions:
  filename: ${POSITIONS_FILE}

clients:
  - url: http://${MONITORING_SERVER}:3100/loki/api/v1/push
    timeout: 10s
    backoff_config:
      min_period: 500ms
      max_period: 5m
      max_retries: 10

scrape_configs:
EOF

    # ── JEUS 서버별 scrape_config 동적 추가 ──
    _build_jeus_scrape_configs "$JEUS_LOG_BASE" \
        | sudo tee -a "$CONFIG_FILE" > /dev/null

    # ── 추가 애플리케이션 로그 (--log-path 지정 시) ──
    if [[ -n "$LOG_PATH" ]]; then
        sudo tee -a "$CONFIG_FILE" > /dev/null << EOF

  # -- JOB: 추가 애플리케이션 로그 --
  - job_name: app-logs
    static_configs:
      - targets:
          - localhost
        labels:
          system_name: "${SYSTEM_NAME}"
          instance_role: "${INSTANCE_ROLE}"
          host: "${HOST_NAME}"
          log_type: "application"
          __path__: "${LOG_PATH}"
    pipeline_stages:
      - multiline:
          firstline: '^(\d{4}[-/\.]\d{2}[-/\.]\d{2}|\[\d{4}[-/\.]\d{2}[-/\.]\d{2}|\d{2}:\d{2}:\d{2}|\[(?i)(error|warn|info|debug|fatal|critical|trace)\]|(?i)(ERROR|WARN|FATAL|CRITICAL)[:\s])'
          max_wait_time: 3s
          max_lines: 200
      - drop:
          expression: '^\s*$'
      - drop:
          expression: >-
            (?i)^(?!.*(\berror\b|\bwarn\b|\bfatal\b|\bcritical\b|\bexception\b|\bfail(ed|ure)?\b|\btimeout\b|\brefused\b|\bdenied\b|\bcorrupt\b|\bpanic\b|\bdead(lock)?\b|\bstack\s*trace\b|\bat\s+[\w\.]+\.\w+\())
      - regex:
          expression: '(?i)(?P<level>ERROR|WARN(?:ING)?|FATAL|CRITICAL|INFO|DEBUG)'
      - labels:
          level:
EOF
    fi

    # ── 시스템 로그 + 보안 로그 ──
    sudo tee -a "$CONFIG_FILE" > /dev/null << EOF

  # -- JOB: 시스템 로그 (에러만 필터) --
  - job_name: system-logs
    static_configs:
      - targets:
          - localhost
        labels:
          system_name: "${SYSTEM_NAME}"
          instance_role: "${INSTANCE_ROLE}"
          host: "${HOST_NAME}"
          log_type: "system"
          __path__: /var/log/messages
    pipeline_stages:
      - drop:
          expression: >-
            (?i)^(?!.*(\berror\b|\bwarn\b|\bfatal\b|\bcritical\b|\bfail(ed|ure)?\b|\btimeout\b|\brefused\b|\bdenied\b|\bpanic\b))

  # -- JOB: 보안 로그 (전량 수집) --
  - job_name: security-logs
    static_configs:
      - targets:
          - localhost
        labels:
          system_name: "${SYSTEM_NAME}"
          instance_role: "${INSTANCE_ROLE}"
          host: "${HOST_NAME}"
          log_type: "security"
          __path__: /var/log/secure
EOF

    sudo chown -R promtail:promtail "$AGENT_DIR"

    # ── 생성된 설정 파일 검증 ──
    info "promtail 설정 파일 문법 검증 중..."
    if "$AGENT_DIR/promtail" -config.file="$CONFIG_FILE" -check-syntax 2>/dev/null; then
        info "  [OK] 설정 파일 문법 검증 통과"
    elif "$AGENT_DIR/promtail" -config.file="$CONFIG_FILE" --dry-run 2>/dev/null; then
        info "  [OK] 설정 파일 dry-run 검증 통과"
    else
        # 일부 버전은 check-syntax/dry-run 미지원 → 경고만 출력
        warn "  설정 파일 자동 검증 불가 (promtail 버전 미지원) — 수동 확인 권장"
    fi

    # ── 설정 파일 요약 출력 ──
    info "생성된 promtail.yml 요약:"
    grep -E "job_name:|__path__|server_name:" "$CONFIG_FILE" \
        | sed 's/^/  /'

    # ── Systemd 서비스 등록 ──
    sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=AOMS Promtail (Log Collector)
Documentation=https://grafana.com/docs/loki/latest/clients/promtail/
After=network.target

[Service]
User=promtail
Group=promtail
Type=simple
ExecStart=${AGENT_DIR}/promtail -config.file=${CONFIG_FILE}
Restart=on-failure
RestartSec=5s
# 보안 강화: 불필요한 권한 제한
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable --now promtail

    # ── 기동 확인 (재시도 루프) ──
    local max_wait=10
    local waited=0
    info "promtail 기동 확인 중 (최대 ${max_wait}초)..."
    while (( waited < max_wait )); do
        if sudo systemctl is-active --quiet promtail; then
            info "[OK] promtail 정상 기동 (포트 ${PROMTAIL_PORT}, ${waited}초 소요)"
            return 0
        fi
        sleep 1
        (( waited++ )) || true
    done

    # 기동 실패 시 로그 출력 후 에러
    warn "promtail 기동 실패 — 최근 로그:"
    sudo journalctl -u promtail --no-pager -n 20 | sed 's/^/  /'
    error "promtail 기동 실패 (${max_wait}초 대기 후 타임아웃)"
}

# ════════════════════════════════════════════════════════════
# jmx_exporter 설치
# ════════════════════════════════════════════════════════════
install_jmx_exporter() {
    info "--- jmx_exporter 설치 ---"

    local AGENT_DIR="$INSTALL_DIR/jmx_exporter"
    local JAR_SRC="$SCRIPT_DIR/jmx_prometheus_javaagent-0.20.0.jar"
    local CONFIG_FILE="$AGENT_DIR/jmx-config.yml"

    [[ -f "$JAR_SRC" ]] || error "jmx_exporter jar 없음: $JAR_SRC"

    sudo mkdir -p "$AGENT_DIR"
    sudo cp "$JAR_SRC" "$AGENT_DIR/"

    sudo tee "$CONFIG_FILE" > /dev/null << 'EOF'
lowercaseOutputName: true
lowercaseOutputLabelNames: true

rules:
  # Tomcat Thread Pool
  - pattern: 'Catalina<type=ThreadPool, name="(.+)"><>(currentThreadCount|currentThreadsBusy|maxThreads):'
    name: tomcat_threadpool_$2
    labels:
      connector: $1

  # Tomcat Request Processor
  - pattern: 'Catalina<type=GlobalRequestProcessor, name="(.+)"><>(requestCount|errorCount|processingTime|maxTime):'
    name: tomcat_request_$2
    labels:
      handler: $1

  # JVM Memory
  - pattern: 'java.lang<type=Memory><HeapMemoryUsage>(used|committed|max):'
    name: jvm_memory_heap_$1_bytes

  # JVM GC
  - pattern: 'java.lang<type=GarbageCollector, name="(.+)"><>(CollectionCount|CollectionTime):'
    name: jvm_gc_$2_total
    labels:
      gc: $1

  # JVM Threads
  - pattern: 'java.lang<type=Threading><>(ThreadCount|DaemonThreadCount|PeakThreadCount):'
    name: jvm_threads_$1
EOF

    info "jmx_exporter 설치 완료: $AGENT_DIR"
    warn "JEUS JVM 옵션에 다음을 추가하세요:"
    warn "  -javaagent:$AGENT_DIR/jmx_prometheus_javaagent-0.20.0.jar=${JMX_PORT}:$AGENT_DIR/jmx-config.yml"
    warn "예) jeus.properties 또는 startWebContainer.sh 수정 후 JEUS 재기동 필요"
}

# ════════════════════════════════════════════════════════════
# 설치 실행
# ════════════════════════════════════════════════════════════
case "$AGENT_TYPE" in
    all)
        install_node_exporter
        install_promtail
        install_jmx_exporter
        ;;
    node)     install_node_exporter ;;
    promtail) install_promtail ;;
    jmx)      install_jmx_exporter ;;
    *) error "알 수 없는 --type: $AGENT_TYPE (all|node|promtail|jmx)" ;;
esac

info "=== 설치 완료 ==="
info "Prometheus에서 다음 타겟 추가 필요:"
echo ""
echo "  - targets: ['$(hostname -I | awk '{print $1}'):${NODE_EXPORTER_PORT}']"
echo "    labels:"
echo "      system_name: '${SYSTEM_NAME}'"
echo "      instance_role: '${INSTANCE_ROLE}'"
echo "      host: '${HOST_NAME}'"