# Synapse-V 배포 가이드

백화점 통합 모니터링 시스템(Synapse-V) — 폐쇄망 운영 서버 배포 절차

> **환경**: Mac(빌드 머신) → Server A(Main) + Server B(AI/Vector)  
> **OS**: RedHat 8.9 / Docker Compose  
> **배포 방식**: Mac에서 이미지 빌드 → `.tar.gz` 패키징 → SCP 전송 → 서버에서 로드

---

## 목차

1. [사전 준비 (Mac)](#1-사전-준비-mac)
2. [Server B 배포 (AI/Vector 서버)](#2-server-b-배포-aivector-서버)
3. [Server A 배포 (Main 서버)](#3-server-a-배포-main-서버)
   - [3-1. 인프라 서비스 (Prometheus, Loki, Alertmanager, Grafana, PostgreSQL)](#3-1-인프라-서비스)
   - [3-2. 애플리케이션 서비스 (admin-api, log-analyzer, frontend)](#3-2-애플리케이션-서비스)
   - [3-3. n8n 워크플로우 자동화](#3-3-n8n-워크플로우-자동화)
4. [모니터링 에이전트 배포 (대상 서버)](#4-모니터링-에이전트-배포-대상-서버)
5. [배포 후 검증 스크립트](#5-배포-후-검증-스크립트)
6. [롤백 절차](#6-롤백-절차)
7. [트러블슈팅 체크리스트](#7-트러블슈팅-체크리스트)

---

## 1. 사전 준비 (Mac)

### 1-1. 환경변수 파일 준비

```bash
cd /path/to/aoms/main-server
cp .env.example .env

# .env 파일 필수 항목 입력
vi .env
```

**필수 입력 항목:**

| 변수 | 설명 | 예시 |
|---|---|---|
| `GRAFANA_ADMIN_PASSWORD` | Grafana 관리자 비밀번호 | `MySecurePass123!` |
| `DB_USER` | PostgreSQL 사용자명 | `aoms` |
| `DB_PASSWORD` | PostgreSQL 비밀번호 | `MyDBPass456!` |
| `PROM_PASS` | Prometheus Basic Auth 비밀번호 | `PromPass789!` |
| `LLM_API_URL` | 내부 LLM API 엔드포인트 | `http://llm-server:8080/v1` |
| `LLM_API_KEY` | LLM API 기본 키 | `sk-...` |
| `LLM_AGENT_CODE` | LLM 에이전트 코드 | `aoms-analyzer` |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams Webhook URL | `https://...webhook.office.com/...` |
| `N8N_PASSWORD` | n8n 관리자 비밀번호 | `N8nPass!234` |
| `MONITORING_SERVER_IP` | Server A IP 주소 | `192.168.10.5` |
| `OLLAMA_URL` | Server B Ollama URL | `http://192.168.10.6:11434` |
| `QDRANT_URL` | Server B Qdrant URL | `http://192.168.10.6:6333` |
| `ADMIN_API_EXTERNAL_URL` | Teams 피드백 버튼 URL (브라우저 접근 가능) | `http://192.168.10.5:8080` |

### 1-2. Docker 이미지 빌드

```bash
cd /path/to/aoms

# 전체 빌드 (admin-api, log-analyzer, frontend)
./build-images.sh

# 결과물 확인
ls -lh main-server/*.tar.gz
# main-server/aoms-admin-api-1.0.tar.gz
# main-server/aoms-log-analyzer-1.0.tar.gz
# main-server/aoms-frontend-1.0.tar.gz
```

### 1-3. 파일 전송

```bash
SERVER_A="user@192.168.10.5"
SERVER_B="user@192.168.10.6"
REMOTE_DIR="/app/aoms"

# Server A — 인프라 이미지 (aoms-offline 패키지)
scp aoms-offline/docker-images/*.tar    $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/*.tar.gz $SERVER_A:$REMOTE_DIR/images/

# Server A — 애플리케이션 이미지 (빌드 결과물)
scp main-server/aoms-admin-api-1.0.tar.gz    $SERVER_A:$REMOTE_DIR/images/
scp main-server/aoms-log-analyzer-1.0.tar.gz $SERVER_A:$REMOTE_DIR/images/
scp main-server/aoms-frontend-1.0.tar.gz     $SERVER_A:$REMOTE_DIR/images/

# Server A — 설정 파일 및 docker-compose
scp main-server/docker-compose.yml $SERVER_A:$REMOTE_DIR/
scp main-server/.env               $SERVER_A:$REMOTE_DIR/
scp -r main-server/configs/        $SERVER_A:$REMOTE_DIR/configs/
scp -r main-server/n8n-workflows/  $SERVER_A:$REMOTE_DIR/n8n-workflows/

# Server B — 이미지
scp aoms-offline/docker-images/ollama-0.18.0.tar.gz    $SERVER_B:$REMOTE_DIR/images/
scp aoms-offline/docker-images/qdrant-v1.17.0.tar.gz   $SERVER_B:$REMOTE_DIR/images/
scp aoms-offline/docker-images/ollama-models.tar.gz    $SERVER_B:$REMOTE_DIR/

# Server B — docker-compose
scp sub-server/docker-compose.yml $SERVER_B:$REMOTE_DIR/

# 에이전트 파일 (대상 서버 배포용)
scp install-agents.sh $SERVER_A:$REMOTE_DIR/
scp aoms-offline/agents/linux/alloy-linux-amd64.zip $SERVER_A:$REMOTE_DIR/agents/
scp aoms-offline/agents/linux/node_exporter-1.10.2.linux-amd64.tar.gz $SERVER_A:$REMOTE_DIR/agents/
```

---

## 2. Server B 배포 (AI/Vector 서버)

> **배포 순서**: Server B를 먼저 배포해야 Server A의 log-analyzer가 임베딩 모델을 사용할 수 있습니다.

### 2-1. 디렉터리 구조 생성

```bash
ssh user@SERVER_B
sudo mkdir -p /app/aoms/{images,services/ollama-models,services/qdrant-storage}
sudo chown -R $USER:$USER /app/aoms
```

### 2-2. Docker 이미지 로드

```bash
cd /app/aoms/images

docker load < ollama-0.18.0.tar.gz
docker load < qdrant-v1.17.0.tar.gz

# 로드 확인
docker images | grep -E "ollama|qdrant"
```

### 2-3. Ollama 모델 복원

```bash
cd /app/aoms

# 사전 다운로드한 모델 압축 해제
tar xzf ollama-models.tar.gz -C services/ollama-models/

# 파일 확인 (bge-m3 모델이 있어야 함)
ls services/ollama-models/models/manifests/
```

### 2-4. 서비스 시작

```bash
cd /app/aoms
docker compose up -d

# 상태 확인
docker compose ps
```

### 2-5. Ollama bge-m3 모델 준비 확인

```bash
# Ollama API 응답 확인
curl -s http://localhost:11434/api/tags | python3 -m json.tool

# bge-m3 모델이 없다면 폐쇄망 수동 등록
# (ollama-models.tar.gz에 포함된 경우 자동 인식됨)
docker exec aoms-ollama ollama list
```

### 2-6. Qdrant 컬렉션 초기화

Server A 배포 완료 후 WF12를 통해 수행됩니다. (섹션 3-3 참조)

---

## 3. Server A 배포 (Main 서버)

### 3-1. 인프라 서비스

#### 디렉터리 구조 생성

```bash
ssh user@SERVER_A
sudo mkdir -p /app/aoms/{images,configs/{prometheus,alertmanager,loki,grafana,postgres},ssl}
sudo chown -R $USER:$USER /app/aoms
```

#### SSL 인증서 생성 (Grafana HTTPS)

```bash
# 자체 서명 인증서 생성
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /app/aoms/ssl/grafana.key \
  -out    /app/aoms/ssl/grafana.crt \
  -subj "/C=KR/ST=Seoul/O=Synapse-V/CN=$(hostname)"

chmod 600 /app/aoms/ssl/grafana.key
chmod 644 /app/aoms/ssl/grafana.crt
```

#### 인프라 이미지 로드

```bash
cd /app/aoms/images

docker load < prometheus-v3.10.0.tar
docker load < altermanager-main.tar       # Alertmanager
docker load < loki-main-26d9031.tar       # Loki
docker load < grafana-12.4.0.tar
docker load < postgres.tar                # PostgreSQL 16-alpine
docker load < n8n-2.12.2.tar.gz          # n8n (또는 n8n-1.44.0)

# 로드 확인
docker images | grep -E "prometheus|alertmanager|loki|grafana|postgres|n8n"
```

#### Prometheus Basic Auth 해시 생성

```bash
# Prometheus web.yml의 bcrypt 해시 생성 (PROM_PASS와 동일한 비밀번호)
# htpasswd가 있는 경우
htpasswd -nBC 12 admin

# 또는 Python으로 생성
python3 -c "
import bcrypt
password = b'<PROM_PASS 값 입력>'
hashed = bcrypt.hashpw(password, bcrypt.gensalt(rounds=12))
print(hashed.decode())
"
```

생성된 해시를 `configs/prometheus/web.yml`의 `password_bcrypt` 항목에 입력합니다.

#### .env 파일 확인

```bash
vi /app/aoms/.env

# 반드시 확인할 항목:
# MONITORING_SERVER_IP=192.168.10.5   ← Server A의 실제 IP
# OLLAMA_URL=http://192.168.10.6:11434  ← Server B 실제 IP
# QDRANT_URL=http://192.168.10.6:6333   ← Server B 실제 IP
```

#### 인프라 서비스 시작 (순서 중요)

```bash
cd /app/aoms

# 1. PostgreSQL 먼저 시작 (다른 서비스들이 의존)
docker compose up -d postgres

# 헬스체크 통과 대기 (최대 30초)
until docker inspect aoms-postgres --format='{{.State.Health.Status}}' | grep -q healthy; do
  echo "PostgreSQL 기동 대기 중..."; sleep 5
done
echo "PostgreSQL 준비 완료"

# 2. Loki 시작
docker compose up -d loki
sleep 10

# 3. Prometheus + Alertmanager 시작
docker compose up -d prometheus alertmanager
sleep 5

# 4. Grafana 시작
docker compose up -d grafana

# 5. 상태 확인
docker compose ps | grep -E "prometheus|alertmanager|loki|grafana|postgres"
```

---

### 3-2. 애플리케이션 서비스

#### 애플리케이션 이미지 로드

```bash
cd /app/aoms/images

docker load < aoms-admin-api-1.0.tar.gz
docker load < aoms-log-analyzer-1.0.tar.gz
docker load < aoms-frontend-1.0.tar.gz

# 로드 확인
docker images | grep aoms
```

#### 서비스 시작 순서

```bash
cd /app/aoms

# 1. log-analyzer 먼저 시작 (admin-api가 depends_on으로 참조)
docker compose up -d log-analyzer
sleep 10

# 2. admin-api 시작 (PostgreSQL 헬스체크 통과 후 자동 테이블 생성)
docker compose up -d admin-api
sleep 15

# 3. frontend 시작
docker compose up -d frontend

# 4. 상태 확인
docker compose ps | grep -E "admin-api|log-analyzer|frontend"

# 5. admin-api 테이블 생성 로그 확인
docker logs aoms-admin-api 2>&1 | grep -E "table|created|error" | head -20
```

#### admin-api Swagger UI 접근 확인

```bash
curl -sf http://localhost:8080/docs > /dev/null && echo "admin-api OK" || echo "admin-api FAIL"
```

---

### 3-3. n8n 워크플로우 자동화

#### n8n 시작

```bash
cd /app/aoms
docker compose up -d n8n
sleep 30   # n8n 초기화 대기

# 상태 확인
docker logs aoms-n8n 2>&1 | tail -20
```

#### n8n 초기 계정 설정 (폐쇄망 — DB 직접 설정)

```bash
# bcrypt 해시 생성 (N8N_PASSWORD 환경변수 값 사용)
N8N_PASSWORD=$(grep N8N_PASSWORD /app/aoms/.env | cut -d= -f2)

HASH=$(docker exec aoms-n8n node -e "
const bcrypt = require('/usr/local/lib/node_modules/n8n/node_modules/bcryptjs');
bcrypt.hash('${N8N_PASSWORD}', 10, (err, hash) => { process.stdout.write(hash); });
")

N8N_USER=$(grep N8N_USER /app/aoms/.env | cut -d= -f2 | tr -d '"')

# user 테이블 업데이트
docker exec aoms-postgres psql -U aoms -d aoms -c "
UPDATE n8n.\"user\" SET
  email      = '${N8N_USER}@aoms.local',
  \"firstName\" = 'Admin',
  \"lastName\"  = 'Synapse-V',
  password   = '${HASH}',
  settings   = '{\"userActivated\": true}'
WHERE role = 'global:owner';"
```

#### n8n API 키 발급

```bash
N8N_USER=$(grep N8N_USER /app/aoms/.env | cut -d= -f2 | tr -d '"')
N8N_PASSWORD=$(grep N8N_PASSWORD /app/aoms/.env | cut -d= -f2)

# 로그인
curl -s -c /tmp/n8n_cookies.txt -X POST "http://localhost:5678/rest/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${N8N_USER}@aoms.local\",\"password\":\"${N8N_PASSWORD}\"}"

# API 키 생성
N8N_API_KEY=$(curl -s -b /tmp/n8n_cookies.txt -X POST "http://localhost:5678/rest/me/api-key" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['apiKey'])")

echo "N8N_API_KEY=$N8N_API_KEY"
# 이 값을 메모해두세요 (워크플로우 임포트에 사용)
```

#### PostgreSQL 크리덴셜 등록

```bash
DB_PASSWORD=$(grep DB_PASSWORD /app/aoms/.env | cut -d= -f2)
DB_USER=$(grep DB_USER /app/aoms/.env | cut -d= -f2)

curl -s -b /tmp/n8n_cookies.txt -X POST "http://localhost:5678/rest/credentials" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Synapse-V PostgreSQL\",
    \"type\": \"postgres\",
    \"data\": {
      \"host\": \"postgres\",
      \"port\": 5432,
      \"database\": \"aoms\",
      \"user\": \"${DB_USER}\",
      \"password\": \"${DB_PASSWORD}\",
      \"ssl\": \"disable\"
    },
    \"nodesAccess\": []
  }"
```

#### 워크플로우 임포트 (WF1~WF12 순서대로)

```bash
cd /app/aoms/n8n-workflows

for WF in WF1 WF2 WF3 WF4 WF5 WF6 WF7 WF8 WF9 WF10 WF11 WF12; do
  FILE=$(ls ${WF}-*.json 2>/dev/null | head -1)
  if [[ -z "$FILE" ]]; then
    echo "⚠  $WF 파일 없음, 스킵"
    continue
  fi

  # active 필드 추가 후 배열 형식으로 변환
  python3 -c "
import json
with open('$FILE') as f:
    wf = json.load(f)
wf['active'] = False
with open('/tmp/wf_import.json', 'w') as f:
    json.dump([wf], f, ensure_ascii=False)
"

  docker cp /tmp/wf_import.json aoms-n8n:/tmp/wf_import.json
  RESULT=$(docker exec aoms-n8n n8n import:workflow --input=/tmp/wf_import.json 2>&1)
  echo "$RESULT" | grep -q "imported" && echo "✓ $WF 임포트 완료" || echo "✗ $WF 임포트 실패: $RESULT"
done
```

#### Qdrant 컬렉션 초기화 (WF12 실행)

```bash
# WF12 수동 트리거 — 집계 컬렉션 초기화
curl -s -X POST http://localhost:8000/aggregation/collections/setup \
  -H "Content-Type: application/json" | python3 -m json.tool

# 또는 n8n API로 WF12 수동 실행
WF12_ID=$(curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" \
  http://localhost:5678/api/v1/workflows | \
  python3 -c "
import sys, json
wfs = json.load(sys.stdin)['data']
for wf in wfs:
    if 'WF12' in wf.get('name','') or 'aggregation' in wf.get('name','').lower():
        print(wf['id'])
        break
")

if [[ -n "$WF12_ID" ]]; then
  curl -s -X POST "http://localhost:5678/api/v1/workflows/${WF12_ID}/activate" \
    -H "X-N8N-API-KEY: $N8N_API_KEY"
  echo "WF12 활성화 완료 (ID: $WF12_ID)"
fi
```

#### 나머지 워크플로우 활성화

```bash
# n8n API로 전체 워크플로우 ID 조회 후 활성화
curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" http://localhost:5678/api/v1/workflows | \
  python3 -c "
import sys, json
wfs = json.load(sys.stdin)['data']
for wf in wfs:
    print(f\"{wf['id']}  {wf['name']}\")
"

# 각 워크플로우 활성화 (WF_ID에 실제 ID 입력)
for WF_ID in <WF1_ID> <WF2_ID> <WF3_ID> <WF4_ID> <WF5_ID> <WF6_ID> <WF7_ID> <WF8_ID> <WF9_ID> <WF10_ID> <WF11_ID>; do
  curl -s -X POST "http://localhost:5678/api/v1/workflows/${WF_ID}/activate" \
    -H "X-N8N-API-KEY: $N8N_API_KEY"
  echo "활성화: $WF_ID"
done
```

---

## 4. 모니터링 에이전트 배포 (대상 서버)

모니터링 대상 서버 각각에 SSH 접속하여 수행합니다.

### 4-1. 에이전트 파일 전송

```bash
# Server A에서 대상 서버로 전송
TARGET_SERVER="user@192.168.10.10"   # 대상 서버 IP

scp /app/aoms/install-agents.sh                           $TARGET_SERVER:/tmp/
scp /app/aoms/agents/alloy-linux-amd64.zip                $TARGET_SERVER:/tmp/
scp /app/aoms/agents/node_exporter-1.10.2.linux-amd64.tar.gz $TARGET_SERVER:/tmp/
# JMX가 필요한 경우
scp /app/aoms/agents/jmx_prometheus_javaagent-0.20.0.jar  $TARGET_SERVER:/tmp/

ssh $TARGET_SERVER
cd /tmp
chmod +x install-agents.sh
```

### 4-2. 에이전트 설치

```bash
# 대상 서버에서 실행
./install-agents.sh \
  --system-name    "customer-experience" \   # Prometheus label과 동일해야 함
  --instance-role  "was1" \                  # 서버 역할 번호
  --host           "cx-was01" \              # 호스트명
  --monitoring-server "192.168.10.5" \       # Server A IP
  --install-dir    "/opt/aoms-agents" \
  --jeus-log-base  "/apps/logs" \            # JEUS 로그 상위 경로
  --type           all \                     # node_exporter + alloy + jmx
  --jmx-port       9404
```

### 4-3. JEUS JVM 옵션 추가 (JMX 수집 활성화)

```bash
# JEUS 기동 스크립트 또는 jeus.properties에 추가
# -javaagent:/opt/aoms-agents/jmx_exporter/jmx_prometheus_javaagent-0.20.0.jar=9404:/opt/aoms-agents/jmx_exporter/jmx-config.yml

# JEUS 재기동 후 확인
curl -sf http://localhost:9404/metrics | head -5
```

### 4-4. Prometheus 스크레이프 타겟 추가

Server A의 `configs/prometheus/prometheus.yml`에 대상 서버 추가:

```yaml
scrape_configs:
  - job_name: 'node'
    static_configs:
      - targets: ['192.168.10.10:9100']
        labels:
          system_name: 'customer-experience'
          instance_role: 'was1'
          host: 'cx-was01'

  - job_name: 'jmx'
    static_configs:
      - targets: ['192.168.10.10:9404']
        labels:
          system_name: 'customer-experience'
          instance_role: 'was1'
```

```bash
# Prometheus 설정 리로드 (재시작 없이)
curl -X POST http://localhost:9090/-/reload
```

---

## 5. 배포 후 검증 스크립트

아래 스크립트를 Server A에서 실행합니다.

### verify-deploy.sh

```bash
#!/bin/bash
# ============================================================
# Synapse-V 배포 검증 스크립트
# 사용법: ./verify-deploy.sh [SERVER_B_IP]
# ============================================================
set -euo pipefail

SERVER_B_IP="${1:-}"
PASS=0; FAIL=0
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC}  $1"; (( PASS++ )) || true; }
fail() { echo -e "  ${RED}✗${NC}  $1"; (( FAIL++ )) || true; }
warn() { echo -e "  ${YELLOW}!${NC}  $1"; }
section() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

# ──────────────────────────────────────────
section "1. Docker 컨테이너 상태"
CONTAINERS=("aoms-prometheus" "aoms-alertmanager" "aoms-loki" "aoms-grafana"
            "aoms-postgres" "aoms-admin-api" "aoms-log-analyzer" "aoms-frontend" "aoms-n8n")

for c in "${CONTAINERS[@]}"; do
  STATUS=$(docker inspect "$c" --format='{{.State.Status}}' 2>/dev/null || echo "missing")
  if [[ "$STATUS" == "running" ]]; then
    ok "$c — running"
  else
    fail "$c — $STATUS"
  fi
done

# ──────────────────────────────────────────
section "2. 포트 응답 확인"
check_http() {
  local name="$1" url="$2" expected="${3:-200}"
  local code
  code=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
  if [[ "$code" == "$expected" || "$code" == "200" || "$code" == "302" ]]; then
    ok "$name ($url) → HTTP $code"
  else
    fail "$name ($url) → HTTP $code (expected $expected)"
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

# ──────────────────────────────────────────
section "3. PostgreSQL 연결 및 테이블 확인"
TABLE_COUNT=$(docker exec aoms-postgres psql -U aoms -d aoms -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ')

if [[ "$TABLE_COUNT" -ge 10 ]]; then
  ok "PostgreSQL 테이블 $TABLE_COUNT개 (예상: 12개)"
else
  fail "PostgreSQL 테이블 수 부족: $TABLE_COUNT개"
fi

# n8n 스키마 확인
N8N_SCHEMA=$(docker exec aoms-postgres psql -U aoms -d aoms -t -c \
  "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='n8n';" 2>/dev/null | tr -d ' ')
[[ "$N8N_SCHEMA" -ge 1 ]] && ok "n8n 스키마 존재" || fail "n8n 스키마 없음"

# ──────────────────────────────────────────
section "4. admin-api 엔드포인트 확인"
SYSTEMS=$(curl -s http://localhost:8080/api/v1/systems 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "-1")
if [[ "$SYSTEMS" -ge 0 ]]; then
  ok "GET /api/v1/systems → ${SYSTEMS}개 시스템 등록됨"
else
  fail "GET /api/v1/systems 응답 오류"
fi

# ──────────────────────────────────────────
section "5. log-analyzer 엔드포인트 확인"
ANALYZER_HEALTH=$(curl -s http://localhost:8000/health 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "error")
[[ "$ANALYZER_HEALTH" == "ok" ]] && ok "log-analyzer /health → ok" || fail "log-analyzer /health → $ANALYZER_HEALTH"

# ──────────────────────────────────────────
section "6. Loki 로그 수신 확인"
LOKI_STATUS=$(curl -s http://localhost:3100/ready 2>/dev/null | tr -d '\n')
[[ "$LOKI_STATUS" == "ready" ]] && ok "Loki 준비 완료" || warn "Loki 상태: $LOKI_STATUS"

# 스트림 수 확인
STREAM_COUNT=$(curl -s "http://localhost:3100/loki/api/v1/label" 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
[[ "$STREAM_COUNT" -gt 0 ]] && ok "Loki 레이블 ${STREAM_COUNT}개 수신 중" || warn "Loki 수신 데이터 없음 (에이전트 미배포 또는 정상)"

# ──────────────────────────────────────────
section "7. Prometheus 스크레이프 상태"
PROM_TARGETS=$(curl -s "http://localhost:9090/api/v1/targets" 2>/dev/null | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
active = d.get('data', {}).get('activeTargets', [])
up_count = sum(1 for t in active if t.get('health') == 'up')
total = len(active)
print(f'{up_count}/{total}')
" 2>/dev/null || echo "0/0")
ok "Prometheus 타겟: $PROM_TARGETS UP"

# ──────────────────────────────────────────
section "8. n8n 워크플로우 확인"
N8N_HEALTH=$(curl -s http://localhost:5678/healthz 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "error")
[[ "$N8N_HEALTH" == "ok" ]] && ok "n8n healthz → ok" || warn "n8n 상태: $N8N_HEALTH"

# ──────────────────────────────────────────
# Server B 확인 (IP 인수 전달 시)
if [[ -n "$SERVER_B_IP" ]]; then
  section "9. Server B (AI/Vector) 확인"

  OLLAMA_OK=$(curl -s --max-time 5 "http://${SERVER_B_IP}:11434/api/tags" 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('models',[])))" 2>/dev/null || echo "-1")
  if [[ "$OLLAMA_OK" -ge 0 ]]; then
    ok "Ollama 응답 OK (모델 ${OLLAMA_OK}개)"
    [[ "$OLLAMA_OK" -eq 0 ]] && warn "  → bge-m3 모델이 없습니다. Ollama에서 pull 필요"
  else
    fail "Ollama 응답 없음 (${SERVER_B_IP}:11434)"
  fi

  QDRANT_OK=$(curl -s --max-time 5 "http://${SERVER_B_IP}:6333/" 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('title','unknown'))" 2>/dev/null || echo "error")
  [[ "$QDRANT_OK" == "qdrant - vector search engine" ]] && \
    ok "Qdrant 응답 OK" || fail "Qdrant 응답 이상: $QDRANT_OK"

  # Qdrant 컬렉션 확인
  COLLECTIONS=$(curl -s --max-time 5 "http://${SERVER_B_IP}:6333/collections" 2>/dev/null | \
    python3 -c "
import sys, json
d = json.load(sys.stdin)
cols = [c['name'] for c in d.get('result', {}).get('collections', [])]
print(', '.join(cols) if cols else 'none')
" 2>/dev/null || echo "error")
  ok "Qdrant 컬렉션: $COLLECTIONS"
fi

# ──────────────────────────────────────────
section "결과 요약"
TOTAL=$((PASS + FAIL))
echo ""
echo -e "  통과: ${GREEN}${PASS}${NC} / 전체: ${TOTAL}"
if [[ "$FAIL" -gt 0 ]]; then
  echo -e "  실패: ${RED}${FAIL}${NC}개 — 위 내용을 확인하세요"
  exit 1
else
  echo -e "  ${GREEN}모든 검증 통과 ✓${NC}"
fi
```

### 스크립트 생성 및 실행

```bash
# Server A에서 실행
cat > /app/aoms/verify-deploy.sh << 'SCRIPT'
# (위 스크립트 내용 붙여넣기)
SCRIPT

chmod +x /app/aoms/verify-deploy.sh

# 실행 (Server B IP 포함)
/app/aoms/verify-deploy.sh 192.168.10.6
```

### 에이전트 검증 (대상 서버에서 실행)

```bash
#!/bin/bash
# verify-agents.sh — 대상 서버에서 실행
echo "=== Synapse-V 에이전트 상태 확인 ==="

# node_exporter
systemctl is-active node_exporter && echo "✓ node_exporter 실행 중" || echo "✗ node_exporter 중단"
curl -sf http://localhost:9100/metrics | head -3

# Grafana Alloy
systemctl is-active alloy && echo "✓ Alloy 실행 중" || echo "✗ Alloy 중단"
curl -sf http://localhost:12345/metrics | grep -c "alloy_" | xargs -I{} echo "  Alloy 메트릭 {}개"

# JMX (선택)
if systemctl list-unit-files | grep -q jmx; then
  curl -sf http://localhost:9404/metrics | head -3
fi

# ACL 확인 (JEUS 로그)
echo "--- JEUS 로그 ACL ---"
getfacl /apps/logs 2>/dev/null | grep alloy || echo "  ACL 미설정"
```

---

## 6. 롤백 절차

### 애플리케이션 서비스 롤백

```bash
cd /app/aoms

# 이전 버전 이미지 태그 확인
docker images | grep aoms

# 특정 서비스 롤백 (예: admin-api)
docker compose stop admin-api
docker tag aoms-admin-api:prev aoms-admin-api:1.0   # 이전 버전으로 태그
docker compose up -d admin-api

# 또는 이전 tar.gz에서 재로드
docker load < /app/aoms/backup/aoms-admin-api-0.9.tar.gz
docker compose up -d admin-api
```

### 전체 스택 롤백

```bash
# 현재 스택 중단 (데이터 유지)
docker compose down

# 이전 버전 이미지 로드
docker load < /app/aoms/backup/aoms-admin-api-0.9.tar.gz
docker load < /app/aoms/backup/aoms-log-analyzer-0.9.tar.gz

# 이전 .env 복원
cp /app/aoms/backup/.env.bak /app/aoms/.env

# 재시작
docker compose up -d
```

---

## 7. 트러블슈팅 체크리스트

### 서비스 로그 확인

```bash
# 특정 서비스 로그
docker logs aoms-admin-api    --tail 50 -f
docker logs aoms-log-analyzer --tail 50 -f
docker logs aoms-postgres     --tail 50 -f
docker logs aoms-n8n          --tail 50 -f

# 전체 로그
cd /app/aoms && docker compose logs --tail 30
```

### 자주 발생하는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| admin-api 기동 실패 | PostgreSQL 미준비 | `docker logs aoms-postgres` 확인 후 `docker compose up -d admin-api` 재시도 |
| Teams 알림 미발송 | `TEAMS_WEBHOOK_URL` 오류 | `.env` 확인 후 `docker compose up -d admin-api` |
| log-analyzer LLM 호출 실패 | `LLM_API_URL` / `LLM_API_KEY` 오류 | `.env` 확인 후 `docker compose up -d log-analyzer` |
| Ollama 임베딩 오류 | Server B 미기동 또는 bge-m3 모델 없음 | Server B에서 `docker exec aoms-ollama ollama pull bge-m3` |
| n8n 워크플로우 임포트 오류 | `typeVersion` 또는 operator 형식 오류 | `n8n-workflows/CLAUDE.md` 체크리스트 참조 |
| Prometheus `system_name` 불일치 | Prometheus label ≠ DB `systems.system_name` | DB에서 `system_name` 확인 후 Prometheus 설정 수정 |
| Grafana HTTPS 접속 불가 | SSL 인증서 경로 오류 | `/app/aoms/ssl/` 경로와 `docker-compose.yml` volume 확인 |

### 환경변수 적용 후 재시작

```bash
# .env 수정 후 관련 서비스만 재시작
cd /app/aoms
docker compose up -d admin-api log-analyzer n8n
```

### PostgreSQL 직접 접속

```bash
docker exec -it aoms-postgres psql -U aoms -d aoms

# 테이블 목록
\dt

# 시스템 목록 확인
SELECT system_name, teams_webhook_url FROM systems;

# 최근 알림 이력
SELECT * FROM alert_history ORDER BY created_at DESC LIMIT 10;
```

---

*최종 업데이트: 2026-04-05*
