# Synapse-V — Claude 컨텍스트 가이드

백화점 통합 모니터링 시스템(Synapse-V). 폐쇄망 환경의 RedHat 8.9 서버에 Docker Compose로 운영된다.

---

## 전체 아키텍처

```
외부 세계
  └── Teams (알림 수신)
  └── LLM API (내부망 AI 분석)

[ Server A — Main Server ]                [ Server B — AI/Vector ]
  Prometheus  ──scrape──▶  대상 서버들       Ollama (bge-m3 임베딩)
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
  n8n          ──trigger──▶ log-analyzer (5분 주기)
               ──webhook──▶ admin-api (메트릭 벡터 분석)
  PostgreSQL  (admin-api, n8n 공용)
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
LLM_API_URL         내부 LLM API (현재 미사용 — log-analyzer가 직접 호출)
LOG_ANALYZER_URL    http://log-analyzer:8000
```

---

### log-analyzer (포트 8000)

**인바운드:**
- `n8n` → `POST /analyze/trigger` — 5분 주기 분석 트리거
- 내부 스케줄러 — `ANALYSIS_INTERVAL_SECONDS`마다 자동 실행

**아웃바운드:**
- `Loki:3100` — ERROR/WARN/FATAL 로그 조회 (최근 5분, Loki 3.x API)
- `admin-api:8080` — 시스템 목록, 담당자 조회 / 분석 결과 POST
- `LLM API` (외부) — 로그 분석 프롬프트 호출
- `Ollama:11434` (Server B) — bge-m3 텍스트 임베딩
- `Qdrant:6333` (Server B) — `log_incidents` 컬렉션 벡터 저장/조회

**환경변수:**
```
LOKI_URL                    http://loki:3100
ADMIN_API_URL               http://admin-api:8080
LLM_API_URL                 내부 LLM API 엔드포인트
LLM_API_KEY                 기본 API 키 (담당자별 키 미등록 시 사용)
LLM_AGENT_CODE              기본 에이전트 코드
OLLAMA_URL                  http://{server-b}:11434
EMBED_MODEL                 bge-m3
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
| `alert_history` | admin-api | 알림 발송 이력. `alert_type`: `metric` / `metric_resolved` / `log_analysis` |
| `log_analysis_history` | admin-api, log-analyzer | LLM 분석 결과 저장 |
| `alert_cooldown` | admin-api | 5분 중복 발송 방지. key: `{system}:{role}:{alertname}:{severity}` |
| `system_collector_config` | admin-api (Phase 5) | 수집기 유연 레지스트리. collector_type + metric_group 등록 |
| `metric_hourly_aggregations` | admin-api (Phase 5) | 1시간 집계 + LLM 이상 분석 결과 |
| `metric_daily_aggregations` | admin-api (Phase 5) | 1일 집계 롤업 |
| `metric_weekly_aggregations` | admin-api (Phase 5) | 7일 집계 롤업 |
| `metric_monthly_aggregations` | admin-api (Phase 5) | 월/분기/반기/연간 집계. `period_type`으로 구분 |
| `aggregation_report_history` | admin-api (Phase 5) | Teams 주기별 리포트 발송 이력 |
| n8n 스키마 | n8n | n8n 워크플로우 데이터 (`DB_POSTGRESDB_SCHEMA=n8n`) |

---

### n8n (포트 5678)

> **WF1, WF6~WF11은 log-analyzer 내부 스케줄러로 이관됨** — n8n은 WF2/WF3/WF4/WF5/WF12만 운영.

| WF | 파일 | 트리거 | 설명 | 상태 |
|---|---|---|---|---|
| WF1 | WF1-log-analysis-trigger | 5분 주기 | `POST log-analyzer/analyze/trigger` | **이관** → log-analyzer `_scheduler()` |
| WF2 | WF2-metric-vector-search | Alertmanager webhook | `POST log-analyzer/metric/similarity` → admin-api 알림 | 운영 중 |
| WF3 | WF3-feedback-processing | Teams 피드백 버튼 | 해결책 등록 → Qdrant 업데이트 | 운영 중 |
| WF4 | WF4-daily-report | 매일 08:00 | 전일 집계 요약 Teams 발송 | 운영 중 |
| WF5 | WF5-escalation | 30분 주기 | 미확인 알림 반복 에스컬레이션 | 운영 중 |
| WF6 | WF6-hourly-metric-aggregation | 매 시간 | Prometheus 집계 → LLM 이상 감지 → Qdrant 저장 → 프로액티브 알림 | **이관** → log-analyzer `_hourly_agg_scheduler()` |
| WF7 | WF7-daily-aggregation | 매일 07:30 | 1시간 집계 → 일별 롤업 → admin-api 저장 | **이관** → log-analyzer `_daily_agg_scheduler()` |
| WF8 | WF8-weekly-report | 매주 | 7일 집계 → Teams 주간 리포트 | **이관** → log-analyzer `_weekly_agg_scheduler()` |
| WF9 | WF9-monthly-report | 매월 | 월간 집계 → Teams 월간 리포트 | **이관** → log-analyzer `_monthly_agg_scheduler()` |
| WF10 | WF10-long-period-report | 분기/반기/연간 | 장기 집계 리포트 | **이관** → log-analyzer `_longperiod_agg_scheduler()` |
| WF11 | WF11-proactive-trend-alert | 주기적 | trend-alert 조회 → 임박 장애 프로액티브 알림 | **이관** → log-analyzer `_trend_agg_scheduler()` |
| WF12 | WF12-aggregation-collection-setup | 수동/배포 시 1회 | `POST log-analyzer/aggregation/collections/setup` — 집계 컬렉션 초기화 | 운영 중 |

---

## 코드 위치

```
aoms/
├── CLAUDE.md                          # 이 파일
├── README.md                          # 프로젝트 전체 구현 워크플로우
├── Makefile                           # 로컬 개발 단축 명령어
├── build-images.sh                    # 운영 Docker 이미지 빌드 스크립트
├── main-server/
│   ├── README.md                      # 개발자 가이드 (로컬 실행 + 배포)
│   ├── docker-compose.yml             # 운영용
│   ├── docker-compose.dev.yml         # 로컬 개발용 (인프라만)
│   ├── .env.example                   # 운영 환경변수 템플릿
│   ├── .env.local.example             # 로컬 환경변수 템플릿
│   ├── configs/dev/                   # 로컬 최소 설정 파일
│   └── services/
│       ├── admin-api/
│       │   ├── CLAUDE.md              # admin-api 상세 가이드
│       │   ├── main.py                # FastAPI 앱, lifespan (테이블 자동생성)
│       │   ├── database.py            # DB 엔진, get_db() 의존성
│       │   ├── models.py              # SQLAlchemy ORM (12개 테이블)
│       │   ├── schemas.py             # Pydantic 스키마
│       │   ├── routes/                # systems, contacts, alerts, analysis, feedback
│       │   │                          # + collector_config, aggregations, reports (Phase 5)
│       │   ├── services/
│       │   │   ├── cooldown.py        # 5분 중복 알림 방지
│       │   │   └── notification.py    # TeamsNotifier (Adaptive Card)
│       │   └── tests/                 # pytest, SQLite in-memory
│       └── log-analyzer/
│           ├── CLAUDE.md              # log-analyzer 상세 가이드
│           ├── main.py                        # FastAPI 앱, 내부 스케줄러(WF1/WF6~WF11 대체), 모든 엔드포인트
│           ├── analyzer.py                    # 핵심 분석 로직 (Loki 조회 → LLM 호출 → admin-api 전송)
│           ├── aggregation_processor.py       # Phase 5: WF6~WF11 집계 로직 (asyncio semaphore=20 병렬)
│           ├── vector_client.py               # log_incidents / metric_baselines 컬렉션 관리
│           └── aggregation_vector_client.py   # metric_hourly_patterns / aggregation_summaries (Phase 5)
└── sub-server/
    └── docker-compose.yml             # Server B: Ollama + Qdrant
```

---

## 포트 맵

### Server A — Main Server

| 서비스 | 개발 (호스트 노출) | 운영 (호스트 노출) | 비고 |
|---|---|---|---|
| admin-api | `8080` (uvicorn 직접) | `8080` | Swagger: `/docs` |
| log-analyzer | `8000` (uvicorn 직접) | `8000` | |
| frontend | `3001` (Docker, nginx / npm run dev) | `3001` (Docker, nginx) | |
| PostgreSQL | `5432` | `5432` | |
| Prometheus | `9090` | `9090` | |
| Alertmanager | `9093` | `9093` | |
| Loki | `3100` | `3100` | |
| Grafana | — (없음) | `3000` | |
| n8n | `5678` | `5678` | |
| Qdrant | `6333` (HTTP), `6334` (gRPC) | — (없음, Server B) | |
| Ollama | `11434` | — (없음, Server B) | |

> 개발 환경에서 `frontend` 컨테이너의 `/api/` → `admin-api`, `/analyze/` + `/aggregation/` → `log-analyzer`는  
> `extra_hosts`로 호스트 머신을 향한다 (포트는 nginx.conf에 하드코딩 — 8080/8000).

### Server B — AI/Vector

| 서비스 | 포트 | 비고 |
|---|---|---|
| Ollama | `11434` | bge-m3 임베딩 모델 |
| Qdrant | `6333` (HTTP), `6334` (gRPC) | 벡터 DB |

---

## 핵심 데이터 흐름

### 메트릭 알림 흐름
```
Prometheus 수집 → alert_rules.yml 평가
  → Alertmanager (firing)
  → POST admin-api/api/v1/alerts/receive
    → system_name으로 시스템 + 담당자 조회
    → 5분 쿨다운 체크
    → TeamsNotifier.send_metric_alert()
    → alert_cooldown upsert + alert_history 저장
```

### LLM 로그 분석 흐름
```
log-analyzer 내부 스케줄러 (ANALYSIS_INTERVAL_SECONDS마다, 기본 5분)
  → analyzer.run_analysis()
    → admin-api에서 활성 시스템 목록 조회
    → Loki에서 시스템별 최근 5분 ERROR/WARN/FATAL 수집
    → PII 마스킹 (카드번호, 주민번호, 전화번호, 이메일)
    → (Phase 4b) normalize → Ollama 임베딩 → Qdrant 유사도 검색
    → 유사 이력 + 해결책으로 LLM 프롬프트 강화
    → 담당자별 llm_api_key로 LLM API 호출
    → POST admin-api/api/v1/analysis (결과 전송)
      → warning/critical이면 TeamsNotifier.send_log_analysis_alert()
```

### 벡터 유사도 분류
```
anomaly type:
  duplicate  — score ≥ 0.95 → Teams 알림 생략
  recurring  — score ≥ 0.85 → "반복 이상" 강조 알림
  related    — score ≥ 0.70 → "유사 이상" 알림
  new        — score < 0.70 → "신규 이상" 알림
```

---

## 개발 시 주의사항

### `system_name` 일관성
Prometheus label의 `system_name`과 PostgreSQL `systems.system_name`이 반드시 일치해야 한다. 불일치 시 알림은 수신되지만 담당자 조회 실패 → Teams 알림 미발송.

### `instance_role` 의미 — HA 이중화 식별자
`instance_role`은 에이전트 타입(infra/was)이 아닌 **이중화 인스턴스를 식별**하는 값이다.

```
system_name = "customer_experience"   ← DB systems.system_name
instance_role = "was1"                 ← HA 이중화 구분 (was1/was2, db-primary/db-standby)
host = "10.0.1.5"                      ← 물리 서버 IP
```

- 같은 서버의 동일 서비스 이중화: `was1`, `was2`
- DB HA: `db-primary`, `db-standby`
- 단일 인스턴스: `main` 또는 그냥 비워두면 기본값 `default`

### 다중 로그 소스 — `[[log_monitor]]` 배열
한 에이전트에서 여러 로그 파일을 각기 다른 `log_type` 라벨로 수집할 때 `[[log_monitor]]` 섹션을 여러 개 정의한다.

```toml
[[log_monitor]]
paths = ["/home/jeus/logs/JeusServer.log"]
keywords = ["ERROR", "Fatal", "Exception"]
log_type = "jeus"

[[log_monitor]]
paths = ["/opt/app/logs/*.log"]
keywords = ["ERROR", "CRITICAL"]
log_type = "app"
```

**담당자/채널 분리**가 필요한 경우 (서비스별 Teams webhook, 별도 LLM 비용):
→ 서비스마다 별도 `system_name`을 DB에 등록하고 에이전트 인스턴스도 분리.

**같은 팀이 여러 로그 파일 수집**만 필요한 경우:
→ 하나의 에이전트에 `[[log_monitor]]` 다중 정의.

### 담당자별 LLM API 키
`contacts.llm_api_key`가 있으면 해당 키로 LLM 호출, 없으면 환경변수 `LLM_API_KEY` 사용. AI 비용을 시스템 담당자별로 분리 청구하는 구조.

### Teams Webhook URL 우선순위
`systems.teams_webhook_url` (시스템별) → `TEAMS_WEBHOOK_URL` 환경변수 (전역). 시스템별 알림 채널 분리 가능.

### 로그 수집 에이전트 — synapse_agent (Rust)
Phase 6에서 Grafana Alloy + node_exporter + Loki를 **synapse_agent 단일 바이너리**로 대체.
로그는 Loki로 push하지 않고 `log_error_total` Prometheus 메트릭으로 Remote Write한다.

- **설치**: admin-api `/api/v1/agents/install` → config.toml SFTP 업로드 → nohup 실행
- **설정 파일**: `config.toml` (`[[log_monitor]]` 다중 섹션으로 여러 로그 소스 지정)
- **WAL**: `/var/lib/synapse-agent/wal` (2시간 버퍼)
- **라벨**: `system_name`, `instance_role`, `host`, `log_type`, `level`, `service_name`, `template`
- **필터링**: `[[log_monitor]].keywords` 기반 AhoCorasick 매칭 → PII 마스킹 → `log_error_total` 메트릭

### 폐쇄망 배포
- Docker 이미지: Mac에서 `build-images.sh`로 `linux/amd64` 빌드 → `.tar.gz` 저장 → scp 전송 → `docker load`
- synapse_agent 바이너리: `cargo build --release --target x86_64-unknown-linux-musl` → scp 전송
- Python 패키지: `requirements/` 디렉토리에 버전 고정. 운영 Dockerfile은 `prod.txt`만 설치.

### 로컬 개발
```bash
make dev-up     # 인프라 시작
make run-api    # admin-api 핫리로드 (포트 8080)
make run-analyzer  # log-analyzer 핫리로드 (포트 8000)
make test-api   # 단위 테스트 (인프라 불필요 — SQLite in-memory)
```

---

## Claude 작업 규칙

### 개선 작업 워크플로우
1. **CLAUDE.md 업데이트** — 개선 내용 중 아키텍처 변경, 새 기능, 설정 변경 등 프로젝트 컨텍스트에 해당하는 내용은 관련 폴더의 CLAUDE.md에 반드시 반영한다.
2. **테스트 후 완료** — 모든 개선 작업은 테스트를 실행하고 통과 확인 후 완료 처리한다. 테스트 없이 완료 선언 금지.
3. **CLAUDE.md 저장 위치** — 내용에 따라 해당 폴더의 CLAUDE.md에 나눠서 저장한다.
   - 전체 아키텍처/공통: `aoms/CLAUDE.md`
   - admin-api 관련: `main-server/services/admin-api/CLAUDE.md`
   - log-analyzer 관련: `main-server/services/log-analyzer/CLAUDE.md`
   - 인프라/배포 관련: `main-server/CLAUDE.md`

---

## Claude 반복 실수 방지 목록

> **이 섹션은 Claude가 과거에 반복한 실수를 기록한다. 작업 전 반드시 확인할 것.**

### [일반] 불필요한 추상화 / 과도한 기능 추가 금지
- 요청하지 않은 helper 함수, 유틸리티, 설정 옵션을 추가하지 않는다.
- 유사한 코드 3줄이 생겨도 섣불리 공통 함수로 추출하지 않는다.
- 요청된 기능 범위만 정확히 구현하고, "개선 사항"을 임의로 끼워 넣지 않는다.

### [일반] 테스트 없이 완료 선언 금지
- 코드 변경 후 반드시 `make test-api` 또는 해당 서비스의 테스트를 실행하고 통과 확인 후 완료 처리한다.
- 테스트가 실패하면 완료라고 말하지 않는다.

### [일반] CLAUDE.md 업데이트 누락 금지
- 아키텍처 변경, 새 엔드포인트, 새 환경변수, 새 테이블, 설정 변경이 생기면 해당 폴더의 CLAUDE.md를 **코드와 동시에** 업데이트한다.
- 작업 후 "CLAUDE.md도 업데이트해야 하나요?" 라고 묻지 않는다 — 스스로 판단해서 반영한다.

### [Python/FastAPI] import 순서 / 순환 참조
- 새 모듈 추가 시 순환 import가 발생하지 않는지 먼저 확인한다.
- `from .models import Foo` 패턴과 `from models import Foo` 패턴을 혼용하지 않는다 (프로젝트 전체 일관성 유지).

### [Python/FastAPI] async 일관성
- `async def` 엔드포인트에서 동기 I/O 블로킹 함수를 직접 호출하지 않는다.
- SQLAlchemy는 `asyncpg` 드라이버 + `AsyncSession` 패턴을 일관되게 사용한다.

### [DB / 마이그레이션] 테이블 자동 생성 의존 금지
- `main.py` lifespan의 `create_all()`은 개발 편의용이다. 운영 스키마 변경은 직접 SQL 또는 Alembic을 사용한다.
- 새 컬럼/테이블 추가 시 운영 DB에 `ALTER TABLE` / `CREATE TABLE` SQL을 별도 제공한다.

### [Frontend / React] 디자인 시스템 일탈 금지
- 뉴모피즘 디자인 시스템(`design-system.md` 또는 기존 컴포넌트 참고)을 벗어난 스타일을 임의로 추가하지 않는다.
- 새 색상, 그림자, 폰트 크기를 하드코딩하지 않고 CSS 변수(`--var-name`)를 사용한다.

### [n8n 워크플로우] JSON 직접 편집 시 ID 충돌 주의
- 워크플로우 JSON을 복사·수정할 때 노드 `id` 필드가 중복되지 않도록 확인한다.
- `credentials` 블록의 ID는 실제 n8n 인스턴스의 크리덴셜 ID와 일치해야 한다 — 예시 ID를 그대로 두지 않는다.

### [보안] 환경변수 / 시크릿 노출 금지
- 코드 예시에 실제 API 키, 비밀번호, Webhook URL을 넣지 않는다.
- `.env.example` 파일에는 반드시 플레이스홀더(`your_value_here`)만 사용한다.

---

## 현재 구현 상태

| Phase | 상태 | 내용 |
|---|---|---|
| Phase 1 | 완료 | 인프라 (Prometheus, Grafana, Alertmanager, Postgres) — Loki 제거 |
| Phase 2 | 완료 | admin-api, Teams 알림 |
| Phase 3 | 완료 | 에이전트 배포 (node_exporter, Grafana Alloy, jmx_exporter) — 레거시 |
| Phase 4 | 완료 | log-analyzer, LLM 분석 |
| Server B | 완료 | Ollama + Qdrant 배포 |
| Phase 4b | 완료 | 벡터 유사도 분석 (log_incidents 컬렉션) |
| Phase 4c | 완료 | n8n 12종 워크플로우 (WF1~WF12) |
| Phase 5 | 완료 | 계층적 메트릭 집계 (시간/일/주/월) + 장애 예방 시스템 (수집기 유연 레지스트리, 집계 벡터 검색, 프로액티브 알림) |
| Frontend UI | 완료 | React + 뉴모피즘 프론트엔드 (20개 화면) — 분석 탭, 피드백 관리, 벡터 컬렉션 상태 포함 |
| Phase 4d | 계획 | Agentic LLM 2-tier (ReAct 루프) |
| Phase 6 (aoms_agent) | 완료 | Rust 단일 바이너리 수집기 (CPU/메모리/디스크/네트워크/프로세스/로그/웹서버 access log), Prometheus Remote Write, WAL 2h 버퍼 |
| Phase 6 (admin-api) | 완료 | aoms_agent install 자동화 (config.toml SFTP 업로드), live-status API (Prometheus 쿼리), prometheus_analyzer.py 자동 분석 루프 |
| Phase 6 (frontend) | 완료 | AgentDetailPage live-status 카드 — 수집기별 활성 뱃지, last_seen 표시 |
| Phase 7 | 완료 | `instance_role` HA 의미 재정립, `[[log_monitor]]` 다중 log_type 지원, log-analyzer Loki→Prometheus 마이그레이션, Loki 컨테이너 완전 제거 |
| Phase 8 (dashboard) | 완료 | 통합 운영 대시보드 — 하이브리드 레이아웃(통계+카드), 시스템 상태 종합 판정(메트릭+로그분석+예방패턴), WebSocket 실시간 알림 스트리밍, 예방적 패턴 감지 연동, 단위 테스트 13개 |
