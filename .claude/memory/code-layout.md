# 코드 위치 + 포트 맵

## 디렉터리 구조

```
aoms/
├── CLAUDE.md                          # 루트 컨텍스트 가이드 (축약본 + memory 참조)
├── README.md                          # 프로젝트 전체 구현 워크플로우
├── Makefile                           # 로컬 개발 단축 명령어
├── build-images.sh                    # 운영 Docker 이미지 빌드 스크립트
├── .claude/memory/                    # 상세 컨텍스트 분리 보관
├── scripts/
│   ├── export-ollama-model.sh         # 폐쇄망 배포: Ollama 모델 tar 추출 (ADR-003)
│   └── import-ollama-model.sh         # 폐쇄망 배포: 서버 Ollama에 import
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
│       │   ├── main.py                # FastAPI 앱, lifespan
│       │   ├── database.py            # DB 엔진, get_db() 의존성
│       │   ├── models.py              # SQLAlchemy ORM (16개 테이블)
│       │   ├── schemas.py             # Pydantic 스키마
│       │   ├── init.sql               # 운영 스키마 정본 (ADR-002)
│       │   ├── migrations/            # 기존 운영 DB용 ALTER SQL
│       │   ├── routes/                # systems, contacts, alerts, analysis, feedback,
│       │   │                          #   collector_config, aggregations, reports, agents, dashboard, websocket
│       │   ├── services/
│       │   │   ├── llm_client.py      # LLM Strategy (ADR-001, log-analyzer와 SYNC)
│       │   │   ├── cooldown.py        # 5분 중복 알림 방지
│       │   │   ├── notification.py    # TeamsNotifier (Adaptive Card)
│       │   │   ├── ssh_session.py     # SSH 세션 인메모리 관리
│       │   │   ├── prometheus_analyzer.py   # Prometheus 이상 감지 + LLM (ADR-001)
│       │   │   ├── db_collector.py    # DB 메트릭 수집 루프 (Phase 9)
│       │   │   └── db_backends/       # Strategy + Registry (oracle/postgres/mssql/mysql)
│       │   └── tests/                 # pytest, SQLite in-memory
│       └── log-analyzer/
│           ├── CLAUDE.md                        # log-analyzer 상세 가이드
│           ├── main.py                          # FastAPI 앱, 내부 스케줄러(모든 주기 작업 처리), lifespan 컬렉션 보증(ADR-004)
│           ├── analyzer.py                      # 핵심 로그 분석 (Prometheus 쿼리 → LLM → admin-api)
│           ├── llm_client.py                    # LLM Strategy 원본 (ADR-001)
│           ├── aggregation_processor.py         # Phase 5: 시간/일/주/월/장기 집계 + 트렌드 분석 코어
│           ├── vector_client.py                 # log_incidents / metric_baselines 관리
│           ├── aggregation_vector_client.py     # metric_hourly_patterns / aggregation_summaries
│           ├── trace_summarizer.py              # OTel: Tempo 조회 → tier별 trace context 텍스트 (ADR-008)
│           └── tests/                           # pytest (JSON 파싱 등)
├── agent/                             # synapse_agent Rust 단일 바이너리 수집기 (Phase 6)
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
| Grafana | — (없음) | `3000` | |
| Tempo | — (없음) | `3200` | 분산 추적 백엔드 (ADR-008) |
| OTel Collector | `13133` (healthcheck), `4317` (gRPC, 127.0.0.1), `4318` (HTTP, 127.0.0.1) | 동일 | tail_sampling (ADR-008) |
| n8n | `5678` | `5678` | 현재 미사용 (컨테이너만 예비 유지, ADR-006) |
| Qdrant | `6333` (HTTP), `6334` (gRPC) | — (없음, Server B) | |
| Ollama | `11434` | — (없음, Server B) | |

> 개발 환경에서 `frontend` 컨테이너의 `/api/` → `admin-api`, `/analyze/` + `/aggregation/` → `log-analyzer`는
> `extra_hosts`로 호스트 머신을 향한다 (포트는 nginx.conf에 하드코딩 — 8080/8000).

### Server B — AI/Vector

| 서비스 | 포트 | 비고 |
|---|---|---|
| Ollama | `11434` | paraphrase-multilingual 임베딩 모델 (ADR-003, 768dim) |
| Qdrant | `6333` (HTTP), `6334` (gRPC) | 벡터 DB, 컬렉션 차원 768 (ADR-003) |
