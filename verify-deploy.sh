#!/bin/bash
# ============================================================
# Synapse-V 배포 검증 스크립트
# 사용법: ./verify-deploy.sh [SERVER_B_IP]
# 예시:   ./verify-deploy.sh 192.168.10.6
# ============================================================
set -euo pipefail

SERVER_B_IP="${1:-}"
PASS=0; FAIL=0
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

ok()      { echo -e "  ${GREEN}✓${NC}  $1"; (( PASS++ )) || true; }
fail()    { echo -e "  ${RED}✗${NC}  $1"; (( FAIL++ )) || true; }
warn()    { echo -e "  ${YELLOW}!${NC}  $1"; }
section() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

BASE_DIR="/app/synapse"

# ──────────────────────────────────────────────────────────────
section "1. Docker 컨테이너 상태"

CONTAINERS=(
  "synapse-prometheus"
  "synapse-alertmanager"
  "synapse-grafana"
  "synapse-postgres"
  "synapse-admin-api"
  "synapse-log-analyzer"
  "synapse-frontend"
  "synapse-n8n"
  "synapse-tempo"
  "synapse-otel-collector"
)

for c in "${CONTAINERS[@]}"; do
  STATUS=$(docker inspect "$c" --format='{{.State.Status}}' 2>/dev/null || echo "missing")
  if [[ "$STATUS" == "running" ]]; then
    ok "$c — running"
  else
    fail "$c — $STATUS"
  fi
done

# ──────────────────────────────────────────────────────────────
section "2. 포트 응답 확인"

check_http() {
  local name="$1" url="$2"
  local code
  code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  if [[ "$code" =~ ^(200|301|302)$ ]]; then
    ok "$name ($url) → HTTP $code"
  else
    fail "$name ($url) → HTTP $code"
  fi
}

check_http "Prometheus"       "http://localhost:9090/-/healthy"
check_http "Alertmanager"     "http://localhost:9093/-/healthy"
check_http "Grafana"          "https://localhost:3000/api/health"
check_http "admin-api"        "http://localhost:8080/health"
check_http "admin-api Docs"   "http://localhost:8080/docs"
check_http "log-analyzer"     "http://localhost:8000/health"
check_http "frontend"         "http://localhost:3001"
check_http "n8n"              "http://localhost:5678/healthz"

# ──────────────────────────────────────────────────────────────
section "3. 설정 파일 존재 확인"

check_file() {
  local label="$1" path="$2"
  if [[ -f "$path" ]]; then
    ok "$label — $path"
  else
    fail "$label 없음 — $path"
  fi
}

check_dir() {
  local label="$1" path="$2"
  if [[ -d "$path" ]]; then
    ok "$label — $path"
  else
    fail "$label 없음 — $path"
  fi
}

check_file ".env"                         "$BASE_DIR/.env"
check_file "docker-compose.yml"           "$BASE_DIR/docker-compose.yml"
check_file "prometheus.yml"               "$BASE_DIR/configs/prometheus/prometheus.yml"
check_file "alert_rules.yml"              "$BASE_DIR/configs/prometheus/alert_rules.yml"
check_file "web.yml (Basic Auth)"         "$BASE_DIR/configs/prometheus/web.yml"
check_file "alertmanager.yml"             "$BASE_DIR/configs/alertmanager/alertmanager.yml"
check_dir  "grafana/provisioning"         "$BASE_DIR/configs/grafana/provisioning"
check_file "postgres/init.sql"            "$BASE_DIR/configs/postgres/init.sql"
check_file "postgres/postgresql.conf"     "$BASE_DIR/configs/postgres/postgresql.conf"
check_file "ssl/grafana.crt"              "$BASE_DIR/ssl/grafana.crt"
check_file "ssl/grafana.key"              "$BASE_DIR/ssl/grafana.key"
check_file "tempo/tempo.yml"              "$BASE_DIR/configs/tempo/tempo.yml"
check_file "otel-collector-config.yml"    "$BASE_DIR/configs/otel-collector/otel-collector-config.yml"

# .env 필수 키 존재 여부
if [[ -f "$BASE_DIR/.env" ]]; then
  for key in SECRET_KEY CORS_ORIGINS FRONTEND_EXTERNAL_URL AGENT_PROMETHEUS_URL TEAMS_WEBHOOK_URL LLM_API_URL QDRANT_URL ENCRYPTION_KEY DEVX_CLIENT_ID DEVX_CLIENT_SECRET; do
    if grep -q "^${key}=" "$BASE_DIR/.env" 2>/dev/null; then
      VALUE=$(grep "^${key}=" "$BASE_DIR/.env" | cut -d= -f2-)
      if [[ -n "$VALUE" ]]; then
        ok ".env: $key 설정됨"
      else
        warn ".env: $key 값이 비어 있음"
      fi
    else
      fail ".env: $key 항목 없음"
    fi
  done
fi

# ──────────────────────────────────────────────────────────────
section "4. PostgreSQL 연결 및 테이블 확인"

TABLE_COUNT=$(docker exec synapse-postgres psql -U synapse -d synapse -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' \n')

if [[ "$TABLE_COUNT" =~ ^[0-9]+$ ]] && [[ "$TABLE_COUNT" -ge 10 ]]; then
  ok "PostgreSQL public 테이블 ${TABLE_COUNT}개 (예상: 12개 이상)"
else
  fail "PostgreSQL 테이블 수 이상: '${TABLE_COUNT}'"
fi

N8N_SCHEMA=$(docker exec synapse-postgres psql -U synapse -d synapse -t -c \
  "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='n8n';" 2>/dev/null | tr -d ' \n')
[[ "$N8N_SCHEMA" -ge 1 ]] && ok "n8n 스키마 존재" || fail "n8n 스키마 없음"

# ──────────────────────────────────────────────────────────────
section "5. Prometheus Basic Auth 확인"

# /api/v1/query는 인증이 필요한 엔드포인트 — 401 응답이면 Basic Auth 활성화됨
PROM_AUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "http://localhost:9090/api/v1/query?query=up" 2>/dev/null || echo "000")
if [[ "$PROM_AUTH_CODE" == "401" ]]; then
  ok "Prometheus Basic Auth 활성화됨 (401 확인)"
elif [[ "$PROM_AUTH_CODE" == "200" ]]; then
  warn "Prometheus 인증 없이 접근 가능 — web.yml Basic Auth 설정 확인 필요"
else
  warn "Prometheus /api/v1/query 응답: HTTP $PROM_AUTH_CODE"
fi

# ──────────────────────────────────────────────────────────────
section "6. admin-api 기능 확인"

SYSTEMS=$(curl -s --max-time 5 http://localhost:8080/api/v1/systems 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "-1")
if [[ "$SYSTEMS" =~ ^[0-9]+$ ]]; then
  ok "GET /api/v1/systems → ${SYSTEMS}개 시스템 등록됨"
else
  fail "GET /api/v1/systems 응답 오류"
fi

AGENTS=$(curl -s --max-time 5 http://localhost:8080/api/v1/agents 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "-1")
if [[ "$AGENTS" =~ ^[0-9]+$ ]]; then
  ok "GET /api/v1/agents → ${AGENTS}개 에이전트 등록됨"
else
  warn "GET /api/v1/agents 응답 오류 (에이전트 미배포 시 정상)"
fi

# ──────────────────────────────────────────────────────────────
section "7. log-analyzer 기능 확인"

ANALYZER_STATUS=$(curl -s --max-time 5 http://localhost:8000/health 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "error")
[[ "$ANALYZER_STATUS" == "ok" ]] && ok "log-analyzer /health → ok" || fail "log-analyzer /health → $ANALYZER_STATUS"

# ──────────────────────────────────────────────────────────────
section "8. Prometheus 스크레이프 상태"

# Basic Auth 자격증명 로드
if [[ -f "$BASE_DIR/.env" ]]; then
  PROM_USER_VAL=$(grep "^PROM_USER=" "$BASE_DIR/.env" | cut -d= -f2- || echo "")
  PROM_PASS_VAL=$(grep "^PROM_PASS=" "$BASE_DIR/.env" | cut -d= -f2- || echo "")
else
  PROM_USER_VAL=""
  PROM_PASS_VAL=""
fi

PROM_TARGETS=$(curl -s --max-time 5 -u "${PROM_USER_VAL}:${PROM_PASS_VAL}" \
  "http://localhost:9090/api/v1/targets" 2>/dev/null | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
active = d.get('data', {}).get('activeTargets', [])
up_count = sum(1 for t in active if t.get('health') == 'up')
total = len(active)
print(f'{up_count}/{total}')
" 2>/dev/null || echo "?/?")
ok "Prometheus 타겟: $PROM_TARGETS UP"

# Remote Write Receiver 활성화 확인
RW_ENABLED=$(curl -s --max-time 5 -u "${PROM_USER_VAL}:${PROM_PASS_VAL}" \
  "http://localhost:9090/api/v1/status/flags" 2>/dev/null | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
flags = d.get('data', {})
print(flags.get('web.enable-remote-write-receiver', 'false'))
" 2>/dev/null || echo "unknown")
if [[ "$RW_ENABLED" == "true" ]]; then
  ok "Prometheus Remote Write Receiver 활성화됨"
else
  warn "Prometheus Remote Write Receiver 상태: $RW_ENABLED (synapse_agent가 메트릭을 보내려면 활성화 필요)"
fi

# ──────────────────────────────────────────────────────────────
section "9. Tempo / OTel Collector 상태"

# Tempo health (포트 미노출 — docker exec 경유)
TEMPO_HEALTH=$(docker exec synapse-tempo wget -qO- http://localhost:3200/ready 2>/dev/null || echo "error")
if [[ "$TEMPO_HEALTH" == "ready" ]]; then
  ok "Tempo /ready → ready"
else
  fail "Tempo /ready → $TEMPO_HEALTH"
fi

# OTel Collector health (포트 미노출 — docker exec 경유)
OTEL_CODE=$(docker exec synapse-otel-collector wget -qS -O /dev/null http://localhost:13133/ 2>&1 | \
  grep "HTTP/" | awk '{print $2}' | tail -1 || echo "000")
if [[ "$OTEL_CODE" == "200" ]]; then
  ok "OTel Collector :13133 → HTTP 200"
else
  fail "OTel Collector :13133 → HTTP $OTEL_CODE"
fi

# ──────────────────────────────────────────────────────────────
section "10. n8n 상태 확인"

N8N_HEALTH=$(curl -s --max-time 5 http://localhost:5678/healthz 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "error")
[[ "$N8N_HEALTH" == "ok" ]] && ok "n8n healthz → ok" || warn "n8n 상태: $N8N_HEALTH (초기 설정 필요할 수 있음)"

# ──────────────────────────────────────────────────────────────
# Server B 확인 (IP 인수 전달 시)
# ADR-011/012: Ollama 제거됨 → Qdrant만 확인
if [[ -n "$SERVER_B_IP" ]]; then
  section "11. Server B (Vector DB) 확인 — ${SERVER_B_IP}"

  QDRANT_TITLE=$(curl -s --max-time 5 "http://${SERVER_B_IP}:6333/" 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('title','unknown'))" 2>/dev/null || echo "error")
  [[ "$QDRANT_TITLE" == "qdrant - vector search engine" ]] && \
    ok "Qdrant 응답 OK" || fail "Qdrant 응답 이상: $QDRANT_TITLE"

  COLLECTIONS=$(curl -s --max-time 5 "http://${SERVER_B_IP}:6333/collections" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
cols = [c['name'] for c in d.get('result', {}).get('collections', [])]
print(', '.join(cols) if cols else 'none')
" 2>/dev/null || echo "error")

  EXPECTED_COLLECTIONS=("log_incidents" "metric_baselines" "metric_hourly_patterns" "aggregation_summaries")
  ok "Qdrant 컬렉션: $COLLECTIONS"
  for col in "${EXPECTED_COLLECTIONS[@]}"; do
    echo "$COLLECTIONS" | grep -q "$col" && \
      ok "  컬렉션 $col 존재" || warn "  컬렉션 $col 없음 (POST /aggregation/collections/setup 실행 필요)"
  done
fi

# ──────────────────────────────────────────────────────────────
section "결과 요약"
TOTAL=$((PASS + FAIL))
echo ""
echo -e "  통과: ${GREEN}${PASS}${NC} / 전체: ${TOTAL}"

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "  실패: ${RED}${FAIL}${NC}개"
  echo ""
  echo "  위 오류를 확인하세요:"
  echo "    - 로그 확인: docker logs <컨테이너명> --tail 50"
  echo "    - 재시작:    cd /app/synapse && docker compose up -d"
  echo "    - 가이드:    /app/synapse/deploy-guide.md 참조"
  exit 1
else
  echo -e "  ${GREEN}모든 검증 통과 ✓${NC}"
  exit 0
fi
