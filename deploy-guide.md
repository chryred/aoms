# Synapse-V 배포 가이드

백화점 통합 모니터링 시스템(Synapse-V) — 폐쇄망 운영 서버 배포 절차

> **환경**: Mac(빌드 머신) → Server A(Main) + Server B(AI/Vector)  
> **OS**: RedHat 8.9 / Docker Compose  
> **배포 방식**: Mac에서 이미지 빌드 → `.tar.gz` 패키징 → SCP 전송 → 서버에서 로드  
> **배포 경로**: `/app/synapse` (Server A, Server B 공통)

---

## 목차

1. [사전 준비 (Mac)](#1-사전-준비-mac)
2. [Server B 배포 (AI/Vector 서버)](#2-server-b-배포-aivector-서버)
3. [Server A 배포 (Main 서버)](#3-server-a-배포-main-서버)
   - [3-1. 인프라 서비스 (Prometheus, Alertmanager, Grafana, PostgreSQL)](#3-1-인프라-서비스)
   - [3-2. 애플리케이션 서비스 (admin-api, log-analyzer, frontend)](#3-2-애플리케이션-서비스)
   - [3-3. n8n 워크플로우 자동화](#3-3-n8n-워크플로우-자동화)
4. [모니터링 에이전트 배포 (대상 서버)](#4-모니터링-에이전트-배포-대상-서버)
5. [배포 후 검증](#5-배포-후-검증)
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
| `DB_USER` | PostgreSQL 사용자명 **(반드시 `synapse`)** | `synapse` |
| `DB_PASSWORD` | PostgreSQL 비밀번호 | `MyDBPass456!` |
| `PROM_USER` | Prometheus Basic Auth 사용자명 | `admin` |
| `PROM_PASS` | Prometheus Basic Auth 비밀번호 | `PromPass789!` |
| `LLM_API_URL` | 내부 LLM API 엔드포인트 | `http://llm-server:8080/v1` |
| `LLM_API_KEY` | LLM API 기본 키 | `sk-...` |
| `LLM_AGENT_CODE` | LLM 에이전트 코드 | `synapse-analyzer` |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams Webhook URL | `https://...webhook.office.com/...` |
| `N8N_USER` | n8n 관리자 사용자명 | `admin` |
| `N8N_PASSWORD` | n8n 관리자 비밀번호 | `N8nPass!234` |
| `MONITORING_SERVER_IP` | Server A IP 주소 | `192.168.10.5` |
| `OLLAMA_URL` | Server B Ollama URL | `http://192.168.10.6:11434` |
| `EMBED_MODEL` | 임베딩 모델명 | `bge-m3` |
| `QDRANT_URL` | Server B Qdrant URL | `http://192.168.10.6:6333` |
| `FRONTEND_EXTERNAL_URL` | Teams 카드 "해결책 등록" 버튼이 여는 React 페이지 URL (브라우저 접근 가능) | `http://192.168.10.5:3001` |
| `ENCRYPTION_KEY` | 공통 Fernet 대칭키 (DB 모니터링 자격증명 · 챗봇 executor 자격증명 공용) | `<fernet_key>` |

> **주의**: `DB_USER`는 반드시 `synapse`이어야 합니다. `docker-compose.yml`의 PostgreSQL 헬스체크와 `DATABASE_URL`이 `synapse`로 하드코딩되어 있어 다른 값 사용 시 admin-api 기동 실패합니다.

> **`ENCRYPTION_KEY` 생성 방법:**
> ```bash
> python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
> ```

### 1-2. synapse_agent 바이너리 빌드

`build-images.sh`가 admin-api 이미지 빌드 시 `agent/dist/agent-v` 바이너리를 번들링합니다.  
빌드 전 에이전트 바이너리를 먼저 컴파일해야 합니다.

```bash
cd /path/to/aoms/agent

# musl 정적 바이너리 빌드 (RedHat 8.9 대상)
# Rust 툴체인 및 musl 타겟 설치 필요:
#   rustup target add x86_64-unknown-linux-musl
./build.sh

# 빌드 결과 확인
ls -lh dist/agent-v
file dist/agent-v   # "statically linked" 여야 함
```

### 1-3. Docker 이미지 빌드

```bash
cd /path/to/aoms

# 전체 빌드 (admin-api, log-analyzer, frontend)
./build-images.sh

# 결과물 확인
ls -lh main-server/*.tar.gz
# main-server/synapse-admin-api-1.0.tar.gz
# main-server/synapse-log-analyzer-1.0.tar.gz
# main-server/synapse-frontend-1.0.tar.gz
```

### 1-4. 파일 전송

```bash
SERVER_A="user@192.168.10.5"
SERVER_B="user@192.168.10.6"
REMOTE_DIR="/app/synapse"

# ── Server A — 애플리케이션 이미지 ──────────────────────────
scp main-server/synapse-admin-api-1.0.tar.gz     $SERVER_A:$REMOTE_DIR/images/
scp main-server/synapse-log-analyzer-1.0.tar.gz  $SERVER_A:$REMOTE_DIR/images/
scp main-server/synapse-frontend-1.0.tar.gz      $SERVER_A:$REMOTE_DIR/images/

# ── Server A — 인프라 이미지 (offline 패키지) ───────────────
# aoms-offline/ 디렉터리에 사전 준비된 이미지 파일 전송
scp aoms-offline/docker-images/prometheus-v3.10.0.tar    $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/alertmanager-main.tar     $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/grafana-12.4.0.tar        $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/postgres-16-alpine.tar    $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/n8n-1.44.0.tar            $SERVER_A:$REMOTE_DIR/images/

# ── Server A — 설정 파일 및 docker-compose ──────────────────
scp main-server/docker-compose.yml  $SERVER_A:$REMOTE_DIR/
scp main-server/.env                $SERVER_A:$REMOTE_DIR/
scp -r main-server/configs/         $SERVER_A:$REMOTE_DIR/configs/
scp -r main-server/n8n-workflows/   $SERVER_A:$REMOTE_DIR/n8n-workflows/

# ── Server B — 이미지 ───────────────────────────────────────
scp aoms-offline/docker-images/ollama-0.18.0.tar.gz    $SERVER_B:$REMOTE_DIR/images/
scp aoms-offline/docker-images/qdrant-v1.17.0.tar.gz   $SERVER_B:$REMOTE_DIR/images/
scp aoms-offline/ollama-models.tar.gz                  $SERVER_B:$REMOTE_DIR/

# ── Server B — docker-compose ───────────────────────────────
scp sub-server/docker-compose.yml   $SERVER_B:$REMOTE_DIR/
```

> **synapse_agent 별도 전송 불필요**: 에이전트 바이너리는 `synapse-admin-api:1.0` 이미지에 번들되어 있습니다.  
> 대상 서버 배포는 admin-api의 `/api/v1/agents/install` API로 자동화됩니다.

---

## 2. Server B 배포 (AI/Vector 서버)

> **배포 순서**: Server B를 먼저 배포해야 Server A의 log-analyzer가 임베딩 모델을 사용할 수 있습니다.

### 2-1. 디렉터리 구조 생성

```bash
ssh user@SERVER_B
sudo mkdir -p /app/synapse/{images,services/ollama-models,services/qdrant-storage}
sudo chown -R $USER:$USER /app/synapse
```

### 2-2. Docker 이미지 로드

```bash
cd /app/synapse/images

docker load < ollama-0.18.0.tar.gz
docker load < qdrant-v1.17.0.tar.gz

# 로드 확인
docker images | grep -E "ollama|qdrant"
```

### 2-3. Ollama 모델 복원

```bash
cd /app/synapse

# 사전 다운로드한 모델 압축 해제
tar xzf ollama-models.tar.gz -C services/ollama-models/

# bge-m3 모델 확인
ls services/ollama-models/models/manifests/registry.ollama.ai/library/ | grep bge
```

### 2-4. 서비스 시작

```bash
cd /app/synapse
docker compose up -d

# 상태 확인
docker compose ps
```

### 2-5. Ollama bge-m3 모델 확인

```bash
# Ollama API 응답 확인
curl -s http://localhost:11434/api/tags | python3 -c "
import sys, json
d = json.load(sys.stdin)
for m in d.get('models', []):
    print(m['name'])
"

# bge-m3가 목록에 없으면 수동 등록 (폐쇄망 불가 시 ollama-models.tar.gz 재배포)
docker exec synapse-ollama ollama list
```

### 2-6. Qdrant 컬렉션 초기화

Server A 배포 완료 후 WF12를 통해 수행됩니다. (섹션 3-3 참조)

---

## 3. Server A 배포 (Main 서버)

### 3-1. 인프라 서비스

#### 디렉터리 구조 생성

```bash
ssh user@SERVER_A
sudo mkdir -p /app/synapse/{images,configs/{prometheus,alertmanager,grafana,postgres},ssl}
sudo chown -R $USER:$USER /app/synapse
```

#### SSL 인증서 생성 (Grafana HTTPS)

```bash
# 자체 서명 인증서 생성 (10년 유효)
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /app/synapse/ssl/grafana.key \
  -out    /app/synapse/ssl/grafana.crt \
  -subj "/C=KR/ST=Seoul/O=Synapse-V/CN=$(hostname)"

chmod 600 /app/synapse/ssl/grafana.key
chmod 644 /app/synapse/ssl/grafana.crt
```

#### Prometheus Basic Auth 해시 생성

`configs/prometheus/web.yml`의 `password_bcrypt` 항목에 입력할 bcrypt 해시를 생성합니다.

```bash
PROM_PASS=$(grep PROM_PASS /app/synapse/.env | cut -d= -f2)

python3 -c "
import bcrypt
password = b'${PROM_PASS}'
hashed = bcrypt.hashpw(password, bcrypt.gensalt(rounds=12))
print(hashed.decode())
"
```

생성된 해시를 `/app/synapse/configs/prometheus/web.yml`에 입력:

```yaml
# configs/prometheus/web.yml
basic_auth_users:
  admin: <생성된_bcrypt_해시>
```

#### 인프라 이미지 로드

```bash
cd /app/synapse/images

docker load < prometheus-v3.10.0.tar
docker load < alertmanager-main.tar
docker load < grafana-12.4.0.tar
docker load < postgres-16-alpine.tar
docker load < n8n-1.44.0.tar

# 로드 확인
docker images | grep -E "prometheus|alertmanager|grafana|postgres|n8n"
```

#### .env 파일 확인

```bash
vi /app/synapse/.env

# 반드시 확인할 항목:
# DB_USER=synapse                            ← synapse 고정
# MONITORING_SERVER_IP=192.168.10.5          ← Server A 실제 IP
# OLLAMA_URL=http://192.168.10.6:11434       ← Server B 실제 IP
# QDRANT_URL=http://192.168.10.6:6333        ← Server B 실제 IP
# ENCRYPTION_KEY=<fernet_key>                ← 공통 암호화 키 (DB 모니터링 · 챗봇 executor)
```

#### 인프라 서비스 시작 (순서 중요)

```bash
cd /app/synapse

# 1. PostgreSQL 먼저 시작 (다른 서비스들이 의존)
docker compose up -d postgres

# 헬스체크 통과 대기 (최대 30초)
until docker inspect synapse-postgres --format='{{.State.Health.Status}}' | grep -q healthy; do
  echo "PostgreSQL 기동 대기 중..."; sleep 5
done
echo "PostgreSQL 준비 완료"

# 2. Prometheus + Alertmanager 시작
docker compose up -d prometheus alertmanager
sleep 5

# 3. Grafana 시작
docker compose up -d grafana

# 4. 상태 확인
docker compose ps | grep -E "prometheus|alertmanager|grafana|postgres"
```

---

### 3-2. 애플리케이션 서비스

#### 애플리케이션 이미지 로드

```bash
cd /app/synapse/images

docker load < synapse-admin-api-1.0.tar.gz
docker load < synapse-log-analyzer-1.0.tar.gz
docker load < synapse-frontend-1.0.tar.gz

# 로드 확인
docker images | grep synapse
```

#### 서비스 시작 순서

```bash
cd /app/synapse

# 1. log-analyzer 먼저 시작 (admin-api depends_on 참조)
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
docker logs synapse-admin-api 2>&1 | grep -E "table|created|error|startup" | head -20
```

#### admin-api 정상 기동 확인

```bash
curl -sf http://localhost:8080/health && echo "admin-api OK"
curl -sf http://localhost:8080/docs > /dev/null && echo "admin-api Swagger OK"
```

---

### 3-3. n8n (현재 미사용, 컨테이너만 예비 유지)

> **중요**: WF1·WF2·WF3·WF6~WF12는 각각 log-analyzer 스케줄러 / admin-api 직접 호출 / frontend 직결로 이관·제거되었습니다 (ADR-006).
> WF4(일일 장애 리포트)·WF5(반복 이상 에스컬레이션)는 보류 상태로 `n8n-workflows/` 디렉터리에 JSON만 보존되어 있으며,
> 추후 log-analyzer로 포팅할 때 참고용입니다.

n8n 컨테이너는 docker-compose에 남아 있지만 워크플로우를 import하지 않아도 됩니다.

```bash
# Qdrant 집계 컬렉션 초기화 (과거 WF12 역할) — log-analyzer API 직접 호출
curl -s -X POST http://localhost:8000/aggregation/collections/setup \
  -H "Content-Type: application/json" | python3 -m json.tool
```

WF4/WF5 재활용이 필요해질 때만 기존 `docs/workflow/9.phase4c-n8n.md`를 참고해 n8n 초기 계정 설정 + 크리덴셜 등록 + 워크플로우 import 절차를 밟으면 됩니다.

---

## 4. 모니터링 에이전트 배포 (대상 서버)

synapse_agent는 Rust로 작성된 단일 정적 바이너리입니다. `synapse-admin-api` 이미지에 번들되어 있으며,  
admin-api의 `/api/v1/agents/install` API를 통해 대상 서버에 자동 배포됩니다.  
별도 파일 전송이나 스크립트 실행 없이 API 호출 한 번으로 설치됩니다.

### 4-1. 모니터링 대상 시스템 등록 (admin-api)

먼저 Swagger UI(`http://SERVER_A:8080/docs`) 또는 API로 시스템과 담당자를 등록합니다.

```bash
# 시스템 등록 예시
curl -s -X POST http://localhost:8080/api/v1/systems \
  -H "Content-Type: application/json" \
  -d '{
    "system_name": "customer-experience",
    "display_name": "고객경험 시스템",
    "teams_webhook_url": "https://...webhook.office.com/..."
  }'

# 담당자 등록 예시
curl -s -X POST http://localhost:8080/api/v1/contacts \
  -H "Content-Type: application/json" \
  -d '{
    "name": "홍길동",
    "teams_upn": "gildong@company.com",
    "llm_api_key": "sk-..."
  }'
```

### 4-2. 에이전트 설치 (API 호출)

```bash
# 대상 서버에 synapse_agent 자동 설치
curl -s -X POST http://localhost:8080/api/v1/agents/install \
  -H "Content-Type: application/json" \
  -d '{
    "system_name": "customer-experience",
    "instance_role": "was1",
    "host": "cx-was01",
    "target_host": "192.168.10.10",
    "target_user": "deploy",
    "ssh_key_path": "/root/.ssh/id_rsa",
    "install_dir": "/opt/synapse-agent"
  }' | python3 -m json.tool
```

> admin-api가 내부적으로:
> 1. `config.toml` 생성 (system_name, instance_role, Prometheus Remote Write 엔드포인트 포함)
> 2. SFTP로 대상 서버에 바이너리 + config.toml 업로드
> 3. nohup으로 에이전트 실행

### 4-3. config.toml 구조 (참고)

```toml
[agent]
system_name = "customer-experience"   # DB systems.system_name과 반드시 일치
instance_role = "was1"                # HA 이중화 구분 (was1/was2, db-primary/db-standby)
host = "cx-was01"
collect_interval_secs = 15

[remote_write]
endpoint = "http://192.168.10.5:9090/api/v1/write"   # Server A Prometheus Remote Write
batch_size = 500
timeout_secs = 10
wal_dir = "/var/lib/synapse-agent/wal"
wal_retention_hours = 2

[collectors]
cpu = true
memory = true
disk = true
network = true
process = true
log_monitor = true

# 로그 소스 1
[[log_monitor]]
paths = ["/apps/logs/JeusServer.log"]
keywords = ["ERROR", "Fatal", "Exception", "CRITICAL"]
log_type = "jeus"

# 로그 소스 2 (같은 팀, 다른 파일)
[[log_monitor]]
paths = ["/opt/app/logs/*.log"]
keywords = ["ERROR", "CRITICAL"]
log_type = "app"
```

> - `system_name`은 DB `systems.system_name`과 **반드시 동일**해야 알림이 올바르게 라우팅됩니다.
> - 담당자/채널 분리가 필요하면 별도 `system_name`으로 별도 등록하세요.
> - synapse_agent는 Prometheus Remote Write로 메트릭을 전송합니다 (Loki 미사용).
>   Prometheus 스크레이프 타겟 추가가 불필요합니다.

### 4-4. 에이전트 상태 확인

```bash
# admin-api로 에이전트 등록 목록 조회
curl -s http://localhost:8080/api/v1/agents | python3 -m json.tool

# 특정 에이전트 live-status (수집기별 활성 여부, last_seen)
curl -s "http://localhost:8080/api/v1/agents/{agent_id}/live-status" | python3 -m json.tool

# Prometheus에서 에이전트 heartbeat 확인 (인증 필요)
PROM_USER=$(grep PROM_USER /app/synapse/.env | cut -d= -f2)
PROM_PASS=$(grep PROM_PASS /app/synapse/.env | cut -d= -f2)
curl -su "${PROM_USER}:${PROM_PASS}" \
  "http://localhost:9090/api/v1/query?query=agent_up" | python3 -m json.tool
```

---

## 5. 배포 후 검증

Server A에서 `verify-deploy.sh`를 실행합니다.

```bash
chmod +x /app/synapse/verify-deploy.sh

# Server B IP 포함하여 실행 (권장)
/app/synapse/verify-deploy.sh 192.168.10.6

# Server A만 검증 (Server B 미배포 시)
/app/synapse/verify-deploy.sh
```

**검증 항목:**

| 섹션 | 내용 |
|---|---|
| 1. Docker 컨테이너 상태 | synapse-prometheus, alertmanager, grafana, postgres, admin-api, log-analyzer, frontend, n8n |
| 2. 포트 응답 확인 | 각 서비스 HTTP 응답 코드 |
| 3. 설정 파일 존재 확인 | .env, prometheus.yml, alertmanager.yml, web.yml, ssl 인증서 등 |
| 4. PostgreSQL 테이블 확인 | public 스키마 테이블 수, n8n 스키마 존재 여부 |
| 5. Prometheus Basic Auth | 인증 활성화 여부 (401 응답 확인) |
| 6. admin-api 기능 확인 | /api/v1/systems, /api/v1/agents 응답 |
| 7. log-analyzer 기능 확인 | /health → ok |
| 8. Prometheus 스크레이프 상태 | 타겟 UP 비율, Remote Write Receiver 활성화 |
| 9. n8n 워크플로우 확인 | healthz → ok |
| 10. Server B 확인 (선택) | Ollama bge-m3 모델, Qdrant 컬렉션 4종 |

**모든 검증 통과 후 최종 확인:**

```bash
# admin-api Swagger
curl -sf http://localhost:8080/docs > /dev/null && echo "OK"

# log-analyzer 내부 스케줄러 확인 (5분마다 분석, 1시간마다 집계)
docker logs synapse-log-analyzer 2>&1 | grep -E "scheduler|analysis|aggregation" | tail -10

# n8n 활성 워크플로우 확인 (WF2/3/4/5/12 = 5개 활성화)
curl -s -H "X-N8N-API-KEY: $N8N_API_KEY" http://localhost:5678/api/v1/workflows | \
  python3 -c "
import sys, json
wfs = json.load(sys.stdin)['data']
active = [w['name'] for w in wfs if w.get('active')]
print(f'활성 워크플로우 {len(active)}개:', active)
"
```

---

## 6. 롤백 절차

### 애플리케이션 서비스 롤백

```bash
cd /app/synapse

# 이전 버전 이미지 로드
docker load < /app/synapse/backup/synapse-admin-api-0.9.tar.gz

# 특정 서비스 롤백
docker compose stop admin-api
docker compose up -d admin-api

# 또는 이미지 태그 변경 후 재시작
docker tag synapse-admin-api:prev synapse-admin-api:1.0
docker compose up -d admin-api
```

### 전체 스택 롤백

```bash
# 현재 스택 중단 (데이터 볼륨 유지)
docker compose down

# 이전 버전 이미지 로드
docker load < /app/synapse/backup/synapse-admin-api-0.9.tar.gz
docker load < /app/synapse/backup/synapse-log-analyzer-0.9.tar.gz

# 이전 .env 복원
cp /app/synapse/backup/.env.bak /app/synapse/.env

# 재시작
docker compose up -d
```

---

## 7. 트러블슈팅 체크리스트

### 서비스 로그 확인

```bash
docker logs synapse-admin-api    --tail 50 -f
docker logs synapse-log-analyzer --tail 50 -f
docker logs synapse-postgres     --tail 50 -f
docker logs synapse-n8n          --tail 50 -f
docker logs synapse-prometheus   --tail 50 -f

# 전체 로그
cd /app/synapse && docker compose logs --tail 30
```

### 자주 발생하는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| admin-api 기동 실패 | PostgreSQL 미준비 또는 `DB_USER` 오류 | `docker logs synapse-postgres` 확인. `.env`에서 `DB_USER=synapse` 확인 |
| admin-api DB 연결 실패 | `DB_USER` 값이 `synapse`가 아님 | `.env`에서 `DB_USER=synapse`로 수정 후 `docker compose up -d admin-api` |
| Teams 알림 미발송 | `TEAMS_WEBHOOK_URL` 오류 | `.env` 확인 후 `docker compose up -d admin-api` |
| log-analyzer LLM 호출 실패 | `LLM_API_URL` / `LLM_API_KEY` 오류 | `.env` 확인 후 `docker compose up -d log-analyzer` |
| log-analyzer 임베딩 오류 | Server B 미기동 또는 bge-m3 모델 없음 | Server B에서 `docker exec synapse-ollama ollama list` 확인 |
| synapse_agent 메트릭 미수신 | Prometheus Remote Write Receiver 비활성화 | `docker-compose.yml`에 `--web.enable-remote-write-receiver` 플래그 확인 |
| synapse_agent 설치 실패 | SSH 키 또는 대상 서버 접근 오류 | `docker logs synapse-admin-api`에서 SFTP 에러 확인 |
| n8n 워크플로우 임포트 오류 | `typeVersion` 또는 크리덴셜 ID 불일치 | 크리덴셜 등록 후 워크플로우 임포트 순서 확인 |
| Prometheus Basic Auth 401 | 인증 정보 오류 | `PROM_USER` / `PROM_PASS` 확인, bcrypt 해시 재생성 |
| Grafana HTTPS 접속 불가 | SSL 인증서 경로 오류 | `/app/synapse/ssl/` 경로와 `docker-compose.yml` volume 확인 |
| Qdrant 컬렉션 없음 | WF12 미실행 | `curl -X POST http://localhost:8000/aggregation/collections/setup` |
| 암호화 키 오류 (DB 모니터링 / 챗봇 executor) | `ENCRYPTION_KEY` 미설정 | Fernet 키 생성 후 `.env`에 추가, 컨테이너 재시작 |

### 환경변수 적용 후 재시작

```bash
# .env 수정 후 관련 서비스만 재시작
cd /app/synapse
docker compose up -d admin-api log-analyzer n8n
```

### PostgreSQL 직접 접속

```bash
docker exec -it synapse-postgres psql -U synapse -d synapse

# 테이블 목록
\dt

# 시스템 목록 확인
SELECT system_name, teams_webhook_url FROM systems;

# 최근 알림 이력
SELECT * FROM alert_history ORDER BY created_at DESC LIMIT 10;

# 에이전트 등록 현황
SELECT system_name, instance_role, host, status, last_seen FROM agent_instances;
```

### Prometheus 쿼리 (인증 필요)

```bash
PROM_USER=$(grep PROM_USER /app/synapse/.env | cut -d= -f2)
PROM_PASS=$(grep PROM_PASS /app/synapse/.env | cut -d= -f2)

# 에이전트 heartbeat 확인
curl -su "${PROM_USER}:${PROM_PASS}" \
  "http://localhost:9090/api/v1/query?query=agent_up" | python3 -m json.tool

# 로그 에러 카운트 확인
curl -su "${PROM_USER}:${PROM_PASS}" \
  "http://localhost:9090/api/v1/query?query=log_error_total" | python3 -m json.tool

# Prometheus 설정 리로드 (스크레이프 타겟 추가 후)
curl -su "${PROM_USER}:${PROM_PASS}" -X POST http://localhost:9090/-/reload
```

---

*최종 업데이트: 2026-04-13*
