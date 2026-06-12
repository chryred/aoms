# Architecture Decision Records (ADR)

아키텍처 결정 이력 — 추후 회고·재평가 시 참고용. 각 ADR은 *배경 → 결정 → 영향/트레이드오프* 구조.

## ADR 유지 규칙
- **신규 ADR 번호**는 순차 증가 (ADR-006, 007, …)
- **상태 변경**: Accepted → Deprecated → Superseded by ADR-XXX 로 이동, 삭제하지 않음
- **롤백 시**: 해당 ADR을 수정하지 않고, 역방향 결정을 기록하는 신규 ADR 추가
- **판단 근거**: 실측 데이터·벤치마크는 본문에 숫자로 남기기

---

## ADR-001: LLM 호출을 Strategy 패턴으로 일원화 (2026-04-14)

**Status**: Accepted

**Context**
- `log-analyzer/llm_client.py`에는 `LLM_TYPE=devx/ollama/claude/openai`를 스위칭하는 Strategy 패턴 존재
- 그러나 `admin-api/services/prometheus_analyzer.py:434-450`은 `{LLM_API_URL}/chat/completions` + `gpt-4o-mini` OpenAI 포맷을 **httpx로 직접 하드코딩**
- 운영 `LLM_TYPE=devx` 환경에서 admin-api가 실제 이상을 감지하면 LLM 호출 항상 실패 → plain-text fallback만 Teams 발송
- 테스트 결과 `log_analysis_history` 전건에 `model_used=NULL`, 프로바이더 전환 불가

**Decision**
1. `log-analyzer/llm_client.py`를 `admin-api/services/llm_client.py`로 **복제** (파일 상단 `# SYNC:` 주석으로 drift 관리)
2. `prometheus_analyzer.py`에서 `call_llm_text(prompt, api_key, agent_code)` 사용
3. `call_llm_text` 시그니처에 `api_key`/`agent_code` 파라미터 추가 — 담당자별 `contacts.llm_api_key` 오버라이드 유지
4. `log_analysis_history.model_used` 컬럼에 `LLM_TYPE` 값 자동 기록

**Consequences**
- ✅ `LLM_TYPE` 변경만으로 devx/ollama/claude/openai 전환 가능
- ✅ prometheus_analyzer 경로에서도 devx 정상 호출됨
- ⚠️ `llm_client.py` 두 곳 복제 → 새 프로바이더 추가 시 양쪽 수정 필요 (SYNC 주석으로 완화)
- 대안 검토: shared Python 패키지화 — 폐쇄망 Docker 빌드 복잡성 고려하여 탈락

**관련 파일**
- `main-server/services/admin-api/services/llm_client.py` (신규)
- `main-server/services/admin-api/services/prometheus_analyzer.py:14-27,433-455`
- `main-server/services/log-analyzer/llm_client.py:181-249`

---

## ADR-002: LLM/분석 실패 이력 DB 기록 + UI 가시화 (2026-04-14)

**Status**: Accepted

**Context**
- 기존 `analyzer.py:run_analysis` inner `except`는 `errors += 1` 카운터만 올리고 `submit_analysis` 호출 안 함
- 결과: 피드백 관리 화면에서 **"어느 시스템이 LLM 분석에 실패했는지" 전혀 알 수 없음**
- 별도로 `store_incident_vector`가 silent 실패 시 `logger.warning`만 남기고 `qdrant_point_id=NULL` 반환 → 103건 누적
- `anomaly_type`은 유사도 분류(new/recurring/related/duplicate) 의미를 가지므로 실패를 그 필드에 섞으면 의미 훼손

**Decision**
1. **신규 컬럼** `log_analysis_history.error_message TEXT` + `alert_history.error_message TEXT`
   - NULL = 성공, 값 = LLM/분석/Qdrant 저장 실패 사유 (snippet 포함)
   - 단일 컬럼으로 flag + reason 동시 표현
2. 실패 경로에서도 `submit_analysis` 호출해 DB 기록 + alert_history 동반 삽입
3. **Teams 발송 차단**: `error_message IS NOT NULL`이면 severity=warning/critical이어도 Teams 미발송 (스팸 방지)
4. **UI 뱃지**: `AlertTable.tsx`에서 `error_message` 존재 시 빨간 "분석 실패" 뱃지, 툴팁으로 사유 노출
5. **"피드백 제출 가능" 카운트는 기존대로 `qdrant_point_id` 기준** → 실패 레코드 자동 제외 (운영 플로우 오염 없음)
6. 3중 동기화: `models.py` + `init.sql` + `migrations/20260414_add_error_message.sql`

**Consequences**
- ✅ 운영자가 `error_message` 한 컬럼만 보고 "DevX 필터 거절" / "빈 응답" / "JSON 형식 오류" 즉시 판별
- ✅ `_parse_json_from_text` 실패 시 응답 snippet(150자) 포함 → 디버깅 시간 단축
- ⚠️ 스키마 3중 동기화 필수 — 하나라도 누락 시 신규 설치(init.sql) vs 기존 운영(ALTER) 불일치

**관련 파일**
- `main-server/services/admin-api/{models.py, init.sql, schemas.py, routes/analysis.py}`
- `main-server/services/admin-api/migrations/20260414_add_error_message.sql`
- `main-server/services/log-analyzer/analyzer.py:344-396`, `llm_client.py:219-231`
- `main-server/services/frontend/src/types/alert.ts`, `components/alert/AlertTable.tsx`

---

## ADR-003: 임베딩 모델 교체 bge-m3 → paraphrase-multilingual (2026-04-14)

**Status**: Accepted (운영 2-core CPU 대응)

**Context**
- 운영 서버 사양: **2-core CPU, GPU 없음**
- `bge-m3` (566M params, 1024 dim): 2-core CPU에서 임베딩 1건 30~130초 소요 → `timeout=30s` 기본값에서 **매 실행 타임아웃 발생**
- 결과: 103건 전부 `qdrant_point_id=NULL`, 유사도 검색 기능 사실상 무력화
- 측정: sub-server에서 bge-m3 cold 130s+, warm 32s vs paraphrase-multilingual warm 0.57s

**Decision**
1. **모델 교체**: `bge-m3:latest` (1.1GB, 1024dim) → `paraphrase-multilingual:latest` (537MB, 768dim)
   - 기반: `paraphrase-multilingual-mpnet-base` (277M params, 다국어 50+ 언어 지원)
   - 한국어 품질: bge-m3의 약 85% 수준 (실용 충분)
2. **차원 축소**: Qdrant 4개 컬렉션 전부 `_VECTOR_SIZE = 768`로 재생성
3. **기존 벡터 폐기**: 차원 불일치로 기존 219개 포인트 손실 — 운영 초기 단계라 수용 가능
4. **keep_alive="24h"** 임베딩 호출에 명시적 지정 → Ollama 기본 5분 keep_alive 경계에서 발생하던 cold-start 반복 차단
5. **타임아웃 30s → 120s** (`httpx.AsyncClient(timeout=120.0)`) — cold-start 1회만 수용
6. **Ollama-native 모델만 사용** (HF GGUF 직접 pull 비채택) → 폐쇄망 배포 시 manifest 표준 포맷 유지

**Consequences**
- ✅ 임베딩 **~100배 빠름** (0.57s vs 60-130s) — 2-core CPU에서도 실용적
- ✅ 모델 크기 **50% 감소**, Qdrant 저장 용량 **25% 감소**
- ⚠️ 한국어 유사도 정확도 소폭 하락 가능성 — 2주 observability로 `similarity_score` 분포 모니터링
- ⚠️ 기존 219 포인트 백필 없음 — 필요 시 재임베딩 스크립트 작성 필요 (범위 외)
- ❌ 대안 검토:
  - `multilingual-e5-small` (118M, 384dim) — HF GGUF pull 복잡성
  - `all-minilm` (22M, 384dim) — 영어 전용 (Korean logs 손실)
  - sub-server GPU 추가 — 인프라 승인 필요

**관련 파일**
- `main-server/.env.local` EMBED_MODEL=paraphrase-multilingual
- `main-server/services/log-analyzer/vector_client.py:27 (timeout=120)`, `:65-76 (keep_alive 24h)`, `:467 (_VECTOR_SIZE=768)`
- 폐쇄망 배포 스크립트: `scripts/export-ollama-model.sh`, `scripts/import-ollama-model.sh`

---

## ADR-004: Qdrant 컬렉션 부팅 시 자동 보증 (2026-04-14)

**Status**: Accepted

**Context**
- 과거 103건 `qdrant_point_id=NULL` 사건의 근본 원인 중 하나: **컬렉션 부재** 상태에서 `store_incident_vector` 호출 → `ensure_collection` 내부 실패 → silent warning → point_id=None
- 수동으로 `POST /aggregation/collections/setup` 호출해야 했고, 배포 시 누락 가능

**Decision**
- `main-server/services/log-analyzer/main.py` `lifespan` 진입부에 `log_incidents`, `metric_baselines` 자동 `ensure_collection` 호출
- try/except로 래핑 — Qdrant 기동 지연 시 분석 중 재시도로 회복

**Consequences**
- ✅ 서비스 재기동 시 컬렉션 자동 복구, 운영자 수동 setup 부담 제거
- ✅ 과거 silent 실패 재발 방지
- 집계 컬렉션(`metric_hourly_patterns`, `aggregation_summaries`)은 `POST /aggregation/collections/setup` 유지 (WF12 호출 경로 보존)

**관련 파일**
- `main-server/services/log-analyzer/main.py:163-181 (lifespan)`

---

## ADR-005: `no_logs` 카운터 분리 (2026-04-14)

**Status**: Accepted (작은 개선)

**Context**
- `run_analysis()` 결과 dict의 `skipped` 필드가 **두 가지 이유를 혼재**:
  1. 시스템 `status != "active"` (비활성)
  2. 활성이지만 최근 5분 에러 로그 없음
- 운영자가 `skipped=2`만 보고는 "DB에 active=False인 시스템 있나?" 같은 잘못된 추정 가능

**Decision**
- 결과 dict에 `no_logs` 필드 신규 추가 (기본값 0, backward-compatible additive)
- "에러 로그 없음" 경로만 `no_logs += 1`, 비활성 시스템은 기존대로 `skipped += 1`

**Consequences**
- ✅ 운영 모니터링 해상도 증가 — 운영자가 한눈에 "모든 시스템이 건강하다" vs "시스템이 비활성이다" 구분
- ✅ 기존 소비자 영향 없음 (필드 추가만)

**관련 파일**
- `main-server/services/log-analyzer/analyzer.py:306-398 (run_analysis)`

---

## ADR-006: 피드백 제출 React 직결 + n8n 의존 제거 (2026-04-14)

**Status**: Accepted

**Context**
- Teams 카드 "해결책 등록" 버튼이 `admin-api`의 스탠드얼론 HTML 폼(`GET /api/v1/feedback/form`)을 열고, 제출은 `N8N_WEBHOOK_URL/webhook/feedback`(WF3)으로 POST 했음.
- n8n 가동 불안정으로 제출 시 500 에러가 반복 발생. 담당자가 Teams에서 해결책을 등록할 수 없는 치명적 UX 문제.
- 동일 DB insert + Qdrant 업데이트 로직이 이미 admin-api 네이티브 `POST /api/v1/feedback`에 존재하고, `AlertDetailPanel` 인라인 폼은 그걸 쓰는 중 → 이중화.
- 추가 점검 결과 `main-server/n8n-workflows/` 12개 JSON이 전부 `active:false`였고, WF1/WF6~WF11은 이미 log-analyzer 내부 스케줄러로 이관 완료, WF2는 admin-api가 log-analyzer를 직접 호출, WF12는 `POST /aggregation/collections/setup` 직접 호출로 대체되어 있었음. 실질적으로 n8n이 처리하는 트래픽이 전무했다.

**Decision**
1. **Teams 카드 URL 교체**: `{ADMIN_API_EXTERNAL_URL}/api/v1/feedback/form?system=...&point_id=...`
   → `{FRONTEND_EXTERNAL_URL}/feedback/submit?alert_history_id=N&system=...&point_id=UUID`.
2. **React 페이지 신설** (`src/pages/FeedbackSubmitPage.tsx`) — AppLayout 외부 단독 페이지. 기존 `alertsApi.createFeedback` + `useCreateFeedback` 훅을 재사용해 `POST /api/v1/feedback`로 직행. 성공 시 성공 화면 + `window.close()` 버튼 노출.
3. **로그인 세션 없는 진입 처리**: `AuthGuard`가 `useLocation`으로 현재 경로를 캡처해 `/login?redirect=...`로 리다이렉트하고, `LoginPage`가 성공 후 `searchParams.get('redirect')` 경로로 복귀.
4. **alert_history.id 확보 순서 변경**: `routes/alerts.py` / `routes/analysis.py`에서 `AlertHistory` 저장을 Teams 발송 이전으로 앞당기고 `await db.flush()`로 PK를 미리 발급해 notifier에 전달.
5. **n8n 워크플로우 정리**: WF1·WF2·WF3·WF6~WF12 JSON 삭제. WF4(일일 장애 리포트)와 WF5(반복 이상 에스컬레이션)는 아직 log-analyzer로 포팅되지 않았으므로 **보류 상태로 JSON만 보존**하고 README를 현행화.
6. **n8n Docker 서비스는 유지** — 향후 WF4/WF5를 포팅하기 전까지 컨테이너만 띄워두고 워크플로우는 import하지 않음.
7. **환경변수 정리**: `ADMIN_API_EXTERNAL_URL`과 `N8N_WEBHOOK_URL`은 피드백 경로 외 사용처가 없었으므로 `.env.local`·`.env.local.example`·`docker-compose.yml`에서 삭제. 대신 `FRONTEND_EXTERNAL_URL` 신규 도입.

**Consequences**
- ✅ Teams 피드백 제출이 admin-api로 직행해 n8n 장애와 무관해짐. 동일 엔드포인트를 React 인라인 폼과 공유하므로 유지보수 포인트가 하나로 통합.
- ✅ n8n 이중화된 DB insert + Qdrant 업데이트 로직 제거. 운영자가 한 곳의 FastAPI 로그만 보면 추적 가능.
- ✅ 알림 발송이 실패하거나 cooldown으로 skip되더라도 `alert_history`는 항상 먼저 저장되어 피드백 버튼 / 이력 조회 일관성 확보. 부수 효과로 duplicate(info) 로그 분석 알림도 `alert_history` row가 항상 존재하도록 조건 확장(`should_log_alert`).
- ⚠️ WF4/WF5가 현재 `active:false`로 멈춰 있어 "일일 장애 리포트"와 "반복 이상 에스컬레이션" 기능이 사실상 공백. 추후 log-analyzer에 `_daily_report_scheduler` / `_escalation_scheduler` 형태로 포팅 필요.
- ⚠️ `FRONTEND_EXTERNAL_URL` 환경변수가 운영 배포 체크리스트에 추가됨 — 미설정 시 `http://localhost:3001` 기본값이라 사내망에서 버튼 무반응.

**관련 파일**
- `main-server/services/admin-api/services/notification.py` (`_FRONTEND_EXTERNAL_URL`, `alert_history_id` 파라미터)
- `main-server/services/admin-api/routes/alerts.py:196-216` (flush 후 notifier 호출)
- `main-server/services/admin-api/routes/analysis.py:22-103` (`alert_record` 먼저 생성 → flush)
- `main-server/services/admin-api/routes/feedback.py` (HTML form + N8N 경로 제거)
- `main-server/services/frontend/src/pages/FeedbackSubmitPage.tsx` (신규)
- `main-server/services/frontend/src/components/layout/AuthGuard.tsx` (redirect 쿼리)
- `main-server/services/frontend/src/pages/auth/LoginPage.tsx` (redirect 복귀)
- `main-server/n8n-workflows/README.md` (보류 안내), WF1/2/3/6~12 JSON 삭제

---

## ADR-008: OpenTelemetry + Grafana Tempo 분산 추적 통합 (2026-04-18)

**Status**: Accepted

**Context**
- LLM 로그 분석이 "어떤 요청이 실패했는지" 까지는 파악 불가 — 로그 텍스트만으로는 요청 흐름 추적 안 됨
- Java WAS (Tomcat/JBoss/JEUS) 환경에서 OTel Java Agent 자동 계측으로 span 생성 가능
- tail-based sampling으로 에러 100%, 느린 요청(≥2s) 100%, 나머지 5% 랜덤 보존

**결정**
1. **Tempo**: `grafana/tempo:2.9.1` — local backend, 48h retention, metrics_generator OFF
2. **OTel Collector**: `otel/opentelemetry-collector-contrib:0.123.0` — tail_sampling(decision_wait=5s)
3. **OTel gating**: `agent_instances` EXISTS 쿼리만 — `systems` 테이블 컬럼 추가 금지
4. **DB 컬럼**: `log_analysis_history.referenced_trace_ids`, `alert_history.related_trace_ids` (JSON)
5. **LLM trace 예산**: 5min=400자/hourly=300자/daily=200자, log_content 축소 보상
6. **freshness 보정**: end_ts에서 15s earlier로 Tempo 조회 (tail_sampling decision_wait 고려)
7. **모델 타입**: SQLAlchemy `JSON` (PostgreSQL migration은 JSONB — SQLite 테스트 호환)

**영향/트레이드오프**
- OTLP 포트 `127.0.0.1:4317/4318` — 기존 bare port 패턴과 다름
- JDK 8: JAR v1.33.x (CVE-2026-33701 RMI 비활성화 권고), JDK 11+: v2.x
- JAR 바이너리 폐쇄망 사전 배치 필요 (`main-server/artifacts/otel/README.md` 참조)

**등록 UX / 설치 계정 정책 (2026-04-18 보강)**
- **등록 UX는 `AgentFormModal`로 통합**: `synapse_agent`/`db`와 동일하게 `/agents` 페이지 드롭다운에서 `otel_javaagent` 선택. 대시보드 상세(`DashboardSystemDetailPage`)는 `TraceDotChart` 조회만 담당, 미등록 시 에이전트 관리로 유도하는 안내 카드만 표시. `OtelAgentInstallForm` 컴포넌트 삭제.
- **설치 계정 기본값은 서비스 계정(non-root)**: `synapse-agent` 배포 원칙(`agent/config.sample.toml`)과 동일. SSH 계정 = WAS 기동 계정(`jeussic`, `jeuserp` 등), 설치 경로 = `~/otel` (admin-api가 원격 `echo $HOME`으로 tilde 확장). tomcat/jboss/jeus/standalone은 서비스 계정으로 충분.
- **systemd 시스템 유닛만 root 필수**: `/etc/systemd/system/*.service.d/` 쓰기 권한 때문. `service_type == "systemd"` + `ssh_username != "root"` 조합은 admin-api가 설치 시 `PermissionError`로 차단.

**대시보드 Trace 카드 지표 (2026-04-21 보강)**
- tail_sampling 이 `errors`(status=error)·`slow`(duration>2s) trace 를 100% 보존하고 정상 trace 만 5% probabilistic 로 남기므로, `error_count / total_sampled` 식의 **비율 지표는 구조적으로 편향**됨(정상 /ok 만 호출해도 90%+ 에러율로 표시되는 문제). 대시보드 심각도 판정은 **절대 건수** 기반으로 전환:
  - `error_count` + `slow_count` = `anomaly_count`
  - 임계치: 50 (경고) / 100 (위험). 관측 창은 필터 (현재 6h 고정)
- `get_trace_metrics` 응답 스키마에서 `error_rate` 필드 제거, `slow_count`·`anomaly_count`·`slow_threshold_ms` 추가. 프런트 `TraceTreemapSection`·`TraceDotChart` 모두 건수 기반 표시·범례로 재설계.
- **Slow 판정 동기화 규칙**: `admin-api/routes/traces.py` 의 상수 `_SLOW_THRESHOLD_MS` 는 Collector `tail_sampling.policies.slow.threshold_ms` 와 동일 값 유지. 한쪽만 바꾸면 Slow 카운트가 실제 보존 정책과 어긋남.

---

## ADR-009 — ReAct 챗봇: EMS in-process + 프롬프트 기반 ReAct (2026-04-18)

**상태**: Accepted

**배경**
- 사용자가 화면 전역에서 EMS/admin/log-analyzer를 한 자연어 인터페이스로 조회할 수 있어야 함
- 기존 `ems-mcp`는 stdio MCP 서버. 별도 Docker로 띄우면 운영/빌드 부담 증가
- 기존 LLM Strategy(`llm_client.py`)는 text 응답만 지원 (native function calling 없음)

**결정**
1. **ems-mcp는 별도 서비스로 분리하지 않고** `ems_client.py` 로직을 admin-api 내부로 포팅. MCP SDK 의존성 제거. 9개 도구를 파이썬 함수로 분리해 `services/chat_tools/executors/ems.py` 에 이관.
2. **프롬프트 기반 ReAct**: LLM이 `{thought, action, args}` 또는 `{thought, final_answer_ready}` JSON을 반환. 도구 실행 후 observation을 history에 append. 최종 답변은 별도 스트리밍 프롬프트로 호출해 토큰 단위 SSE 전달.
3. **Tool Registry는 DB** (`chat_tools` 테이블). `input_schema`는 JSON Schema draft-07. 관리자가 `/admin/chat-tools`에서 `is_enabled` 토글 → 다음 메시지부터 즉시 반영 (캐시 없음).
4. **도구 스키마 저장 방식**: 표준 JSON Schema로 저장해 향후 native function calling 지원 LLM으로 이관 시 그대로 재사용 가능.
5. **SSE 이벤트 타입**: `user_saved`/`iter_start`/`thought`/`tool_call`/`tool_result`/`token`/`final`/`error`. JSON 결정 단계는 버퍼링, 최종 답변만 토큰 스트리밍 (중간 JSON이 프론트에 깨진 상태로 노출되지 않도록).
6. **대화 맥락 재구성**: 매 사용자 전송 시 `chat_messages`에서 최근 20턴을 DB에서 재조회해 프롬프트에 주입 (in-memory 전용 상태 금지). 세션을 닫았다 열어도 컨텍스트 연속성 유지.
7. **첨부 이미지**: 업로드/저장/인라인 렌더까지 MVP 구현. LLM에 이미지를 전달하는 프로바이더별 포맷 변환은 v2로 유보.

**영향/트레이드오프**
- 장점: 배포 단순 (admin-api 한 컨테이너), 기존 ORM·인증·크립토 재사용, 토글 즉시성
- 단점: ems-mcp 별도 업데이트가 자동 반영되지 않음. 의도적으로 포크 유지 필요 시 `ems-mcp` 원본 참조 주석 유지.
- 대안: (기각) stdio MCP subprocess — 컨테이너 내 프로세스 관리 복잡도 및 stdio 파이프 수명 이슈

---

## ADR-010 — 공통 Fernet 키: `DB_ENCRYPTION_KEY` → `ENCRYPTION_KEY` (2026-04-18)

**상태**: Accepted

**배경**
- 기존 `DB_ENCRYPTION_KEY` (Fernet)가 DB 수집기 자격증명 암호화 전용이었음
- 챗봇 executor(EMS) 자격증명도 동일한 암호화 방식을 요구
- 키 네임스페이스가 DB에 한정되면 다른 도메인에서 혼란 유발

**결정**
1. 환경변수 `DB_ENCRYPTION_KEY` → **`ENCRYPTION_KEY`** 개명. 하위 호환 폴백 없음(배포 시 값 그대로 복사 재등록).
2. 암호화 함수 `encrypt_password`/`decrypt_password`를 `services/db_collector.py` → **`services/crypto.py`** 로 이관. 기존 호출부는 `services/crypto` 로 직접 import 경로 변경.
3. 챗봇은 `services/chat_tools/executor_config.py` 가 `config_schema`에서 `secret: true` 필드만 선택적으로 암호화/복호화 (아이디/URL 등은 평문).
4. 문서·스크립트 반영: `.env.example`, `.env.local.example`, `docker-compose.yml`, `verify-deploy.sh`, `deploy-guide.md`, `admin-api/CLAUDE.md`.

**영향/트레이드오프**
- 장점: 암호화 키의 범용성 + 다른 도메인(챗봇 executor 등) 자연스럽게 재사용
- 단점: 운영 시 env 파일 업데이트 필수(기존 값 복사). `grep -r DB_ENCRYPTION_KEY` 0건 확인으로 검증

---

## ADR-011: Ollama 제거 → FastEmbed(ONNX) + Qdrant Hybrid Search + RAG 챗봇 (2026-04-23)

**Status**: Accepted (Supersedes ADR-003 모델 교체 제약)

**Context**
- ADR-003에서 bge-m3(1024dim) → paraphrase-multilingual(768dim)로 교체했던 배경:
  Ollama on 2-core CPU 환경에서 bge-m3 임베딩 1건이 cold 130s+, warm 32s 소요되어 타임아웃 연발.
- 문제의 본질은 bge-m3 **모델**이 아니라 Ollama(llama.cpp 기반) **실행기**였음 — ONNX Runtime 기반 추론은 같은 모델도 크게 빠름.
- Qdrant 1.17은 sparse 벡터 + Query API의 `prefetch + RRF fusion`을 네이티브로 지원해 Hybrid Search 도입 비용이 크지 않음.
- 챗봇은 ReAct 에이전트(ADR-009)를 통해 EMS/admin/log_analyzer 툴은 연동하지만 Qdrant를 직접 활용하지 못하고 있어, 축적된 장애 지식(log_incidents / metric_baselines / aggregation_summaries)을 RAG로 재사용하지 못하는 상태.

**Decision**

1. **Ollama 제거 → ONNX 인프로세스 임베딩 (하이브리드 스택)**
   - 임베딩 런타임:
     - **Dense**: `onnxruntime>=1.17` + `transformers`(토크나이저) 조합으로 `BAAI/bge-m3` ONNX를 **직접 로드** (1024 dim, 한국어 고품질). 모델 ONNX 출력에 `sentence_embedding` (CLS pooling + L2 normalize 내장)이 포함되어 추가 후처리 불필요
     - **Sparse**: `fastembed>=0.8.0` 의 `SparseTextEmbedding("Qdrant/bm25")` (BM25 IDF)
   - FastEmbed `TextEmbedding`에 bge-m3 미지원 (#107/#348/#485/#511/#602 모두 OPEN) 및 `sentence-transformers`의 ONNX external-data 로딩 버그로 둘 다 회피 → **onnxruntime 직접 호출 경로 채택**
   - 실측 속도 (2-core CPU, warm): **Dense 35~90ms, Sparse 즉시, Hybrid `/points/query` RRF 전체 36ms**. ADR-003 Ollama bge-m3(warm 32s) 대비 **~300배 개선**
   - `sub-server/docker-compose.yml`에서 Ollama 컨테이너 삭제
   - log-analyzer 메모리 상향: 256m → 2048m (bge-m3 ONNX `model.onnx_data` ~2.1GB + 런타임)
   - **모델은 Dockerfile 빌드 단계에서 이미지에 번들** (`RUN python -c "SentenceTransformer(...); SparseTextEmbedding(...)"` 형태로 `/app/dense-models` + `/app/fastembed-models`). `make build-analyzer` 1회 → `docker save | gzip` → 폐쇄망에서 `docker load` → 수기 스테이징·볼륨 마운트 불필요
   - 런타임 안전장치: `HF_HUB_OFFLINE=1` (내장 모델만 사용)
   - 개발기 로컬 실행 시 HuggingFace 직접 접근이 막힌 네트워크에서는 `HF_ENDPOINT=https://hf-mirror.com` 으로 우회 다운로드 가능

2. **임베딩 모델 복귀 & 확장**
   - Dense: `BAAI/bge-m3` (1024 dim, 한국어 고품질, 8192 토큰). `_EMBED_MAX_CHARS` 100 → 3000으로 완화
   - Sparse: `Qdrant/bm25` (BM25 IDF, 키워드 매칭)
   - 모듈 레벨 싱글턴 + lazy-load로 서비스 부팅 속도 유지

3. **Qdrant Hybrid Search (Dense + Sparse RRF)**
   - `log_incidents`, `metric_baselines`, `aggregation_summaries`는 Hybrid(Dense 1024 + Sparse BM25)
   - `metric_hourly_patterns`는 Dense 전용 (LLM 자연어 요약이라 키워드 매칭 불필요)
   - 검색은 Qdrant Query API `/points/query` + `prefetch + fusion: rrf` 사용
   - prefetch 단계: dense cosine threshold=0.5 느슨하게 적용(완전 무관 결과 차단), sparse는 threshold 없음
   - 기존 `score_threshold` 파라미터는 받되 RRF에는 미적용 (점수 스케일 다름). classify_anomaly 임계값은 RRF 점수 기반(0.032/0.025/0.015)으로 재설정, 운영 후 튜닝 필요. **(2026-05-31 후속 보정: Qdrant RRF k=2 스케일(상한 1.0)에 맞춰 0.8/0.5/0.3으로 확정 — 커밋 7679f5e, `vector_client.py:classify_anomaly`. 알림성 인식 tier-2는 RRF rank 경쟁 문제로 dense 단독 cosine ≥ 0.9로 분리됨.)**

4. **RAG 챗봇 연동**
   - admin-api에 `qdrant` executor 신설 (`services/chat_tools/executors/qdrant.py`)
   - 도구 2종 등록:
     - `qdrant_search_incident_knowledge`: log_incidents + metric_baselines 통합 Hybrid 검색 (log-analyzer `/incident/search` 신규 엔드포인트)
     - `qdrant_search_aggregation_summary`: aggregation_summaries Hybrid 검색 (log-analyzer 기존 `/aggregation/search` 재활용)
   - `chat_agent.py._decision_prompt()`에 사용 가이드 추가 (admin_search_alert_history 보다 의미 검색이 필요한 질문에 우선 사용)
   - 환경변수 `LOG_ANALYZER_URL`을 qdrant executor도 공유 (config.base_url로 override 가능)

5. **운영 데이터 없음 → 재색인 스킵**
   - 기존 Qdrant 데이터 전량 삭제 후 서비스 재시작으로 Hybrid 스키마 자동 생성

**Consequences**
- ✅ 임베딩 추론 속도: Ollama HTTP 120s timeout → FastEmbed ONNX 인프로세스 (네트워크 왕복 제거 + ONNX 양자화)
- ✅ 한국어 임베딩 품질 복원: bge-m3 (ADR-003에서 포기했던 모델)
- ✅ 토큰 제한 완화: 100자 → 3000자 (bge-m3 8192 토큰 지원)
- ✅ 아키텍처 단순화: Server B에서 Ollama 제거 → 2GB RAM + 0.5 CPU 절약
- ✅ Hybrid Search로 에러 클래스명(NullPointerException, ORA-00060) 정확 매칭 + 의미 검색 동시 확보
- ✅ 챗봇이 축적된 장애 지식을 RAG로 답변에 활용 가능 ("OOM 전에도 발생했나?" 등)
- ⚠️ log-analyzer 메모리 8x 상향 필요 (256m → 2048m). Server A 리소스 영향 확인 필요
- ⚠️ FastEmbed ONNX 파일(~1.2GB)의 폐쇄망 사전 스테이징 운영 공수 추가
- ⚠️ classify_anomaly RRF 임계값은 운영 데이터 축적 후 재조정 필요
- ❌ 대안 검토:
  - bge-m3 Ollama 유지 + Hybrid만 추가 → CPU 타임아웃 재현 위험 (ADR-003)
  - paraphrase-multilingual 유지 + FastEmbed 전환 → 한국어 품질 이득 포기
  - Qdrant 서버 내장 추론 → Qdrant 서버는 추론 엔진 제공 안 함 (FastEmbed는 클라이언트 라이브러리)

**관련 파일** (ADR-011 당시 → ADR-012에서 추가 정리됨)
- `main-server/services/log-analyzer/Dockerfile` (ONNX 모델 번들 레이어: bge-m3 + BM25)
- `main-server/services/log-analyzer/requirements/base.txt` (+`onnxruntime`, `transformers`, `sentencepiece`, `fastembed`, `numpy`)
- `main-server/services/log-analyzer/vector_client.py` (전면 재작성)
- `main-server/services/log-analyzer/aggregation_vector_client.py` (Hybrid store/search)
- `main-server/services/log-analyzer/main.py` (+/incident/search, lifespan hybrid=True)
- `main-server/services/log-analyzer/analyzer.py` (dense+sparse 호출)
- `main-server/services/log-analyzer/aggregation_processor.py` (daily 집계 sparse 추가)
- `sub-server/docker-compose.yml` (Ollama 제거)
- `main-server/docker-compose.yml`, `docker-compose.dev.yml` (env + volume 변경)
- `main-server/.env.example` (OLLAMA_URL 삭제, DENSE/SPARSE/FASTEMBED_CACHE_PATH 추가)
- `main-server/services/admin-api/services/chat_tools/executors/qdrant.py` (신규)
- `main-server/services/admin-api/services/chat_tools/registry.py` (qdrant 등록)
- `main-server/services/admin-api/services/chat_agent.py` (decision_prompt 가이드)
- `main-server/services/admin-api/init.sql`, `migrations/20260423_qdrant_rag_chat_tools.sql` (qdrant 도구 시드)

**ADR-011 후속 (Track A — 2026-05-11)**: `knowledge_guides` 컬렉션도 bge-reranker-v2-m3 cross-encoder reranker 적용 대상에 추가됨. `guides_vector_client.search_guides(rerank=True, rerank_top_k=N)` 호출 시 RRF 결과를 reranker로 재순위화 후 guide_id 단위 그룹화. 챗봇 `qdrant_search_guide` 도구 및 `/search-verify/chatbot` 엔드포인트는 항상 rerank=True. `/search-verify/collections`에서 knowledge_guides 선택 시 use_reranker 파라미터 연동. `admin-api/routes/knowledge_verify.py`의 `_call_guide_search()` 헬퍼 + `_GUIDE_COLLECTIONS = {"knowledge_guides"}` 참고.


---

## ADR-012: LLM용 Ollama Strategy 제거 (2026-04-23)

**Status**: Accepted (Supersedes ADR-001 `ollama` provider slot)

**Context**
- ADR-011에서 임베딩용 Ollama는 제거했으나 `llm_client.py` Strategy의 `ollama` 옵션은 유지되어 있었음
- 운영 환경은 `LLM_TYPE=devx` (DevX OAuth)를 사용, 로컬은 `claude`/`openai`로 전환 가능
- Ollama를 LLM으로도 사용하지 않기로 확정 → 코드베이스 전체 정리 필요
- Server B에서 Ollama 컨테이너가 완전히 제거된 상태에서 Strategy만 남아 혼란 초래
- 배포 가이드, 검증 스크립트, seed 스크립트까지 Ollama 전제가 산재

**Decision**
1. **코드** — `OllamaStrategy` 클래스 삭제 (log-analyzer + admin-api 양쪽 SYNC), `_STRATEGIES` 딕셔너리에서 `"ollama"` 항목 제거
2. **테스트** — `test_build_strategy_known_types` assertion에서 `"ollama"` 제거
3. **환경변수** — `.env.local`, `.env.local.example`, `.env.example`에서 `OLLAMA_URL` 및 `LLM_TYPE=ollama` 기본값 제거. `LLM_MODEL=llama3` 기본값 제거
4. **docker-compose** — `main-server/docker-compose.yml` n8n 컨테이너의 `OLLAMA_URL`/`EMBED_MODEL` env 주입 삭제. `sub-server/docker-compose.yml`은 ADR-011에서 이미 처리됨
5. **배포 스크립트** — `scripts/export-ollama-model.sh`, `scripts/import-ollama-model.sh` 삭제
6. **배포 가이드** — `deploy-guide.md` Server B 섹션 2-1~2-5의 Ollama 이미지/모델 복원 절차 삭제, 환경변수 표/트러블슈팅 Ollama 항목 제거
7. **검증 스크립트** — `verify-deploy.sh` `.env` 필수 키에서 `OLLAMA_URL` 제거, Server B 확인 섹션의 Ollama 헬스체크 블록 전체 삭제
8. **테스트 시드** — `main-server/scripts/seed_test_data.py`에서 `call_ollama_llm`, `check_ollama`, `parse_llm_json` 제거. `generate_llm_analysis`를 템플릿 기반 fallback로 단순화
9. **문서** — `CLAUDE.md`, `README.md`, `docs/*` 에서 LLM_TYPE 허용값 `ollama` 제거, 제거 안내 추가. 과거 워크플로우 문서(phase0-prep, phase4b-vector, phase4d-agent, phase-serverb)는 최상단에 ADR-011/012 폐기 배너 추가

**Consequences**
- ✅ Strategy 옵션 축소: `devx` / `claude` / `openai`
- ✅ 배포 단순화: Server B는 Qdrant 전용, 폐쇄망 Ollama 모델 스테이징 절차 제거
- ✅ 환경변수 잡음 제거 (`OLLAMA_URL`, `EMBED_MODEL=bge-m3` 등)
- ✅ seed_test_data.py는 외부 LLM 호출 없이 동작 → 로컬 환경에서 추가 의존성 없음
- ⚠️ 기존 `.env`에 `LLM_TYPE=ollama`가 있을 경우 `_build_strategy`가 fallback으로 `DevxStrategy`를 선택 (테스트 `test_build_strategy_unknown_falls_back_to_devx`로 검증됨)
- ⚠️ 과거 워크플로우 문서의 구체적 Ollama 설치 절차는 역사 자료로만 남음 → 운영 배포 시 `deploy-guide.md`만 참조

**관련 파일**
- `main-server/services/log-analyzer/llm_client.py` (OllamaStrategy 삭제, 문서 주석 갱신)
- `main-server/services/admin-api/services/llm_client.py` (SYNC 삭제)
- `main-server/services/log-analyzer/tests/test_llm_client.py` (strategy 키 assertion 갱신)
- `main-server/.env.local`, `.env.local.example`, `.env.example` (OLLAMA_URL / LLM_TYPE=ollama / LLM_MODEL=llama3 제거)
- `main-server/docker-compose.yml` (n8n env 정리)
- `main-server/scripts/seed_test_data.py` (Ollama 의존 제거, 템플릿 fallback)
- `scripts/export-ollama-model.sh`, `scripts/import-ollama-model.sh` (삭제)
- `deploy-guide.md`, `verify-deploy.sh` (Ollama 섹션 제거)
- `README.md`, `CLAUDE.md`, `main-server/README.md`, `main-server/CLAUDE.md`, `main-server/services/admin-api/CLAUDE.md`, `main-server/services/log-analyzer/CLAUDE.md`
- `docs/architecture-design.md` v1.3 (ADR-011/012 반영)
- `docs/workflow.md`, `docs/data-flow.md`, `docs/test/test-plan.md`, `docs/workflow/1.phase0-prep.md`, `7.phase-serverb.md`, `8.phase4b-vector.md`, `10.phase4d-agent.md`, `11.phase5-final.md` (최상단 폐기 배너 / 본문 수정)

---

## ADR-013: UTC/KST 타임존 정책 표준화 (2026-04-23)

**Status**: Accepted

**Context**
- 시스템 전반에서 UTC/KST 혼재로 3가지 버그 존재:
  1. API 응답 datetime이 naive UTC ('Z' suffix 없음) → JS가 로컬 시간으로 파싱 가능 (9시간 오차 위험)
  2. 집계 버킷(hour_bucket/day_bucket 등)이 UTC 자정 기준 → KST 사용자 기준으로 날짜가 9시간 어긋남
  3. 배치 스케줄(KST)과 집계 버킷(UTC) 불일치 → "4월 21일 리포트"가 KST 04/21 09:00~04/22 08:59 데이터를 포함

**결정**
- **저장=UTC / 스케줄=KST / 표출=KST** 정책 유지 (변경 없음)
- Bug 1 수정: Pydantic v2 `PlainSerializer`로 모든 Out 모델의 datetime을 `UtcDatetime` 타입으로 교체 → 'Z' suffix 자동 추가
- Bug 2 수정: `aggregation_processor.py`의 버킷 경계를 KST midnight 기준으로 변경 후 UTC naive로 DB 저장
  - 예: KST 4월 22일 00:00 = UTC 4월 21일 15:00 → `hour_bucket = "2026-04-21T15:00:00"` 저장
  - 프론트엔드 `formatKST("2026-04-21T15:00:00Z")` → "2026-04-22 00:00" 표시 ✓
- Grafana: `GF_DATE_FORMATS_DEFAULT_TIMEZONE=Asia/Seoul` (이미 docker-compose.yml에 설정되어 있었음)

**영향**
- `admin-api/schemas.py`: `UtcDatetime` Annotated 타입 추가, 모든 Out 모델 datetime 필드 교체
- `log-analyzer/aggregation_processor.py`: `_KST` 상수 추가, hourly/daily/weekly/monthly/longperiod 버킷 계산 KST 기준으로 변경
- **기존 집계 데이터**: 변경 전 데이터는 UTC 기준 버킷으로 저장됨 (마이그레이션 불필요 — 신규 집계부터 KST 기준 적용)
- 프론트엔드 `normalizeUtc()`: 'Z'가 이미 있으면 그대로 통과 (완전 backward compatible)
- 테스트: 144 passed

**관련 파일**
- `main-server/services/admin-api/schemas.py` (UtcDatetime 타입 + Out 모델 전체)
- `main-server/services/log-analyzer/aggregation_processor.py` (_KST + 버킷 계산 5개 함수)

---

## ADR-014: 에러 알림 예외 처리 (Alert Exclusion) 기능 (2026-04-25)

**Status**: Accepted

**Context**
- 운영 현장에서 `ERROR` 레벨 로그가 실제 장애가 아니라 배치 작업·의도된 로깅으로 쓰이는 경우 불필요한 알림/인시던트 대량 발생
- 기존에 이를 막는 수단이 없었음 (`AlertCooldown`은 5분 중복 차단뿐)

**결정**
1. **매칭 키**: `(system_id, instance_role, template)` — `instance_role=NULL`이면 해당 시스템 전체 role에 적용. template은 synapse_agent가 정규화한 Prometheus `log_error_total.template` 라벨 원본
2. **매칭 방식**: template 정확 문자열 일치 (MVP). 유사도 기반은 후속 과제
3. **이중 게이트**:
   - 1차: log-analyzer `run_analysis()` 시작 시 활성 규칙 캐시 → 각 template 필터링 (LLM 호출 전)
   - 2차: admin-api `POST /api/v1/analysis` 수신 시 재확인 (캐시 미스 방어)
4. **수집 처리**: 예외 매치 시 `log_analysis_history`에 `excluded=true, exclusion_rule_id` 로 최소 이력 저장 (감사·통계용). 알림/인시던트/Teams 발송/LLM 호출 모두 스킵
5. **해제**: Soft delete(`active=false`) — 해제 이후 다음 수집 주기부터 정상 처리 재개. 과거 소급 없음
6. **UI**: `/alerts` 페이지에 통합 (별도 admin 페이지 없음). 체크박스 다건 선택 → "선택 예외 처리" 일괄 등록. "예외 처리됨" 탭에서 목록/해제
7. **templates 저장**: `log_analysis_history.templates_json` (JSONB) + `alert_history.log_analysis_id` FK로 UI에서 template 목록 조회 가능

**대안 검토**
- 유사도 기반 매칭 (Qdrant RRF 임계값): 오탐 위험, 설명 불가능 → 기각
- Prometheus label 필터 (synapse_agent 수정): agent 변경 비용 큼 → 기각
- (system_id, instance_role) 기준 넓은 예외: 너무 broad → 기각

**영향**
- 신규: `alert_exclusions` 테이블, `services/exclusion_filter.py`, `routes/alert_exclusions.py`, `api/alertExclusions.ts`
- 변경: `log_analysis_history`(excluded/exclusion_rule_id/templates_json 컬럼), `alert_history`(log_analysis_id 컬럼), `routes/analysis.py`(게이트), `routes/alerts.py`(bulk-exclude), `log-analyzer/analyzer.py`(캐시+게이트), `pages/AlertHistoryPage.tsx`, `components/alert/AlertTable.tsx`
- DB 마이그레이션: `main-server/configs/postgres/migrations/add_alert_exclusions.sql`
- 테스트: 144 passed

**2026-05-12 보강**: prometheus_analyzer 메트릭 알림 예외 처리 추가 (`metric_exclusions`)

**배경**
- ADR-014 본문의 `alert_exclusions` 는 로그 알림 전용(template 정확 매칭). admin-api 내부 백그라운드 루프(`prometheus_analyzer.py`)가 5분마다 자동 생성하는 CPU/메모리/디스크 I/O/네트워크/HTTP/로그 에러율 이상 알림은 template 없음 → 같은 예외 처리 메커니즘에 태울 수 없었음
- 개발기 등 일부 호스트만 디스크 I/O 둔감화하고 싶은 운영 요구

**결정**
1. **별도 테이블 `metric_exclusions`** 신설 — 매칭 키 `(system_id, host, metric_type)`. host=NULL 와일드카드 (시스템 전체). `alert_exclusions` 확장하지 않은 이유: `template`(텍스트) vs `host + metric_type`(카테고리) 도메인 직교, 컬럼 추가 시 의미 오염 + log-analyzer 매처에 metric 행 스킵 분기 필요
2. **두 가지 동작**: `override_threshold IS NULL` 완전 차단 / 값 있으면 임계치 대체 (개발기 둔감화)
3. **매칭 시점**: log 예외처리와 대칭 — cycle 시작 시 활성 규칙 캐시 → push 사이트(CPU L232, 메모리 L250, 로그에러율 L277, HTTP L298, 네트워크 RX L316, 네트워크 TX L338, 디스크 I/O L360)에서 검사. 매칭 + 완전 차단 시 `sm.cpu_avg` 등 raw 필드 비할당(severity 계산 부작용 방지) + anomaly skip → 결과적으로 AlertHistory INSERT 자체 차단
4. **메트릭 종류 enum 7종**: cpu, memory, disk_io, network_rx, network_tx, http_latency, log_error_rate. 한글 라벨/단위는 `services/metric_types.py` (Python) + `frontend/src/constants/metricTypes.ts` (TS)에 동기화 주석으로 단일 진실 유지
5. **AlertHistory.metric_types JSONB 컬럼** 추가 — prometheus_analyzer 가 INSERT 시 묶인 메트릭 종류 저장. 레거시 NULL 행은 title 정규식으로 폴백 추출 (`extract_metric_types_from_title`)
6. **UI 통합**: 기존 AlertHistoryPage 예외처리 모달 확장. 로그+메트릭 혼합 선택 시 모달 상단 탭 분리. 메트릭 모드는 호스트 + metric_type 체크박스 + override_threshold 입력 + "시스템 전체 host 적용" 토글
7. **HTTP 지연 한계**: Prometheus 쿼리에 임계치가 박혀 있어 V1 은 완전 차단만 지원 (override_threshold 무시). 후속에서 쿼리 동적 생성으로 개선 가능

**영향**
- 신규: `metric_exclusions` 테이블, `services/metric_types.py`, `routes/metric_exclusions.py`, `api/metricExclusions.ts`, `constants/metricTypes.ts`, `tests/test_metric_exclusions.py` (21 신규 테스트)
- 변경: `alert_history.metric_types JSONB` 컬럼 추가, `prometheus_analyzer.py` push 사이트 7곳 + `_check_metric_exclusion` 헬퍼 + cycle 시작 시 규칙 로드 + skip_count 일괄 갱신, `AlertHistoryPage.tsx` 모달 분기 + 액션 바, `AlertTable.tsx` 체크박스 disabled 조건 완화
- DB 마이그레이션: `main-server/configs/postgres/migrations/20260512_add_metric_exclusions.sql`
- 테스트: 451 + 21 = 472 passed (admin-api 전체 regression OK)

**2026-04-25 보강**: count 임계값(`max_count_per_window`) + 자동 만료(`expires_at`) 추가

**배경**
- template 정확 매칭만으로는 (1) 같은 template이 평소 노이즈에서 폭증 장애로 전환되는 케이스를 못 잡음, (2) 등록 후 stale한 규칙이 누적되며 운영 환경 변화에 적응 못함
- 변종 장애 미탐지 위험: 분당 1~2건의 노이즈로 등록한 예외도, 분당 500건 폭증 시 그대로 무시 → 장애 인지 지연

**결정**
1. **count 임계값** (`max_count_per_window` INTEGER NULL): 5분 윈도우 내 발생 건수가 임계값 이하일 때만 예외 적용. NULL이면 무제한 (기존 동작 호환)
2. **자동 만료** (`expires_at` TIMESTAMP NULL): Lazy 검증 — 매칭 시점 + list API에서 `expires_at <= now`이면 제외. 백그라운드 sweep 잡 없음 (단순성 우선)
3. count 검사는 **log-analyzer 1차 게이트**(in-process count) + **admin-api 2차 게이트**(`template_counts` payload 필드)에서 수행
4. UI 모달: count 임계값 입력 (선택) + 만료 옵션 셀렉트 (30일 권장, 7/90일/직접 지정/없음)
5. "예외 처리됨" 탭에 임계값/만료 컬럼 + 만료 배지 (활성/만료/해제됨 3-state)

**대안 검토**
- baseline 자동 학습 (옵션 C): 설정 부담 vs 정확도 트레이드오프. 데이터 쌓인 후 별도 ADR로 검토
- 백그라운드 cron sweep: Lazy 방식으로 충분, 필요 시 후속

**영향**
- 변경: `alert_exclusions` 테이블 컬럼 2개 추가, `is_excluded()` count 인자, `_is_template_excluded()` log-analyzer 만료/count 로직, `LogAnalysisCreate.template_counts`, `AlertHistoryPage` 모달/탭, `alertExclusions.ts` 타입
- DB 마이그레이션: `main-server/configs/postgres/migrations/alert_exclusions_count_expiry.sql`
- 하위 호환: 신규 컬럼 NULL → 기존 동작 그대로, 무중단 배포 가능
- 테스트: 164 passed (기존 154 + 신규 10)


---

## ADR-015: 챗봇 다중 시스템 스코프 + 메시지별 system_id (2026-04-29)

**Status**: Accepted

**Context**
- 챗봇이 단일 `visitor_system_id`만 보관 → 사용자가 "여러 시스템 동시 검색" 의도 못 살림
- "지식 검색 대상" 단일 select라 매번 시스템 선택 강요, "담당 시스템 모두" 같은 자연스런 디폴트 없음
- 시스템별 챗봇 활용 통계(예: "이번 달 CRM 관련 질문 47건") 데이터 없음 — `chat_messages`에 `system_id` 미존재
- "이전 대화" 검색·이름변경·소프트삭제 부재로 운영 사용성 빈약

**Decision**
1. **데이터 모델 — Hybrid 배열 + 단일 컬럼**:
   - `chat_sessions.system_ids INTEGER[]` (GIN 인덱스) — 사용자가 미리 고른 N개 시스템 (세션 의도)
   - `chat_messages.system_id INTEGER FK→systems(id)` — 메시지가 실제 어느 시스템 질문이었는가 (통계용)
   - `chat_sessions.deleted_at TIMESTAMP` — 소프트 삭제 (목록 제외, 데이터 보존)
2. **API**:
   - `POST /api/v1/chat/sessions` body에 `system_ids` 옵셔널
   - `PATCH /api/v1/chat/sessions/{id}` 신설 (title, system_ids)
   - `GET /api/v1/chat/sessions?q=` ILIKE 제목 검색 + `deleted_at IS NULL`
   - `DELETE /api/v1/chat/sessions/{id}` 하드→소프트 삭제 변경
   - `GET /api/v1/chat/statistics?from=&to=&group_by=system` (admin only)
3. **메시지 system_id 추출 폴백 순서**: `tool_args.system_id` → `tool_args.system_name` → `tool_result` 단일 시스템 → 세션 `system_ids`가 1개면 그것 → NULL
4. **Qdrant 검색 필터 다중화** — `system_ids: list[int]` 추가 (기존 단일 `system_name` 유지)
5. **프론트**: `SystemMultiSelect` 공용 컴포넌트, 디폴트(일반=담당 시스템 모두 / admin=전체 / 담당 0개=빈 상태), "전체 시스템" 옵션 제거, 세션 ⋯ 메뉴(이름변경/삭제), 사이드바 검색(200ms debounce), 추천 카드 동적 치환(`useChatPromptCategories`)

**대안 검토**
- 정규화 매핑 테이블 `chat_session_systems(session_id, system_id)`: 사이드바 50개 세션 로드마다 LEFT JOIN+GROUP_CONCAT 부하 → 기각
- 백엔드 미변경, 프론트 zustand에만 보관: 시스템별 통계 요구사항 충족 불가 → 기각

**영향**
- 신규 테이블 없음. 컬럼 3개 + 인덱스 3개 추가
- 신규: `routes/chat.py`(PATCH/statistics), `services/admin-api/services/chat_agent.py`(system_id 추출), `services/chat_tools/executors/qdrant.py`(다중 필터)
- 신규 프론트 컴포넌트 5개: `SystemMultiSelect`, `ChatSessionSearchInput`, `SessionItemMenu`, `SessionRenameModal`, `SessionDeleteConfirmModal`
- 신규 훅 2개: `useChatPromptCategories`, `usePatchChatSession`
- 시그니처 변경: `chatStore.filterSystemId` → `filterSystemIds: number[]`, `ChatHeader` props 다중화
- DB 마이그레이션: `main-server/configs/postgres/migrations/20260429_chat_multi_system.sql`
- 하위 호환: 새 컬럼 모두 nullable 또는 기본값(빈 배열) → 무중단
- 테스트: admin-api 213 passed (기존 200 + 신규 13)

---

## ADR-016: 게스트 챗봇 이전 대화 이어가기 — localStorage 24h (2026-04-29)

**Status**: Accepted

**Context**
- `/chat/guest`는 인증 없이 사번으로 접근하는 현업 직원용 운영 지식 챗봇 (admin 페이지 외부, AppLayout 미사용)
- 매번 visitor_form → system_select → chat 흐름을 새로 시작하고, 페이지 떠나면 메시지가 사라짐 (`messages`는 React 로컬 state)
- 운영 가치 있는 패턴: "오전에 물어본 절차를 오후에 다시 보기" — 같은 브라우저·같은 사번 단위로 1일 이내 재방문이 잦음
- 한편 사번은 인증 수단이 아니라 추측·공유 가능. 공용 PC 환경(매장·영업)도 흔함

**Decision**
1. **localStorage 24h 보관 + 사번 변경 wipe + 수동 clear** 조합으로 진행
2. **메시지 본문은 localStorage에 저장 안 함**. 메타(`session_id`, `title`, `last_message_at`, `system_ids`)만 보관 → 5MB 한계·XSS 표면 축소. 본문은 신규 백엔드 endpoint로 조회.
3. **신규 endpoint**: `GET /api/v1/help/sessions/{id}/messages?employee_id=...`
   - `_get_help_session` (area='help_inquiry' + deleted_at IS NULL) 검증
   - `visitor_employee_id == query.employee_id` 매칭 — 불일치 403
   - `chat_messages` 시간순 반환
4. **Phase 확장**: `visitor_form → recent_sessions → (system_select | chat)`. 사번 일치 cache + 세션 ≥1 일 때만 recent_sessions 노출
5. **wipe 트리거 4종**: ① 진입 시 expires_at 만료 ② 사번 변경 ③ 메시지 활동 시 expires_at = now+24h 갱신 ④ chat 헤더 수동 버튼
6. **세션 보관 5개 LRU** (last_message_at DESC)

**대안 검토**
- **옵션 A 현행 유지**: 운영 가치 부족 → 기각
- **옵션 C — `visitor_employee_id` 기준 백엔드 세션 목록 조회**: 사번이 인증이 아니라 다른 사람 사번 추측·공유로 정보 유출 가능 → 기각
- **세션ID 단독을 강한 토큰으로 사용 (사번 매칭 생략)**: UUID v4 122-bit 만으로 추측 불가능하지만 감사 로그에 "어떤 사번이 어떤 세션을 조회했는지" 기록되도록 사번 매칭 추가 → 정보 가치 vs 비용 trade-off에서 매칭 채택
- **JWT 기반 단기 토큰 발급**: 과한 복잡도 — 후속 ADR로 보류

**영향**
- 신규 endpoint: `GET /api/v1/help/sessions/{id}/messages` (admin-api `routes/help.py`)
- `_get_help_session` 헬퍼에 `deleted_at IS NULL` 필터 추가 (POST messages / escalate 경로도 자동 보호)
- 신규 프론트 모듈: `lib/guestSessionCache.ts` (loadCache, wipeCache, addOrUpdateSession, removeSession, TTL 24h, MAX 5개)
- 신규 컴포넌트: `components/help/GuestRecentSessions.tsx`
- 변경: `api/help.ts`(getMessages 추가), `HelpVisitorForm.tsx`(사번 변경 wipe), `GuestEntryPage.tsx`(phase 확장 + 캐시 동기화 + chat 헤더 wipe 버튼)
- 코드베이스에 처음 도입되는 localStorage TTL 패턴 — 소형 모듈로 분리하여 테스트 가능
- 하위 호환: 기존 visitor_form / system_select / chat / escalated phase 모두 그대로 동작 — recent_sessions는 cache 있을 때만 끼어듦
- 테스트: admin-api 218 passed (기존 213 + 신규 5)

---

## ADR-017: 챗봇 UX 디테일 (Toast Undo / 모바일 affordance / Microcopy 톤) (2026-04-29)

**Status**: Accepted

**Context**
- /impeccable:critique 결과 30/40 — 기술 품질은 견고하나 User Control(3), Error Prevention(5), Error Recovery(9), Help and Documentation(10) 영역 보강 필요
- 운영팀 신뢰는 "실수했을 때, 처음 왔을 때, 잘못됐을 때"의 디자인 개입에서 형성됨

**Decisions**
1. **삭제 Undo 패턴**: 세션 `DELETE` 후 8초 토스트에 "되돌리기" action 노출 → `POST /sessions/{id}/restore` (deleted_at = NULL). 백엔드는 `_ensure_owner` 우회한 별도 핸들러로 deleted 세션도 조회 가능하게 처리, 본인 user_id 검증만 유지.
2. **에러 메시지 분기**: `lib/chatErrorMessage.ts` 헬퍼 — `AbortError`는 빈 문자열(toast 안 띄움), 401/403=세션 만료, 404=세션 없음, 5xx=서버 일시 문제, 네트워크 실패=연결 문제. 모든 SSE 호출부(ChatPage/Panel/GuestEntryPage)가 동일 헬퍼 사용.
3. **모바일 affordance**: 사이드바 ⋯ 메뉴를 `md:opacity-0 md:group-hover:opacity-100`으로 변경 — 데스크탑은 hover 의존, 모바일/터치는 항상 가시. 매장 PC 환경 대응.
4. **게스트 톤 분리 정책**: 인증 페이지(/chat) = clinical 운영 톤 유지. 게스트 페이지(/chat/guest) = 현장 직원 친근 톤 ("어떤 도움이 필요하세요?", "{system_names} 관련 질문에 답해드려요"). 두 페이지가 다른 사용자 그룹을 대상으로 함을 명시.
5. **사번 마스킹**: GuestRecentSessions 부제에서 visitor_employee_id를 `EM***34` 형태로 부분 마스킹 — 매장 공용 PC 어깨너머 노출 차단.
6. **추천 카드 그룹핑**: 6개 카드를 "시스템 상태(실시간)" 3개 + "지식·이력(정적)" 3개로 sub-header 분할. cognitive load 권장 한계(4) 안에 들어가도록.
7. **신뢰 신호 명시**: HelpVisitorForm/GuestRecentSessions에 "이전 대화는 24시간 동안 이 브라우저에만 보관돼요" 안내 — 데이터 보관 정책을 사용자에게 투명하게 노출.

**대안 검토**
- Confirm 모달로 모든 wipe 보호: 의도된 단순성 깨짐 → 기각, 토스트 Undo로 충분
- ChatLauncher 더블클릭 affordance 변경: critique에서 잘못 짚은 항목(실제로는 차트 컴포넌트의 텍스트)이라 변경 불필요
- Modal 공통 셸 추출(ADR-016 후속): 이미 `components/common/Modal.tsx`로 완료

**영향**
- 신규: `lib/chatErrorMessage.ts`, `useRestoreChatSession` 훅, `POST /sessions/{id}/restore` 백엔드 endpoint + 단위 테스트 2개
- 변경: `ChatPage.tsx`(Undo toast), `ChatPanel.tsx`(에러 메시지), `GuestEntryPage.tsx`(헤더 microcopy + system 매핑), `HelpVisitorForm.tsx`(친근 톤 + 신뢰 신호), `GuestRecentSessions.tsx`(사번 마스킹 + micro-help), `useChatPromptCategories.ts`(그룹 시그니처), `SessionItemMenu.tsx`(모바일 affordance)
- 테스트: admin-api 220 passed (218 + restore 2건)
- 점수 예상: critique 30/40 → 35+ 권역 (User Control + Error Recovery + Help and Documentation 영역 직접 개선)

---

## ADR-014: OIDC IdP — Synapse를 내부 타시스템의 Identity Provider로

**배경**
내부에서 직접 개발하는 타시스템들이 Synapse의 사용자 계정으로 SSO 로그인을 원함.
Synapse는 이미 자체 username/password DB(`users` 테이블)를 보유하고 있어 IdP 역할 확장이 자연스러움.

**결정**
- **OIDC Authorization Code Flow** 채택. SAML은 상용 솔루션과 연동 시 어쩔 수 없이 사용하는 것으로, 직접 개발 시스템에 불필요한 XML/복잡도를 강요함.
- **ID Token 서명: RS256(비대칭키)**. HS256(대칭키)은 `SECRET_KEY`를 모든 클라이언트와 공유해야 하므로 보안 리스크. RS256은 공개키만 배포하면 검증 가능.
- **RSA 키 관리**: 환경변수(`OAUTH_PRIVATE_KEY`, `OAUTH_PUBLIC_KEY`) PEM 문자열로 관리. 컨테이너 재시작 시에도 일관된 키 유지.
- **Access Token**: HS256(기존 SECRET_KEY 재사용, `type="oauth_access"` 구분). ID Token과 분리하여 userinfo 전용으로 사용.

**트레이드오프**
- PKCE 미구현: 내부 시스템 전용이므로 신뢰도가 높아 생략. 향후 퍼블릭 클라이언트 필요 시 추가.
- RSA 키 교체 시 다운타임: 환경변수 교체 후 재시작 필요. 다중 kid 로테이션은 현재 미구현.

**영향**
- 신규: `routes/oauth.py` (OIDC 전체), `models.py` OAuthClient/OAuthAuthorizationCode, `init.sql`/migration 추가
- 변경: `auth.py` (RSA 키 함수 + `create_id_token` + `create_oauth_access_token`), `main.py` 라우터 등록
- 프론트엔드: `OAuthLoginPage.tsx`, `OAuthClientsPage.tsx`(/admin/oauth-clients), Sidebar 메뉴 추가
- 환경변수: `OAUTH_PRIVATE_KEY`, `OAUTH_PUBLIC_KEY`, `OAUTH_ISSUER`
- 테스트: 기존 220 passed 영향 없음

---

## ADR-018: knowledge_guides 인덱싱 주체 이전 — admin-api → log-analyzer + Hybrid 전환 (2026-05-09)

**배경**
초기 `knowledge_guides` 컬렉션은 admin-api(`services/qdrant_guides.py`)가 Dense-only(Cosine)로 직접 인덱싱했고, `routes/chat.py`에서 ReAct 루프 시작 *전에* 사전 검색하여 이미지 URL만 추출했다. 가이드 텍스트(title/content)는 LLM 컨텍스트에 들어가지 못해 답변 품질을 떨어뜨렸다.

또한 다른 knowledge 컬렉션(`knowledge_documents`/`knowledge_jira_issues`/`knowledge_confluence_pages`)은 모두 log-analyzer가 Hybrid(Dense+BM25)로 관리하고 있어 점수 정규화·서비스 경계가 어긋났다.

당초 컬렉션 설계 의도는 **시스템별 운영 가이드 + Synapse 공통 사용 가이드 통합**(system_id=NULL = 전체 공용, system_id=N = 시스템별)이었으나 운영상 Synapse UI 사용법 위주로만 활용되었다.

**결정**
- 컬렉션 인덱싱·검색 주체를 **log-analyzer로 이전**한다 (`guides_vector_client.py` + `routes/guides.py`).
- 컬렉션 스키마를 **Dense(1024) + Sparse(BM25) Hybrid**로 통일한다 (다른 knowledge 컬렉션과 동일).
- admin-api `services/qdrant_guides.py`는 log-analyzer HTTP 프록시로 전환 (시그니처 호환).
- `routes/chat.py:177` 사전 가이드 검색 코드 + meta 이벤트(이미지 첨부) 제거.
- ReAct 도구 `qdrant_search_guide` 신규 등록 (`chat_tools` 시드). LLM이 능동적으로 검색하며, 세션의 `system_ids` + `system_id IS NULL` 필터를 log-analyzer 측에서 OR 조합으로 적용한다.
- `_HELP_ALLOWED_TOOLS`에 `qdrant_search_guide` 추가 (현업 게스트 챗봇도 가이드 검색 허용).
- Point ID는 admin-api `KnowledgeGuide.id` (UUID 문자열)를 그대로 사용 (Qdrant native UUID 지원).

**트레이드오프**
- 기존 Dense-only 컬렉션은 차원/스파스 추가가 불가능하므로 **삭제 후 재생성** 필요. 1회용 마이그레이션 스크립트 제공: `services/admin-api/scripts/migrate_guides_to_hybrid.py` (`DRY_RUN=1` 지원).
- log-analyzer `ensure_guides_collection`은 Dense-only 잔존 시 자동 재생성하지 않고 WARNING만 남긴다 (운영 데이터 보호 — 마이그레이션 스크립트 사용 강제).
- 가이드 이미지 자동 표시(meta 이벤트) 제거. LLM 답변에 가이드 텍스트가 포함되며, 이미지 UX는 별도 후속 작업으로 분리.

**영향**
- log-analyzer 신규: `guides_vector_client.py`, `routes/guides.py` (3 endpoint), `main.py` lifespan ensure + 라우터 등록
- admin-api 변경: `services/qdrant_guides.py` HTTP 프록시 전환, `services/chat_tools/executors/qdrant.py` `_search_guides` 추가, `services/prompts.py` 트리거 추가, `services/chat_agent.py` `_HELP_ALLOWED_TOOLS` 확장, `routes/chat.py` 사전 검색 제거, `main.py` lifespan ensure 호출 제거
- DB: `chat_tools` 테이블에 `qdrant_search_guide` 행 추가 (`init.sql` + `migrations/20260509_add_qdrant_search_guide_tool.sql`)
- 1회용 스크립트: `scripts/migrate_guides_to_hybrid.py`
- 테스트: 기존 277 passed 유지



---

## ADR-019: SSL 내부망 발급을 ACME → 직접 서명(cryptography)으로 전환

**상태**: 채택 (2026-05-31)

**맥락**:
- 기존 `ssl_issuer.py`는 acme.sh ACME(http-01, `--standalone --httpport 8080`)로 내부망 인증서를 발급했으나, 운영기에서도 동작 불가였다:
  - acme.sh 챌린지 서버 8080이 admin-api(uvicorn 8080)와 같은 네임스페이스에서 포트 충돌
  - 와일드카드(`*.shinsegae.com`)는 ACME 규약상 http-01 불가(DNS-01 필요)인데 코드는 http-01 사용
  - 운영 `docker-compose.yml`에 SSL env/볼륨·acme.sh 번들이 없어 배포 결선도 미완성
- 이 시스템은 **중앙(admin-api) 발급 → paramiko push 배포** 모델이라 각 타겟 서버의 80 검증이 불필요하다.
- step-ca는 우리가 통제하는 **사설 CA**이므로 ACME 챌린지 없이 직접 서명이 가능하다.

**결정**:
- **내부망**: intermediate CA 키로 leaf 인증서를 **직접 서명**(`cryptography`). 챌린지 없음, 와일드카드 SAN(`*.shinsegae.com` + `shinsegae.com`) 포함. acme.sh/socat/포트(8080) 의존 제거.
  - 구현은 `cryptography`(이미 `requirements/base.txt`, OIDC RS256용)로 통일 → 외부 바이너리·bind mount·OS 호환·uid 이슈 전부 회피(admin-api 이미지 `python:3.11-slim` + 비루트 `1036:510`).
  - CA 생성도 `cryptography`로 통일(`scripts/ssl_ca_gen.py`) — smallstep/step-ca 이미지는 intermediate 키를 비밀번호로 암호화 저장해 무암호 PEM 로드와 비호환.
  - leaf 서명은 단일 헬퍼 `ssl_issuer.sign_leaf()` — 부트스트랩(샌드박스 와일드카드)과 `issue_or_renew`가 공유.
- **DMZ(외부망)**: 기존 http-01 acme.sh 번들(`ssl_dmz.py`) 유지 — DMZ 서버가 자체 발급(중앙 acme.sh 아님). 변경 없음.
- 새 env: `STEP_CA_INTERMEDIATE_CERT`, `STEP_CA_INTERMEDIATE_KEY` (intermediate CA 경로).
- `issue_or_renew()` 시그니처/반환(`{domain, install_dir, rc, output}`)·결과물 경로(`{CERT_BASE}/wildcard/{fullchain.cer,cert.key,ca.cer}`) 유지 → `ssl_scheduler`·`ssl_deployer`·`ssl_monitor` 무변경.

**결과**:
- 8080 충돌·와일드카드 http-01 모순·acme.sh 번들 문제 원천 해소.
- 폐쇄망 배포 시 외부 바이너리 0 (cryptography만).
- 로컬 Mac 샌드박스(`make ssl-sandbox-*`)로 발급·배포·모니터링 end-to-end 테스트 가능(호스트 무오염).

**검증 전략**: 1차 로컬 Mac 샌드박스(직접 서명은 순수 파이썬이라 OS 차이 무관) → 2차 운영기/스테이징 실환경(테스트 전용 도메인·타겟 한정, 운영 서비스 미접촉).

---

## ADR-020: 대시보드 트렌드 차트 — 시스템별 fan-out 쿼리를 system_name 합산쿼리로 전환 (2026-06-10)

**상태**: 채택 (2026-06-10)

**맥락**:
- 운영서버(4-core, 확장 불가)에서 대시보드 로드 시 `GET /api/v1/systems/{id}/metrics/range` 요청이 타임아웃.
- `TrendMonitorSection.tsx`가 `useQueries`로 (선택 시스템 N개) × (TREND_CHARTS 4종: cpu/memory/log/web) = 4N개 요청을 병렬 발사하고, 각 요청이 admin-api에서 다시 `asyncio.gather`로 2~3개 PromQL `query_range`(15s timeout, 커넥션 풀 없는 `httpx.AsyncClient` per-request)를 호출 → 시스템 수가 늘수록 최대 ~9N개 Prometheus 쿼리가 동시에 발생.
- 인프라 확장이 불가하므로 쿼리 수 자체를 줄여야 함.

**결정**:
- admin-api에 신규 엔드포인트 `GET /api/v1/systems/metrics/range-batch?metric_group=...` 추가 (`routes/aggregations.py` `_metrics_router`).
  - `TREND_BATCH_PROMQL`: 차트별 PromQL에서 `system_name="{sn}"` 필터 대신 `by (system_name)` 그룹화 사용 (예: `max by (system_name) (cpu_usage_percent{core="total"})`).
  - 차트당 PromQL **1회**로 전체 시스템을 동시에 조회 → 응답을 `{ "<system_name>": [{hour_bucket, value}, ...] }`로 변환.
- 프론트엔드 `TrendMonitorSection.tsx`: 기존 N×4 `useQueries` fan-out을 차트당 1개(총 4개) 쿼리로 교체. `system_name → display_name` 매핑(`displayNameBySystemName`)으로 결과를 화면 표시명에 매핑하고, 선택된 시스템(`targetSystemNames`)만 필터링.
- 시스템 상세 페이지용 `GET /{system_id}/metrics/range`(인스턴스별 `_by_inst` 변형 포함)는 변경 없음 — 대시보드 전용 경량 엔드포인트만 신설.

**결과**:
- 대시보드 로드 시 Prometheus 쿼리 수가 시스템 수 N에 무관하게 **차트당 1회(총 4회)**로 고정됨.
- `TREND_CHARTS`에서 더 이상 쓰이지 않는 `collectorType`/`metricKey` 필드 제거.

**관련**: 동일 세션에서 log-analyzer Jira/Confluence 동기화의 `GET /api/v1/knowledge/sync-status` 인증 불일치(매일 401 → `last_sync_at=None` → 전체 재동기화) 버그도 함께 수정 — `GET /sync-status`에서 `Depends(get_current_user)` 제거 (POST와 동일하게 무인증, 내부 신뢰 호출 전제).
