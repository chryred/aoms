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
   - [3-1. 인프라 서비스 (Prometheus, Alertmanager, Grafana, PostgreSQL, Tempo, OTel)](#3-1-인프라-서비스)
   - [3-2. 애플리케이션 서비스 (admin-api, log-analyzer, frontend)](#3-2-애플리케이션-서비스)
   - [3-3. n8n (미사용, 예비 컨테이너)](#3-3-n8n-미사용-예비-컨테이너)
4. [모니터링 에이전트 배포 (대상 서버)](#4-모니터링-에이전트-배포-대상-서버)
5. [Synapse CLI 배포 (운영 담당자 서버)](#5-synapse-cli-배포-운영-담당자-서버)
6. [배포 후 검증](#6-배포-후-검증)
7. [롤백 절차](#7-롤백-절차)
8. [트러블슈팅 체크리스트](#8-트러블슈팅-체크리스트)

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

| 변수 | 설명 | 예시 / 생성 방법 |
|---|---|---|
| `GRAFANA_ADMIN_PASSWORD` | Grafana 관리자 비밀번호 | `MySecurePass123!` |
| `DB_USER` | PostgreSQL 사용자명 **(반드시 `synapse`)** | `synapse` |
| `DB_PASSWORD` | PostgreSQL 비밀번호 | `MyDBPass456!` |
| `PROM_USER` | Prometheus Basic Auth 사용자명 | `admin` |
| `PROM_PASS` | Prometheus Basic Auth 비밀번호 | `PromPass789!` |
| `SECRET_KEY` | JWT 서명 키 **(운영 배포 필수 변경)** | `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `CORS_ORIGINS` | 허용 프론트엔드 도메인 (콤마 구분) | `http://192.168.10.5:3001` |
| `FRONTEND_EXTERNAL_URL` | Teams 카드 "해결책 등록" 버튼이 여는 React 페이지 URL (브라우저 접근 가능) | `http://192.168.10.5:3001` |
| `AGENT_PROMETHEUS_URL` | synapse_agent live-status 쿼리용 Prometheus URL | `http://192.168.10.5:9090` |
| `LLM_TYPE` | LLM 프로바이더 선택 (ADR-012: ollama 폐지) | `devx` / `claude` / `openai` |
| `LLM_API_URL` | 내부 LLM API 엔드포인트 | `http://llm-server:8080/v1` |
| `LLM_MODEL` | 사용할 LLM 모델명 (`devx` 타입은 agent_code로 관리하므로 생략 가능) | `your-model-name` |
| `DEVX_CLIENT_ID` | DevX OAuth Client ID | `synapse-client` |
| `DEVX_CLIENT_SECRET` | DevX OAuth Client Secret | `your-secret` |
| `TEAMS_WEBHOOK_URL` | Microsoft Teams Webhook URL | `https://...webhook.office.com/...` |
| `N8N_USER` | n8n 관리자 사용자명 | `admin` |
| `N8N_PASSWORD` | n8n 관리자 비밀번호 | `N8nPass!234` |
| `MONITORING_SERVER_IP` | Server A IP 주소 (n8n webhook URL 구성용) | `192.168.10.5` |
| `QDRANT_URL` | Server B Qdrant URL | `http://192.168.10.6:6333` |
| `ENCRYPTION_KEY` | 공통 Fernet 대칭키 (DB 모니터링 자격증명 · 챗봇 executor 자격증명 공용) | 아래 생성 방법 참고 |
| `LLM_API_KEY` | n8n WF4/WF5 활성화 시 필요 (현재 n8n 미사용으로 선택 항목) | `your-api-key` |

> **주의**: `DB_USER`는 반드시 `synapse`이어야 합니다. `.env.example`의 기본값이 `aoms`로 되어 있으나 이는 잘못된 기본값입니다. `docker-compose.yml`의 `DATABASE_URL`이 `postgresql+asyncpg://synapse:...`로 **하드코딩**되어 있어 `DB_USER=aoms`로 배포하면 Postgres 사용자는 `aoms`로 생성되지만 admin-api는 `synapse`로 접속 시도하여 DB 연결에 실패합니다.

> **`ENCRYPTION_KEY` 생성 방법:**
> ```bash
> python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
> ```

> **`SECRET_KEY` 생성 방법:**
> ```bash
> python3 -c "import secrets; print(secrets.token_urlsafe(32))"
> ```

---

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

admin-api Dockerfile은 **멀티스테이지 빌드**입니다.  
- Stage 1: Go로 synapse CLI 바이너리를 빌드 (`synapse-cli/` 디렉터리)
- Stage 2: Python admin-api 이미지에 agent-v + synapse CLI 번들

**별도 CLI 빌드 없이** `build-images.sh` 한 번으로 모두 처리됩니다.

```bash
cd /path/to/aoms

# 전체 빌드 (admin-api, log-analyzer, frontend)
# 빌드 컨텍스트는 프로젝트 루트 (build-images.sh가 자동 처리)
./build-images.sh

# 결과물 확인
ls -lh main-server/*.tar.gz
# main-server/synapse-admin-api-1.0.tar.gz  (agent-v + synapse CLI 포함)
# main-server/synapse-log-analyzer-1.0.tar.gz
# main-server/synapse-frontend-1.0.tar.gz
```

> **주의**: `synapse-log-analyzer-1.0.tar.gz`는 BAAI/bge-m3 ONNX 모델이 이미지에 번들되어 **약 3GB** 크기입니다. SCP 전송 전 Server A 디스크 여유 공간(최소 10GB 권장)을 확인하세요.

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
scp aoms-offline/docker-images/prometheus-v3.10.0.tar           $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/alertmanager-main.tar            $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/grafana-12.4.0.tar               $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/postgres-16-alpine.tar           $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/n8n-1.44.0.tar                   $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/tempo-2.9.1.tar                  $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/otel-collector-contrib-0.123.0.tar  $SERVER_A:$REMOTE_DIR/images/

# ── Server A — 설정 파일 및 docker-compose ──────────────────
scp main-server/docker-compose.yml  $SERVER_A:$REMOTE_DIR/
scp main-server/.env                $SERVER_A:$REMOTE_DIR/
scp -r main-server/configs/         $SERVER_A:$REMOTE_DIR/configs/
scp -r main-server/n8n-workflows/   $SERVER_A:$REMOTE_DIR/n8n-workflows/

# ── Server A — alertmanager 디렉터리 생성 확인 (configs/ scp 후) ─
ssh $SERVER_A "mkdir -p $REMOTE_DIR/configs/alertmanager"

# ── Server B — 이미지 (ADR-011/012: Qdrant만) ─────────────────
scp aoms-offline/docker-images/qdrant-v1.17.0.tar.gz   $SERVER_B:$REMOTE_DIR/images/

# ── Server B — docker-compose ───────────────────────────────
scp sub-server/docker-compose.yml   $SERVER_B:$REMOTE_DIR/
```

> **synapse_agent 및 synapse CLI 별도 전송 불필요**: 두 바이너리 모두 `synapse-admin-api:1.0` 이미지에 번들되어 있습니다.  
> - `synapse_agent` 배포: admin-api의 `/api/v1/agents/install` API로 자동화
> - `synapse CLI` 배포: 프론트엔드 `/admin/synapse-cli` UI로 자동화 (섹션 5 참조)

---

## 2. Server B 배포 (Vector DB 서버)

> **배포 순서**: Server B를 먼저 배포해야 Server A의 log-analyzer가 Qdrant에 접근할 수 있습니다.
> **ADR-011/012**: 임베딩 및 LLM 용도의 Ollama는 모두 제거됨 → Server B는 Qdrant 전용.

### 2-1. 디렉터리 구조 생성

```bash
ssh user@SERVER_B
sudo mkdir -p /app/synapse/{images,services/qdrant-storage}
sudo chown -R $USER:$USER /app/synapse
```

### 2-2. Docker 이미지 로드

```bash
cd /app/synapse/images

docker load < qdrant-v1.17.0.tar.gz

# 로드 확인
docker images | grep qdrant
```

### 2-3. 서비스 시작

```bash
cd /app/synapse
docker compose up -d

# 상태 확인
docker compose ps
```

### 2-4. Qdrant 헬스 체크

```bash
curl -s http://localhost:6333/readyz
# 응답: "all shards are ready"
```

### 2-5. Qdrant 컬렉션 초기화

Server A 배포 완료 후 log-analyzer API를 통해 수행됩니다. (섹션 3-3 참조)
임베딩은 log-analyzer 컨테이너 내 FastEmbed ONNX로 이미지에 번들됨 (ADR-011).

---

## 3. Server A 배포 (Main 서버)

### 3-1. 인프라 서비스

#### 디렉터리 구조 생성

```bash
ssh user@SERVER_A
sudo mkdir -p /app/synapse/{images,configs/{prometheus,alertmanager,grafana,postgres,tempo,otel-collector},ssl}
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

#### Alertmanager 설정 확인

`configs/alertmanager/alertmanager.yml`이 SCP로 전송되어 있어야 합니다. 이 파일은 admin-api webhook URL이 Docker 내부 서비스명으로 지정되어 있습니다. 별도 수정 없이 바로 사용 가능합니다.

```bash
# 파일 존재 확인
cat /app/synapse/configs/alertmanager/alertmanager.yml
```

---

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
docker load < tempo-2.9.1.tar
docker load < otel-collector-contrib-0.123.0.tar

# 로드 확인
docker images | grep -E "prometheus|alertmanager|grafana|postgres|n8n|tempo|otel"
```

#### .env 파일 확인

```bash
vi /app/synapse/.env

# 반드시 확인할 항목:
# DB_USER=synapse                            ← synapse 고정 (.env.example 기본값 aoms는 잘못된 값)
# DB_PASSWORD=<비밀번호>
# SECRET_KEY=<랜덤 32자 이상>                ← JWT 서명 키 (미설정 시 로그인 불가)
# CORS_ORIGINS=http://192.168.10.5:3001      ← 프론트엔드 접근 URL
# FRONTEND_EXTERNAL_URL=http://192.168.10.5:3001  ← Teams 카드 버튼 URL
# AGENT_PROMETHEUS_URL=http://192.168.10.5:9090   ← agent live-status용
# MONITORING_SERVER_IP=192.168.10.5          ← Server A 실제 IP (n8n webhook용)
# QDRANT_URL=http://192.168.10.6:6333        ← Server B 실제 IP
# ENCRYPTION_KEY=<fernet_key>                ← 공통 암호화 키
# LLM_TYPE=devx                              ← LLM 프로바이더 (ollama 폐지, ADR-012)
# DEVX_CLIENT_ID=<client_id>
# DEVX_CLIENT_SECRET=<client_secret>
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

# 4. Tempo + OTel Collector 시작 (분산추적 인프라)
docker compose up -d tempo otel-collector
sleep 5

# 5. 상태 확인
docker compose ps | grep -E "prometheus|alertmanager|grafana|postgres|tempo|otel"
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

> `synapse-admin-api:1.0`에는 세 바이너리가 번들됩니다:  
> - `/app/bin/agent-v` — synapse_agent (Rust musl 정적 바이너리)  
> - `/app/bin/synapse` — synapse CLI (Go 정적 바이너리, 멀티스테이지 빌드)

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

#### 초기 admin 계정 생성 (최초 배포 1회만)

```bash
# admin 계정 생성 (이메일·비밀번호는 실제 값으로 변경)
docker exec -it synapse-admin-api \
  sh -c "ADMIN_EMAIL=admin@company.com ADMIN_PASSWORD=changeme python scripts/create_admin.py"

# 생성 확인
docker logs synapse-admin-api 2>&1 | grep -E "admin|user|created" | tail -5
```

#### LLM 에이전트 설정 (최초 배포 1회만)

init.sql에서 기본 LLM 영역 설정이 자동 삽입되지만, **DevX `agent_code` 값은 실제 운영 환경에 맞게 업데이트**해야 합니다.

```bash
# 프론트엔드 LLM 설정 페이지에서 수정
# http://192.168.10.5:3001/admin/llm-config (admin 로그인 필요)
```

| 수정 항목 | 내용 |
|---|---|
| `agent_code` | init.sql 기본값 `custom_8f9ee032e5594452bff5602c03e966eb`를 실제 DevX 에이전트 코드로 교체 |
| `cli_query` 영역 추가 (선택) | synapse CLI `ask` 명령에서 사용할 DevX 에이전트 코드 등록. 등록하지 않으면 `--area` 옵션에 DevX 에이전트 코드를 직접 지정해야 함 |

---

### 3-3. n8n (미사용, 예비 컨테이너)

> **중요**: 모든 워크플로우(WF1~WF12)는 log-analyzer 스케줄러 / admin-api 직접 호출 / frontend 직결로 이관·제거되었습니다 (ADR-006).
> WF4(일일 장애 리포트)·WF5(반복 이상 에스컬레이션)는 보류 상태로 `n8n-workflows/` 디렉터리에 JSON만 보존되어 있으며,
> 추후 log-analyzer로 포팅할 때 참고용입니다.

n8n 컨테이너는 docker-compose에 남아 있지만 워크플로우를 import하지 않아도 됩니다.

#### Qdrant 컬렉션 초기화

log-analyzer가 기동되면 `log_incidents`와 `metric_baselines` 컬렉션은 **자동 생성**됩니다.
`metric_hourly_patterns`와 `aggregation_summaries`는 **수동 1회** 실행이 필요합니다:

```bash
# 집계 컬렉션 초기화 (최초 1회)
curl -s -X POST http://localhost:8000/aggregation/collections/setup \
  -H "Content-Type: application/json" | python3 -m json.tool
```

> **긴급 복구 (전체 재설정)**: 컬렉션 차원 불일치 등으로 전체 재생성이 필요한 경우:
> ```bash
> # Mac에서 실행 (Server B IP를 인자로 전달)
> ./collection_reset.sh http://192.168.10.6:6333
> ```
> 이 스크립트는 4개 컬렉션을 모두 **삭제 후 재생성**합니다. 기존 벡터 데이터가 모두 삭제되므로 주의하세요.

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
    "teams_upn": "gildong@company.com"
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

## 5. Synapse CLI 배포 (운영 담당자 서버)

synapse CLI는 운영 서버 담당자가 **터미널에서 직접 LLM에 질의**하는 Go CLI 도구입니다.  
`synapse-admin-api:1.0` 이미지 내 `/app/bin/synapse`에 번들되어 있으며,  
프론트엔드 UI를 통해 SSH/SCP로 대상 서버에 배포됩니다.

### 5-1. CLI 배포 방식 개요

```
[admin-api 이미지 /app/bin/synapse]
        ↓ SSH/SCP (SSH 세션 등록 후 자동)
[운영 담당자 서버 ~/bin/synapse]
        ↓ synapse login
[config: ~/bin/.synapse_config.json]
```

### 5-2. 프론트엔드 UI로 배포

1. **프론트엔드 접속**: `http://192.168.10.5:3001/admin/synapse-cli` (admin 로그인 필요)

2. **SSH 세션 등록**: 우상단 "SSH 연결" 버튼 → 대상 서버 정보 입력
   - 호스트 IP, 포트(기본: 22), 사용자명, 비밀번호

3. **CLI 서버 등록**: "CLI 서버 추가" → 아래 항목 입력

   | 필드 | 설명 | 예시 |
   |---|---|---|
   | 시스템 | 등록된 시스템 선택 | `customer-experience` |
   | 호스트 | 대상 서버 표시명 | `cx-was01` |
   | 설치 경로 | 바이너리 설치 위치 | `~/bin/synapse` |

4. **설치 실행**: 목록에서 해당 서버의 "배포" 버튼 클릭 → 실시간 로그로 진행 상황 확인

5. **완료 확인**: 설치 완료 후 대상 서버에서:

   ```bash
   ~/bin/synapse --version
   ```

### 5-3. CLI 초기 설정 (담당자 서버에서 1회)

배포 완료 후 운영 담당자가 대상 서버에서 직접 실행합니다.

```bash
# admin-api 서버 주소 및 계정 설정
~/bin/synapse login

# 프롬프트 안내:
# Server URL: http://192.168.10.5:8080
# Email: gildong@company.com
# Password: ****
# Default system: customer-experience
# → config 저장: ~/bin/.synapse_config.json
```

> **config 파일 위치**: 바이너리 옆 `.synapse_config.json` (홈 디렉터리 아님)  
> Docker 컨테이너 내 UID 불일치로 인한 `permission denied` 방지를 위해 바이너리 옆에 저장합니다.

### 5-4. CLI 사용 방법

```bash
# 단방향 질의 — 현재 시스템 알림 컨텍스트 포함
~/bin/synapse ask "현재 CPU 사용률이 왜 높나요?"

# 다른 시스템 컨텍스트로 질의
~/bin/synapse ask --system oms "주문 처리 지연 원인을 분석해줘"

# 로그 파일 첨부 (기본: 마지막 300줄)
~/bin/synapse ask --file /apps/logs/JeusServer.log "에러 패턴을 분석해줘"

# 로그 파일 마지막 N줄 지정
~/bin/synapse ask --file app.log --tail 500 "분석해줘"

# stdin 파이프 지원
tail -200 /apps/logs/app.log | ~/bin/synapse ask "에러 원인을 찾아줘"

# 대화형 모드 (세션 유지)
~/bin/synapse chat

# 새 세션 강제 시작
~/bin/synapse chat --new
```

> **DevX 사용 시 `--area` 옵션**: 기본값은 `cli_query`. admin-api `llm_agent_configs` 테이블에  
> `cli_query` area_code가 등록되어 있지 않으면 `/admin/llm-config`에서 등록하거나,  
> `--area <실제_DevX_agent_code>` 형식으로 직접 지정합니다.
>
> ```bash
> ~/bin/synapse ask --area "custom_8f9ee032e5594452bff5602c03e966eb" "분석해줘"
> ```

### 5-5. CLI 재배포 (업데이트)

admin-api 이미지 재배포 후 CLI 바이너리도 업데이트해야 하면:

1. 프론트엔드 `/admin/synapse-cli` 접속
2. 해당 서버의 "배포" 버튼 재실행 (기존 config 파일은 보존됨)

---

## 6. 배포 후 검증

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
| 1. Docker 컨테이너 상태 | synapse-prometheus, alertmanager, grafana, postgres, admin-api, log-analyzer, frontend, n8n, tempo, otel-collector |
| 2. 포트 응답 확인 | 각 서비스 HTTP 응답 코드 |
| 3. 설정 파일 존재 확인 | .env, prometheus.yml, alertmanager.yml, web.yml, ssl 인증서 등 |
| 4. PostgreSQL 테이블 확인 | public 스키마 테이블 수, n8n 스키마 존재 여부 |
| 5. Prometheus Basic Auth | 인증 활성화 여부 (401 응답 확인) |
| 6. admin-api 기능 확인 | /api/v1/systems, /api/v1/agents 응답 |
| 7. log-analyzer 기능 확인 | /health → ok |
| 8. Prometheus 스크레이프 상태 | 타겟 UP 비율, Remote Write Receiver 활성화 |
| 9. Tempo / OTel Collector 상태 | 내부 health endpoint 확인 |
| 10. n8n 상태 확인 | healthz → ok |
| 11. admin-api 번들 바이너리 확인 | /app/bin/agent-v, /app/bin/synapse 존재 여부 |
| 12. Server B 확인 (선택) | Qdrant 컬렉션 4종 (/collections) — ADR-011/012 이후 Ollama 없음 |

**모든 검증 통과 후 최종 확인:**

```bash
# admin-api Swagger
curl -sf http://localhost:8080/docs > /dev/null && echo "OK"

# log-analyzer 내부 스케줄러 확인 (5분마다 분석, 1시간마다 집계)
docker logs synapse-log-analyzer 2>&1 | grep -E "scheduler|analysis|aggregation" | tail -10

# log-analyzer 기동 시 자동 생성: log_incidents, metric_baselines
# 아래 명령으로 생성 여부 확인 후, 없으면 log-analyzer 로그 재확인
curl -s http://192.168.10.6:6333/collections | python3 -m json.tool

# Qdrant 집계 컬렉션 초기화 (최초 1회 — metric_hourly_patterns, aggregation_summaries 생성)
curl -s -X POST http://localhost:8000/aggregation/collections/setup \
  -H "Content-Type: application/json" | python3 -m json.tool

# synapse CLI 번들 확인 (admin-api 이미지 내)
docker exec synapse-admin-api ls -lh /app/bin/
# → agent-v, synapse 두 파일 모두 있어야 함
```

---

## 7. 롤백 절차

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

## 8. 트러블슈팅 체크리스트

### 서비스 로그 확인

```bash
docker logs synapse-admin-api    --tail 50 -f
docker logs synapse-log-analyzer --tail 50 -f
docker logs synapse-postgres     --tail 50 -f
docker logs synapse-n8n          --tail 50 -f
docker logs synapse-prometheus   --tail 50 -f
docker logs synapse-tempo        --tail 50 -f
docker logs synapse-otel-collector --tail 50 -f

# 전체 로그
cd /app/synapse && docker compose logs --tail 30
```

### 자주 발생하는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| admin-api 기동 실패 | PostgreSQL 미준비 또는 `DB_USER` 오류 | `docker logs synapse-postgres` 확인. `.env`에서 `DB_USER=synapse` 확인 |
| admin-api DB 연결 실패 | `DB_USER` 값이 `synapse`가 아님 (`.env.example` 기본값 `aoms` 그대로 사용) | `.env`에서 `DB_USER=synapse`로 수정 후 `docker compose up -d admin-api` |
| 로그인 불가 (JWT 오류) | `SECRET_KEY` 미설정 또는 기본값 사용 | `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` 로 키 생성 후 `.env` 반영, `docker compose up -d admin-api` |
| Teams 카드 버튼 URL 오류 | `FRONTEND_EXTERNAL_URL` 미설정 | `.env`에서 `FRONTEND_EXTERNAL_URL=http://{server-a-ip}:3001` 확인 |
| Teams 알림 미발송 | `TEAMS_WEBHOOK_URL` 오류 | `.env` 확인 후 `docker compose up -d admin-api` |
| log-analyzer LLM 호출 실패 | `LLM_API_URL` / `DEVX_CLIENT_ID/SECRET` 오류 | `.env` 확인 후 `docker compose up -d log-analyzer` |
| log-analyzer 임베딩 오류 | FastEmbed ONNX 로딩 실패 또는 Qdrant 미기동 | `docker logs synapse-log-analyzer \| grep FastEmbed` 확인, Server B Qdrant `/readyz` 확인 |
| synapse_agent 메트릭 미수신 | Prometheus Remote Write Receiver 비활성화 | `docker-compose.yml`에 `--web.enable-remote-write-receiver` 플래그 확인 |
| synapse_agent 설치 실패 | SSH 키 또는 대상 서버 접근 오류 | `docker logs synapse-admin-api`에서 SFTP 에러 확인 |
| Prometheus Basic Auth 401 | 인증 정보 오류 | `PROM_USER` / `PROM_PASS` 확인, bcrypt 해시 재생성 |
| Grafana HTTPS 접속 불가 | SSL 인증서 경로 오류 | `/app/synapse/ssl/` 경로와 `docker-compose.yml` volume 확인 |
| Alertmanager 기동 실패 | alertmanager.yml 파일 없음 | `/app/synapse/configs/alertmanager/alertmanager.yml` 파일 존재 확인 |
| PostgreSQL 기동 실패 | postgresql.conf 파일 없음 | `/app/synapse/configs/postgres/postgresql.conf` 파일 존재 확인 |
| Qdrant 컬렉션 없음 (`metric_hourly_patterns`, `aggregation_summaries`) | 초기화 미실행 | `curl -X POST http://localhost:8000/aggregation/collections/setup` |
| Qdrant 컬렉션 없음 (`log_incidents`, `metric_baselines`) | log-analyzer 미기동 | log-analyzer 부팅 시 자동 생성됨. `docker logs synapse-log-analyzer` 확인 |
| 암호화 키 오류 (DB 모니터링 / 챗봇 executor) | `ENCRYPTION_KEY` 미설정 | Fernet 키 생성 후 `.env`에 추가, 컨테이너 재시작 |
| Tempo 컨테이너 기동 실패 | tempo.yml 설정 파일 없음 | `/app/synapse/configs/tempo/tempo.yml` 파일 존재 확인 |
| OTel Collector 기동 실패 | otel-collector-config.yml 없음 | `/app/synapse/configs/otel-collector/otel-collector-config.yml` 파일 존재 확인 |
| synapse CLI 배포 실패 (SFTP 오류) | SSH 세션 만료 또는 대상 서버 연결 오류 | `/admin/synapse-cli`에서 SSH 세션 재등록 후 재시도 |
| synapse CLI 배포 실패 (바이너리 없음) | admin-api 이미지 재빌드 필요 | `docker exec synapse-admin-api ls /app/bin/synapse` 확인. 없으면 이미지 재빌드 |
| `synapse ask` 실패 (401) | 토큰 만료 | `synapse login` 재실행 |
| `synapse ask` 실패 (LLM 오류) | `cli_query` area_code 미등록 또는 DevX 에이전트 코드 불일치 | `/admin/llm-config`에서 `cli_query` 영역 등록, 또는 `--area <agent_code>` 직접 지정 |
| `synapse login` 실패 (`permission denied`) | config 파일 쓰기 권한 오류 | `ls -la ~/bin/` 확인. 소유자 불일치 시 `chown $USER ~/bin/.synapse_config.json` |

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
SELECT system_name, instance_role, host, agent_type, status, last_seen FROM agent_instances;

# LLM 에이전트 설정 확인
SELECT area_code, area_name, agent_code FROM llm_agent_configs;
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

*최종 업데이트: 2026-04-25*
