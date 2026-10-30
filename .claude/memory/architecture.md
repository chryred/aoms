# Synapse-V 전체 아키텍처 + 서비스 연결 맵

백화점 통합 모니터링 시스템. 폐쇄망 환경 RedHat 8.9 서버에 Docker Compose로 운영.

## 전체 아키텍처

```
외부 세계
  └── Teams (알림 수신)
  └── LLM API (내부망 AI 분석)

[ Server A — Main Server ]                [ Server B — AI/Vector ]
  Prometheus  ──scrape──▶  대상 서버들       Ollama (paraphrase-multilingual 임베딩)
  Alertmanager ──webhook──▶ admin-api        Qdrant (벡터 DB)
  Grafana     ──read───▶   Prometheus
  admin-api   ──read───▶   PostgreSQL
              ──http───▶   Teams Webhook
              ◀──http───   log-analyzer
  log-analyzer ──query──▶  Prometheus (log_error_total 메트릭)
               ──http──▶   admin-api
               ──http──▶   LLM API
               ──http──▶   Ollama (Server B)
               ──http──▶   Qdrant (Server B)
  frontend    ──http───▶   admin-api (React `/feedback/submit` → `POST /api/v1/feedback`)
  PostgreSQL  (admin-api 전용; gateway 는 agent_instances/systems 읽기 + agent_commands 폴링)

[ WAS 서버들 ]  Agent-T (Java 에이전트, JDK 1.6~21)
  Agent-T ──http POST /t/v1/batch (Bearer 토큰, 1초 배치)──▶ agent-t-gateway (Server A :8330)
  agent-t-gateway ──HTTP JSONEachRow──▶ ClickHouse (agent_t DB, 트랜잭션 7일)
                  ──remote write(5초 집계)──▶ Prometheus
                  ──SSE /t/v1/stream, snapshot──▶ frontend (nginx `/t/` 프록시)
  admin-api ──HTTP 조회──▶ ClickHouse (`/api/v1/apm/*`) / log-analyzer ──▶ ClickHouse (trace_summarizer)
```

---

## 서비스 연결 맵

### admin-api (포트 8080)

**인바운드:**
- `Alertmanager` → `POST /api/v1/alerts/receive` — 메트릭 알림 수신
- `log-analyzer` → `POST /api/v1/analysis` — LLM 분석 결과 수신
- `log-analyzer` → `GET /api/v1/systems` — 시스템 목록 조회
- `log-analyzer` → `GET /api/v1/systems/{id}/contacts` — 담당자 조회

**아웃바운드:**
- `PostgreSQL:5432` — 모든 데이터 영속
- `Teams Webhook` (외부) — Adaptive Card 알림 발송

**환경변수:**
```
DATABASE_URL        postgresql+asyncpg://aoms:{DB_PASSWORD}@postgres:5432/aoms
TEAMS_WEBHOOK_URL   전역 Teams 알림 URL (시스템별 URL 없을 때 폴백)
LLM_API_URL         내부 LLM API (admin-api prometheus_analyzer도 사용, ADR-001)
LOG_ANALYZER_URL    http://log-analyzer:8000
```

---

### log-analyzer (포트 8000)

**인바운드:**
- 내부 스케줄러 (`_scheduler`, `_hourly_agg_scheduler` 등) — 주기별 자동 실행 (n8n 의존 제거, ADR-006)
- `trace_summarizer` — ClickHouse(`agent_t.tx_summary`) 느린·에러 트랜잭션 요약을 LLM 프롬프트에 주입 (Agent-T, ADR-022)
- `POST /analyze/trigger` — 수동 트리거 (디버그/운영용)

**아웃바운드:**
- `Prometheus:9090` — `log_error_total` 메트릭 쿼리 (Loki 제거됨)
- `admin-api:8080` — 시스템 목록, 담당자 조회 / 분석 결과 POST
- `LLM API` (외부) — 로그 분석 프롬프트 호출
- `Ollama:11434` (Server B) — paraphrase-multilingual 텍스트 임베딩 (ADR-003)
- `Qdrant:6333` (Server B) — `log_incidents` 컬렉션 벡터 저장/조회

**환경변수:**
```
PROMETHEUS_URL              http://prometheus:9090
ADMIN_API_URL               http://admin-api:8080
LLM_API_URL                 내부 LLM API 엔드포인트
LLM_API_KEY                 기본 API 키 (담당자별 키 미등록 시 사용)
LLM_AGENT_CODE              기본 에이전트 코드
OLLAMA_URL                  http://{server-b}:11434
EMBED_MODEL                 paraphrase-multilingual (ADR-003)
QDRANT_URL                  http://{server-b}:6333
ANALYSIS_INTERVAL_SECONDS   300
```

---

### PostgreSQL (포트 5432)

**테이블 구조:**

| 테이블 | 사용 서비스 | 설명 |
|---|---|---|
| `systems` | admin-api, log-analyzer | 모니터링 대상 시스템. `system_name` = Prometheus label |
| `contacts` | admin-api | 담당자. `teams_upn` = Teams @mention, `llm_api_key` = 담당자별 AI 비용 분리 |
| `system_contacts` | admin-api | 시스템↔담당자 N:M |
| `alert_history` | admin-api | 알림 발송 이력. `alert_type`: `metric` / `metric_resolved` / `log_analysis`. `error_message` 컬럼(ADR-002) |
| `log_analysis_history` | admin-api, log-analyzer | LLM 분석 결과. `error_message`·`model_used` 컬럼(ADR-001/002) |
| `alert_cooldown` | admin-api | 5분 중복 발송 방지. key: `{system}:{role}:{alertname}:{severity}` |
| `system_collector_config` | admin-api (Phase 5) | 수집기 유연 레지스트리. collector_type + metric_group 등록 |
| `metric_hourly_aggregations` | admin-api (Phase 5) | 1시간 집계 + LLM 이상 분석 결과 |
| `metric_daily_aggregations` | admin-api (Phase 5) | 1일 집계 롤업 |
| `metric_weekly_aggregations` | admin-api (Phase 5) | 7일 집계 롤업 |
| `metric_monthly_aggregations` | admin-api (Phase 5) | 월/분기/반기/연간 집계. `period_type`으로 구분 |
| `aggregation_report_history` | admin-api (Phase 5) | Teams 주기별 리포트 발송 이력 |
| `agent_instances` | admin-api (Phase 6) | 수집기 인스턴스 메타정보. `ssh_username` 저장, password 저장 금지 |
| `agent_install_jobs` | admin-api (Phase 6) | 비동기 설치 Job 이력. status: pending/running/done/failed |
| `users` | admin-api (Phase 0) | 프론트엔드 인증 사용자. role: admin/operator. is_approved |
| `apm_dashboards` | admin-api (Agent-T) | APM 실시간 대시보드 레이아웃/필터. 소유자별 + 공용 기본 1개 |
| `agent_commands` | admin-api (Agent-T) | Agent-T 원격 명령 큐(스레드 덤프). gateway 가 폴링·전달 |

---

### n8n (Agent-T 도입으로 컨테이너 제거 · 보류 워크플로우 JSON 만 보존)

> 과거 WF1~WF12 워크플로우 대부분이 log-analyzer 내부 스케줄러 / admin-api 직접 호출 / frontend 직결로 이관·제거됨 (ADR-006).
> 컨테이너는 ADR-022 에서 제거(WF4/WF5 는 향후 log-analyzer 스케줄러로 이관 예정, JSON 은 `main-server/n8n-workflows/` 보존).

| WF | 트리거 | 설명 | 상태 |
|---|---|---|---|
| WF1 | 5분 주기 | 로그 분석 트리거 | **이관** → log-analyzer `_scheduler()` (JSON 제거) |
| WF2 | Alertmanager webhook | 메트릭 벡터 검색 | **이관** → admin-api가 log-analyzer `/metric/similarity` 직접 호출 (JSON 제거) |
| WF3 | Teams 피드백 버튼 | 해결책 등록 | **이관** → frontend `/feedback/submit` + admin-api `POST /api/v1/feedback` (JSON 제거) |
| WF4 | 매일 08:00 | 일일 장애 리포트 Teams 발송 | **보류** — JSON 파일 `main-server/n8n-workflows/WF4-daily-report.json` 보존. `active:false` |
| WF5 | 30분 주기 | 반복 이상 에스컬레이션 | **보류** — JSON 파일 `main-server/n8n-workflows/WF5-escalation.json` 보존. `active:false` |
| WF6 | 매 시간 | 1시간 메트릭 집계 | **이관** → log-analyzer `_hourly_agg_scheduler()` (JSON 제거) |
| WF7 | 매일 07:30 | 일별 롤업 | **이관** → log-analyzer `_daily_agg_scheduler()` (JSON 제거) |
| WF8 | 매주 | 주간 리포트 | **이관** → log-analyzer `_weekly_agg_scheduler()` (JSON 제거) |
| WF9 | 매월 | 월간 리포트 | **이관** → log-analyzer `_monthly_agg_scheduler()` (JSON 제거) |
| WF10 | 분기/반기/연간 | 장기 집계 리포트 | **이관** → log-analyzer `_longperiod_agg_scheduler()` (JSON 제거) |
| WF11 | 4시간 주기 | 프로액티브 트렌드 알림 | **이관** → log-analyzer `_trend_agg_scheduler()` (JSON 제거) |
| WF12 | 수동/배포 시 1회 | 집계 Qdrant 컬렉션 초기화 | **이관** → `POST /aggregation/collections/setup` 직접 호출 (JSON 제거) |
