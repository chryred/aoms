#!/bin/bash
# ============================================================
# AOMS 배포 검증 스크립트
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

# ──────────────────────────────────────────────────────────────
section "1. Docker 컨테이너 상태"

CONTAINERS=(
  "aoms-prometheus"
  "aoms-alertmanager"
  "aoms-loki"
  "aoms-grafana"
  "aoms-postgres"
  "aoms-admin-api"
  "aoms-log-analyzer"
  "aoms-frontend"
  "aoms-n8n"
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
check_http "Loki"             "http://localhost:3100/ready"
check_http "admin-api"        "http://localhost:8080/health"
check_http "admin-api Docs"   "http://localhost:8080/docs"
check_http "log-analyzer"     "http://localhost:8000/health"
check_http "frontend"         "http://localhost:3001"
check_http "n8n"              "http://localhost:5678/healthz"

# ──────────────────────────────────────────────────────────────
section "3. PostgreSQL 연결 및 테이블 확인"

TABLE_COUNT=$(docker exec aoms-postgres psql -U aoms -d aoms -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' \n')

if [[ "$TABLE_COUNT" =~ ^[0-9]+$ ]] && [[ "$TABLE_COUNT" -ge 10 ]]; then
  ok "PostgreSQL public 테이블 ${TABLE_COUNT}개 (예상: 12개)"
else
  fail "PostgreSQL 테이블 수 이상: '${TABLE_COUNT}'"
fi

N8N_SCHEMA=$(docker exec aoms-postgres psql -U aoms -d aoms -t -c \
  "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='n8n';" 2>/dev/null | tr -d ' \n')
[[ "$N8N_SCHEMA" -ge 1 ]] && ok "n8n 스키마 존재" || fail "n8n 스키마 없음"

# ──────────────────────────────────────────────────────────────
section "4. admin-api 기능 확인"

SYSTEMS=$(curl -s --max-time 5 http://localhost:8080/api/v1/systems 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "-1")
if [[ "$SYSTEMS" =~ ^[0-9]+$ ]]; then
  ok "GET /api/v1/systems → ${SYSTEMS}개 시스템 등록됨"
else
  fail "GET /api/v1/systems 응답 오류"
fi

# ──────────────────────────────────────────────────────────────
section "5. log-analyzer 기능 확인"

ANALYZER_STATUS=$(curl -s --max-time 5 http://localhost:8000/health 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "error")
[[ "$ANALYZER_STATUS" == "ok" ]] && ok "log-analyzer /health → ok" || fail "log-analyzer /health → $ANALYZER_STATUS"

# ──────────────────────────────────────────────────────────────
section "6. Loki 상태 확인"

LOKI_READY=$(curl -s --max-time 5 http://localhost:3100/ready 2>/dev/null | tr -d '\n')
[[ "$LOKI_READY" == "ready" ]] && ok "Loki 준비 완료" || warn "Loki 상태: '${LOKI_READY}'"

LABEL_COUNT=$(curl -s --max-time 5 "http://localhost:3100/loki/api/v1/label" 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
if [[ "$LABEL_COUNT" -gt 0 ]]; then
  ok "Loki 레이블 ${LABEL_COUNT}개 수신 중"
else
  warn "Loki 수신 레이블 없음 (에이전트 미배포 또는 정상 초기 상태)"
fi

# ──────────────────────────────────────────────────────────────
section "7. Prometheus 스크레이프 상태"

PROM_TARGETS=$(curl -s --max-time 5 "http://localhost:9090/api/v1/targets" 2>/dev/null | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
active = d.get('data', {}).get('activeTargets', [])
up_count = sum(1 for t in active if t.get('health') == 'up')
total = len(active)
print(f'{up_count}/{total}')
" 2>/dev/null || echo "?/?")
ok "Prometheus 타겟: $PROM_TARGETS UP"

# ──────────────────────────────────────────────────────────────
section "8. n8n 워크플로우 확인"

N8N_HEALTH=$(curl -s --max-time 5 http://localhost:5678/healthz 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "error")
[[ "$N8N_HEALTH" == "ok" ]] && ok "n8n healthz → ok" || warn "n8n 상태: $N8N_HEALTH (초기 설정 필요할 수 있음)"

# ──────────────────────────────────────────────────────────────
# Server B 확인 (IP 인수 전달 시)
if [[ -n "$SERVER_B_IP" ]]; then
  section "9. Server B (AI/Vector) 확인 — ${SERVER_B_IP}"

  OLLAMA_MODELS=$(curl -s --max-time 10 "http://${SERVER_B_IP}:11434/api/tags" 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('models',[])))" 2>/dev/null || echo "-1")
  if [[ "$OLLAMA_MODELS" =~ ^[0-9]+$ ]]; then
    ok "Ollama 응답 OK (모델 ${OLLAMA_MODELS}개)"
    if [[ "$OLLAMA_MODELS" -eq 0 ]]; then
      warn "  → bge-m3 모델이 없습니다"
      warn "     docker exec aoms-ollama ollama pull bge-m3"
    else
      # bge-m3 모델 존재 여부
      BGE_OK=$(curl -s --max-time 5 "http://${SERVER_B_IP}:11434/api/tags" 2>/dev/null | \
        python3 -c "
import sys, json
d = json.load(sys.stdin)
names = [m.get('name','') for m in d.get('models',[])]
print('yes' if any('bge-m3' in n for n in names) else 'no')
" 2>/dev/null || echo "no")
      [[ "$BGE_OK" == "yes" ]] && ok "  bge-m3 모델 확인 OK" || warn "  bge-m3 모델 없음 (pull 필요)"
    fi
  else
    fail "Ollama 응답 없음 (${SERVER_B_IP}:11434)"
  fi

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
      ok "  컬렉션 $col 존재" || warn "  컬렉션 $col 없음 (WF12 실행 필요)"
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
  echo "    - 재시작:    cd /app/aoms && docker compose up -d"
  echo "    - 가이드:    /app/aoms/deploy-guide.md 섹션 7 참조"
  exit 1
else
  echo -e "  ${GREEN}모든 검증 통과 ✓${NC}"
  exit 0
fi
