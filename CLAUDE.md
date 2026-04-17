# Synapse-V — Claude 컨텍스트 가이드

백화점 통합 모니터링 시스템. 폐쇄망 RedHat 8.9 + Docker Compose. 상세 컨텍스트는 **`.claude/memory/`** 에 분리 보관(필요 시 로드).

## 상세 문서 (필요 시 로드)

| 문서 | 내용 | 언제 읽어야 하나 |
|---|---|---|
| `.claude/memory/architecture.md` | 전체 아키텍처 다이어그램, 서비스 연결 맵(admin-api/log-analyzer/PostgreSQL), n8n 보류 워크플로우 표 | 서비스 간 통신·데이터 흐름 분석 시 |
| `.claude/memory/code-layout.md` | 디렉터리 트리 + Server A/B 포트 맵 | 파일 위치·포트 확인 시 |
| `.claude/memory/data-flows.md` | 메트릭 알림 / LLM 로그 분석 / 벡터 유사도 분류 / 분석 실패 처리 흐름 | 기능 추가·버그 추적 시 |
| `.claude/memory/development-notes.md` | system_name 일관성, instance_role 의미, synapse_agent, 폐쇄망 배포, 담당자별 LLM 키 등 | 구현 세부사항 필요 시 |
| `.claude/memory/adrs.md` | ADR-001 ~ 005 전문 + 유지 규칙 | 아키텍처 결정 배경 재검토 시 |
| `.claude/memory/implementation-status.md` | Phase 1 ~ Phase 10 구현 현황 표 | 이미 구현된 기능 확인 시 |

> 참조 방식: `@` 자동 로드 아님. **필요할 때 Read tool로 경로를 읽는다** (예: `Read `.claude/memory/adrs.md``).

---

## Quick Reference — 항상 알아야 할 핵심

### 서비스 구성 (Server A)
- **admin-api** (8080): FastAPI. 시스템/담당자 관리, 알림 수신, Teams 발송
- **log-analyzer** (8000): FastAPI. Prometheus `log_error_total` 조회 → LLM 분석 → admin-api 전송. 내부 스케줄러가 모든 주기 작업(과거 n8n WF1/WF6~WF11) 처리
- **frontend** (3001): React + Vite + TailwindCSS, 뉴모피즘 디자인 시스템
- **PostgreSQL** (5432), **Prometheus** (9090), **Alertmanager** (9093), **Grafana** (3000, 운영)
- **n8n** (5678): 현재 미사용. 컨테이너만 예비 유지(WF4 일일 리포트 / WF5 에스컬레이션은 향후 log-analyzer 이관 예정으로 `main-server/n8n-workflows/`에 JSON만 보존)

### Server B
- **Ollama** (11434): `paraphrase-multilingual` 임베딩 모델 (768차원, ADR-003)
- **Qdrant** (6333): `log_incidents`, `metric_baselines`, `metric_hourly_patterns`, `aggregation_summaries` (모두 768차원)

### 핵심 환경변수
| 변수 | 기본 값 / 설명 |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://...` |
| `LLM_TYPE` | `devx` / `ollama` / `claude` / `openai` — `llm_client.py` Strategy가 라우팅 (ADR-001) |
| `DEVX_CLIENT_ID` / `DEVX_CLIENT_SECRET` | DevX OAuth client_credentials 인증 (시스템 발급) |
| `OLLAMA_URL` / `EMBED_MODEL` | `paraphrase-multilingual` (ADR-003) |
| `QDRANT_URL` | `http://{server-b}:6333` |
| `TEAMS_WEBHOOK_URL` | 전역 Teams 폴백 (시스템별 `systems.teams_webhook_url`이 우선) |
| `FRONTEND_EXTERNAL_URL` | Teams 카드 "해결책 등록" 버튼이 여는 React 페이지 외부 접근 URL (예: `http://{server-a-ip}:3001`) |
| `ANALYSIS_INTERVAL_SECONDS` | 300 (로그 분석 주기) |
| `PROMETHEUS_ANALYZE_INTERVAL_SECONDS` | 300 (admin-api 메트릭 교차 분석 주기) |

### 로컬 개발
```bash
make dev-up          # 인프라 시작
make run-api         # admin-api 핫리로드 (8080)
make run-analyzer    # log-analyzer 핫리로드 (8000)
make test-api        # 단위 테스트 (SQLite in-memory)
```

### CLAUDE.md 저장 위치 규칙
내용에 따라 해당 폴더의 CLAUDE.md에 나눠서 저장 (장문 상세는 `.claude/memory/`로 분리):
- 전체 아키텍처/공통: `aoms/CLAUDE.md` + `.claude/memory/`
- admin-api 관련: `main-server/services/admin-api/CLAUDE.md`
- log-analyzer 관련: `main-server/services/log-analyzer/CLAUDE.md`
- 인프라/배포 관련: `main-server/CLAUDE.md`

---

## Claude 작업 규칙

### 개선 작업 워크플로우
1. **컨텍스트 로드** — 작업 대상에 따라 `.claude/memory/` 관련 파일을 먼저 읽기 (예: 아키텍처 변경이면 `architecture.md` + `adrs.md`)
2. **CLAUDE.md / memory 업데이트** — 아키텍처 변경, 새 기능, 설정 변경 등은 관련 위치에 반영. ADR에 해당하는 결정은 `.claude/memory/adrs.md`에 추가
3. **테스트 후 완료** — 모든 개선은 테스트(`make test-api` 등) 실행·통과 확인 후 완료 처리. 테스트 없이 완료 선언 금지
4. **CLAUDE.md 저장 위치** — 위 규칙 준수. 장문 상세 설명은 `.claude/memory/`로, 핵심 요약만 CLAUDE.md에

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

### [일반] CLAUDE.md / memory 업데이트 누락 금지
- 아키텍처 변경, 새 엔드포인트, 새 환경변수, 새 테이블, 설정 변경이 생기면 해당 위치(CLAUDE.md 또는 `.claude/memory/*.md`)를 **코드와 동시에** 업데이트한다.
- 작업 후 "CLAUDE.md도 업데이트해야 하나요?" 라고 묻지 않는다 — 스스로 판단해서 반영한다.
- ADR에 해당하는 결정(아키텍처·설계 선택)은 반드시 `.claude/memory/adrs.md`에 기록.

### [Python/FastAPI] import 순서 / 순환 참조
- 새 모듈 추가 시 순환 import가 발생하지 않는지 먼저 확인한다.
- `from .models import Foo` 패턴과 `from models import Foo` 패턴을 혼용하지 않는다 (프로젝트 전체 일관성 유지).

### [Python/FastAPI] async 일관성
- `async def` 엔드포인트에서 동기 I/O 블로킹 함수를 직접 호출하지 않는다.
- SQLAlchemy는 `asyncpg` 드라이버 + `AsyncSession` 패턴을 일관되게 사용한다.

### [DB / 마이그레이션] 테이블 자동 생성 의존 금지
- `main.py` lifespan의 `create_all()`은 개발 편의용이다. 운영 스키마 변경은 직접 SQL 또는 Alembic을 사용한다.
- 새 컬럼/테이블 추가 시 **3중 동기화** 필수: `models.py` + `init.sql` + `migrations/*.sql` (ADR-002 참고).

### [Frontend / React] 디자인 시스템 일탈 금지
- 뉴모피즘 디자인 시스템(`design-system.md` 또는 기존 컴포넌트 참고)을 벗어난 스타일을 임의로 추가하지 않는다.
- 새 색상, 그림자, 폰트 크기를 하드코딩하지 않고 CSS 변수(`--var-name`)를 사용한다.

### [n8n 워크플로우] JSON 직접 편집 시 ID 충돌 주의
- 워크플로우 JSON을 복사·수정할 때 노드 `id` 필드가 중복되지 않도록 확인한다.
- `credentials` 블록의 ID는 실제 n8n 인스턴스의 크리덴셜 ID와 일치해야 한다 — 예시 ID를 그대로 두지 않는다.

### [보안] 환경변수 / 시크릿 노출 금지
- 코드 예시에 실제 API 키, 비밀번호, Webhook URL을 넣지 않는다.
- `.env.example` 파일에는 반드시 플레이스홀더(`your_value_here`)만 사용한다.

### [LLM 파이프라인] llm_client.py 이중화 관리 (ADR-001)
- `log-analyzer/llm_client.py`와 `admin-api/services/llm_client.py`는 **동일 내용 복제본**. 파일 상단 `# SYNC:` 주석 확인.
- 새 프로바이더 추가·로직 변경 시 **양쪽 파일 동시 수정**.

### [LLM 파이프라인] DevX OAuth + 업무영역별 agent_code (ADR-007)
- DevX 인증은 시스템 OAuth(`client_credentials`) 방식. `DEVX_CLIENT_ID`/`DEVX_CLIENT_SECRET` 환경변수로 토큰 발급.
- `agent_code`는 `llm_agent_configs` 테이블에서 업무 영역별 관리 (9개 영역). 담당자(contacts)와 무관.
- 관리 페이지: `/admin/llm-config` (admin 전용)
