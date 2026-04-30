# Synapse-V 추가 배포 가이드 (2026-04-30)

> **기준**: `deploy-guide.md` (2026-04-25) 이후 변경분만 기술  
> **적용 대상**: 기존 배포 완료 서버 A / Server B 업데이트 시 참고

---

## 변경 요약

| 구분 | 내용 |
|---|---|
| **인프라** | docker-compose `user: "1036:510"` 전체 적용 + named volume → 바인드 마운트 교체 |
| **신규 환경변수** | OIDC RSA 키 경로 3종 + Knowledge 연동 6종 |
| **신규 기능** | V1 Knowledge RAG (Jira/Confluence/문서), 게스트 채팅, OIDC IdP (ADR-014) |
| **빌드 변경** | 모델 분리 배포 — log-analyzer 이미지에서 모델 제거 → 볼륨 마운트 방식 |
| **DB 마이그레이션** | 4개 SQL 신규 (OIDC 테이블, 채팅 다중시스템, 게스트 채팅) |
| **버그픽스** | RHEL 8.9 Teams webhook SSL CA bundle 순서 수정 |
| **파일 저장 경로** | `services/attaches/` 통합 — admin-api(업로드·첨부) + log-analyzer(임베딩) 공유 볼륨 |
| **환경변수 정리** | `.env.example` 서비스별 재정리, 실제 운영값 → 플레이스홀더 교체 |

---

## 1. 신규 환경변수 (`.env` 추가 필수)

### 1-1. OIDC IdP RSA 키 (ADR-014) — **필수**

Synapse-V가 타시스템의 SSO Identity Provider 역할을 하기 위한 RSA 키 쌍.  
**최초 1회 생성 후 admin-api 이미지에 번들되어 배포됨.**

```bash
# Mac(빌드 머신)에서 실행
cd main-server/services/admin-api/secrets

# RSA 키 쌍 생성 (2048bit)
openssl genrsa -out oauth_private.pem 2048
openssl rsa -in oauth_private.pem -pubout -out oauth_public.pem

# 생성 확인
ls -lh *.pem
# ※ secrets/*.pem 은 .gitignore 처리됨 — 절대 커밋 금지
```

`.env`에 아래 항목 추가:

```bash
# OIDC IdP RSA 키 경로 (컨테이너 내부 고정 경로)
OAUTH_PRIVATE_KEY_PATH=/app/secrets/oauth_private.pem
OAUTH_PUBLIC_KEY_PATH=/app/secrets/oauth_public.pem

# OIDC issuer URL (브라우저 접근 가능 주소로 설정)
OAUTH_ISSUER=http://192.168.10.5:8080
```

> **주의**: RSA 키는 admin-api Dockerfile에서 `secrets/` 디렉터리 전체를 이미지에 복사합니다.  
> 키 생성 없이 빌드하면 `FileNotFoundError`로 admin-api 기동 실패.

---

### 1-2. V1 Knowledge RAG — Jira / Confluence 연동 (선택)

Jira/Confluence 미사용 시 빈 값으로 두면 동기화 스케줄러가 자동 비활성화됩니다.

```bash
# Jira 연동
JIRA_URL=https://jira.company.com
JIRA_TOKEN=your_jira_personal_access_token
JIRA_PROJECTS=INFRA,PAYMENT,OPS   # 동기화 대상 프로젝트 키 (콤마 구분)

# Confluence 연동
CONFLUENCE_URL=https://confluence.company.com
CONFLUENCE_TOKEN=your_confluence_personal_access_token
CONFLUENCE_SPACES=OPS,POLICY   # 동기화 대상 Space 키 (콤마 구분)

# 동기화 API 호출 속도 제한 (초당 최대 요청 수, 기본 5)
KNOWLEDGE_SYNC_RATE_LIMIT=5
```

> Jira Bearer Token 발급: Jira 계정 → Profile → Personal Access Tokens → Create  
> 동기화 스케줄: 매일 04:00 KST (Jira) / 04:30 KST (Confluence) 자동 실행

---

### 1-3. 전체 신규 환경변수 요약

| 변수 | 필수/옵션 | 기본값 | 설명 |
|---|---|---|---|
| `OAUTH_PRIVATE_KEY_PATH` | 필수 | `/app/secrets/oauth_private.pem` | OIDC RSA 개인키 컨테이너 경로 |
| `OAUTH_PUBLIC_KEY_PATH` | 필수 | `/app/secrets/oauth_public.pem` | OIDC RSA 공개키 컨테이너 경로 |
| `OAUTH_ISSUER` | 필수 | `http://localhost:8080` | OIDC issuer URL (브라우저 접근 가능 주소) |
| `JIRA_URL` | 옵션 | — | Jira REST API 기본 URL |
| `JIRA_TOKEN` | 옵션 | — | Jira Personal Access Token |
| `JIRA_PROJECTS` | 옵션 | — | 동기화 프로젝트 키 목록 (콤마 구분) |
| `CONFLUENCE_URL` | 옵션 | — | Confluence REST API 기본 URL |
| `CONFLUENCE_TOKEN` | 옵션 | — | Confluence Personal Access Token |
| `CONFLUENCE_SPACES` | 옵션 | — | 동기화 Space 키 목록 (콤마 구분) |
| `KNOWLEDGE_SYNC_RATE_LIMIT` | 옵션 | `5` | Knowledge 동기화 초당 API 호출 수 상한 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | 옵션 | `15` | JWT Access Token 유효 시간(분) |
| `REFRESH_TOKEN_EXPIRE_DAYS` | 옵션 | `7` | Refresh Token 유효 기간(일) |
| `COOKIE_SECURE` | 옵션 | `true` | Refresh Token 쿠키 Secure 플래그 |

---

## 2. docker-compose 인프라 변경 — 볼륨 바인드 마운트

### 2-1. 바인드 마운트 디렉터리 사전 생성 (Server A)

기존 named volume(`prometheus_data`, `postgres_data`, `tempo_data`)이 **바인드 마운트로 교체**됨.  
컨테이너 기동 전 서버에서 디렉터리를 미리 생성해야 합니다.

```bash
ssh user@SERVER_A

# 바인드 마운트 대상 디렉터리 생성
sudo mkdir -p /app/synapse/services/prometheus
sudo mkdir -p /app/synapse/services/postgres/data
sudo mkdir -p /app/synapse/services/tempo

# uid 1036, gid 510 소유권 설정 (docker-compose의 user 설정과 일치)
sudo chown -R 1036:510 /app/synapse/services/prometheus
sudo chown -R 1036:510 /app/synapse/services/postgres
sudo chown -R 1036:510 /app/synapse/services/tempo
```

> **기존 데이터 마이그레이션**: named volume에 데이터가 있으면 바인드 마운트 경로로 복사 후 컨테이너를 재시작합니다.
> ```bash
> # (선택) 기존 Prometheus 데이터 이전
> docker run --rm \
>   -v synapse_prometheus_data:/src:ro \
>   -v /app/synapse/services/prometheus:/dst \
>   alpine sh -c "cp -av /src/. /dst/"
>
> # PostgreSQL 데이터는 pg_dump 후 복원 권장
> docker exec synapse-postgres pg_dump -U synapse synapse > /tmp/synapse_backup.sql
> # (바인드 마운트로 전환 후)
> docker exec -i synapse-postgres psql -U synapse synapse < /tmp/synapse_backup.sql
> ```

---

### 2-2. user: "1036:510" 적용

`prometheus`, `postgres`, `admin-api`, `log-analyzer` 컨테이너에 `user: "1036:510"` 추가됨.  
(RedHat 8.9 SELinux uid 매칭 — 볼륨 쓰기 권한 오류 방지)

`frontend` 컨테이너는 nginx 내부 권한 충돌로 `user` 설정을 **적용하지 않음**.

---

### 2-3. services/attaches/ 디렉터리 사전 생성 (신규)

admin-api(문서 업로드 + 챗봇 첨부파일)와 log-analyzer(문서 임베딩)가 공유하는 파일 저장 경로.  
컨테이너 기동 전 서버에서 디렉터리를 미리 생성해야 합니다.

```bash
ssh user@SERVER_A
cd /app/synapse

sudo mkdir -p services/attaches/{knowledge-docs,chat-attachments}
sudo chown -R 1036:510 services/attaches/
```

> docker-compose 볼륨 마운트 구성 (이미 반영됨):
> - admin-api: `./services/attaches/knowledge-docs:/attaches/knowledge-docs`
> - admin-api: `./services/attaches/chat-attachments:/attaches/chat-attachments`
> - log-analyzer: `./services/attaches/knowledge-docs:/attaches/knowledge-docs`
>
> 두 컨테이너가 동일한 호스트 경로를 마운트하므로 admin-api가 저장한 파일을 log-analyzer가 직접 읽을 수 있습니다.

---

## 3. log-analyzer — 모델 분리 배포 (구조 변경)

### 3-1. 개요

기존: 모델이 Docker 이미지에 번들 (~3GB 이미지)  
변경: 모델을 서버 볼륨(`/app/synapse/models/`)에 별도 배포, 이미지는 ~500MB

| 경로 | 내용 |
|---|---|
| `/app/synapse/models/dense-models/` | BAAI/bge-m3 ONNX (~1.1GB) |
| `/app/synapse/models/fastembed-models/` | Qdrant/bm25 BM25 (~50MB) |
| `/app/synapse/models/reranker-models/` | bge-reranker-v2-m3-ONNX (~2.3GB) |

---

### 3-2. 모델 최초 배포 (빌드 서버에서 1회)

```bash
cd /path/to/aoms

# 모델 전용 tar.gz 추출 (pigz 필요, 없으면 gzip으로 자동 대체)
./build-images.sh export-models
# → main-server/synapse-models.tar.gz 생성 (~1.5GB compressed)

# Server A로 전송
scp main-server/synapse-models.tar.gz user@192.168.10.5:/tmp/
```

```bash
# Server A에서 실행
sudo mkdir -p /app/synapse/models
sudo chown -R 1036:510 /app/synapse/models

# 압축 해제 (pigz 사용 권장, 없으면 gzip)
pigz -d -c /tmp/synapse-models.tar.gz | tar -xf - -C /app/synapse/models
# pigz 없을 때: tar -xzf /tmp/synapse-models.tar.gz -C /app/synapse/models

# 확인
ls -lh /app/synapse/models/
# dense-models/  fastembed-models/  reranker-models/
```

---

### 3-3. 이미지 빌드 및 전송 (이후 코드 배포)

모델 배포 이후 코드 변경 시에는 이미지만 교체합니다.

```bash
# Mac에서
./build-images.sh

# log-analyzer 이미지 전송 (~500MB)
scp main-server/synapse-log-analyzer-1.0.tar.gz user@192.168.10.5:/app/synapse/images/

# Server A에서 로드 후 재시작
docker load < /app/synapse/images/synapse-log-analyzer-1.0.tar.gz
cd /app/synapse
docker compose up -d log-analyzer
```

> **모델 재배포가 필요한 경우**: Reranker/Dense 모델 변경 시에만 `export-models` 재실행.  
> 단순 코드 변경은 이미지만 교체하면 됩니다.

---

## 4. DB 마이그레이션 (기존 운영 DB에 적용)

신규 설치라면 `configs/postgres/init.sql`에 모두 반영되어 있습니다.  
**기존 운영 DB**는 아래 순서로 SQL을 적용하세요.

```bash
ssh user@SERVER_A
cd /app/synapse
```

### 4-1. 게스트 채팅 (`20260428_guest_chat.sql`)

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

### 4-2. 챗봇 다중 시스템 스코프 (`20260429_chat_multi_system.sql`)

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

### 4-3. OIDC 테이블 (`20260429_add_oauth_tables.sql` + `20260429_add_oauth_refresh_tokens.sql`)

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

### 4-4. 마이그레이션 적용 확인

```bash
docker exec -it synapse-postgres psql -U synapse -d synapse -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;"
```

아래 테이블이 존재해야 합니다:
- `oauth_clients`
- `oauth_authorization_codes`
- `oauth_refresh_tokens`

그리고 `chat_sessions`에 `visitor_employee_id`, `system_ids`, `deleted_at` 컬럼이 추가되어야 합니다:

```bash
docker exec -it synapse-postgres psql -U synapse -d synapse -c "
\d chat_sessions"
```

---

## 5. V1 Knowledge RAG 초기화 (최초 1회)

### 5-1. Qdrant Knowledge 컬렉션 확인

log-analyzer 기동 시 Knowledge 컬렉션 3종이 자동 생성됩니다:

```bash
# Server B에서 확인
curl -s http://192.168.10.6:6333/collections | python3 -m json.tool | grep '"name"'
```

예상 컬렉션 목록:
- `log_incidents` (기존)
- `metric_baselines` (기존)
- `metric_hourly_patterns` (기존, 수동 초기화)
- `aggregation_summaries` (기존, 수동 초기화)
- `knowledge_jira_issues` **(신규)**
- `knowledge_confluence_pages` **(신규)**
- `knowledge_documents` **(신규)**

### 5-2. Jira / Confluence 수동 동기화 트리거 (선택)

자동 스케줄(매일 04:00/04:30 KST) 이전에 즉시 동기화가 필요하면:

```bash
# Jira 즉시 동기화 (백그라운드 실행)
curl -s -X POST http://localhost:8000/knowledge/sync/jira/trigger | python3 -m json.tool

# Confluence 즉시 동기화 (백그라운드 실행)
curl -s -X POST http://localhost:8000/knowledge/sync/confluence/trigger | python3 -m json.tool

# 동기화 상태 확인 (admin-api에서)
curl -s http://localhost:8080/api/v1/knowledge/sync-status | python3 -m json.tool
```

### 5-3. 프론트엔드 Knowledge 페이지

`http://192.168.10.5:3001/knowledge` (admin/operator 로그인 필요)

| 탭 | 기능 |
|---|---|
| 문서 | DOCX/PDF/XLSX/PPTX 업로드 → 자동 청킹 → Qdrant 적재 |
| 동기화 | Jira/Confluence 동기화 현황, 단건 강제 재동기화 |
| 질문 분석 | 수집된 질문 클러스터링 분석 |
| 운영자 노트 | Q&A 형식 수동 지식 등록 |
| 검색 검증 | 검색 품질 테스트 (질의 → Qdrant 점수 확인) |

---

## 6. OIDC IdP 설정 (타시스템 SSO 연동 시)

OIDC IdP를 타시스템과 연동하려면 OAuth 클라이언트를 등록해야 합니다.

### 6-1. OAuth 클라이언트 등록

```bash
# admin-api를 통해 OAuth 클라이언트 등록
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

### 6-2. OIDC 디스커버리 엔드포인트

타시스템 설정 시 참고:

```bash
# OpenID Configuration (메타데이터)
curl -s http://192.168.10.5:8080/.well-known/openid-configuration | python3 -m json.tool

# JWKs (공개키)
curl -s http://192.168.10.5:8080/oauth/jwks | python3 -m json.tool
```

---

## 7. 배포 절차 요약 (기존 서버 업데이트)

```bash
# ── Mac(빌드 머신) ─────────────────────────────────────────────────────────────

# 1. RSA 키 생성 (최초 1회만)
cd main-server/services/admin-api/secrets
openssl genrsa -out oauth_private.pem 2048
openssl rsa -in oauth_private.pem -pubout -out oauth_public.pem

# 2. 이미지 빌드
cd /path/to/aoms
./build-images.sh

# 3. (최초 1회) 모델 추출
./build-images.sh export-models

# 4. 파일 전송
SERVER_A="user@192.168.10.5"
scp main-server/synapse-admin-api-1.0.tar.gz     $SERVER_A:/app/synapse/images/
scp main-server/synapse-log-analyzer-1.0.tar.gz  $SERVER_A:/app/synapse/images/
scp main-server/synapse-frontend-1.0.tar.gz      $SERVER_A:/app/synapse/images/
scp main-server/docker-compose.yml               $SERVER_A:/app/synapse/
scp main-server/.env                             $SERVER_A:/app/synapse/

# 5. (최초 1회) 모델 전송
scp main-server/synapse-models.tar.gz $SERVER_A:/tmp/


# ── Server A ───────────────────────────────────────────────────────────────────

# 6. 바인드 마운트 디렉터리 생성 (최초 1회)
sudo mkdir -p /app/synapse/services/{prometheus,postgres/data,tempo}
sudo mkdir -p /app/synapse/services/attaches/{knowledge-docs,chat-attachments}   # 섹션 2-3
sudo chown -R 1036:510 /app/synapse/services/

# 7. (최초 1회) 모델 압축 해제
sudo mkdir -p /app/synapse/models
sudo chown -R 1036:510 /app/synapse/models
pigz -d -c /tmp/synapse-models.tar.gz | tar -xf - -C /app/synapse/models

# 8. .env 신규 항목 추가 (편집)
vi /app/synapse/.env
# → OAUTH_PRIVATE_KEY_PATH, OAUTH_PUBLIC_KEY_PATH, OAUTH_ISSUER 추가
# → JIRA_*, CONFLUENCE_* 추가 (Knowledge RAG 사용 시)

# 9. 이미지 로드
cd /app/synapse/images
docker load < synapse-admin-api-1.0.tar.gz
docker load < synapse-log-analyzer-1.0.tar.gz
docker load < synapse-frontend-1.0.tar.gz

# 10. DB 마이그레이션 적용 (섹션 4 참조)

# 11. 서비스 재시작
cd /app/synapse
docker compose up -d

# 12. 동작 확인
docker compose ps
curl -sf http://localhost:8080/health && echo "admin-api OK"
curl -sf http://localhost:8000/health && echo "log-analyzer OK"
curl -s http://localhost:8080/.well-known/openid-configuration | python3 -m json.tool | head -5
```

---

## 8. 트러블슈팅 추가 항목

| 증상 | 원인 | 해결 |
|---|---|---|
| admin-api 기동 실패 (`FileNotFoundError: oauth_private.pem`) | OIDC RSA 키 미생성 | `main-server/services/admin-api/secrets/`에서 openssl 키 생성 후 이미지 재빌드 |
| log-analyzer 기동 실패 (`dense-models 없음`) | 모델 볼륨 미배포 | `./build-images.sh export-models` 실행 후 `/app/synapse/models/` 압축 해제 |
| prometheus/postgres/tempo 볼륨 마운트 오류 (`permission denied`) | 바인드 마운트 디렉터리 소유자 불일치 | `chown -R 1036:510 /app/synapse/services/` |
| Teams webhook 연결 실패 (`SSL CERTIFICATE_VERIFY_FAILED`) | RHEL CA bundle 경로 문제 | admin-api 이미지 재빌드 (notification.py RHEL CA bundle 수정 포함됨) |
| Knowledge 컬렉션 미생성 | log-analyzer 미기동 또는 Qdrant 연결 실패 | `docker logs synapse-log-analyzer \| grep knowledge` 확인, Server B Qdrant `/readyz` 확인 |
| Jira/Confluence 동기화 미실행 | 환경변수 미설정 | `.env`에 `JIRA_URL`, `JIRA_TOKEN`, `JIRA_PROJECTS` 설정 후 재시작 |
| OIDC `/oauth/authorize` 404 | admin-api 이미지가 갱신 전 버전 | `docker images \| grep admin-api` 버전 확인 후 최신 이미지 로드 |
| 챗봇 세션 조회 오류 (`column system_ids does not exist`) | DB 마이그레이션 미적용 | 섹션 4-2 `20260429_chat_multi_system.sql` 마이그레이션 적용 |
| 문서 업로드·임베딩 실패 (`Permission denied`, `FileNotFoundError`) | services/attaches/ 소유권 불일치 또는 미생성 | 섹션 2-3 참조: `chown -R 1036:510 /app/synapse/services/attaches/` |

---

*작성일: 2026-05-01, 업데이트: 2026-05-01*  
*기준 커밋: `6c9f46f` (feat(knowledge): Jira/Confluence 단건 강제 재동기화 구현)*  
*추가 반영: §2-3 services/attaches/ 파일 저장 경로 통합 / .env.example 서비스별 재정리*
