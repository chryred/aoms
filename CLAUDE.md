# AOMS — Claude 컨텍스트 가이드

백화점 통합 모니터링 시스템(AOMS). 폐쇄망 환경의 RedHat 8.9 서버에 Docker Compose로 운영된다.

---

## 전체 아키텍처

```
외부 세계
  └── Teams (알림 수신)
  └── LLM API (내부망 AI 분석)

[ Server A — Main Server ]                [ Server B — AI/Vector ]
  Prometheus  ──scrape──▶  대상 서버들       Ollama (bge-m3 임베딩)
  Alertmanager ──webhook──▶ admin-api        Qdrant (벡터 DB)
  Loki        ◀──push───   Grafana Alloy
  Grafana     ──read───▶   Prometheus, Loki
  admin-api   ──read───▶   PostgreSQL
              ──http───▶   Teams Webhook
              ◀──http───   log-analyzer
  log-analyzer ──read──▶   Loki
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
| `alert_history` | admin-api | 알림 발송 이력. `alert_type`: `metric` / `log_analysis` |
| `log_analysis_history` | admin-api, log-analyzer | LLM 분석 결과 저장 |
| `alert_cooldown` | admin-api | 5분 중복 발송 방지. key: `{system}:{role}:{alertname}:{severity}` |
| n8n 스키마 | n8n | n8n 워크플로우 데이터 (`DB_POSTGRESDB_SCHEMA=n8n`) |

---

### n8n (포트 5678)

5종 워크플로우:
1. **로그 분석 트리거** — 5분 주기 → `POST log-analyzer/analyze/trigger`
2. **메트릭 벡터 분석** — Alertmanager webhook → `POST admin-api/metric/similarity`
3. **피드백 등록** — Teams 피드백 → `POST admin-api/api/v1/...`
4. **일일 리포트** — 매일 08:00
5. **반복 에스컬레이션** — 30분 주기

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
│       │   ├── models.py              # SQLAlchemy ORM (6개 테이블)
│       │   ├── schemas.py             # Pydantic 스키마
│       │   ├── routes/                # systems, contacts, alerts, analysis
│       │   ├── services/
│       │   │   ├── cooldown.py        # 5분 중복 알림 방지
│       │   │   └── notification.py    # TeamsNotifier (Adaptive Card)
│       │   └── tests/                 # pytest, SQLite in-memory
│       └── log-analyzer/
│           ├── main.py                # FastAPI 앱, 스케줄러, /analyze/trigger
│           ├── analyzer.py            # 핵심 분석 로직 (Loki 조회 → LLM 호출 → admin-api 전송)
│           └── vector_client.py       # Ollama 임베딩 + Qdrant 유사도 분석
└── sub-server/
    └── docker-compose.yml             # Server B: Ollama + Qdrant
```

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
n8n 5분 트리거 → POST log-analyzer/analyze/trigger
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

### 담당자별 LLM API 키
`contacts.llm_api_key`가 있으면 해당 키로 LLM 호출, 없으면 환경변수 `LLM_API_KEY` 사용. AI 비용을 시스템 담당자별로 분리 청구하는 구조.

### Teams Webhook URL 우선순위
`systems.teams_webhook_url` (시스템별) → `TEAMS_WEBHOOK_URL` 환경변수 (전역). 시스템별 알림 채널 분리 가능.

### 로그 수집 에이전트 — Grafana Alloy
Promtail v3.x는 glibc 2.34+를 요구하지만 대상 서버(RHEL 8.9)는 glibc 2.28이므로 **Grafana Alloy**로 대체.

- **설치 스크립트**: `install-agents.sh --type all|node|alloy|jmx`
- **설정 파일 형식**: `.alloy` (YAML 아님, River 언어)
- **포트**: 12345 (Alloy 내부 서버)
- **서비스 사용자**: `alloy` (systemd)
- **JEUS 로그 접근**: ACL(`setfacl`)로 `alloy` 사용자에게 읽기 권한 부여
- **라벨**: `system_name`, `instance_role`, `host`, `log_type`, `level`
- **필터링**: ERROR/WARN/FATAL/CRITICAL 키워드 포함 로그만 Loki로 전송 (RE2 정규식)

### 폐쇄망 배포
- Docker 이미지: Mac에서 `build-images.sh`로 `linux/amd64` 빌드 → `.tar.gz` 저장 → scp 전송 → `docker load`
- Alloy 바이너리: `alloy-linux-amd64.zip` 사전 다운로드 → 서버 전송
- Python 패키지: `requirements/` 디렉토리에 버전 고정. 운영 Dockerfile은 `prod.txt`만 설치.

### 로컬 개발
```bash
make dev-up     # 인프라 시작
make run-api    # admin-api 핫리로드 (포트 8080)
make run-analyzer  # log-analyzer 핫리로드 (포트 8000)
make test-api   # 단위 테스트 (인프라 불필요 — SQLite in-memory)
```

---

## 현재 구현 상태

| Phase | 상태 | 내용 |
|---|---|---|
| Phase 1 | 완료 | 인프라 (Prometheus, Loki, Grafana, Alertmanager, Postgres) |
| Phase 2 | 완료 | admin-api, Teams 알림 |
| Phase 3 | 완료 | 에이전트 배포 (node_exporter, Grafana Alloy, jmx_exporter) |
| Phase 4 | 완료 | log-analyzer, LLM 분석 |
| Server B | 완료 | Ollama + Qdrant 배포 |
| Phase 4b | 완료 | 벡터 유사도 분석 (log_incidents 컬렉션) |
| Phase 4c | 완료 | n8n 5종 워크플로우 |
| Phase 4d | 계획 | Agentic LLM 2-tier (ReAct 루프) |
| Phase 5 | 계획 | 대시보드 완성, Self-monitoring |
