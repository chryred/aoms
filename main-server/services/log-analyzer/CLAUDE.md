# Synapse-V Log Analyzer — 서비스 개요

> 전체 아키텍처·데이터 흐름·ADR 상세는 `.claude/memory/` 참조 (예: `.claude/memory/adrs.md`의 ADR-001 LLM Strategy, ADR-003 임베딩 교체(ADR-011로 일부 번복), ADR-004 컬렉션 자동 보증, ADR-011 FastEmbed+Hybrid).

## 목적

synapse_agent → Prometheus 로그 메트릭 수집 → LLM 분석 → Teams 알림 파이프라인의 실행 주체.
(Loki 의존성 완전 제거 — 로그는 `log_error_total` Prometheus 메트릭으로 수집)
- **내부 스케줄러**가 모든 주기 작업을 처리. n8n 의존성 제거됨(과거 WF1/WF6~WF11 이관 완료, 자세히는 ADR-006 참조)
- PII 마스킹 → ONNX 인프로세스 Dense(bge-m3)+Sparse(BM25) 임베딩 → Qdrant Hybrid 유사도 검색으로 LLM 프롬프트 강화 (ADR-011)
- 업무영역별 agent_code + DevX OAuth로 분석 후 admin-api에 결과 전달

### 내부 스케줄러

| 스케줄러 | 주기 | 비고 |
|---|---|---|
| `_scheduler()` | ANALYSIS_INTERVAL_SECONDS(기본 5분) | 로그 분석 (이전: WF1) |
| `_hourly_agg_scheduler()` | 매 시간 :05분 | 1시간 집계 (이전: WF6) |
| `_daily_agg_scheduler()` | 매일 07:30 KST | 일별 롤업 (이전: WF7) |
| `_weekly_agg_scheduler()` | 매주 월요일 08:00 KST | 주간 리포트 (이전: WF8) |
| `_monthly_agg_scheduler()` | 매월 1일 08:00 KST | 월간 리포트 (이전: WF9) |
| `_longperiod_agg_scheduler()` | 매월 1일 09:00 KST | 분기/반기/연간 (이전: WF10) |
| `_trend_agg_scheduler()` | 4시간마다 | 지속 이상 추세 알림 (이전: WF11) |
| `_jira_sync_scheduler()` | 매일 04:00 KST | V1 Knowledge — Jira 증분 동기화 (JIRA_URL/TOKEN/PROJECTS 필요) |
| `_confluence_sync_scheduler()` | 매일 04:30 KST | V1 Knowledge — Confluence 증분 동기화 (CONFLUENCE_URL/TOKEN/SPACES 필요) |

모든 스케줄러는 실행 완료 후 `_record_run()` 헬퍼가 admin-api `POST /api/v1/scheduler-runs`로 결과(성공/실패 포함)를 기록한다. 실패해도 fire-and-forget이라 스케줄러 동작에 영향 없음.

## 기술 스택

- **Runtime**: Python 3.11, FastAPI (async)
- **로그 수집**: Prometheus HTTP API (`log_error_total` 메트릭, synapse_agent 수집)
- **임베딩**: ONNX Runtime **인프로세스** (ADR-011)
  - Dense: `onnxruntime` + `transformers`(tokenizer) 로 `BAAI/bge-m3` ONNX 직접 로드 (1024차원, 한국어 고품질, 8192 토큰)
  - Sparse: fastembed `SparseTextEmbedding("Qdrant/bm25")` (BM25 IDF)
  - 실측 2-core CPU warm: Dense ~35~90ms, Sparse <1ms, Hybrid `/points/query` 전체 36ms
  - 모델 파일은 Dockerfile 빌드 단계에서 이미지에 번들 (`/app/dense-models`, `/app/fastembed-models`, `HF_HUB_OFFLINE=1`)
- **Reranker (선택적, ADR-011 후속)**: `bge-reranker-v2-m3` ONNX FP32 cross-encoder
  - 모듈: `reranker.py` (`async def rerank(query, candidates, top_k, text_field)`)
  - 입력 (query, doc) 쌍 → relevance logit. Hybrid retrieval(top-N*4) → reranker → top-K 정렬
  - 호출 경로:
    - `/incident/search` 엔드포인트에 `rerank: bool, rerank_top_k: int` 옵션
    - `search_similar_aggregations(rerank=True, rerank_top_k=...)` 키워드 인자
  - 자동 분석 파이프라인(로그/메트릭 유사도 분류)에는 적용하지 않음 (top-1 RRF 임계값 기반이라 reranker 불필요)
  - 모델 ~2.3GB (FP32, 양자화 없음). Dockerfile에서 `onnx-community/bge-reranker-v2-m3-ONNX`로부터 `/app/reranker-models`에 번들
- **벡터 DB**: Qdrant (Server B)
- **포트**: 8000 (Docker)

## 파일 구조

```
log-analyzer/
├── main.py                        # FastAPI 앱, 백그라운드 스케줄러, 모든 엔드포인트
├── analyzer.py                    # 핵심 분석 로직 (Loki 조회 → PII 마스킹 → LLM 호출 → admin-api 전송)
├── aggregation_processor.py       # Phase 5: 집계 스케줄러 코어 (asyncio 병렬, semaphore=20)
├── vector_client.py               # log_incidents / metric_baselines 컬렉션 관리
├── aggregation_vector_client.py   # metric_hourly_patterns / aggregation_summaries 컬렉션 관리
├── knowledge_vector_client.py     # V1 Knowledge 3종 컬렉션 (Jira/Confluence/Documents) 관리
├── reranker.py                    # bge-reranker-v2-m3 cross-encoder 재순위화 (ADR-011 후속, FP32)
├── chunking.py                    # 문서 포맷별 청킹 전략 (DOCX/PDF/XLSX/PPTX/Confluence)
├── Dockerfile
└── requirements/
```

```

## 엔드포인트

### 로그 분석
- `POST /analyze/trigger` — 수동 분석 트리거 (디버그/운영 용)
- `GET  /analyze/status`  — 마지막 실행 결과 조회
- `GET  /health`          — 헬스체크

### 메트릭 유사도 분석
- `POST /metric/similarity` — admin-api가 Alertmanager 알림 수신 시 호출. `metric_baselines` 컬렉션 Hybrid 검색 후 분류 반환

### RAG 챗봇 검색 (ADR-011)
- `POST /incident/search` — admin-api chat_tools의 `qdrant_search_incident_knowledge` 도구가 호출. `log_incidents` + `metric_baselines`를 Hybrid(RRF) 통합 검색하여 과거 장애 이력·해결책 반환
- `POST /aggregation/search` — chat_tools의 `qdrant_search_aggregation_summary` 도구가 재활용. `aggregation_summaries` Hybrid 검색
- `POST /metric/resolve`    — admin-api가 resolved 이벤트 수신 시 호출. Qdrant 포인트에 `resolved=True` 업데이트

### 컬렉션 관리
- `POST /collections/{type}/create`  — 컬렉션 생성 (`log`, `metric`, `hourly`, `summary`)
- `DELETE /collections/{type}`       — 컬렉션 삭제
- `POST /collections/{type}/reset`   — 컬렉션 초기화 (삭제 후 재생성, 테스트용)

### 집계 벡터 검색 (Phase 5)
- `POST /aggregation/search`          — UI 자연어 유사도 검색 프록시 (`metric_hourly_patterns` 또는 `aggregation_summaries`)
- `POST /aggregation/similar-period`  — 기존 point_id 기준으로 유사한 과거 기간 검색
- `GET  /aggregation/collections/info` — 두 집계 컬렉션의 point 수 및 상태 확인
- `POST /aggregation/collections/setup` — 두 집계 컬렉션 초기화 (없으면 생성, 수동 1회)

### 집계 트리거 (Phase 5)
- `POST /aggregation/hourly/trigger`    — 1시간 메트릭 집계 (asyncio semaphore=20 병렬)
- `POST /aggregation/daily/trigger`     — 일별 롤업 집계
- `POST /aggregation/weekly/trigger`    — 주간 리포트 + Teams
- `POST /aggregation/monthly/trigger`   — 월간 리포트 + Teams
- `POST /aggregation/longperiod/trigger`— 분기/반기/연간 리포트 + Teams
- `POST /aggregation/trend/trigger`     — 지속 이상 추세 알림 + Teams (시스템별 webhook)
- `GET  /aggregation/status`            — 모든 집계 스케줄러 실행 상태 일괄 조회

### 집계 벡터 저장 (Phase 5, aggregation_processor 내부 직접 호출)
- `POST /aggregation/store-hourly`   — (하위 호환) 1시간 집계 LLM 분석 결과를 `metric_hourly_patterns`에 저장
- `POST /aggregation/store-summary`  — (하위 호환) 일/주/월 집계 요약을 `aggregation_summaries`에 저장

### V1 Knowledge RAG (knowledge_vector_client.py)
- `POST /knowledge/search`           — 3종 컬렉션 Federated 검색 (2차 RRF + corrected 보너스 + 옵션 reranker)
- `POST /embed/document`             — 문서 파일 청킹 → 임베딩 → `knowledge_documents` 저장 (docx/pdf/xlsx/pptx)
- `POST /knowledge/operator-note`    — 운영자 Q&A 노트 등록 (`knowledge_documents`, doc_type=operator_note)
- `POST /knowledge/correction`       — 검색 결과 피드백 적용 (corrected=True + correction_text)
- `POST /knowledge/sync/jira/trigger`       — Jira 동기화 수동 즉시 트리거
- `POST /knowledge/sync/confluence/trigger` — Confluence 동기화 수동 즉시 트리거

## Qdrant 컬렉션

| 컬렉션 | type 키 | 내용 |
|---|---|---|
| `log_incidents` | `log` | 로그 분석 이상 이력 |
| `metric_baselines` | `metric` | 메트릭 알림 이상 이력 |
| `metric_hourly_patterns` | `hourly` | `_hourly_agg_scheduler` 저장 — 1시간 집계 LLM 분석 패턴 |
| `aggregation_summaries` | `summary` | 일/주/월/장기 스케줄러 저장 — 리포트 요약 |
| `knowledge_jira_issues` | — | V1 Knowledge: Jira 이슈 (project/status/system_name payload 인덱스) |
| `knowledge_confluence_pages` | — | V1 Knowledge: Confluence 페이지 청크 (space/system_name payload 인덱스) |
| `knowledge_documents` | — | V1 Knowledge: 문서 청크 + 운영자 노트 (doc_type/system_id/tags payload 인덱스). doc_type="operator_note"는 운영자 Q&A |

## 환경변수

| 변수 | 설명 |
|---|---|
| `PROMETHEUS_URL` | `http://prometheus:9090` (log_error_total 쿼리용) |
| `ADMIN_API_URL` | `http://admin-api:8080` |
| `DEVX_CLIENT_ID` | DevX OAuth client_id (시스템 발급) |
| `DEVX_CLIENT_SECRET` | DevX OAuth client_secret |
| `DENSE_EMBED_MODEL` | `BAAI/bge-m3` (ADR-011) |
| `SPARSE_EMBED_MODEL` | `Qdrant/bm25` (ADR-011) |
| `RERANKER_MODEL` | `onnx-community/bge-reranker-v2-m3-ONNX` (Dockerfile에서 override). 코드 기본값은 `BAAI/bge-reranker-v2-m3` |
| `RERANKER_MODEL_CACHE` | `/app/reranker-models` (이미지 번들 경로) |
| `RERANKER_ONNX_FILE` | `onnx/model.onnx` (FP32, model.onnx_data external data 동반) |
| `RERANKER_MAX_LENGTH` | `512` (cross-encoder pair encoding 최대 토큰) |
| `FASTEMBED_CACHE_PATH` | `/app/fastembed-models` (read-only 마운트) |
| `HF_HUB_OFFLINE` | `1` (폐쇄망 필수) |
| `QDRANT_URL` | `http://{server-b}:6333` |
| `ANALYSIS_INTERVAL_SECONDS` | `300` (기본 5분) |
| `JIRA_URL` | Jira REST API 기본 URL (예: `https://jira.example.com`). 미설정 시 Jira 동기화 비활성 |
| `JIRA_TOKEN` | Jira Bearer 토큰. 미설정 시 비활성 |
| `JIRA_PROJECTS` | 동기화 대상 프로젝트 키 (콤마 구분, 예: `PROJ1,PROJ2`). 미설정 시 비활성 |
| `CONFLUENCE_URL` | Confluence REST API 기본 URL. 미설정 시 비활성 |
| `CONFLUENCE_TOKEN` | Confluence Bearer 토큰. 미설정 시 비활성 |
| `CONFLUENCE_SPACES` | 동기화 대상 Space 키 (콤마 구분, 예: `DEV,OPS`). 미설정 시 비활성 |
| `KNOWLEDGE_SYNC_RATE_LIMIT` | Knowledge 동기화 req/sec 상한 (기본 5) |

## 핵심 로직

### 로그 분석 흐름
```
내부 _scheduler() (ANALYSIS_INTERVAL_SECONDS마다)
  → analyzer.run_analysis()
    → admin-api GET /api/v1/systems 로 활성 시스템 목록 조회
    → 시스템별 Prometheus에서 최근 5분 log_error_total 메트릭 조회
      (sum_over_time(log_error_total{system_name="..."}[5m]) > 0)
      → instance_role별 그룹화, template 라벨로 로그 내용 추출
    → PII 마스킹 (카드번호, 주민번호, 전화번호, 이메일)
    → normalize → FastEmbed Dense+Sparse 임베딩 → log_incidents Hybrid 유사도 검색 (RRF)
    → 유사 이력 + 해결책으로 LLM 프롬프트 강화
    → 업무영역별 agent_code로 DevX OAuth API 호출 (llm_agent_configs 테이블)
    → admin-api POST /api/v1/analysis 로 결과 전송
```

### 메트릭 유사도 분류 (ADR-011 Hybrid RRF)
```
POST /metric/similarity
  → 메트릭 상태를 자연어 텍스트로 변환 → FastEmbed Dense+Sparse 임베딩
  → metric_baselines Hybrid 검색 (prefetch dense>=0.5, sparse, RRF fusion)
    RRF score ≥ 0.030 → duplicate  (Teams 알림 생략)
    RRF score ≥ 0.022 → recurring  ("반복 이상" 강조)
    RRF score ≥ 0.014 → related    ("유사 이상")
    그 외             → new        ("신규 이상") → Qdrant에 저장
```
> RRF 점수는 순위 기반(상대 스케일)이라 기존 cosine 임계값과 다르다. 운영 데이터 축적 후 재튜닝.

### 집계 처리 흐름 (Phase 5 — 내부 스케줄러)

**PROMQL_MAP 수집기별 지원 현황 (Phase 9에서 node_exporter/jmx_exporter 제거):**
- `synapse_agent`: cpu / memory / disk / network / log / web (기본 수집기 — node_exporter/jmx_exporter 대체)
- `db_exporter`: db_connections / db_query / db_cache / db_replication (agent_type='db' AgentInstance가 자동 등록 — oracle/postgresql/mssql/mysql)

```
_hourly_agg_scheduler() (매 시간 :05분 KST)
  → aggregation_processor.run_hourly_aggregation()
    → GET /api/v1/collector-config (활성 수집기 목록)
    → asyncio.gather() — semaphore=20 병렬
      → PROMQL_MAP[collector_type][metric_group] 으로 Prometheus avg_over_time[1h] 쿼리
      → 이상 감지 (_detect_anomaly — synapse_agent / db_exporter 지원)
      → POST /api/v1/aggregations/hourly (기본 저장)
      → 이상이면: LLM → Qdrant → hourly 업데이트 → Teams 프로액티브 알림

_daily_agg_scheduler() (매일 07:30 KST)
  → aggregation_processor.run_daily_aggregation()
    → GET /api/v1/aggregations/hourly (전일 데이터)
    → Python 그룹핑·집계
    → POST /api/v1/aggregations/daily + Qdrant 저장

_weekly/_monthly/_longperiod_agg_scheduler() (각 주기 KST)
  → 기간별 집계 조회 → LLM 요약 → Teams 리포트

_trend_agg_scheduler() (4시간마다)
  → aggregation_processor.run_trend_alert()
      → GET /api/v1/aggregations/hourly (최근 8시간, warning/critical)
      → 시스템별 3시간 이상 이상 지속 감지
      → 병렬: LLM 추세 분석 → Teams (시스템별 webhook || 전역)
```

### n8n 이관 성능 효과 (이력)
- 기존(n8n 시절): Prometheus/DB/LLM/Teams를 순차 처리 (1,560개 × 최대 135초 = 13.7시간)
- 현재(log-analyzer 직접): asyncio semaphore=20 병렬 처리 (41분)

## 문서 청킹 (chunking.py)

향후 V1 Confluence/Jira 배치 동기화 + DOCX/PDF/XLSX/PPTX 업로드 파이프라인의 사전 작업.
**vector_client.py와 독립된 유틸리티** — 현재는 import 되는 곳 없음(파일 업로드 엔드포인트 추가 시 활용).

### 청크 크기 정책
| 항목 | 값 | 근거 |
|---|---|---|
| `max_chars` | 1500자 | 한국어 ≈ 800~1000 토큰 (bge-m3 8192 한도 내 안전 마진) |
| `overlap` | 200자 | 의미 연결 보존 (조사·문맥 단절 방지) |
| 경계 백트래킹 | 단락(`\n\n`) → 줄바꿈(`\n`) → 공백 | 한국어 청크가 단어/조사 중간에서 끊기는 것 방지. ``lookback`` 범위 내에서 발견 못하면 그대로 자름 |

### 포맷별 전략
| 포맷 | 함수 | 청킹 단위 | 비고 |
|---|---|---|---|
| 순수 텍스트 | `chunk_text` | sliding window (1500/200) | 베이스 함수 — 모든 포맷이 재사용 |
| Confluence | `chunk_confluence_page` | H2/H3 섹션 → 큰 섹션은 sliding window | HTML이면 BeautifulSoup 파싱(다른 HTML 파서 사용 금지). plain text면 chunk_text fallback. heading을 메타에 보존 |
| DOCX | `chunk_docx` | paragraphs+tables 합쳐 sliding window | python-docx, 표는 행 단위 `\|` 결합 |
| PDF | `chunk_pdf` | 페이지 단위로 sliding window | pdfplumber, 페이지마다 빈 텍스트 건너뜀, `page_no` 메타 보존, `chunk_index`는 문서 전역 누적 |
| XLSX | `chunk_xlsx` | **시트 = 1 청크 (분할 안 함)** | openpyxl, 시트를 markdown 표로 변환. 1500자 초과해도 의미 보존 위해 분할 금지 |
| PPTX | `chunk_pptx` | **슬라이드 = 1 청크 (분할 안 함)** | python-pptx, title + body shapes + speaker notes 합산. 표는 셀별 `\|` 결합 |

각 함수는 `list[dict]` 반환: `[{"text": str, "metadata": {"chunk_index", "source_type", ...}}]`.
의존 라이브러리는 `requirements/base.txt` 끝의 "문서 청킹" 블록 참고.

## 개발 주의사항

### 컬렉션 초기화 순서
- `log_incidents` / `metric_baselines`: **log-analyzer `lifespan`이 부팅 시 자동 `ensure_collection`** (ADR-004)
- `metric_hourly_patterns` / `aggregation_summaries`: `POST /aggregation/collections/setup` — 수동 1회

### 분석 실패 이력 기록 (ADR-002)
`analyzer.run_analysis()` 내 `except` 경로에서도 `submit_analysis(..., error_message=...)` 호출.
- admin-api가 `error_message IS NOT NULL`이면 Teams 발송 차단
- `qdrant_point_id` 기준 "피드백 제출 가능" 카운트는 영향 없음 (실패 레코드 자동 제외)
- `model_used` 필드에 `LLM_TYPE` 값 자동 기록 (devx/claude/openai) — ADR-012: ollama 제거

### run_analysis 결과 필드 (ADR-005)
| 필드 | 의미 |
|---|---|
| `analyzed` | 분석 완료 건 (성공) |
| `skipped` | 시스템 `status != "active"` (비활성) |
| `no_logs` | 활성이지만 최근 5분 에러 로그 없음 |
| `errors` | 분석 과정 예외 발생 (실패 레코드는 DB에 별도 저장됨) |

### aggregation_vector_client는 vector_client를 의존
`aggregation_vector_client.py`는 `vector_client.py`의 `get_embedding`, `ensure_collection` 등을 import.
`QDRANT_URL`, `DENSE_EMBED_MODEL`, `SPARSE_EMBED_MODEL`, `FASTEMBED_CACHE`도 `vector_client`에서 가져온다.
