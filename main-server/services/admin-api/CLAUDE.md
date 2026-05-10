# Synapse-V Admin API - 서비스 개요

> 전체 아키텍처·데이터 흐름·ADR 상세는 `.claude/memory/` 참조 (예: `.claude/memory/adrs.md`의 ADR-001 LLM Strategy, ADR-002 error_message 컬럼).

## 목적

백화점 통합 모니터링 시스템(Synapse-V)의 관리 API 서비스.
- 모니터링 대상 **시스템** 및 **담당자** 등록/관리
- Prometheus Alertmanager로부터 **메트릭 알림** 수신 → Teams 발송
- log-analyzer 서비스로부터 **LLM 로그 분석 결과** 수신 → Teams 발송
- 알림 이력 조회 및 **acknowledge** 처리

## 로컬 개발 커맨드

```bash
make run-api         # admin-api 핫리로드 (8080)
make install-api     # 의존성 설치 (venv 경유)
make test-api        # 단위 테스트 (SQLite in-memory)
```

> Python 실행 시 반드시 `./venv/bin/python` 또는 `make` 타겟 경유 (글로벌 pip 사용 금지).

---

## 기술 스택

- **Runtime**: Python 3.11, FastAPI (async)
- **DB**: PostgreSQL — SQLAlchemy 2.0 async (asyncpg 드라이버)
- **알림**: Microsoft Teams Incoming Webhook (Adaptive Card)
- **인증**: JWT(HS256) + bcrypt — `python-jose 3.3.0`, `passlib[bcrypt] 1.7.4`, `bcrypt 4.0.1`
- **OIDC IdP**: RS256 ID Token, Authorization Code Flow — `python-jose[cryptography]` + `cryptography>=41.0.0` (ADR-014)
- **포트**: 8080 (Docker)

## 파일 구조

```
admin-api/
├── main.py              # FastAPI 앱 초기화, 라우터 등록, lifespan(테이블 자동 생성 + SSH 세션 정리 루프 + Prometheus 분석 루프)
├── database.py          # DB 엔진·세션 팩토리, get_db() 의존성
├── models.py            # SQLAlchemy ORM 모델 (16개 테이블 — agent_instances, agent_install_jobs 포함)
├── schemas.py           # Pydantic 입출력 스키마 (LlmAgentConfig 스키마 포함)
                         # AlertHistory ISP(2-6): AlertHistoryBaseOut(공통) + AlertHistoryMetricOut/AlertHistoryLogOut(타입별)
                         # + AlertHistoryOut(슈퍼셋 하위 호환 — 라우트·프론트 JSON 와이어 포맷 유지)
├── auth.py              # JWT 발급/검증, bcrypt, get_current_user, require_admin + OIDC RSA 키/ID Token(ADR-014)
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
│   ├── feedback.py          # /api/v1/feedback — Wave 2A 이후: /upload + /attachments/{path} 유지, 나머지 모두 410 Gone
│   ├── collector_config.py  # /api/v1/collector-config (Phase 5)
│   ├── aggregations.py      # /api/v1/aggregations (Phase 5)
│   ├── reports.py           # /api/v1/reports (Phase 5)
│   ├── agents.py            # /api/v1/ssh/session, /api/v1/agents CRUD + health-summary (Phase 6)
│   ├── agents_control.py    # /api/v1/agents 제어·설치·OTel — start/stop/restart/status/install/config/live-status (Phase 6)
│   ├── dashboard.py         # /api/v1/dashboard (통합 대시보드 API - Phase 8)
│   ├── websocket.py         # /ws/dashboard (실시간 알림 스트리밍 - Phase 8)
│   └── oauth.py             # OIDC IdP (ADR-014): /.well-known/openid-configuration, /oauth/jwks, /oauth/authorize, /oauth/token, /oauth/userinfo, /api/v1/oauth/clients
└── services/
    ├── agent_utils.py           # sanitize_promql_label — PromQL 레이블 인젝션 방지 공유 유틸
    ├── cooldown.py              # 알림 중복 발송 방지 (5분 쿨다운)
    ├── notification.py          # TeamsNotifier — Webhook POST 전송 + SSL CA 처리 (카드 빌드는 adaptive_card_builder에 위임)
    ├── adaptive_card_builder.py # Teams Adaptive Card JSON 빌더 — build_metric_alert_card / build_log_analysis_card / build_recovery_card / build_vector_context_block
    ├── ssh_session.py           # SSH 세션 인메모리 관리 (5분 슬라이딩 TTL, DB 저장 금지)
    ├── llm_client.py            # LLM Strategy (ADR-001, log-analyzer와 SYNC) — devx/claude/openai (ADR-012: ollama 제거)
    ├── prometheus_analyzer.py   # Prometheus PromQL 이상 감지 → LLM 분석 → Teams 알림 (Phase F, ADR-001 반영)
    ├── db_collector.py          # DB 메트릭 수집 루프 (encrypt/decrypt, Gauge, Strategy 디스패치)
    └── db_backends/             # Strategy + Registry 패턴 DB 백엔드
        ├── __init__.py          # DB_AGENT_TYPE, BACKENDS registry, DBBackend Protocol
        ├── oracle.py            # Oracle (oracledb)
        ├── postgres.py          # PostgreSQL (psycopg2)
        ├── mssql.py             # MSSQL (pymssql)
        └── mysql.py             # MySQL (mysql-connector-python)
```

## 데이터 모델

| 테이블 | 설명 |
|---|---|
| `systems` | 모니터링 대상 시스템. `system_name`은 Prometheus label과 동일하게 사용 |
| `contacts` | 담당자. `teams_upn`은 Teams @mention용 이메일 (LLM 관련 필드 제거됨 — ADR-007) |
| `llm_agent_configs` | 업무 영역별 DevX agent_code 관리 (9개 영역). `area_code` 유니크 (ADR-007) |
| `system_contacts` | 시스템↔담당자 N:M 매핑. `notify_channels`에 콤마로 채널 지정 |
| `alert_history` | 모든 알림 발송 이력. `alert_type`: `metric` / `log_analysis`. 메트릭 복구 시 원본 row 의 `resolved_at` 만 업데이트 (별도 row 생성 안 함). `error_message` 컬럼(ADR-002) 포함 |
| `log_analysis_history` | LLM 분석 결과 저장. log-analyzer 서비스가 POST로 전달. `error_message`(실패 사유)·`model_used`(LLM_TYPE) 컬럼 포함(ADR-001/002) |
| `alert_cooldown` | 중복 알림 방지용 쿨다운 추적. key: `{system}:{role}:{alertname}:{severity}` |
| ~~`system_collector_config`~~ | **삭제됨 (D4 결정, 2026-05-01)**. `GET /api/v1/collector-config`는 `agent_instances.label_info`에서 on-the-fly derive. POST/PATCH/DELETE → 410 Gone. |
| `metric_hourly_aggregations` | 1시간 집계 + LLM 이상 분석 결과 (Phase 5) |
| `metric_daily_aggregations` | 1일 집계 롤업 (Phase 5) |
| `metric_weekly_aggregations` | 7일 집계 롤업 (Phase 5) |
| `metric_monthly_aggregations` | 월/분기/반기/연간 집계. `period_type`으로 구분 (Phase 5) |
| `aggregation_report_history` | Teams 주기별 리포트 발송 이력. 중복 방지용 (Phase 5) |
| `users` | 프론트엔드 인증 사용자. `role`: admin / operator. `is_approved`: admin 승인 여부 (Phase 0) |
| `agent_instances` | 수집기 인스턴스 메타정보. `ssh_username` 저장, password 저장 금지 (Phase 6). `agent_type='db'`는 `label_info` JSON에 `db_type`(oracle/postgresql/mssql/mysql) + 연결 정보 저장 (Phase 9) |
| `agent_install_jobs` | 비동기 설치 Job 이력. `status`: pending/running/done/failed (Phase 6) |
| `incidents` | 인시던트 라이프사이클 — 관련 알림을 하나의 사건으로 묶어 MTTA/MTTR 추적. `status`: open/acknowledged/investigating/resolved/closed |
| `incident_timeline` | 인시던트 이벤트 타임라인 — `event_type`: alert_added / analysis_added / status_changed / comment |
| `chat_tools` | ReAct 챗봇이 호출할 수 있는 도구 레지스트리. `executor` (ems/admin/log_analyzer/qdrant), `is_enabled`, `input_schema` JSON Schema (Phase Chat, ADR-011 qdrant 추가) |
| `chat_executor_configs` | Executor별 자격증명/설정. `config` JSONB (secret 필드는 Fernet 암호문), `config_schema` 폼 렌더 메타 (Phase Chat) |
| `chat_sessions` | 사용자 챗봇 세션. UUID PK, `user_id` FK. `system_ids INTEGER[]` (다중 시스템 스코프), `deleted_at` (소프트 삭제) (Phase Chat) |
| `chat_messages` | 세션 내 메시지. role: user/assistant/tool, `attachments` JSONB (Phase Chat). V1: `rag_top1_score` (Float), `rag_sources_count` (Integer). `system_id INTEGER` FK→systems (도구 호출별 실제 조회 시스템 — 통계용) |
| `knowledge_corrections` | 사용자 오답 교정 이력 — `source_point_id`, `source_collection`, `correct_answer` (V1 RAG) |
| `knowledge_sync_status` | 외부 지식 소스(Jira/Confluence/Documents) 동기화 현황. source가 PK (V1 RAG) |
| `scheduler_run_history` | log-analyzer 스케줄러 실행 이력. `scheduler_type`(analysis/hourly/daily/weekly/monthly/longperiod/trend), `status`(ok/error), `error_count`, `analyzed_count`, `summary_json`, `error_message` |

## API 엔드포인트

### 인증 `/api/v1/auth` (Phase 0)
- `POST /login` — email/password → accessToken(body) + refreshToken(httpOnly 쿠키, 7일)
- `POST /refresh` — refresh 쿠키 → 새 accessToken 반환
- `POST /logout` — refresh 쿠키 삭제 (204)
- `GET /me` — 현재 로그인 사용자 정보
- `GET /me/primary-systems` — 로그인 사용자가 primary 담당자로 등록된 시스템 목록 (AgentFormModal 시스템 자동선택 용도). `User → Contact(user_id) → SystemContact(role='primary') → System` 조인. 응답: `[{ system_id, system_name, display_name }]`

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

### LLM Agent 설정 `/api/v1/llm-agent-configs` (ADR-007)
- `GET /` — 전체 조회 (`?is_active=true` 필터 지원)
- `GET /{area_code}` — area_code로 단건 조회 (log-analyzer 내부 호출용)
- `POST /` — 생성 (admin 인증 필수)
- `PATCH /{id}` — 수정 (admin 인증 필수)
- `DELETE /{id}` — 삭제 (admin 인증 필수)

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

### 수집기 설정 `/api/v1/collector-config` (D4 이후 — derive 전용)
- `GET /` — **agent_instances.label_info에서 on-the-fly derive** (system_collector_config 테이블 삭제됨). 하위 호환 응답 형식 유지.
  - synapse_agent(running/installed) → 6개 metric_group(cpu/memory/disk/network/log/web)
  - db(running/installed) → 4개 metric_group(db_connections/db_query/db_cache/db_replication)
- `POST /` — **410 Gone** (테이블 삭제)
- `PATCH /{id}` — **410 Gone** (테이블 삭제)
- `DELETE /{id}` — **410 Gone** (테이블 삭제)
- `GET /templates/{collector_type}` — 타입별 기본 metric_group 템플릿 반환
  - 지원 타입: `synapse_agent`, `db_exporter`, `custom`

### 집계 데이터 `/api/v1/aggregations` (Phase 5)
- `GET /hourly`, `POST /hourly` — 1시간 집계 조회·저장 (log-analyzer `_hourly_agg_scheduler` 호출)
- `GET /daily`, `POST /daily` — 1일 집계 조회·저장 (log-analyzer `_daily_agg_scheduler` 호출)
- `GET /weekly`, `POST /weekly` — 7일 집계 조회·저장 (log-analyzer `_weekly_agg_scheduler` 호출)
- `GET /monthly`, `POST /monthly` — 월/분기/반기/연간 집계 조회·저장 (log-analyzer 월간/장기 스케줄러 호출)
- `GET /trend-alert` — `llm_prediction` 있는 최근 집계 중 warning/critical 항목 조회 (log-analyzer `_trend_agg_scheduler` + UI 장애 예방)
- 집계 저장은 모두 upsert (system_id + 기간 버킷 + collector_type + metric_group 기준 중복 방지)

### 리포트 이력 `/api/v1/reports` (Phase 5)
- `GET /` — 발송된 리포트 이력 조회 (필터: `report_type`)
- `GET /{id}` — 단건 조회
- `POST /` — 리포트 발송 기록 저장 (log-analyzer 일/주/월/장기 스케줄러 호출, 동일 type + period_start 중복 시 업데이트)

### SSH 세션 `/api/v1/ssh` (Phase 6)
- `POST /session` — 계정 등록 → session_token 발급 (5분 슬라이딩 TTL, SSH 연결 사전 검증)
- `DELETE /session` — 세션 삭제 (로그아웃). `X-SSH-Session` 헤더 필요

### 에이전트 제어 `/api/v1/agents` (Phase 6)
- `GET /` — 등록된 에이전트 목록 (필터: `system_id`, `agent_type`)
- `POST /` — 에이전트 인스턴스 등록
- `GET /{id}`, `PATCH /{id}`, `DELETE /{id}` — 조회/수정/삭제
- `POST /install` — 설치 Job 생성 (비동기, 202 반환 + job_id)
- `GET /jobs/{job_id}` — 설치 진행 상태 폴링 (실시간 로그 포함)
- `POST /{id}/start` — 에이전트 실행 (nohup, PID 파일 기록)
- `POST /{id}/stop` — 에이전트 종료 (PID 파일로 kill)
- `POST /{id}/restart` — 종료 후 재실행
- `GET /{id}/status` — 프로세스 상태 확인 (DB 상태 동기화)
- `GET /{id}/config` — 원격 설정파일 내용 조회 (SFTP)
- `POST /{id}/config` — 설정 업로드 + Reload (재시작) + label_info DB 동기화 (synapse_agent: collectors/log_monitors/web_servers 업데이트)

**제어 공통 규칙:**
- 모든 제어 요청은 `X-SSH-Session: {token}` 헤더 필수 (`db` 타입 예외 — SSH 불필요)
- systemd 미사용 — nohup + PID 파일 방식
- `agent_type`: `synapse_agent` | `db`
- `GET /{id}/live-status` — synapse_agent / db: Prometheus 쿼리 → last_seen, live_status, collectors_active 반환

**Synapse agent `label_info` JSON 스키마 (synapse_agent 타입):**
```json
{
  "system_name": "cxm",
  "display_name": "고객경험시스템",
  "instance_role": "was1",
  "collectors": { "cpu": true, "memory": true, "log_monitor": true, "web_servers": true, ... },
  "log_monitors": [
    { "paths": ["/server1/JeusServer.log"], "keywords": ["ERROR","CRITICAL"], "log_type": "app" }
  ],
  "web_servers": [
    { "name": "apache1", "display_name": "Apache 1",
      "log_path": "/var/log/apache/access.log", "log_format": "combined",
      "slow_threshold_ms": 1000, "was_services": ["jeus1","jeus2"] }
  ]
}
```
- `web_servers` 배열은 설치 Job에서 `[[web_servers]]` TOML 섹션으로 렌더링되어 Rust agent `WebServerConfig`로 전달된다 (name·log_path 미입력 엔트리는 자동 스킵). `log_format`은 `combined` | `nginx_json` | `clf` 중 하나.

**DB 에이전트 공통 특이사항 (Phase 9 — oracle/postgresql/mssql/mysql):**
- `agent_type = "db"`, `label_info.db_type`으로 DB 종류 구분
- SSH 세션 불필요 — `install` 시 DB 연결 테스트만 수행
- `host`: SCAN 주소 또는 DB 호스트명
- `port`: DB 기본 포트 (oracle=1521, postgresql=5432, mssql=1433, mysql=3306)
- `label_info` JSON 예시:
  - Oracle: `{ "db_type": "oracle", "service_name": "ORCL", "username": "...", "encrypted_password": "..." }`
  - PostgreSQL: `{ "db_type": "postgresql", "database": "mydb", "username": "...", "encrypted_password": "..." }`
  - MSSQL: `{ "db_type": "mssql", "database": "mydb", "username": "...", "encrypted_password": "..." }`
  - MySQL: `{ "db_type": "mysql", "database": "mydb", "username": "...", "encrypted_password": "..." }`
  - 등록 시 `password` 필드로 전달하면 서버에서 Fernet 암호화 후 `encrypted_password`로 저장
- **Strategy + Registry 패턴**: `services/db_backends/` — `BACKENDS[db_type].test_connection()` / `.collect_sync()` 디스패치
- `install` = DB 연결 테스트 성공 → status `running` (수집 즉시 시작) + db_exporter collector_config 4개 자동 생성
- `start`/`stop`/`restart` 지원 — SSH 없이 status 전환으로 수집 제어 (`running` ↔ `stopped`)
- 수집 루프(`db_collection_loop`)는 `status == "running"`인 에이전트만 수집 (기본 60초 주기, `ENCRYPTION_KEY` 설정 시 활성화)
- 수집 중 DB 접속 실패 시 자동으로 `status="stopped"` 전환 (에러 로그 무한 반복 방지)

### Prometheus 메트릭 엔드포인트 `/metrics` (Phase 9)
- DB 수집 메트릭을 Prometheus 형식으로 노출 (Oracle/PostgreSQL/MSSQL/MySQL 공통)
- Prometheus scrape 설정: `admin-api` job이 `metrics_path: /metrics`로 이미 구성됨
- 노출 메트릭:

| 메트릭명 | 설명 |
|---|---|
| `db_connections_active_percent` | 활성 세션 % (max 대비) |
| `db_connections_active` | 활성 세션 수 |
| `db_transactions_per_second` | TPS (DB별 카운터 기반) |
| `db_slow_queries_total` | 슬로우 쿼리 수 (1초 초과) |
| `db_cache_hit_rate_percent` | 버퍼 캐시 히트율 % |
| `db_replication_lag_seconds` | 복제 지연(초) |

레이블: `system_name`, `instance_role`

### 통합 대시보드 `/api/v1/dashboard` (Phase 8 + Phase 2A 확장)
- `GET /system-health` — 전체 시스템 상태 종합 조회
  - 응답: `{ summary: { total_systems, critical_systems, warning_systems, normal_systems, total_metric_alerts, total_log_critical, total_log_warning, last_updated }, systems: [...] }`
  - `systems[*]` 항목에 **`instances: InstanceStatusOut[]`** 추가 (Phase 2A). PROMETHEUS_URL 미설정 시 `[]`.
  - 상태 판정 기준: Prometheus 라이브(max_over_time[5m]) + 메트릭 알림 + 로그분석 — **조회 기간: 최근 10분**. 라이브 메트릭은 **worst-case(max)** 기준 (Phase 2A: avg → max 변경)
  - `total_log_critical` / `total_log_warning`: 전체 시스템 최근 10분 로그분석 건수 합계
  - 시스템 카드 reason 텍스트: "수집 알림 N개" (메트릭 알림) / "로그 이상 감지|경고"
- `GET /systems/{id}/detailed` — 시스템 상세 정보 조회
  - 응답: `{ system_id, display_name, metric_alerts: [...], log_analysis: { ... }, contacts: [...], instances: InstanceStatusOut[], last_updated }`
  - **`instances`**: 인스턴스별 상태 배열 추가 (Phase 2A). PROMETHEUS_URL 미설정 시 `[]`.
  - 메트릭 알림, 로그분석 결과 (최근 10분, 5개), 담당자 정보 포함

**`InstanceStatusOut` 스키마 (schemas.py)**:
```python
class InstanceStatusOut(BaseModel):
    instance_role: str                   # Prometheus 레이블 (was1, db1, …)
    server_type: Optional[str] = None   # agent_instances.server_type (web/was/db/middleware/other)
    status: str                          # normal | warning | critical | inactive
    worst_metric: Optional[str] = None  # 상태 유발 메트릭 그룹 (cpu, memory 등)
```

**RANGE_PROMQL_MAP `*_by_inst` 키 (Phase 2A)**:
- merge 루프에서 `instance_role` 레이블이 있으면 `{key}__{instance_role}` 형식 (예: `cpu_max_by_inst__was1`) 으로 `metrics_json` 에 저장됨 (`__` 구분자 convention)
- 추가된 키: `cpu_max_by_inst`, `mem_max_by_inst`, `disk_io_max_by_inst`, `net_rx_max_by_inst`, `log_max_by_inst`, `resp_max_by_inst` (synapse_agent), `conn_max_by_inst`, `cache_min_by_inst` (db_exporter)

### WebSocket 실시간 알림 `/ws/dashboard` (Phase 8)
- **연결**: `WebSocket ws://host:8080/api/v1/ws/dashboard`
- **메시지 형식**:
  ```json
  {
    "type": "alert_fired" | "alert_resolved" | "log_analysis_complete",
    "timestamp": "2026-04-11T12:34:56.789000",
    "data": { "system_id": "...", "alert_name": "...", ... }
  }
  ```
- **Heartbeat**: 클라이언트에서 30초마다 "ping" 전송, 서버는 "pong" 응답
- **자동 재연결**: 클라이언트에서 exponential backoff (3s, 6s, 12s, 24s, 48s) 지원
- **브로드캐스트**: Alertmanager 또는 log-analyzer에서 알림 발생 시 모든 연결 클라이언트에게 즉시 전파

### WebSocket 브로드캐스트 트리거
- **alerts.py** — `POST /receive`에서 alert 저장 후 `notify_alert_fired()` / `notify_alert_resolved()` 호출
- **analysis.py** — `POST /` 분석 결과 저장 후 severity가 warning/critical일 때 `notify_log_analysis()` 호출

### 인시던트 `/api/v1/incidents` (Incident Lifecycle + Wave 2A 피드백)
- `GET /` — 목록 조회 (필터: `system_id`, `status`, `severity`, `limit`, `offset`)
- `GET /stats` — 인시던트 통계 (`{ total, registrable, completed }`)
- `GET /feedback/pending` — 승인 대기 피드백 목록 (admin 전용)
- `GET /feedback/search` — 해결책 벡터 검색 (log-analyzer `/incident/search` 프록시)
- `GET /{id}` — 상세 조회 (타임라인 + 연결된 알림 최대 20건 포함, `mtta_minutes`/`mttr_minutes` 계산됨)
- `GET /{id}/feedback` — 인시던트에 등록된 피드백 목록 (status 미지정: approved만)
- `PATCH /{id}` — 상태/근본원인/조치/사후분석 업데이트 (status 전이 시 타임라인 자동 기록)
- `POST /{id}/comments` — 댓글 추가 (타임라인에 `event_type=comment`로 저장)
- `POST /{id}/feedback` — 피드백 등록 (status=pending, 승인자 지정 필수)
- `POST /{id}/feedback/{fid}/approve` — 피드백 승인 (admin OR 지정 승인자, OCR 완료 확인 후 Qdrant upsert)
- `POST /{id}/feedback/{fid}/reject` — 피드백 반려 (reason 필수)
- `POST /{id}/feedback/{fid}/resubmit` — 피드백 재등록 (pending/rejected/approved 모두 허용. approved 수정 시 status=pending 복귀 → 재승인 필요. body의 `revision_reason` 선택 — 승인자 검토용)

**자동 그루핑 규칙** (`routes/alerts._get_or_create_incident`):
- 알림 수신 시 같은 `system_id`의 **30분 이내 open/acknowledged/investigating** 인시던트가 있으면 연결 (`alert_count` 증가)
- 심각도 상향: warning → critical은 인시던트 severity를 critical로 변경
- 매칭 인시던트 없으면 신규 생성 (`status="open"`, `detected_at=now`)
- `alert_history.incident_id` / `log_analysis_history.incident_id`에 FK 저장
- 각 연결 시 `incident_timeline` 에 `event_type="alert_added"` 또는 `"analysis_added"` 기록

**MTTA/MTTR 계산**: 응답 시 `acknowledged_at - detected_at` / `resolved_at - detected_at`을 분 단위로 변환

**Teams 카드 연동**: `notification.py`의 `send_metric_alert`/`send_log_analysis_alert`에 `incident_id` 전달 → 카드에 **"인시던트 보기"** 버튼 추가 (URL: `{FRONTEND_EXTERNAL_URL}/incidents/{id}`)

### Knowledge 관리 `/api/v1/knowledge` (V1 RAG)
- `POST /upload` — 문서 파일(pdf/docx/xlsx/pptx) 업로드 → log-analyzer /embed/document 비동기 호출 → job_id 반환 (202)
  - 저장 경로: `{KNOWLEDGE_DOCS_DIR}/{system_id}/{filename}` (기본: `/app/synapse/knowledge-docs`)
- `GET /upload/{job_id}/status` — 업로드 Job 상태 폴링
- `POST /operator-note` — 운영자 Q&A 노트 등록 → log-analyzer /knowledge/operator-note 호출 → `point_id` **문자열** 반환 (uint64 → JS 정밀도 손실 방지)
- `PATCH /operator-note/{point_id}` — 운영자 노트 수정. path param `point_id`는 **문자열**
- `DELETE /operator-note/{point_id}` — 운영자 노트 삭제. path param `point_id`는 **문자열**
- `POST /feedback` — 오답 교정 피드백 — `knowledge_corrections` INSERT + log-analyzer /knowledge/correction 호출 (best-effort)
- `GET /questions/frequent` — 최근 N일 사용자 질문 집계·클러스터링 (cosine 유사도 0.85, 5분 캐시)
- `GET /sync-status` — knowledge_sync_status 조회 (source 필터 지원)
- `POST /sync-status` — log-analyzer 스케줄러가 호출 (last_sync_at, total_synced UPSERT)
- `POST /sync/{jira|confluence}` — 전체 소스 동기화 트리거 (background, log-analyzer 프록시)
- `POST /sync/jira/{issue_key}/force` — Jira 단건 이슈 강제 재동기화 (동기, log-analyzer 프록시)
- `POST /sync/confluence/{page_id}/force` — Confluence 단건 페이지 강제 재동기화 (동기, log-analyzer 프록시)
- `GET /documents` — Qdrant 적재 문서 목록 조회 (log-analyzer GET /knowledge/documents 프록시). `?system_id=` 필터 지원. 응답: `{ items: [{ file_hash, file_name, system_id, chunk_count, uploaded_at }] }`
- `DELETE /documents/{file_hash}` — file_hash 단위 문서 청크 일괄 삭제 (log-analyzer DELETE /knowledge/documents/{file_hash} 프록시). 권한: admin 또는 해당 system_id 의 SystemContact 담당자

### 챗봇 검색 검증 `/api/v1/knowledge/search-verify` (V1 RAG 검증)
- `POST /search-verify/chatbot` — 챗봇 RAG 3개 도구(incident/aggregation/knowledge)와 동일 로직으로 검색. LLM 호출 없음. body: `{ query, system_ids }`. 3개 도구 병렬 호출 후 점수 내림차순 통합 반환
- `POST /search-verify/collections` — 사용자가 선택한 컬렉션을 직접 검색. body: `{ query, system_ids, collections, use_reranker }`. 컬렉션별 log-analyzer 엔드포인트 분기 (incident/aggregation/knowledge)
- 응답 공통 스키마: `{ results: [{ tool, collection, score, content, system_id, system_name, doc_type?, file_name?, file_hash?, ... }], used_tools }` — `extra` 객체는 응답 직렬화 시점에 같은 레벨로 평탄화되어 반환된다 (frontend 가 `result.file_name` 같은 평탄 접근 사용). 운영자 노트는 `doc_type=operator_note` 로 식별
- 구현 파일: `routes/knowledge_verify.py`

**컬렉션별 시스템 필터 정책 (V1)**:
| 컬렉션 | 시스템 필터 |
|---|---|
| `log_incidents` / `metric_baselines` | system_ids 필터 적용 (/incident/search) |
| `aggregation_summaries` / `metric_hourly_patterns` | system_ids 필터 적용 (/aggregation/search) |
| `knowledge_documents` | system_id 필터 (system_ids 1개만 — 복수 시 전체 조회) |
| `knowledge_jira` / `knowledge_confluence` | **필터 미적용** — 전체 지식베이스 조회 (Subagent A federated_search 정책) |

모든 엔드포인트 `Depends(get_current_user)` 인증 필요.

### 게스트 채팅 `/api/v1/help` (V2)
인증 없이 현업 담당자가 RAG 챗봇을 사용할 수 있는 공개 엔드포인트.
모든 세션은 `area_code='help_inquiry'`로 생성되며, `chat_agent.py`에서 RAG 도구만 허용.

- `POST /api/v1/help/sessions` — 게스트 세션 생성 (사번 필수, user_id=NULL)
- `POST /api/v1/help/sessions/{id}/messages` — SSE 스트리밍 (area_code 검증 후 run_react_stream)
- `GET /api/v1/help/sessions/{id}/messages?employee_id=` — 메시지 이력 조회. `area_code='help_inquiry'` + `deleted_at IS NULL` + `visitor_employee_id` 일치 검증 후 `list[ChatMessageOut]` 시간순 반환. 불일치/삭제 세션은 403.
- `GET /api/v1/help/systems` — 시스템 카드 목록 (status='active')
- `GET /api/v1/help/questions/frequent` — 자주 묻는 질문 (help_inquiry 세션 기준)
- `POST /api/v1/help/sessions/{id}/escalate` — incidents 생성 (source='help_inquiry')

`chat_agent.py` 분기: `area_code='help_inquiry'` → `_HELP_ALLOWED_TOOLS` 필터 + `_help_decision_prompt()`
DB 변경: `chat_sessions.user_id` nullable, `visitor_employee_id/email/system_id` 컬럼 추가, `incidents.source` 추가

### ReAct 챗봇 `/api/v1/chat*` (Phase Chat)
- **세션**
  - `POST /api/v1/chat/sessions` — 세션 생성. body(선택): `{ system_ids?: int[] }` (기본 [])
  - `GET /api/v1/chat/sessions` — 본인 세션 목록. 쿼리 파라미터: `q` (title ILIKE 검색). 소프트 삭제된 세션은 제외.
  - `PATCH /api/v1/chat/sessions/{id}` — 제목/시스템 변경. body: `{ title?: str, system_ids?: int[] }` (변경할 필드만)
  - `DELETE /api/v1/chat/sessions/{id}` — **소프트 삭제** (`deleted_at = NOW()`). 첨부파일은 보존.
  - `POST /api/v1/chat/sessions/{id}/restore` — 소프트 삭제 세션 **복구** (`deleted_at = NULL`). 본인 세션만. 프론트에서 삭제 직후 토스트 "되돌리기" 액션이 호출.
  - `GET /api/v1/chat/sessions/{id}/messages` — 메시지 이력 (소프트 삭제된 세션은 404)
  - `POST /api/v1/chat/sessions/{id}/messages` → **SSE** (text/event-stream). body: `{content, attachment_keys, screen_context?}` — `screen_context: {screen, screen_label, system_id?, incident_id?}`은 화면 진입 시 ChatLauncher가 chatStore에 보관 → ChatPage가 메시지 전송 시 첨부. LLM 프롬프트 1턴에만 한 줄 메타로 prepend되며 chat_messages 본문에는 저장되지 않음.
    - 이벤트 타입: `user_saved` / `iter_start` / `thought` / `tool_call` / `tool_result` / `token` / `final` / `error`
    - DevX 폴백: 완성 텍스트를 청크 분할하여 토큰 스트리밍
- **통계** (admin 전용)
  - `GET /api/v1/chat/statistics?from=YYYY-MM-DD&to=YYYY-MM-DD&group_by=system` — 시스템별 챗봇 사용 통계
    - 응답: `[{ system_id, system_name, session_count, message_count, top1_avg_score }]`
- **첨부**
  - `POST /api/v1/chat/sessions/{id}/attachments` — multipart, image/png|jpeg|webp|gif, ≤10MB → `{key, mime, size}`
  - `GET /api/v1/chat/sessions/{id}/attachments/{key}` — 인증 후 스트리밍 서빙
- **도구 관리** (admin 전용 Modify)
  - `GET /api/v1/chat-tools` — 전체 도구 (인증)
  - `PATCH /api/v1/chat-tools/{name}` — is_enabled 토글 (admin)
  - `GET /api/v1/chat-executor-configs` — 전체 executor 설정 (secret 마스킹)
  - `PUT /api/v1/chat-executor-configs/{executor}` — 자격증명 저장 (secret는 Fernet 암호화). `"***"`는 기존 값 유지
  - `POST /api/v1/chat-executor-configs/{executor}/test` — 연결 테스트 (ems=login, log_analyzer=health)

### 챗봇 ReAct 루프 요약
- LLM(`llm_client.py`의 `chat_assistant` area)이 JSON 응답으로 action/final_answer 결정 → `run_tool()`로 도구 실행
- 대화·도구 이력은 `chat_messages`(user/assistant/tool) 테이블에 저장하고, 매 턴마다 최근 20턴을 프롬프트에 재주입
- 도구 그룹:
  - `ems`: ems-mcp 9개 (Polestar 서버 모니터링). 자격증명은 `chat_executor_configs.ems` 에서 로드 (60s TTL 캐시)
  - `admin`: `admin_list_systems` / `admin_search_alert_history` / `admin_list_contacts` (DB 직접 조회)
  - `log_analyzer`: 최근 LLM 로그 분석 조회 + log-analyzer HTTP 프록시
  - `qdrant` (ADR-011 RAG): 검색(Search) 6종 + 전문 조회(Get-Full) 3종.
    - 검색: `qdrant_search_incident_knowledge` (log_incidents + metric_baselines Hybrid) / `qdrant_search_aggregation_summary` (aggregation_summaries Hybrid) / `qdrant_search_hourly_patterns` (metric_hourly_patterns Hybrid) / `qdrant_search_incident_postmortem` (incident_postmortems Hybrid) / `qdrant_search_knowledge` (V1 knowledge federated — log-analyzer `/knowledge/search`) / `qdrant_search_guide` (knowledge_guides Hybrid — log-analyzer `/guides/search`, system_id 필터 + NULL 공용 가이드 OR)
    - 청크 조회 (검색에서 부족한 청크만 보강): `qdrant_get_guide_chunks(guide_id, chunk_indexes?)` / `qdrant_get_document_chunks(file_hash, chunk_indexes?)` / `qdrant_get_confluence_chunks(page_id, chunk_indexes?)`. **chunk_indexes 명시 시 surgical fetch (1-3개 청크만 — 컨텍스트 절약)**, 생략 시 전체 (사용자가 "전문/전체" 명시한 경우만). 각각 청킹된 컬렉션(`knowledge_guides`, `knowledge_documents`, `knowledge_confluence_pages`)에서 chunk_index 순서로 반환. log-analyzer `GET /guides/{id}/chunks?chunk_indexes=2&chunk_indexes=4`, `GET /knowledge/documents/{hash}/chunks`, `GET /knowledge/confluence/{id}/chunks` 프록시
    - 구현은 `services/chat_tools/executors/qdrant.py`. `services/prompts.py._decision_prompt()` 에 사용 트리거 + 전문 조회 가이드 포함. `_HELP_ALLOWED_TOOLS`에는 게스트도 사용 가능한 search 3종 + get_full 3종 포함
  - `prometheus`: `prometheus_query` / `prometheus_range_query` — 보관 기간(운영 15d / 개발 3d) 이내 raw 메트릭 조회. 구현: `services/chat_tools/executors/prometheus.py`. 환경변수: `PROMETHEUS_URL`, `PROMETHEUS_RETENTION_DAYS`(기본 15)
    - `prometheus_query` — instant query (`/api/v1/query`). `system_name` + `metric_group` + 선택 `time(KST)` / `window` / `aggregation`. 결과: `instances[].metrics` (한 시점 값).
    - `prometheus_range_query` — range query (`/api/v1/query_range`). `system_name` + `metric_group` + `start_time` + 선택 `end_time(생략 시 now)` / `step(기본 5m)` / `aggregation`. 결과: `instances[].series` (시계열). 데이터 포인트 1000개 한도.
  - `qdrant_search_knowledge` 도구 결과에서 `rag_top1_score`, `rag_sources_count`를 추출해 직전 user 메시지의 `chat_messages` 컬럼에 UPDATE (`chat_agent.py run_react_stream` 내 score 캡처 로직)
  - `services/qdrant_guides.py`는 ADR-011 Hybrid 통일 이후 log-analyzer `/guides/*` HTTP 프록시로 동작 (Qdrant 직접 호출 폐지). 기존 함수 시그니처(`index_guide`, `delete_guide_index`, `search_guides` 등)는 호환 유지. `update_image_count`는 noop. `routes/guides.py`(가이드 CRUD)에서 import 그대로 사용 가능
  - `routes/chat.py`의 가이드 사전 검색 코드(`search_guides` 호출 + 이미지 meta 이벤트)는 제거됨. LLM이 ReAct 루프에서 `qdrant_search_guide`로 능동 검색

### 예방적 패턴 감지
- `MetricHourlyAggregation.llm_prediction` 필드가 있는 최근 8시간 집계 항목을 조회
- `llm_severity` 가 warning/critical인 항목만 포함
- 대시보드 카드에 "예방 N건" 뱃지 표시 + 상세 페이지에 트렌드/예측 내용 노출
- 데이터 생성 주체: log-analyzer `_hourly_agg_scheduler()` → LLM 이상 분석 → `llm_trend` / `llm_prediction` 저장

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
  → LogAnalysisHistory 생성 (error_message NULL=성공, 값=LLM/분석 실패 사유, ADR-002)
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
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | Access Token 만료 시간(분) |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `1` | Refresh Token 만료 시간(일) |
| `COOKIE_SECURE` | `false` | HTTPS 환경에서 `true`로 설정 |
| `PROMETHEUS_URL` | `""` | Prometheus HTTP API URL (설정 시 Phase F 자동 분석 활성화) |
| `PROMETHEUS_ANALYZE_INTERVAL_SECONDS` | `300` | Prometheus 이상 감지 주기(초) |
| `PROM_ALERT_CPU_THRESHOLD` | `70.0` | CPU warning 임계치(%) |
| `PROM_ALERT_CPU_CRITICAL` | `90.0` | CPU critical 판정 임계치(%) |
| `PROM_ALERT_MEM_THRESHOLD` | `70.0` | 메모리 warning 임계치(%) |
| `PROM_ALERT_MEM_CRITICAL` | `90.0` | 메모리 critical 판정 임계치(%) |
| `PROM_ALERT_HTTP_SLOW_MS` | `3000.0` | HTTP 응답 지연 임계치(ms) |
| `PROM_ALERT_LOG_ERROR_RATE` | `5.0` | 로그 에러 급증 임계치(건/분) |
| `PROM_ALERT_DISK_IO_MS` | `200.0` | 디스크 I/O 응답시간 임계치(ms) |
| `PROM_NET_MAX_MBPS` | `1000.0` | NIC 최대 속도 Mbps (1Gbps 기본). TX/RX 각각 독립 판정 |
| `PROM_ALERT_NET_THRESHOLD_PCT` | `70.0` | 네트워크 대역폭 warning % |
| `PROM_ALERT_NET_CRITICAL_PCT` | `90.0` | 네트워크 대역폭 critical % |
| `PROM_ALERT_COOLDOWN_SECONDS` | `1800` | prometheus_analyzer host별 쿨다운(초, 기본 30분) |
| `ENCRYPTION_KEY` | 없음 (필수) | 공통 Fernet 대칭키 — DB 비밀번호 및 챗봇 executor 자격증명 암호화에 사용. 미설정 시 `db_collection_loop` 비활성화. 생성: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `DB_COLLECT_INTERVAL_SECS` | `60` | DB 메트릭 수집 주기(초). 하위 호환: `ORACLE_COLLECT_INTERVAL_SECS`도 인식 |
| `CHAT_ATTACHMENT_DIR` | `/var/lib/synapse-v/chat-attachments` | 챗봇 메시지 첨부 이미지 저장 루트 |
| `CHAT_ATTACHMENT_MAX_MB` | `10` | 첨부 이미지 단일 최대 크기(MB) |
| `CHAT_MAX_ITERS` | `5` | ReAct 오케스트레이터 도구 호출 반복 한도 |
| `CHAT_HISTORY_WINDOW` | `20` | LLM 프롬프트에 주입할 최근 메시지 N턴 |
| `KNOWLEDGE_DOCS_DIR` | `/app/synapse/knowledge-docs` | 업로드된 문서 저장 루트 디렉터리 (V1 RAG) |
| `OAUTH_PRIVATE_KEY_PATH` | 없음 (필수) | RSA private key PEM 파일 경로. `admin-api/secrets/` 이미지 번들 → 컨테이너 `/app/secrets/oauth_private.pem` 고정. 로컬: 절대경로 지정 |
| `OAUTH_PUBLIC_KEY_PATH` | 없음 (필수) | RSA public key PEM 파일 경로 (JWKS 노출용). 이미지 번들 → `/app/secrets/oauth_public.pem`. 로컬: 절대경로 지정 |
| `OAUTH_ISSUER` | `http://localhost:8080` | OIDC issuer URL (id_token `iss` 클레임 + discovery 메타데이터) |

## DB 초기화

- **개발/자동**: lifespan에서 `Base.metadata.create_all` 실행 (앱 시작 시 테이블 자동 생성)
- **운영 권장**: `configs/postgres/init.sql` 직접 실행 (정식 스키마 파일은 `main-server/configs/postgres/init.sql`)
  ```bash
  docker exec -i synapse-postgres psql -U synapse -d synapse < configs/postgres/init.sql
  ```

---

## 개발 주의사항 (실수 방지)

### Teams Adaptive Card — 카드 액션 (Wave 2B 변경)

`adaptive_card_builder.py`의 `build_metric_alert_card` / `build_log_analysis_card` 두 함수 모두
**"해결책 등록" 버튼이 제거됨 (Wave 2B)**. 현재 액션은 `incident_id`가 있을 때만 표시:

```python
actions: list[dict] = [
    *([{
        "type": "Action.OpenUrl",
        "title": "인시던트 보기",
        "url": f"{_FRONTEND_EXTERNAL_URL}/incidents/{incident_id}",
    }] if incident_id else []),
]
```

- `incident_id`가 NULL인 경우 `actions` 블록 자체가 비어 안내 카드만 발송됨
- `FRONTEND_EXTERNAL_URL` 환경변수로 버튼 URL 구성 (기본: `http://localhost:3001`)
- `alert_history_id`/`point_id` 파라미터는 함수 시그니처에 유지되나 액션에 더 이상 사용되지 않음

### TeamsNotifier 함수 시그니처 (현재)

```python
# send_metric_alert
async def send_metric_alert(
    self, webhook_url, alert, system_display_name, contacts,
    anomaly_type=None, similarity_score=None, has_solution=None,
    similar_incidents=None, point_id=None,
    alert_history_id=None,  # ← Teams 카드 URL에 포함되는 alert_history.id
) -> bool

# send_log_analysis_alert
async def send_log_analysis_alert(
    self, webhook_url, system_display_name, system_name, instance_role,
    analysis, log_sample, contacts,
    anomaly_type=None, similarity_score=None, has_solution=None,
    similar_incidents=None, point_id=None,
    alert_history_id=None,  # ← 동일
) -> bool
```

새 기능 추가 시 두 함수를 함께 수정해야 대칭이 유지됩니다.

### resolved 알림 처리

`alerts.py`에서 `resolved` 상태도 처리합니다. **원본 firing row 의 `resolved_at` 컬럼만 업데이트** 하고 별도 row 는 생성하지 않습니다 (과거 `alert_type="metric_resolved"` 로 별도 row 저장 방식 아님).

**매칭 키**: `(system_id, alertname, instance_role, severity)` 4-tuple (cooldown 키와 대칭, `host` 는 제외).
- 같은 그룹 내 다중 host firing 행을 한 번에 복구 처리 → Teams 복구 카드 1장으로 수렴
- 매칭되는 un-resolved 행이 **없으면** Teams/WebSocket 모두 스킵 (`status=resolved_duplicate_skipped`) — Alertmanager 가 group_interval 경계나 flapping 으로 같은 그룹 resolved 를 여러 번 보낼 때 중복 카드 방지

```python
# 현재 코드 요약 (alerts.py)
if alert.status == "resolved":
    originals = await db.execute(
        select(AlertHistory)
        .where(AlertHistory.alertname == alertname)
        .where(AlertHistory.system_id == system_id)
        .where(AlertHistory.instance_role == instance_role)
        .where(AlertHistory.severity == severity)
        .where(AlertHistory.alert_type == "metric")
        .where(AlertHistory.resolved_at.is_(None))
    )
    original_rows = originals.scalars().all()
    if not original_rows:
        # 중복 resolved → Teams 스킵
        continue
    for row in original_rows:
        row.resolved_at = datetime.now(timezone.utc).replace(tzinfo=None)
    # 이후 Teams send_recovery_alert 1회 + WebSocket 브로드캐스트 1회
```

**판정 쿼리 반영**: `dashboard.py` `_get_system_health` 와 `/systems/{id}/detailed` 는 반드시 `AlertHistory.resolved_at.is_(None)` 필터를 포함해야 복구된 알림이 10분 동안 "위험" 으로 표시되지 않습니다.

테스트 작성 시: `status=resolved` 알림은 `processed[0]["status"] == "resolved"` 반환을 검증하고, 원본 row 의 `resolved_at` 이 세팅되는지 확인해야 합니다. 중복 resolved 시나리오는 `processed[0]["status"] == "resolved_duplicate_skipped"` 로 검증 (`test_receive_resolved_duplicate_skipped` 참고).

### 피드백 등록 흐름 — Wave 2A (인시던트 단위)

Wave 2A 이후 피드백은 인시던트 단위로 관리됨. 승인 워크플로우 포함.

```
인시던트 상세 페이지
  → POST /api/v1/incidents/{incident_id}/feedback
    → alert_feedback insert (status=pending, approver_contact_id 지정)
    → 지정 승인자에게 알림

승인:
  → POST /api/v1/incidents/{incident_id}/feedback/{id}/approve
    → OCR 완료 확인 (425 if processing)
    → status=approved + log-analyzer /incident/embed로 Qdrant upsert
    → feedback.qdrant_point_id 저장

반려:
  → POST /api/v1/incidents/{incident_id}/feedback/{id}/reject
    → status=rejected + rejection_reason 저장 + Teams 알림

재등록 (수정):
  → POST /api/v1/incidents/{incident_id}/feedback/{id}/resubmit
    → status=pending + revision_count 증가 + revision_reason 갱신(선택, 매 회차마다 덮어씀)
    → approved → 수정 시 approved_at/approved_by 초기화 → 승인자 재알림 (Teams 카드에 재등록 사유 노출)
```

**첨부파일**: `POST /api/v1/feedback/upload` (staging 임시 업로드, 피드백 생성/재등록 시 정식 경로로 이동)

**`alert_feedback_attachments` 주요 컬럼**:
- `ocr_status`: `pending` | `processing` | `done` | `failed`
- `ocr_progress`: 0~100 정수. SSE 스트리밍 OCR 진행률 실시간 갱신 (`_run_ocr_for_attachment` 백그라운드 태스크가 `AsyncSessionLocal`로 commit). 마이그레이션: `configs/postgres/migrations/20260508_add_ocr_progress.sql`
- OCR은 피드백 생성/재등록/재시도 모두 `asyncio.create_task(_run_ocr_remaining_detached(feedback_id))` 패턴으로 HTTP 응답과 독립적으로 실행됨

- HTML 폼(`GET /api/v1/feedback/form`)과 n8n WF3은 제거됨
- 자세한 결정 배경 + 이관 이력은 `.claude/memory/adrs.md` ADR-006 참조
- Wave 2A 신규 파일: `services/incident_postmortem_client.py` (log-analyzer embed/search/ocr 클라이언트)

### 해결책 검색 API — Wave 2A 이후

- `GET /api/v1/incidents/feedback/search?q=&system_id=&severity=&limit=` ← **현행 엔드포인트**
  - log-analyzer `/incident/search` 프록시 (Qdrant Hybrid Search)
  - 승인된 피드백만 검색됨

- `GET /api/v1/feedback/search` → **410 Gone** (Wave 2A에서 이전됨)
