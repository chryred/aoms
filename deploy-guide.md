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
   - [3-4. DB 마이그레이션 (기존 운영 DB)](#3-4-db-마이그레이션-기존-운영-db)
4. [Knowledge RAG 초기화](#4-knowledge-rag-초기화)
5. [OIDC IdP 설정 (타시스템 SSO 연동 시)](#5-oidc-idp-설정-타시스템-sso-연동-시)
6. [모니터링 에이전트 배포 (대상 서버)](#6-모니터링-에이전트-배포-대상-서버)
7. [Synapse CLI 배포 (운영 담당자 서버)](#7-synapse-cli-배포-운영-담당자-서버)
8. [배포 후 검증](#8-배포-후-검증)
9. [롤백 절차](#9-롤백-절차)
10. [트러블슈팅 체크리스트](#10-트러블슈팅-체크리스트)

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
| `OAUTH_PRIVATE_KEY_PATH` | OIDC RSA 개인키 컨테이너 경로 | `/app/secrets/oauth_private.pem` |
| `OAUTH_PUBLIC_KEY_PATH` | OIDC RSA 공개키 컨테이너 경로 | `/app/secrets/oauth_public.pem` |
| `OAUTH_ISSUER` | OIDC issuer URL (브라우저 접근 가능 주소) | `http://192.168.10.5:8080` |
| `JIRA_URL` | Jira REST API 기본 URL (선택) | `https://jira.company.com` |
| `JIRA_TOKEN` | Jira Personal Access Token (선택) | `your_jira_pat` |
| `JIRA_PROJECTS` | 동기화 프로젝트 키 목록 — 콤마 구분 (선택) | `INFRA,PAYMENT,OPS` |
| `CONFLUENCE_URL` | Confluence REST API 기본 URL (선택) | `https://confluence.company.com` |
| `CONFLUENCE_TOKEN` | Confluence Personal Access Token (선택) | `your_confluence_pat` |
| `CONFLUENCE_SPACES` | 동기화 Space 키 목록 — 콤마 구분 (선택) | `OPS,POLICY` |
| `KNOWLEDGE_SYNC_RATE_LIMIT` | Knowledge 동기화 초당 API 호출 수 상한 (기본 5) | `5` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT Access Token 유효 시간(분) (기본 15) | `15` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Refresh Token 유효 기간(일) (기본 7) | `7` |
| `COOKIE_SECURE` | Refresh Token 쿠키 Secure 플래그 (기본 true) | `true` |

> **주의**: `DB_USER`는 반드시 `synapse`이어야 합니다. `.env.example`의 기본값이 `aoms`로 되어 있으나 이는 잘못된 기본값입니다. `docker-compose.yml`의 `DATABASE_URL`이 `postgresql+asyncpg://synapse:...`로 **하드코딩**되어 있어 `DB_USER=aoms`로 배포하면 Postgres 사용자는 `aoms`로 생성되지만 admin-api는 `synapse`로 접속 시도하여 DB 연결에 실패합니다.

> **`ENCRYPTION_KEY` 생성 방법:**
> ```bash
> python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
> ```

> **`SECRET_KEY` 생성 방법:**
> ```bash
> python3 -c "import secrets; print(secrets.token_urlsafe(32))"
> ```

> **Jira/Confluence 미사용 시**: `JIRA_URL`, `JIRA_TOKEN`, `JIRA_PROJECTS` / `CONFLUENCE_*` 를 빈 값으로 두면 동기화 스케줄러가 자동 비활성화됩니다.

---

### 1-2. OIDC RSA 키 생성 (최초 1회)

Synapse-V가 타시스템의 SSO Identity Provider 역할을 하기 위한 RSA 키 쌍.  
**빌드 전 반드시 생성해야 합니다** — 키 없이 빌드하면 admin-api 기동 시 `FileNotFoundError` 발생.

```bash
cd /path/to/aoms/main-server/services/admin-api/secrets

# RSA 키 쌍 생성 (2048bit)
openssl genrsa -out oauth_private.pem 2048
openssl rsa -in oauth_private.pem -pubout -out oauth_public.pem

# 생성 확인
ls -lh *.pem
```

> **주의**: `secrets/*.pem`은 `.gitignore` 처리됨 — 절대 커밋 금지.  
> 키는 admin-api Dockerfile에서 `secrets/` 디렉터리 전체를 이미지에 복사합니다.

---

### 1-3. synapse_agent 바이너리 빌드

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

---

### 1-4. Docker 이미지 빌드

admin-api Dockerfile은 **멀티스테이지 빌드**입니다.
- Stage 1: Go로 synapse CLI 바이너리를 빌드 (`synapse-cli/` 디렉터리)
- Stage 2: Python admin-api 이미지에 agent-v + synapse CLI + OIDC RSA 키 번들

**별도 CLI 빌드 없이** `build-images.sh` 한 번으로 모두 처리됩니다.

```bash
cd /path/to/aoms

# 전체 빌드 (admin-api, log-analyzer, frontend)
./build-images.sh

# 결과물 확인
ls -lh main-server/*.tar.gz
# main-server/synapse-admin-api-1.0.tar.gz   (agent-v + synapse CLI + OIDC 키 포함)
# main-server/synapse-log-analyzer-1.0.tar.gz  (~500MB — 모델 미포함)
# main-server/synapse-frontend-1.0.tar.gz
```

> **모델 분리 배포 구조**: log-analyzer 이미지는 더 이상 ONNX 모델을 번들하지 않습니다 (~500MB).  
> 모델은 서버 볼륨(`/app/synapse/models/`)에 별도 배포합니다. **최초 배포 시 1-5절의 모델 추출을 반드시 실행하세요.**

#### 모델 추출 (최초 1회)

```bash
cd /path/to/aoms

# 모델 전용 tar.gz 추출 (pigz 필요, 없으면 gzip으로 자동 대체)
./build-images.sh export-models
# → main-server/synapse-models.tar.gz 생성 (~1.5GB compressed)
```

| 경로 (압축 해제 후) | 내용 |
|---|---|
| `/app/synapse/models/dense-models/` | BAAI/bge-m3 ONNX (~1.1GB) |
| `/app/synapse/models/fastembed-models/` | Qdrant/bm25 BM25 (~50MB) |
| `/app/synapse/models/reranker-models/` | bge-reranker-v2-m3-ONNX (~2.3GB) |

---

### 1-5. 파일 전송

```bash
SERVER_A="user@192.168.10.5"
SERVER_B="user@192.168.10.6"
REMOTE_DIR="/app/synapse"

# ── Server A — 애플리케이션 이미지 ──────────────────────────
scp main-server/synapse-admin-api-1.0.tar.gz     $SERVER_A:$REMOTE_DIR/images/
scp main-server/synapse-log-analyzer-1.0.tar.gz  $SERVER_A:$REMOTE_DIR/images/
scp main-server/synapse-frontend-1.0.tar.gz      $SERVER_A:$REMOTE_DIR/images/

# ── Server A — 인프라 이미지 (offline 패키지) ───────────────
scp aoms-offline/docker-images/prometheus-v3.10.0.tar              $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/alertmanager-main.tar               $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/grafana-12.4.0.tar                  $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/postgres-16-alpine.tar              $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/n8n-1.44.0.tar                      $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/tempo-2.9.1.tar                     $SERVER_A:$REMOTE_DIR/images/
scp aoms-offline/docker-images/otel-collector-contrib-0.123.0.tar  $SERVER_A:$REMOTE_DIR/images/

# ── Server A — 설정 파일 및 docker-compose ──────────────────
scp main-server/docker-compose.yml  $SERVER_A:$REMOTE_DIR/
scp main-server/.env                $SERVER_A:$REMOTE_DIR/
scp -r main-server/configs/         $SERVER_A:$REMOTE_DIR/configs/
scp -r main-server/n8n-workflows/   $SERVER_A:$REMOTE_DIR/n8n-workflows/

# ── Server A — alertmanager 디렉터리 생성 확인 (configs/ scp 후) ─
ssh $SERVER_A "mkdir -p $REMOTE_DIR/configs/alertmanager"

# ── Server A — 모델 (최초 1회) ──────────────────────────────
scp main-server/synapse-models.tar.gz $SERVER_A:/tmp/

# ── Server B — 이미지 (ADR-011/012: Qdrant만) ─────────────────
scp aoms-offline/docker-images/qdrant-v1.17.0.tar.gz   $SERVER_B:$REMOTE_DIR/images/

# ── Server B — docker-compose ───────────────────────────────
scp sub-server/docker-compose.yml   $SERVER_B:$REMOTE_DIR/
```

> **synapse_agent 및 synapse CLI 별도 전송 불필요**: 두 바이너리 모두 `synapse-admin-api:1.0` 이미지에 번들되어 있습니다.  
> - `synapse_agent` 배포: admin-api의 `/api/v1/agents/install` API로 자동화
> - `synapse CLI` 배포: 프론트엔드 `/admin/synapse-cli` UI로 자동화 (섹션 7 참조)

---

## 2. Server B 배포 (Vector DB 서버)

> **배포 순서**: Server B를 먼저 배포해야 Server A의 log-analyzer가 Qdrant에 접근할 수 있습니다.  
> **ADR-011/012**: Ollama는 모두 제거됨 → Server B는 Qdrant 전용.

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
임베딩은 log-analyzer 컨테이너 내 FastEmbed ONNX로 볼륨 마운트됨 (ADR-011).

---

## 3. Server A 배포 (Main 서버)

### 3-1. 인프라 서비스

#### 디렉터리 구조 생성

```bash
ssh user@SERVER_A
sudo mkdir -p /app/synapse/{images,configs/{prometheus,alertmanager,grafana,postgres,tempo,otel-collector},ssl}
sudo chown -R $USER:$USER /app/synapse
```

#### 바인드 마운트 디렉터리 생성

named volume이 바인드 마운트로 전환되어 있습니다. 컨테이너 기동 전 디렉터리를 생성하고 소유권을 설정해야 합니다.

```bash
# 인프라 데이터 디렉터리
sudo mkdir -p /app/synapse/services/prometheus
sudo mkdir -p /app/synapse/services/postgres/data
sudo mkdir -p /app/synapse/services/tempo

# uid 1036, gid 510 소유권 설정 (docker-compose user 설정과 일치)
sudo chown -R 1036:510 /app/synapse/services/prometheus
sudo chown -R 1036:510 /app/synapse/services/postgres
sudo chown -R 1036:510 /app/synapse/services/tempo
```

> **기존 데이터 마이그레이션** (named volume에서 전환 시):
> ```bash
> # Prometheus 데이터 이전
> docker run --rm \
>   -v synapse_prometheus_data:/src:ro \
>   -v /app/synapse/services/prometheus:/dst \
>   alpine sh -c "cp -av /src/. /dst/"
>
> # PostgreSQL은 pg_dump/restore 권장
> docker exec synapse-postgres pg_dump -U synapse synapse > /tmp/synapse_backup.sql
> # (바인드 마운트 전환 후)
> docker exec -i synapse-postgres psql -U synapse synapse < /tmp/synapse_backup.sql
> ```

#### 모델 압축 해제 (최초 1회)

```bash
sudo mkdir -p /app/synapse/models
sudo chown -R 1036:510 /app/synapse/models

# 압축 해제 (pigz 사용 권장, 없으면 gzip)
pigz -d -c /tmp/synapse-models.tar.gz | tar -xf - -C /app/synapse/models
# pigz 없을 때: tar -xzf /tmp/synapse-models.tar.gz -C /app/synapse/models

# 확인
ls -lh /app/synapse/models/
# dense-models/  fastembed-models/  reranker-models/
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

`configs/alertmanager/alertmanager.yml`이 SCP로 전송되어 있어야 합니다. admin-api webhook URL이 Docker 내부 서비스명으로 지정되어 있어 별도 수정 없이 바로 사용 가능합니다.

```bash
cat /app/synapse/configs/alertmanager/alertmanager.yml
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
docker load < tempo-2.9.1.tar
docker load < otel-collector-contrib-0.123.0.tar

# 로드 확인
docker images | grep -E "prometheus|alertmanager|grafana|postgres|n8n|tempo|otel"
```

#### .env 파일 확인

```bash
vi /app/synapse/.env

# 반드시 확인할 항목:
# DB_USER=synapse                                    ← synapse 고정
# DB_PASSWORD=<비밀번호>
# SECRET_KEY=<랜덤 32자 이상>                        ← JWT 서명 키
# CORS_ORIGINS=http://192.168.10.5:3001
# FRONTEND_EXTERNAL_URL=http://192.168.10.5:3001     ← Teams 카드 버튼 URL
# AGENT_PROMETHEUS_URL=http://192.168.10.5:9090
# MONITORING_SERVER_IP=192.168.10.5
# QDRANT_URL=http://192.168.10.6:6333
# ENCRYPTION_KEY=<fernet_key>
# LLM_TYPE=devx                                      ← ollama 폐지 (ADR-012)
# DEVX_CLIENT_ID=<client_id>
# DEVX_CLIENT_SECRET=<client_secret>
# OAUTH_PRIVATE_KEY_PATH=/app/secrets/oauth_private.pem
# OAUTH_PUBLIC_KEY_PATH=/app/secrets/oauth_public.pem
# OAUTH_ISSUER=http://192.168.10.5:8080
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

# 4. Tempo + OTel Collector 시작
docker compose up -d tempo otel-collector
sleep 5

# 5. 상태 확인
docker compose ps | grep -E "prometheus|alertmanager|grafana|postgres|tempo|otel"
```

---

### 3-2. 애플리케이션 서비스

#### 공유 파일 저장 디렉터리 생성

admin-api(문서 업로드·첨부파일)와 log-analyzer(문서 임베딩)가 공유하는 경로입니다.  
두 컨테이너가 동일 호스트 경로를 마운트하므로 admin-api가 저장한 파일을 log-analyzer가 직접 읽습니다.

```bash
cd /app/synapse

sudo mkdir -p services/attaches/{knowledge-docs,chat-attachments}
sudo chown -R 1036:510 services/attaches/
```

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
> - `/app/secrets/oauth_private.pem`, `/app/secrets/oauth_public.pem` — OIDC RSA 키

#### 서비스 시작 순서

```bash
cd /app/synapse

# 1. log-analyzer 먼저 시작
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
curl -sf http://localhost:8080/.well-known/openid-configuration > /dev/null && echo "OIDC OK"
```

#### 초기 admin 계정 생성 (최초 배포 1회만)

```bash
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
| `cli_query` 영역 추가 (선택) | synapse CLI `ask` 명령에서 사용할 DevX 에이전트 코드 등록 |

---

### 3-3. n8n (미사용, 예비 컨테이너)

> **중요**: 모든 워크플로우(WF1~WF12)는 log-analyzer 스케줄러 / admin-api 직접 호출 / frontend 직결로 이관·제거되었습니다 (ADR-006).  
> WF4(일일 장애 리포트)·WF5(반복 이상 에스컬레이션)는 보류 상태로 `n8n-workflows/` 디렉터리에 JSON만 보존.

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

---

### 3-4. DB 마이그레이션 (기존 운영 DB)

**신규 설치라면 이 절을 건너뜁니다** — `configs/postgres/init.sql`에 모두 반영되어 있습니다.  
**기존 운영 DB**는 아래 순서로 SQL을 적용하세요. `configs/postgres/migrations/`에 파일이 있습니다.

```bash
ssh user@SERVER_A
cd /app/synapse
```

#### 게스트 채팅 마이그레이션

```bash
docker exec -i synapse-postgres psql -U synapse -d synapse << 'EOF'
-- chat_sessions.user_id nullable (게스트 세션)
ALTER TABLE chat_sessions ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE chat_sessions
    ADD COLUMN IF NOT EXISTS visitor_employee_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS visitor_email       VARCHAR(200),
    ADD COLUMN IF NOT EXISTS visitor_system_id   INTEGER REFERENCES systems(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_visitor
    ON chat_sessions(visitor_employee_id)
    WHERE visitor_employee_id IS NOT NULL;

ALTER TABLE incidents ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT NULL;
EOF
```

#### 챗봇 다중 시스템 스코프 마이그레이션

```bash
docker exec -i synapse-postgres psql -U synapse -d synapse << 'EOF'
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS system_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_system_ids
    ON chat_sessions USING GIN (system_ids);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_active
    ON chat_sessions(user_id, updated_at DESC)
    WHERE deleted_at IS NULL;

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS system_id INTEGER
    REFERENCES systems(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_system
    ON chat_messages(system_id, created_at)
    WHERE system_id IS NOT NULL;
EOF
```

#### OIDC 테이블 마이그레이션

```bash
docker exec -i synapse-postgres psql -U synapse -d synapse << 'EOF'
CREATE TABLE IF NOT EXISTS oauth_clients (
    id            SERIAL       PRIMARY KEY,
    client_id     VARCHAR(100) UNIQUE NOT NULL,
    client_secret VARCHAR(255) NOT NULL,
    name          VARCHAR(200) NOT NULL,
    redirect_uris JSONB        NOT NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code         VARCHAR(100) PRIMARY KEY,
    client_id    VARCHAR(100) NOT NULL,
    user_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri TEXT         NOT NULL,
    scope        TEXT         NOT NULL DEFAULT 'openid profile email',
    nonce        VARCHAR(200),
    expires_at   TIMESTAMP    NOT NULL,
    used         BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_authorization_codes(expires_at);

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    token        VARCHAR(200) PRIMARY KEY,
    client_id    VARCHAR(100) NOT NULL,
    user_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope        TEXT         NOT NULL DEFAULT 'openid profile email',
    expires_at   TIMESTAMP    NOT NULL,
    revoked      BOOLEAN      NOT NULL DEFAULT FALSE,
    replaced_by  VARCHAR(200),
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_rt_user_client ON oauth_refresh_tokens(user_id, client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_rt_expires ON oauth_refresh_tokens(expires_at);
EOF
```

#### 마이그레이션 적용 확인

```bash
docker exec -it synapse-postgres psql -U synapse -d synapse -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;"
```

아래 테이블이 존재해야 합니다:
- `oauth_clients`, `oauth_authorization_codes`, `oauth_refresh_tokens`

`chat_sessions`에 `visitor_employee_id`, `system_ids`, `deleted_at` 컬럼 추가 확인:

```bash
docker exec -it synapse-postgres psql -U synapse -d synapse -c "\d chat_sessions"
```

---

## 4. Knowledge RAG 초기화

### 4-1. Qdrant Knowledge 컬렉션 확인

log-analyzer 기동 시 Knowledge 컬렉션 3종이 자동 생성됩니다:

```bash
# Server B에서 확인
curl -s http://192.168.10.6:6333/collections | python3 -m json.tool | grep '"name"'
```

예상 컬렉션 목록:

| 컬렉션 | 생성 방식 |
|---|---|
| `log_incidents` | log-analyzer 기동 시 자동 생성 |
| `metric_baselines` | log-analyzer 기동 시 자동 생성 |
| `metric_hourly_patterns` | 수동 초기화 필요 (3-3절) |
| `aggregation_summaries` | 수동 초기화 필요 (3-3절) |
| `knowledge_jira_issues` | log-analyzer 기동 시 자동 생성 |
| `knowledge_confluence_pages` | log-analyzer 기동 시 자동 생성 |
| `knowledge_documents` | log-analyzer 기동 시 자동 생성 |

### 4-2. Jira / Confluence 수동 동기화 트리거 (선택)

자동 스케줄(매일 04:00/04:30 KST) 이전에 즉시 동기화가 필요하면:

```bash
# Jira 즉시 동기화 (백그라운드 실행)
curl -s -X POST http://localhost:8000/knowledge/sync/jira/trigger | python3 -m json.tool

# Confluence 즉시 동기화 (백그라운드 실행)
curl -s -X POST http://localhost:8000/knowledge/sync/confluence/trigger | python3 -m json.tool

# 동기화 상태 확인 (admin-api에서)
curl -s http://localhost:8080/api/v1/knowledge/sync-status | python3 -m json.tool
```

> Jira Bearer Token 발급: Jira 계정 → Profile → Personal Access Tokens → Create

### 4-3. 프론트엔드 Knowledge 페이지

`http://192.168.10.5:3001/knowledge` (admin/operator 로그인 필요)

| 탭 | 기능 |
|---|---|
| 문서 | DOCX/PDF/XLSX/PPTX 업로드 → 자동 청킹 → Qdrant 적재 |
| 동기화 | Jira/Confluence 동기화 현황, 단건 강제 재동기화 |
| 질문 분석 | 수집된 질문 클러스터링 분석 |
| 운영자 노트 | Q&A 형식 수동 지식 등록 |
| 검색 검증 | 검색 품질 테스트 (질의 → Qdrant 점수 확인) |

---

## 5. OIDC IdP 설정 (타시스템 SSO 연동 시)

Synapse-V가 OIDC Identity Provider 역할을 합니다 (ADR-014). 타시스템 연동 시 OAuth 클라이언트를 등록합니다.

### 5-1. OAuth 클라이언트 등록

```bash
curl -s -X POST http://localhost:8080/api/v1/oauth/clients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin_access_token>" \
  -d '{
    "client_id": "target-system-app",
    "client_secret": "your_secret_here",
    "name": "타겟 시스템명",
    "redirect_uris": ["https://target-system.company.com/callback"]
  }' | python3 -m json.tool
```

### 5-2. OIDC 디스커버리 엔드포인트

타시스템 설정 시 참고:

```bash
# OpenID Configuration (메타데이터)
curl -s http://192.168.10.5:8080/.well-known/openid-configuration | python3 -m json.tool

# JWKs (공개키)
curl -s http://192.168.10.5:8080/oauth/jwks | python3 -m json.tool
```

---

## 6. 모니터링 에이전트 배포 (대상 서버)

synapse_agent는 Rust로 작성된 단일 정적 바이너리입니다. `synapse-admin-api` 이미지에 번들되어 있으며,  
admin-api의 `/api/v1/agents/install` API를 통해 대상 서버에 자동 배포됩니다.

### 6-1. 모니터링 대상 시스템 등록 (admin-api)

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

### 6-2. 에이전트 설치 (API 호출)

```bash
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

### 6-3. config.toml 구조 (참고)

```toml
[agent]
system_name = "customer-experience"   # DB systems.system_name과 반드시 일치
instance_role = "was1"                # HA 이중화 구분 (was1/was2, db-primary/db-standby)
host = "cx-was01"
collect_interval_secs = 15

[remote_write]
endpoint = "http://192.168.10.5:9090/api/v1/write"
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
> - synapse_agent는 Prometheus Remote Write로 메트릭을 전송합니다 (Loki 미사용).

### 6-4. 에이전트 상태 확인

```bash
# 에이전트 등록 목록 조회
curl -s http://localhost:8080/api/v1/agents | python3 -m json.tool

# 특정 에이전트 live-status
curl -s "http://localhost:8080/api/v1/agents/{agent_id}/live-status" | python3 -m json.tool

# Prometheus에서 에이전트 heartbeat 확인
PROM_USER=$(grep PROM_USER /app/synapse/.env | cut -d= -f2)
PROM_PASS=$(grep PROM_PASS /app/synapse/.env | cut -d= -f2)
curl -su "${PROM_USER}:${PROM_PASS}" \
  "http://localhost:9090/api/v1/query?query=agent_up" | python3 -m json.tool
```

---

## 7. Synapse CLI 배포 (운영 담당자 서버)

synapse CLI는 운영 서버 담당자가 **터미널에서 직접 LLM에 질의**하는 Go CLI 도구입니다.  
`synapse-admin-api:1.0` 이미지 내 `/app/bin/synapse`에 번들되어 있으며,  
프론트엔드 UI를 통해 SSH/SCP로 대상 서버에 배포됩니다.

### 7-1. CLI 배포 방식 개요

```
[admin-api 이미지 /app/bin/synapse]
        ↓ SSH/SCP (SSH 세션 등록 후 자동)
[운영 담당자 서버 ~/bin/synapse]
        ↓ synapse login
[config: ~/bin/.synapse_config.json]
```

### 7-2. 프론트엔드 UI로 배포

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

### 7-3. CLI 초기 설정 (담당자 서버에서 1회)

```bash
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

### 7-4. CLI 사용 방법

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

### 7-5. CLI 재배포 (업데이트)

admin-api 이미지 재배포 후 CLI 바이너리도 업데이트가 필요하면:

1. 프론트엔드 `/admin/synapse-cli` 접속
2. 해당 서버의 "배포" 버튼 재실행 (기존 config 파일은 보존됨)

---

## 8. 배포 후 검증

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
| 4. PostgreSQL 테이블 확인 | public 스키마 테이블 수 (oauth_clients 등 신규 테이블 포함) |
| 5. Prometheus Basic Auth | 인증 활성화 여부 (401 응답 확인) |
| 6. admin-api 기능 확인 | /api/v1/systems, /api/v1/agents 응답 |
| 7. log-analyzer 기능 확인 | /health → ok |
| 8. Prometheus 스크레이프 상태 | 타겟 UP 비율, Remote Write Receiver 활성화 |
| 9. Tempo / OTel Collector 상태 | 내부 health endpoint 확인 |
| 10. n8n 상태 확인 | healthz → ok |
| 11. admin-api 번들 바이너리 확인 | /app/bin/agent-v, /app/bin/synapse 존재 여부 |
| 12. Server B 확인 (선택) | Qdrant 컬렉션 7종 (/collections) — Knowledge 컬렉션 3종 포함 |

**모든 검증 통과 후 최종 확인:**

```bash
# admin-api Swagger
curl -sf http://localhost:8080/docs > /dev/null && echo "OK"

# OIDC 디스커버리 확인
curl -sf http://localhost:8080/.well-known/openid-configuration > /dev/null && echo "OIDC OK"

# log-analyzer 내부 스케줄러 확인 (5분마다 분석, 1시간마다 집계)
docker logs synapse-log-analyzer 2>&1 | grep -E "scheduler|analysis|aggregation" | tail -10

# Qdrant 컬렉션 확인 (log_incidents, metric_baselines는 log-analyzer 기동 시 자동 생성)
curl -s http://192.168.10.6:6333/collections | python3 -m json.tool

# Qdrant 집계 컬렉션 초기화 (최초 1회 — metric_hourly_patterns, aggregation_summaries 생성)
curl -s -X POST http://localhost:8000/aggregation/collections/setup \
  -H "Content-Type: application/json" | python3 -m json.tool

# synapse CLI 번들 확인 (admin-api 이미지 내)
docker exec synapse-admin-api ls -lh /app/bin/
# → agent-v, synapse 두 파일 모두 있어야 함

# OIDC RSA 키 번들 확인
docker exec synapse-admin-api ls /app/secrets/
# → oauth_private.pem, oauth_public.pem 있어야 함
```

---

## 9. 롤백 절차

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

## 10. 트러블슈팅 체크리스트

### 서비스 로그 확인

```bash
docker logs synapse-admin-api      --tail 50 -f
docker logs synapse-log-analyzer   --tail 50 -f
docker logs synapse-postgres       --tail 50 -f
docker logs synapse-n8n            --tail 50 -f
docker logs synapse-prometheus     --tail 50 -f
docker logs synapse-tempo          --tail 50 -f
docker logs synapse-otel-collector --tail 50 -f

# 전체 로그
cd /app/synapse && docker compose logs --tail 30
```

### 자주 발생하는 문제

| 증상 | 원인 | 해결 |
|---|---|---|
| admin-api 기동 실패 | PostgreSQL 미준비 또는 `DB_USER` 오류 | `docker logs synapse-postgres` 확인. `.env`에서 `DB_USER=synapse` 확인 |
| admin-api DB 연결 실패 | `DB_USER` 값이 `synapse`가 아님 | `.env`에서 `DB_USER=synapse`로 수정 후 `docker compose up -d admin-api` |
| admin-api 기동 실패 (`FileNotFoundError: oauth_private.pem`) | OIDC RSA 키 미생성 | `main-server/services/admin-api/secrets/`에서 openssl 키 생성 후 이미지 재빌드 |
| 로그인 불가 (JWT 오류) | `SECRET_KEY` 미설정 또는 기본값 사용 | `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` 로 키 생성 후 `.env` 반영 |
| Teams 카드 버튼 URL 오류 | `FRONTEND_EXTERNAL_URL` 미설정 | `.env`에서 `FRONTEND_EXTERNAL_URL=http://{server-a-ip}:3001` 확인 |
| Teams 알림 미발송 | `TEAMS_WEBHOOK_URL` 오류 | `.env` 확인 후 `docker compose up -d admin-api` |
| Teams webhook 연결 실패 (`SSL CERTIFICATE_VERIFY_FAILED`) | RHEL CA bundle 경로 문제 | admin-api 이미지 재빌드 (RHEL CA bundle 수정 포함됨) |
| log-analyzer LLM 호출 실패 | `LLM_API_URL` / `DEVX_CLIENT_ID/SECRET` 오류 | `.env` 확인 후 `docker compose up -d log-analyzer` |
| log-analyzer 기동 실패 (`dense-models 없음`) | 모델 볼륨 미배포 | `./build-images.sh export-models` 실행 후 `/app/synapse/models/` 압축 해제 |
| log-analyzer 임베딩 오류 | FastEmbed ONNX 로딩 실패 또는 Qdrant 미기동 | `docker logs synapse-log-analyzer \| grep FastEmbed` 확인, Server B Qdrant `/readyz` 확인 |
| synapse_agent 메트릭 미수신 | Prometheus Remote Write Receiver 비활성화 | `docker-compose.yml`에 `--web.enable-remote-write-receiver` 플래그 확인 |
| synapse_agent 설치 실패 | SSH 키 또는 대상 서버 접근 오류 | `docker logs synapse-admin-api`에서 SFTP 에러 확인 |
| Prometheus Basic Auth 401 | 인증 정보 오류 | `PROM_USER` / `PROM_PASS` 확인, bcrypt 해시 재생성 |
| Grafana HTTPS 접속 불가 | SSL 인증서 경로 오류 | `/app/synapse/ssl/` 경로와 `docker-compose.yml` volume 확인 |
| Alertmanager 기동 실패 | alertmanager.yml 파일 없음 | `/app/synapse/configs/alertmanager/alertmanager.yml` 파일 존재 확인 |
| PostgreSQL 기동 실패 | postgresql.conf 파일 없음 | `/app/synapse/configs/postgres/postgresql.conf` 파일 존재 확인 |
| prometheus/postgres/tempo 볼륨 마운트 오류 (`permission denied`) | 바인드 마운트 디렉터리 소유자 불일치 | `chown -R 1036:510 /app/synapse/services/` |
| 문서 업로드·임베딩 실패 (`Permission denied`) | services/attaches/ 소유권 불일치 또는 미생성 | `chown -R 1036:510 /app/synapse/services/attaches/` (섹션 3-2 참조) |
| Qdrant 컬렉션 없음 (`metric_hourly_patterns`, `aggregation_summaries`) | 초기화 미실행 | `curl -X POST http://localhost:8000/aggregation/collections/setup` |
| Qdrant 컬렉션 없음 (`log_incidents`, `metric_baselines`) | log-analyzer 미기동 | log-analyzer 부팅 시 자동 생성. `docker logs synapse-log-analyzer` 확인 |
| Knowledge 컬렉션 미생성 | log-analyzer 미기동 또는 Qdrant 연결 실패 | `docker logs synapse-log-analyzer \| grep knowledge` 확인, Server B Qdrant `/readyz` 확인 |
| Jira/Confluence 동기화 미실행 | 환경변수 미설정 | `.env`에 `JIRA_URL`, `JIRA_TOKEN`, `JIRA_PROJECTS` 설정 후 재시작 |
| OIDC `/oauth/authorize` 404 | admin-api 이미지가 갱신 전 버전 | `docker images \| grep admin-api` 버전 확인 후 최신 이미지 로드 |
| 챗봇 세션 조회 오류 (`column system_ids does not exist`) | DB 마이그레이션 미적용 | 섹션 3-4의 다중 시스템 스코프 마이그레이션 적용 |
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

# OAuth 클라이언트 확인
SELECT client_id, name, is_active FROM oauth_clients;
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

# Prometheus 설정 리로드
curl -su "${PROM_USER}:${PROM_PASS}" -X POST http://localhost:9090/-/reload
```

---

*최종 업데이트: 2026-05-04*
