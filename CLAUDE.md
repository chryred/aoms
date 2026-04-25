# Synapse-V — Claude 컨텍스트 가이드

백화점 통합 모니터링 시스템. 폐쇄망 RedHat 8.9 + Docker Compose. 상세 컨텍스트는 **`.claude/memory/`** 에 분리 보관(필요 시 로드).

## 상세 문서 (필요 시 로드)

| 문서 | 내용 | 언제 읽어야 하나 |
|---|---|---|
| `.claude/memory/architecture.md` | 전체 아키텍처 다이어그램, 서비스 연결 맵(admin-api/log-analyzer/PostgreSQL), n8n 보류 워크플로우 표 | 서비스 간 통신·데이터 흐름 분석 시 |
| `.claude/memory/code-layout.md` | 디렉터리 트리 + Server A/B 포트 맵 | 파일 위치·포트 확인 시 |
| `.claude/memory/data-flows.md` | 메트릭 알림 / LLM 로그 분석 / 벡터 유사도 분류 / 분석 실패 처리 흐름 | 기능 추가·버그 추적 시 |
| `.claude/memory/development-notes.md` | system_name 일관성, instance_role 의미, synapse_agent, 폐쇄망 배포, 담당자별 LLM 키 등 | 구현 세부사항 필요 시 |
| `.claude/memory/adrs.md` | ADR-001 ~ 012 전문 + 유지 규칙 (ADR-011: FastEmbed+Hybrid+RAG, ADR-012: LLM Ollama 제거) | 아키텍처 결정 배경 재검토 시 |
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
- **Qdrant** (6333): Dense+Sparse Hybrid Search (ADR-011)
  - `log_incidents`, `metric_baselines`, `aggregation_summaries`: Dense(1024) + Sparse(BM25) Hybrid
  - `metric_hourly_patterns`: Dense 전용
  - Ollama는 ADR-011로 제거됨 — 임베딩은 log-analyzer 컨테이너 내 FastEmbed ONNX가 담당

### 핵심 환경변수
| 변수 | 기본 값 / 설명 |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://...` |
| `LLM_TYPE` | `devx` / `claude` / `openai` — `llm_client.py` Strategy가 라우팅 (ADR-001). ADR-012: ollama 폐지 |
| `DEVX_CLIENT_ID` / `DEVX_CLIENT_SECRET` | DevX OAuth client_credentials 인증 (시스템 발급) |
| `DENSE_EMBED_MODEL` | `BAAI/bge-m3` (onnxruntime 직접 호출, 1024차원, ADR-011) |
| `DENSE_ONNX_FILE` | `onnx/model.onnx` (Dense ONNX 파일 경로 — int8 교체 시 `onnx/model_int8.onnx`) |
| `SPARSE_EMBED_MODEL` | `Qdrant/bm25` (fastembed SparseTextEmbedding, IDF 기반) |
| `DENSE_MODEL_CACHE` / `SPARSE_MODEL_CACHE` | 이미지 번들 경로 (Dockerfile에서 자동 설정) |
| `HF_HUB_OFFLINE` | `1` (폐쇄망 필수). 개발기 미러 필요 시 `HF_ENDPOINT=https://hf-mirror.com` |
| `QDRANT_URL` | `http://{server-b}:6333` |
| `TEAMS_WEBHOOK_URL` | 전역 Teams 폴백 (시스템별 `systems.teams_webhook_url`이 우선) |
| `FRONTEND_EXTERNAL_URL` | Teams 카드 "해결책 등록" 버튼이 여는 React 페이지 외부 접근 URL (예: `http://{server-a-ip}:3001`) |
| `ANALYSIS_INTERVAL_SECONDS` | 300 (로그 분석 주기) |
| `PROMETHEUS_ANALYZE_INTERVAL_SECONDS` | 300 (admin-api 메트릭 교차 분석 주기) |
| `TEMPO_URL` | `http://tempo:3200` — admin-api + log-analyzer Tempo HTTP API (ADR-008) |
| `OTEL_COLLECTOR_ENDPOINT` | `http://otel-collector:4317` — Java Agent OTLP gRPC 전송 목적지 (ADR-008) |
| `SYNAPSE_CLI_BINARY_PATH` | `/app/bin/synapse` — CLI 배포용 바이너리 경로 (Docker 이미지 내 번들) |

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

### [타임존] 저장=UTC / 스케줄=KST / 표출=KST

전 계층에서 다음 규칙을 준수해야 UTC/KST 혼재 버그가 재발하지 않는다.

- **수집·전송·저장은 UTC 고정**. Rust Agent / OTel Collector / Prometheus / Tempo는 OTLP·Remote Write 프로토콜 제약으로 Unix epoch(UTC)만 허용한다. PostgreSQL 컬럼도 `TIMESTAMP WITHOUT TIME ZONE`(naive = UTC) 유지.
- **Python 코드 금지 패턴**:
  - `datetime.utcnow()` (Python 3.12+ deprecated) → **`datetime.now(timezone.utc).replace(tzinfo=None)`** 사용 (naive UTC 유지 + deprecated 경고 제거)
  - `datetime.now()` (로컬 타임존 naive) → 금지. UTC가 필요하면 위 표현, KST가 필요하면 `datetime.now(_KST)` (`_KST = timezone(timedelta(hours=9))`) 사용
- **스케줄 계산은 KST**. log-analyzer `_KST` 상수로 "한국 자정 기준 일/주/월 집계" 유지. admin-api `routes/incidents.py`의 `_KST`는 화면 표시용.
- **프론트엔드 표출은 KST**. `src/lib/utils.ts`의 `formatKST()` / `formatRelative()` / `formatPeriodLabel()` 공통 유틸만 사용한다.
  - 수동 `+ 9 * 60 * 60 * 1000` 하드코딩 금지
  - `new Date(naiveUtcString)` 직접 호출 금지 — `normalizeUtc()` 경유 또는 `formatKST()` 사용
  - KST 날짜피커 입력을 백엔드에 보낼 때는 `kstDateToUtcStart()` / `kstDateToUtcEnd()` 사용
- 자세한 내용은 `main-server/services/frontend/CLAUDE.md` "타임존 규칙" 섹션 참고.

### [DB / 마이그레이션] 테이블 자동 생성 의존 금지
- `main.py` lifespan의 `create_all()`은 개발 편의용이다. 운영 스키마 변경은 직접 SQL 또는 Alembic을 사용한다.
- 새 컬럼/테이블 추가 시 **3중 동기화** 필수: `models.py` + `init.sql` + `migrations/*.sql` (ADR-002 참고).

### [Frontend / React] 디자인 시스템 일탈 금지
- 뉴모피즘 디자인 시스템(`design-system.md` 또는 기존 컴포넌트 참고)을 벗어난 스타일을 임의로 추가하지 않는다.
- 새 색상, 그림자, 폰트 크기를 하드코딩하지 않고 CSS 변수(`--var-name`)를 사용한다.

### [Frontend / React] UI 변경 후 별도 subagent로 시각적 검증 필수

프론트엔드 컴포넌트·페이지를 수정한 뒤, 구현한 Claude 자신이 직접 검증하지 않는다.
반드시 **`Agent` 툴로 별도 subagent 2개를 병렬 spawn하여** QA를 위임한다.

**트리거 조건** (아래 중 하나라도 해당하면 실행):
- 새 컴포넌트·페이지 추가
- 기존 UI 레이아웃·스타일 변경
- 뉴모피즘 디자인 토큰 수정 (`index.css`, `neumorphic/`)
- 라우팅 변경

**subagent 1 — 기능 QA (`qa` 스킬 사용, 발견된 문제는 수정까지 수행)**:
```
Agent(
  description: "기능 QA — [변경 내용 한 줄 요약]",
  prompt: """
    /qa
    다음 UI 변경에 대해 독립적인 기능 QA를 수행하라. 문제 발견 시 직접 수정까지 완료한다.
    [변경 내용 설명 + 로컬 URL: http://localhost:3001]
    검증 항목:
    1. 변경된 페이지 골든 패스 (정상 데이터 표시)
    2. Dark / Light 모드 토글
    3. Sidebar 축소/확장 레이아웃
    4. 콘솔 에러 없음
    구현자의 설명을 믿지 말고 직접 눈으로 확인한 결과와 수정 내역을 보고하라.
  """
)
```

**subagent 2 — 디자인 시스템 검증 (`design-review` 스킬 사용, 수정 금지)**:
```
Agent(
  description: "디자인 리뷰 — [변경 내용 한 줄 요약]",
  prompt: """
    /design-review
    다음 UI 변경이 이 프로젝트의 디자인 시스템을 준수하는지 검증하라. 코드는 절대 수정하지 않는다.
    [변경 내용 설명 + 로컬 URL: http://localhost:3001]
    중점 검증:
    1. 하드코딩 색상·그림자 사용 여부 (CSS 변수 대신 hex 직접 사용 금지)
    2. rounded-sm 외 border-radius 사용 여부
    3. Dark / Light 모드 전환 시 색상 깨짐
    4. 뉴모피즘 shadow 토큰(neu-flat / neu-inset / neu-pressed) 일관성
    5. accent 색상 남용 (핵심 인터랙션 외 사용 금지)
    구현자의 설명을 믿지 말고 직접 눈으로 확인한 결과만 보고하라.
  """
)
```

**완료 기준**: 두 subagent의 리포트 모두 이상 없음을 확인한 뒤 완료 선언.
subagent 없이 자가 검증으로 "완료"라고 말하지 않는다.

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
