# AOMS Main Server

백화점 통합 모니터링 시스템(AOMS) 메인 서버 — 로컬 개발 가이드 및 배포 절차

---

## 목차

1. [프로젝트 구조](#프로젝트-구조)
2. [로컬 개발 환경 구성](#로컬-개발-환경-구성)
3. [서비스 실행](#서비스-실행)
4. [테스트](#테스트)
5. [운영 배포 절차](#운영-배포-절차)
6. [환경변수 레퍼런스](#환경변수-레퍼런스)
7. [자주 쓰는 명령어](#자주-쓰는-명령어)

---

## 프로젝트 구조

```
main-server/
├── docker-compose.yml          # 운영용 — 사전 빌드된 이미지 사용
├── docker-compose.dev.yml      # 로컬 개발용 — 인프라만 (postgres, loki 등)
├── .env.example                # 운영 환경변수 템플릿
├── .env.local.example          # 로컬 개발 환경변수 템플릿
├── configs/
│   └── dev/                    # 로컬 개발용 최소 설정
│       ├── loki.yml
│       ├── prometheus.yml
│       └── alertmanager.yml
└── services/
    ├── admin-api/              # FastAPI — 시스템/담당자 관리, 알림 수신/발송
    └── log-analyzer/           # FastAPI — LLM 로그 분석, 벡터 유사도 분석
```

---

## 로컬 개발 환경 구성

### 사전 요구사항

- Docker Desktop (Mac)
- Python 3.11
- 프로젝트 루트의 `venv/` 가상환경

### 1단계 — 환경변수 파일 생성

```bash
# 프로젝트 루트에서 실행
make env-setup
```

`main-server/.env.local` 파일이 생성됩니다. 아래 항목을 채워주세요.

```bash
# 필수 입력
LLM_API_URL=       # 내부 LLM API 엔드포인트
LLM_API_KEY=       # LLM API 키
LLM_AGENT_CODE=    # LLM 에이전트 코드

# Teams 알림 테스트 (선택)
# https://webhook.site 에서 임시 URL 발급 후 입력
TEAMS_WEBHOOK_URL=
```

나머지 항목(DB, Loki, Qdrant 등)은 기본값으로 로컬 인프라에 연결됩니다.

### 2단계 — Python 의존성 설치

```bash
make install
```

### 3단계 — 로컬 인프라 시작

```bash
make dev-up
```

다음 서비스가 Docker로 시작됩니다.

| 서비스 | 로컬 URL | 용도 |
|---|---|---|
| PostgreSQL | `localhost:5432` | admin-api DB |
| Loki | `localhost:3100` | 로그 저장소 |
| Prometheus | `localhost:9090` | 메트릭 수집 |
| Alertmanager | `localhost:9093` | 알림 라우팅 → 로컬 admin-api |
| Qdrant | `localhost:6333` | 벡터 DB |

> **Ollama**: 리소스 소모가 크므로 기본 비활성화입니다. 벡터 임베딩 테스트 시 `docker-compose.dev.yml`의 주석을 해제하세요.

---

## 서비스 실행

두 개의 터미널에서 각각 실행합니다.

```bash
# 터미널 1 — admin-api (코드 저장 시 자동 재시작)
make run-api
# → http://localhost:8080
# → Swagger UI: http://localhost:8080/docs

# 터미널 2 — log-analyzer (코드 저장 시 자동 재시작)
make run-analyzer
# → http://localhost:8000
# → Swagger UI: http://localhost:8000/docs
```

### 알림 흐름 로컬 테스트

Alertmanager가 `configs/dev/alertmanager.yml`을 통해 로컬 admin-api(`localhost:8080`)로 직접 webhook을 전송합니다. 별도 설정 없이 메트릭 알림 → Teams 발송 전체 흐름을 로컬에서 테스트할 수 있습니다.

```bash
# Alertmanager UI에서 수동 알림 발송
open http://localhost:9093

# 또는 curl로 직접 테스트
curl -X POST http://localhost:8080/api/v1/alerts/receive \
  -H "Content-Type: application/json" \
  -d '{
    "alerts": [{
      "status": "firing",
      "labels": {"alertname": "TestAlert", "system_name": "shop-web", "severity": "warning"},
      "annotations": {"summary": "테스트 알림"}
    }]
  }'
```

---

## 테스트

```bash
# admin-api 단위 테스트 (SQLite in-memory 사용 — 인프라 불필요)
make test-api

# 특정 테스트 파일만 실행
cd services/admin-api
../../venv/bin/python -m pytest tests/test_alerts.py -v
```

> `conftest.py`에서 SQLite in-memory DB를 사용하므로 `make dev-up` 없이도 테스트가 가능합니다.

---

## 운영 배포 절차

### Mac에서 이미지 빌드 및 패키징

```bash
# 프로젝트 루트에서
./build-images.sh

# 결과물 (linux/amd64 플랫폼)
# main-server/aoms-admin-api-1.0.tar.gz
# main-server/aoms-log-analyzer-1.0.tar.gz
```

> 또는 Makefile 사용:
> ```bash
> make build          # 전체 빌드
> make build-api      # admin-api만
> make build-analyzer # log-analyzer만
> ```

### 서버 전송 (폐쇄망)

```bash
# 모니터링 서버로 scp 전송
scp main-server/aoms-admin-api-1.0.tar.gz     user@server:/app/aoms/
scp main-server/aoms-log-analyzer-1.0.tar.gz  user@server:/app/aoms/
```

### 서버에서 배포

```bash
# 이미지 로드
docker load < aoms-admin-api-1.0.tar.gz
docker load < aoms-log-analyzer-1.0.tar.gz

# .env 파일 확인/수정
vi /app/aoms/.env

# 특정 서비스만 재시작
docker compose up -d admin-api
docker compose up -d log-analyzer

# 전체 재시작
docker compose up -d
```

### 롤백

```bash
# 이전 버전 이미지가 있는 경우
docker compose stop admin-api
docker tag aoms-admin-api:prev aoms-admin-api:1.0
docker compose up -d admin-api
```

---

## 환경변수 레퍼런스

### admin-api

| 변수 | 로컬 기본값 | 운영 값 | 설명 |
|---|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://aoms:aoms@localhost:5432/aoms` | postgres 컨테이너 URL | DB 연결 |
| `TEAMS_WEBHOOK_URL` | (빈 값) | Teams Incoming Webhook URL | 전역 알림 URL |
| `LLM_API_URL` | — | 내부 LLM API 엔드포인트 | AI 분석 호출 |
| `LOG_ANALYZER_URL` | `http://localhost:8000` | `http://log-analyzer:8000` | 서비스 간 통신 |

### log-analyzer

| 변수 | 로컬 기본값 | 운영 값 | 설명 |
|---|---|---|---|
| `LOKI_URL` | `http://localhost:3100` | `http://loki:3100` | 로그 조회 |
| `ADMIN_API_URL` | `http://localhost:8080` | `http://admin-api:8080` | 분석 결과 전송 |
| `LLM_API_URL` | — | 내부 LLM API | 로그 분석 |
| `LLM_API_KEY` | — | 실제 API 키 | 기본 키 (담당자 미등록 시) |
| `OLLAMA_URL` | `http://localhost:11434` | `http://server-b:11434` | 임베딩 모델 (Server B) |
| `QDRANT_URL` | `http://localhost:6333` | `http://server-b:6333` | 벡터 DB (Server B) |
| `EMBED_MODEL` | `bge-m3` | `bge-m3` | 임베딩 모델명 |
| `ANALYSIS_INTERVAL_SECONDS` | `300` | `300` | 자동 분석 주기(초) |

---

## 자주 쓰는 명령어

```bash
# 전체 명령어 목록
make help

# 인프라 상태 확인
make dev-ps

# 서비스 헬스체크
make health

# DB 직접 접속
make db-shell

# 인프라 재시작 (데이터 유지)
make dev-down && make dev-up

# DB 초기화 (데이터 삭제 후 재시작)
make dev-clean && make dev-up

# 실행 중인 컨테이너 로그 확인
make dev-logs

# 특정 서비스 로그만
cd main-server && docker compose -f docker-compose.dev.yml logs -f postgres
```
