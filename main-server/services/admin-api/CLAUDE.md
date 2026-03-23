# AOMS Admin API - 서비스 개요

## 목적

백화점 통합 모니터링 시스템(AOMS)의 관리 API 서비스.
- 모니터링 대상 **시스템** 및 **담당자** 등록/관리
- Prometheus Alertmanager로부터 **메트릭 알림** 수신 → Teams 발송
- log-analyzer 서비스로부터 **LLM 로그 분석 결과** 수신 → Teams 발송
- 알림 이력 조회 및 **acknowledge** 처리

## 기술 스택

- **Runtime**: Python 3.11, FastAPI (async)
- **DB**: PostgreSQL — SQLAlchemy 2.0 async (asyncpg 드라이버)
- **알림**: Microsoft Teams Incoming Webhook (Adaptive Card)
- **포트**: 8080 (Docker)

## 파일 구조

```
admin-api/
├── main.py              # FastAPI 앱 초기화, 라우터 등록, lifespan(테이블 자동 생성)
├── database.py          # DB 엔진·세션 팩토리, get_db() 의존성
├── models.py            # SQLAlchemy ORM 모델 (6개 테이블)
├── schemas.py           # Pydantic 입출력 스키마
├── init.sql             # 최초 DB 스키마 생성용 SQL (운영 권장)
├── requirements.txt
├── Dockerfile
├── routes/
│   ├── systems.py       # /api/v1/systems
│   ├── contacts.py      # /api/v1/contacts
│   ├── alerts.py        # /api/v1/alerts
│   └── analysis.py      # /api/v1/analysis
└── services/
    ├── cooldown.py      # 알림 중복 발송 방지 (5분 쿨다운)
    └── notification.py  # TeamsNotifier — Adaptive Card 생성·발송
```

## 데이터 모델

| 테이블 | 설명 |
|---|---|
| `systems` | 모니터링 대상 시스템. `system_name`은 Prometheus label과 동일하게 사용 |
| `contacts` | 담당자. `teams_upn`은 Teams @mention용 이메일 |
| `system_contacts` | 시스템↔담당자 N:M 매핑. `notify_channels`에 콤마로 채널 지정 |
| `alert_history` | 모든 알림 발송 이력. `alert_type`: `metric` or `log_analysis` |
| `log_analysis_history` | LLM 분석 결과 저장. log-analyzer 서비스가 POST로 전달 |
| `alert_cooldown` | 중복 알림 방지용 쿨다운 추적. key: `{system}:{role}:{alertname}:{severity}` |

## API 엔드포인트

### 시스템 관리 `/api/v1/systems`
- `GET /` — 전체 목록
- `POST /` — 등록 (`os_type`: linux/windows, `system_type`: web/was/db/middleware/other)
- `GET /{id}`, `PATCH /{id}`, `DELETE /{id}` — 조회/수정/삭제
- `GET /{id}/contacts` — 시스템에 연결된 담당자 목록
- `POST /{id}/contacts` — 담당자 연결
- `DELETE /{id}/contacts/{contact_id}` — 담당자 연결 해제

### 담당자 관리 `/api/v1/contacts`
- `GET /`, `POST /`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}` — 기본 CRUD

### 알림 `/api/v1/alerts`
- `POST /receive` — **Alertmanager webhook 수신** 엔드포인트
  - `firing` 상태 알림만 처리
  - 쿨다운(5분) 체크 → Teams 발송 → `alert_cooldown` 기록 → `alert_history` 저장
- `GET /` — 이력 조회 (필터: `system_id`, `severity`, `acknowledged`, `limit`)
- `POST /{id}/acknowledge` — 알림 확인 처리

### LLM 분석 결과 `/api/v1/analysis`
- `POST /` — log-analyzer가 분석 결과 전달 시 수신
  - `warning`/`critical`이면 Teams 발송 후 `alert_sent=True`
- `GET /` — 이력 조회 (필터: `system_id`, `severity`, `limit`)
- `GET /{id}` — 단건 조회

## 핵심 로직

### 알림 발송 흐름 (메트릭)
```
Alertmanager → POST /api/v1/alerts/receive
  → alert.status == "firing" 확인
  → system_name으로 System + Contact 조회
  → is_in_cooldown() 체크 (5분 내 동일 key 발송 이력 있으면 skip)
  → TeamsNotifier.send_metric_alert() → Teams webhook POST
  → record_sent() — cooldown upsert
  → AlertHistory 저장
```

### 알림 발송 흐름 (LLM 로그 분석)
```
log-analyzer → POST /api/v1/analysis
  → LogAnalysisHistory 생성
  → severity가 warning/critical이면
    → 시스템 담당자 조회
    → TeamsNotifier.send_log_analysis_alert() → Teams webhook POST
  → alert_sent 플래그 업데이트
```

### Teams Webhook URL 우선순위
`System.teams_webhook_url` (시스템별) → 환경변수 `TEAMS_WEBHOOK_URL` (전역 기본값)

### 쿨다운 키 형식
`{system_name}:{instance_role}:{alertname}:{severity}` — 5분 내 동일 키 재발송 차단

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://aoms:aoms@localhost:5432/aoms` | DB 연결 URL |
| `TEAMS_WEBHOOK_URL` | `""` | 전역 Teams webhook URL |

## DB 초기화

- **개발/자동**: lifespan에서 `Base.metadata.create_all` 실행 (앱 시작 시 테이블 자동 생성)
- **운영 권장**: `init.sql` 직접 실행
  ```bash
  docker exec -i aoms-postgres psql -U aoms -d aoms < init.sql
  ```
