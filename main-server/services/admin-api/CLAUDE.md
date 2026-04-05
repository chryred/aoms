# Synapse-V Admin API - 서비스 개요

## 목적

백화점 통합 모니터링 시스템(Synapse-V)의 관리 API 서비스.
- 모니터링 대상 **시스템** 및 **담당자** 등록/관리
- Prometheus Alertmanager로부터 **메트릭 알림** 수신 → Teams 발송
- log-analyzer 서비스로부터 **LLM 로그 분석 결과** 수신 → Teams 발송
- 알림 이력 조회 및 **acknowledge** 처리

## 기술 스택

- **Runtime**: Python 3.11, FastAPI (async)
- **DB**: PostgreSQL — SQLAlchemy 2.0 async (asyncpg 드라이버)
- **알림**: Microsoft Teams Incoming Webhook (Adaptive Card)
- **인증**: JWT(HS256) + bcrypt — `python-jose 3.3.0`, `passlib[bcrypt] 1.7.4`, `bcrypt 4.0.1`
- **포트**: 8080 (Docker)

## 파일 구조

```
admin-api/
├── main.py              # FastAPI 앱 초기화, 라우터 등록, lifespan(테이블 자동 생성)
├── database.py          # DB 엔진·세션 팩토리, get_db() 의존성
├── models.py            # SQLAlchemy ORM 모델 (14개 테이블 — users 포함)
├── schemas.py           # Pydantic 입출력 스키마 (ContactOut.llm_api_key 마스킹 포함)
├── auth.py              # JWT 발급/검증, bcrypt, get_current_user, require_admin Dependency
├── init.sql             # 최초 DB 스키마 생성용 SQL (운영 권장)
├── requirements.txt
├── Dockerfile
├── scripts/
│   └── create_admin.py  # 초기 admin 계정 생성 스크립트
├── routes/
│   ├── auth.py              # /api/v1/auth (login, refresh, logout, me)
│   ├── systems.py           # /api/v1/systems
│   ├── contacts.py          # /api/v1/contacts
│   ├── alerts.py            # /api/v1/alerts
│   ├── analysis.py          # /api/v1/analysis
│   ├── feedback.py          # /api/v1/feedback (해결책 폼 + n8n 연동)
│   ├── collector_config.py  # /api/v1/collector-config (Phase 5)
│   ├── aggregations.py      # /api/v1/aggregations (Phase 5)
│   └── reports.py           # /api/v1/reports (Phase 5)
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
| `alert_history` | 모든 알림 발송 이력. `alert_type`: `metric` / `metric_resolved` / `log_analysis` |
| `log_analysis_history` | LLM 분석 결과 저장. log-analyzer 서비스가 POST로 전달 |
| `alert_cooldown` | 중복 알림 방지용 쿨다운 추적. key: `{system}:{role}:{alertname}:{severity}` |
| `system_collector_config` | 수집기 유연 레지스트리. 시스템별 collector_type + metric_group 등록 (Phase 5) |
| `metric_hourly_aggregations` | 1시간 집계 + LLM 이상 분석 결과 (Phase 5) |
| `metric_daily_aggregations` | 1일 집계 롤업 (Phase 5) |
| `metric_weekly_aggregations` | 7일 집계 롤업 (Phase 5) |
| `metric_monthly_aggregations` | 월/분기/반기/연간 집계. `period_type`으로 구분 (Phase 5) |
| `aggregation_report_history` | Teams 주기별 리포트 발송 이력. 중복 방지용 (Phase 5) |
| `users` | 프론트엔드 인증 사용자. `role`: admin / operator. `is_approved`: admin 승인 여부 (Phase 0) |

## API 엔드포인트

### 인증 `/api/v1/auth` (Phase 0)
- `POST /login` — email/password → accessToken(body) + refreshToken(httpOnly 쿠키, 7일)
- `POST /refresh` — refresh 쿠키 → 새 accessToken 반환
- `POST /logout` — refresh 쿠키 삭제 (204)
- `GET /me` — 현재 로그인 사용자 정보

**초기 admin 계정 생성:**
```bash
docker exec -it aoms-admin-api \
  ADMIN_EMAIL=admin@company.com ADMIN_PASSWORD=changeme \
  python scripts/create_admin.py
```

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
  - `firing` / `resolved` 모두 처리 (`firing` → 쿨다운 체크 → Teams 발송, `resolved` → 복구 알림)
  - 쿨다운(5분) 체크 → Teams 발송 → `alert_cooldown` 기록 → `alert_history` 저장
- `GET /` — 이력 조회 (필터: `system_id`, `severity`, `acknowledged`, `limit`)
- `POST /{id}/acknowledge` — 알림 확인 처리

### LLM 분석 결과 `/api/v1/analysis`
- `POST /` — log-analyzer가 분석 결과 전달 시 수신
  - `warning`/`critical`이면 Teams 발송 후 `alert_sent=True`
- `GET /` — 이력 조회 (필터: `system_id`, `severity`, `limit`)
- `GET /{id}` — 단건 조회

### 수집기 설정 `/api/v1/collector-config` (Phase 5)
- `GET /` — 시스템별/타입별 수집기 설정 목록 조회
- `POST /` — 수집기 설정 등록 (`system_id`, `collector_type`, `metric_group`, `custom_config`)
- `PATCH /{id}` — 설정 수정 (활성화/비활성화 포함)
- `DELETE /{id}` — 설정 삭제
- `GET /templates/{collector_type}` — 타입별 기본 metric_group 템플릿 반환
  - 지원 타입: `node_exporter`, `jmx_exporter`, `db_exporter`, `custom`

### 집계 데이터 `/api/v1/aggregations` (Phase 5)
- `GET /hourly`, `POST /hourly` — 1시간 집계 조회·저장 (WF6 호출)
- `GET /daily`, `POST /daily` — 1일 집계 조회·저장 (WF7 호출)
- `GET /weekly`, `POST /weekly` — 7일 집계 조회·저장 (WF8 호출)
- `GET /monthly`, `POST /monthly` — 월/분기/반기/연간 집계 조회·저장 (WF9/WF10 호출)
- `GET /trend-alert` — `llm_prediction` 있는 최근 집계 중 warning/critical 항목 조회 (WF11 + UI 장애 예방)
- 집계 저장은 모두 upsert (system_id + 기간 버킷 + collector_type + metric_group 기준 중복 방지)

### 리포트 이력 `/api/v1/reports` (Phase 5)
- `GET /` — 발송된 리포트 이력 조회 (필터: `report_type`)
- `GET /{id}` — 단건 조회
- `POST /` — 리포트 발송 기록 저장 (WF7-WF10 호출, 동일 type + period_start 중복 시 업데이트)

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
| `SECRET_KEY` | `change-me-in-production` | JWT 서명 키 — **운영 배포 시 반드시 변경** |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | 허용 프론트엔드 도메인 (콤마 구분) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access Token 만료 시간(분) |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Refresh Token 만료 시간(일) |
| `COOKIE_SECURE` | `false` | HTTPS 환경에서 `true`로 설정 |

## DB 초기화

- **개발/자동**: lifespan에서 `Base.metadata.create_all` 실행 (앱 시작 시 테이블 자동 생성)
- **운영 권장**: `init.sql` 직접 실행
  ```bash
  docker exec -i aoms-postgres psql -U aoms -d aoms < init.sql
  ```

---

## 개발 주의사항 (실수 방지)

### Teams Adaptive Card — 피드백 버튼

`notification.py`의 `send_metric_alert` / `send_log_analysis_alert` 두 함수 모두
Adaptive Card에 `"actions"` 블록으로 **해결책 등록 버튼**이 포함되어 있습니다.

```python
"actions": [
    {
        "type": "Action.OpenUrl",
        "title": "해결책 등록",
        "url": f"{_ADMIN_API_EXTERNAL_URL}/api/v1/feedback/form"
               f"?system={system_name}&point_id={point_id or ''}",
    }
],
```

- 버튼 URL은 `ADMIN_API_EXTERNAL_URL` 환경변수로 구성 (기본: `http://localhost:8080`)
- **Teams에서 버튼을 클릭하는 것은 브라우저에서 열리므로**, 운영 배포 시 반드시 `ADMIN_API_EXTERNAL_URL=http://{server-a-ip}:8080` 설정 필요
- `point_id`는 Qdrant의 포인트 UUID — 메트릭 알림은 `anomaly.get("point_id")`, 로그 분석은 `payload.qdrant_point_id`로 전달

### TeamsNotifier 함수 시그니처 (현재)

```python
# send_metric_alert
async def send_metric_alert(
    self, webhook_url, alert, system_display_name, contacts,
    anomaly_type=None, similarity_score=None, has_solution=None,
    similar_incidents=None, point_id=None  # ← 추가된 파라미터
) -> bool

# send_log_analysis_alert
async def send_log_analysis_alert(
    self, webhook_url, system_display_name, system_name, instance_role,
    analysis, log_sample, contacts,
    anomaly_type=None, similarity_score=None, has_solution=None,
    similar_incidents=None, point_id=None  # ← 추가된 파라미터
) -> bool
```

새 기능 추가 시 두 함수를 함께 수정해야 대칭이 유지됩니다.

### resolved 알림 처리

`alerts.py`에서 `resolved` 상태도 처리합니다 (복구 알림 발송 + `alert_type: "metric_resolved"` 저장).

```python
# ❌ 과거 인식 (틀림)
if alert.status not in ("firing", "resolved"):
    continue  # resolved를 건너뜀

# ✅ 현재 코드 (맞음) — resolved도 처리
if alert.status not in ("firing", "resolved"):
    continue
# → 아래에 resolved 분기 처리 로직 있음
```

테스트 작성 시: `status=resolved` 알림은 `processed[0]["status"] == "resolved"` 반환을 검증해야 합니다.

### 피드백 폼 엔드포인트

`routes/feedback.py` — `GET /api/v1/feedback/form`

- Teams 알림 버튼이 이 URL로 연결됩니다
- 폼 제출은 n8n webhook(`N8N_WEBHOOK_URL/webhook/feedback`)으로 직접 POST
- `N8N_WEBHOOK_URL` 환경변수 미설정 시 기본값: `http://localhost:5678`
- 운영 배포 시 `N8N_WEBHOOK_URL=http://{server-a-ip}:5678` 설정 필요
