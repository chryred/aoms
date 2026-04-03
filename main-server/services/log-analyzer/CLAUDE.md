# AOMS Log Analyzer — 서비스 개요

## 목적

Loki 로그 수집 → LLM 분석 → Teams 알림 파이프라인의 실행 주체.
- 5분 주기(또는 n8n 트리거)로 활성 시스템의 최근 ERROR/WARN/FATAL 로그 수집
- PII 마스킹 → Ollama 임베딩 → Qdrant 유사도 검색으로 LLM 프롬프트 강화
- 담당자별 LLM API 키로 분석 후 admin-api에 결과 전달

## 기술 스택

- **Runtime**: Python 3.11, FastAPI (async)
- **로그 수집**: Loki 3.x HTTP API
- **임베딩**: Ollama bge-m3 (Server B)
- **벡터 DB**: Qdrant (Server B)
- **포트**: 8000 (Docker)

## 파일 구조

```
log-analyzer/
├── main.py                      # FastAPI 앱, 백그라운드 스케줄러, 모든 엔드포인트
├── analyzer.py                  # 핵심 분석 로직 (Loki 조회 → PII 마스킹 → LLM 호출 → admin-api 전송)
├── vector_client.py             # log_incidents / metric_baselines 컬렉션 관리
├── aggregation_vector_client.py # metric_hourly_patterns / aggregation_summaries 컬렉션 관리 (Phase 5)
├── Dockerfile
└── requirements/
    ├── prod.txt
    └── dev.txt
```

## 엔드포인트

### 로그 분석
- `POST /analyze/trigger` — n8n WF1 호출용 수동 트리거
- `GET  /analyze/status`  — 마지막 실행 결과 조회
- `GET  /health`          — 헬스체크

### 메트릭 유사도 분석
- `POST /metric/similarity` — admin-api가 Alertmanager 알림 수신 시 호출. `metric_baselines` 컬렉션에서 유사 이력 분류 후 반환
- `POST /metric/resolve`    — admin-api가 resolved 이벤트 수신 시 호출. Qdrant 포인트에 `resolved=True` 업데이트

### 컬렉션 관리
- `POST /collections/{type}/create`  — 컬렉션 생성 (`log`, `metric`, `hourly`, `summary`)
- `DELETE /collections/{type}`       — 컬렉션 삭제
- `POST /collections/{type}/reset`   — 컬렉션 초기화 (삭제 후 재생성, 테스트용)

### 집계 벡터 검색 (Phase 5)
- `POST /aggregation/search`          — UI 자연어 유사도 검색 프록시 (`metric_hourly_patterns` 또는 `aggregation_summaries`)
- `POST /aggregation/similar-period`  — 기존 point_id 기준으로 유사한 과거 기간 검색
- `GET  /aggregation/collections/info` — 두 집계 컬렉션의 point 수 및 상태 확인
- `POST /aggregation/collections/setup` — 두 집계 컬렉션 초기화 (없으면 생성, WF12 호출)

### 집계 벡터 저장 (Phase 5, WF6-WF10 호출)
- `POST /aggregation/store-hourly`   — 1시간 집계 LLM 분석 결과를 `metric_hourly_patterns`에 저장
- `POST /aggregation/store-summary`  — 일/주/월 집계 요약을 `aggregation_summaries`에 저장

## Qdrant 컬렉션

| 컬렉션 | type 키 | 내용 |
|---|---|---|
| `log_incidents` | `log` | 로그 분석 이상 이력 |
| `metric_baselines` | `metric` | 메트릭 알림 이상 이력 |
| `metric_hourly_patterns` | `hourly` | WF6 저장 — 1시간 집계 LLM 분석 패턴 |
| `aggregation_summaries` | `summary` | WF7-WF10 저장 — 일/주/월 리포트 요약 |

## 환경변수

| 변수 | 설명 |
|---|---|
| `LOKI_URL` | `http://loki:3100` |
| `ADMIN_API_URL` | `http://admin-api:8080` |
| `LLM_API_URL` | 내부 LLM API 엔드포인트 |
| `LLM_API_KEY` | 기본 API 키 (담당자별 키 미등록 시 사용) |
| `LLM_AGENT_CODE` | 기본 에이전트 코드 |
| `OLLAMA_URL` | `http://{server-b}:11434` |
| `EMBED_MODEL` | `bge-m3` |
| `QDRANT_URL` | `http://{server-b}:6333` |
| `ANALYSIS_INTERVAL_SECONDS` | `300` (기본 5분) |

## 핵심 로직

### 로그 분석 흐름
```
n8n WF1 트리거 또는 내부 스케줄러
  → analyzer.run_analysis()
    → admin-api GET /api/v1/systems 로 활성 시스템 목록 조회
    → 시스템별 Loki에서 최근 5분 ERROR/WARN/FATAL 수집
    → PII 마스킹 (카드번호, 주민번호, 전화번호, 이메일)
    → normalize → Ollama 임베딩 → log_incidents 유사도 검색
    → 유사 이력 + 해결책으로 LLM 프롬프트 강화
    → 담당자별 llm_api_key로 LLM API 호출
    → admin-api POST /api/v1/analysis 로 결과 전송
```

### 메트릭 유사도 분류
```
POST /metric/similarity
  → 메트릭 상태를 자연어 텍스트로 변환 → Ollama 임베딩
  → metric_baselines 검색
    score ≥ 0.95 → duplicate  (Teams 알림 생략)
    score ≥ 0.85 → recurring  ("반복 이상" 강조)
    score ≥ 0.70 → related    ("유사 이상")
    score < 0.70 → new        ("신규 이상") → Qdrant에 저장
```

### 집계 벡터 저장 흐름 (Phase 5)
```
WF6(1시간 집계 완료)
  → POST /aggregation/store-hourly
    → aggregation_vector_client.store_hourly_pattern_vector()
    → metric_hourly_patterns 컬렉션에 저장

WF7-WF10(일/주/월 집계 완료)
  → POST /aggregation/store-summary
    → aggregation_vector_client.store_aggregation_summary_vector()
    → aggregation_summaries 컬렉션에 저장
```

## 개발 주의사항

### 컬렉션 초기화 순서
운영 첫 배포 시:
1. `POST /collections/log/create` — log_incidents 생성
2. `POST /collections/metric/create` — metric_baselines 생성
3. `POST /aggregation/collections/setup` — metric_hourly_patterns + aggregation_summaries 생성 (또는 WF12 실행)

### aggregation_vector_client는 vector_client를 의존
`aggregation_vector_client.py`는 `vector_client.py`의 `get_embedding`, `ensure_collection` 등을 import.
`OLLAMA_URL`, `EMBED_MODEL`, `QDRANT_URL`도 `vector_client`에서 가져온다.
