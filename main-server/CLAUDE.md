# main-server — 개발 주의사항 (CLAUDE.md)

각 서비스별 상세 가이드는 해당 디렉터리의 `CLAUDE.md`를 참고하세요.
전체 아키텍처·ADR·데이터 흐름 등 상세 컨텍스트는 **`.claude/memory/`** 에 분리 보관되어 있습니다(필요 시 Read tool로 로드).

---

## 환경변수 주입 구조

`.env.local` → `docker-compose.dev.yml`에서 `${VAR}` 방식으로 컨테이너에 주입됩니다.

```
.env.local
  └──(docker compose up)──▶ dev-n8n, dev-prometheus, dev-alertmanager 컨테이너
```

> `.env.local` 수정 후에는 반드시 해당 컨테이너를 재시작해야 새 값이 반영됩니다.

```bash
# 예: TEAMS_WEBHOOK_URL 변경 후
cd main-server
docker compose -f docker-compose.dev.yml up -d n8n
```

### 환경변수별 담당 서비스

| 변수 | 사용 서비스 | 비고 |
|---|---|---|
| `DATABASE_URL` | admin-api, log-analyzer | asyncpg URL |
| `TEAMS_WEBHOOK_URL` | admin-api | 전역 Teams webhook |
| `FRONTEND_EXTERNAL_URL` | admin-api | Teams 카드 "해결책 등록" 버튼이 여는 React 페이지 URL (브라우저 접근 가능해야 함, 예: `http://{server-a-ip}:3001`) |
| `LOG_ANALYZER_URL` | admin-api | 메트릭 유사도 분석 호출 |
| `DEVX_CLIENT_ID` / `DEVX_CLIENT_SECRET` | admin-api, log-analyzer | DevX OAuth 인증 |
| `DENSE_EMBED_MODEL` / `SPARSE_EMBED_MODEL` | log-analyzer | FastEmbed ONNX 임베딩 (ADR-011). 기본값: `BAAI/bge-m3` (1024 dim) + `Qdrant/bm25` |
| `FASTEMBED_CACHE_PATH` / `HF_HUB_OFFLINE` | log-analyzer | 폐쇄망 ONNX 사전 스테이징 경로 + 오프라인 모드 (ADR-011) |
| `QDRANT_URL` | log-analyzer | 벡터 DB. 컬렉션 차원 1024 (ADR-011) |
| `LLM_TYPE` | admin-api, log-analyzer | `devx`/`claude`/`openai` — `llm_client.py` Strategy가 라우팅 (ADR-001). ADR-012: ollama 폐지 |

---

## 로컬 개발 시작 순서

```bash
make dev-up          # 인프라 컨테이너 시작
make run-api         # admin-api 핫리로드 (8080)
make run-analyzer    # log-analyzer 핫리로드 (8000)
make test-api        # 단위 테스트 (인프라 불필요)
```

---

## 단위 테스트 작성 규칙

- 테스트 DB: SQLite in-memory (PostgreSQL 불필요)
- 외부 HTTP(Teams, log-analyzer): `unittest.mock.AsyncMock`으로 패치
- **`resolved` 알림은 처리됨** — `status == "resolved"` 반환 검증 (건너뛰는 게 아님)
- 테스트 파일 위치: `services/admin-api/tests/`

---

## DB 스키마 관리 규칙

**스키마 단일 진실의 원천**: `configs/postgres/init.sql`

```
configs/postgres/
├── init.sql          ← 유일한 정식 스키마 (전체 CREATE TABLE 포함)
└── migrations/       ← 기존 운영 DB 대상 점진적 변경 SQL
    └── YYYYMMDD_xxx.sql
```

### 스키마 변경 시 필수 3중 동기화
1. `services/admin-api/models.py` — SQLAlchemy ORM 모델
2. `configs/postgres/init.sql` — 완성형 스키마 (신규 설치용)
3. `configs/postgres/migrations/YYYYMMDD_xxx.sql` — 기존 운영 DB용 ALTER TABLE

> `services/admin-api/migrations/` 폴더는 폐기됨. 향후 마이그레이션은 반드시 `configs/postgres/migrations/`에 생성.

### DDL 컬럼 순서 규칙

`CREATE TABLE` 작성 시 컬럼 순서는 반드시 아래 순서를 따른다.

```
1. PK (id)
2. FK (system_id, 관련 외래키)
3. 비즈니스 컬럼 (도메인 의미를 가진 필드)
4. 시스템/감사 필드 — 반드시 맨 끝에 위치
   - created_by, created_at
   - updated_by, updated_at
   - deactivated_by, deactivated_at
```

**잘못된 예 (시스템 필드가 중간에 위치)**:
```sql
CREATE TABLE foo (
    id SERIAL PRIMARY KEY,
    name TEXT,
    created_by VARCHAR(100),  -- ❌ 중간에 위치
    created_at TIMESTAMP,
    active BOOLEAN,
    expires_at TIMESTAMP
);
```

**올바른 예 (시스템 필드가 맨 끝)**:
```sql
CREATE TABLE foo (
    id SERIAL PRIMARY KEY,
    name TEXT,
    active BOOLEAN,
    expires_at TIMESTAMP,
    created_by VARCHAR(100),  -- ✅ 맨 끝
    created_at TIMESTAMP
);
```

### 운영 DB 초기화
```bash
docker exec -i synapse-postgres psql -U synapse -d synapse < configs/postgres/init.sql
```

---

## Qdrant 컬렉션 구조 (ADR-011 Hybrid)

총 **9개 컬렉션**. 모두 Dense(1024) + Sparse(BM25) Hybrid 스키마.
운영 분석 계열 5개 + Knowledge 계열 4개로 구분.

### 운영 분석 계열 (5개)

| 컬렉션 | 저장 주체 | 시스템 필터 | 내용 |
|---|---|---|---|
| `metric_baselines` | log-analyzer (lifespan 자동 ensure) | `system_name` + `metric_name` | 메트릭 알림 이상 이력 (`alert_history.qdrant_point_id`) |
| `log_incidents` | log-analyzer (lifespan 자동 ensure) | `system_name` | 로그 분석 이상 이력 (`log_analysis_history.qdrant_point_id`) |
| `incident_postmortems` | log-analyzer (Wave 1B, lifespan 자동 ensure) | `system_id` IN list | 인시던트 사후분석 서사. 피드백 승인 시 embed. payload: `incident_id`, `severity`, `narrative` |
| `metric_hourly_patterns` | log-analyzer (Phase 5, `POST /aggregation/collections/setup` 수동 1회) | `system_name` | `_hourly_agg_scheduler`가 저장하는 1시간 집계 LLM 분석 패턴 — 챗봇 `qdrant_search_hourly_patterns` |
| `aggregation_summaries` | log-analyzer (Phase 5, `POST /aggregation/collections/setup` 수동 1회) | `system_name` | 일/주/월/분기/반기/연간 스케줄러가 저장하는 리포트 요약 — 챗봇 `qdrant_search_aggregation_summary` |

### Knowledge 계열 (4개)

| 컬렉션 | 저장 주체 | 시스템 필터 | 내용 |
|---|---|---|---|
| `knowledge_guides` | log-analyzer (lifespan 자동 ensure) | `system_id` (NULL=전체 공용) | 운영 가이드 + Synapse 사용법. **1500자 청크(overlap 200)** 단위. payload: `guide_id`, `chunk_index`, `title`. 챗봇 `qdrant_search_guide` (group_by_guide=True 기본) |
| `knowledge_jira_issues` | log-analyzer (lifespan 자동 ensure, `_jira_sync_scheduler` 매일 04:00 KST) | ❌ 미적용 (V1) | Jira 이슈 (issue 단위). payload 인덱스: `project`, `status`, `system_name` |
| `knowledge_confluence_pages` | log-analyzer (lifespan 자동 ensure, `_confluence_sync_scheduler` 매일 04:30 KST) | ❌ 미적용 (V1) | Confluence 페이지 청크(섹션 1500자). payload 인덱스: `space`, `system_name` |
| `knowledge_documents` | log-analyzer (lifespan 자동 ensure) | `system_ids` IN list (P2-A) | 업로드 문서 청크(1500자) + 운영자 노트. payload 인덱스: `doc_type`, `system_id`, `tags`, `stored_at`. `doc_type=operator_note`는 운영자 Q&A |

**검색 방식 (ADR-011)**:
- 모든 컬렉션 Hybrid: `/points/query` + `prefetch[dense>=0.5, sparse]` + `fusion: rrf`
- RRF 점수 스케일이 cosine과 다르므로 classify_anomaly 임계값 재설정됨 (운영 후 튜닝 필요)
- `score_threshold` 파라미터(기본 0.5)로 dense prefetch 최소 유사도 조정 가능 (Track B — `/incident/search`, `/aggregation/search`, `/knowledge/search`, `/guides/search`)

**검색 통합 패턴**:
- `log_incidents` + `metric_baselines` → 챗봇 도구 `qdrant_search_incident_knowledge`가 `/incident/search`로 통합 검색 (RRF)
- `knowledge_jira_issues` + `knowledge_confluence_pages` + `knowledge_documents` → `/knowledge/search`가 federated 검색(2차 RRF + corrected 보너스 + 옵션 reranker)
- `metric_hourly_patterns` / `aggregation_summaries` → UI 유사도 검색 프록시(`/aggregation/search`, `/aggregation/similar-period`)
- `incident_postmortems` → `/incident-postmortem/search` 단독 검색 (LLM 해결책 프롬프트 강화)
- `knowledge_guides` → `/guides/search` (group_by_guide=True 기본, reranker on)

**피드백 등록 시 해결책 업데이트 분기** — `alert_history.alert_type` 기준:
- `metric`, `metric_resolved` → `metric_baselines`
- 그 외 → `log_incidents`

**차원 불일치 주의**: 벡터 차원 변경 시 기존 컬렉션 삭제 후 재생성 필요 (Qdrant는 생성 후 차원 변경 불가). ADR-011에서 768 → 1024로 변경됨.

---

## 폐쇄망 FastEmbed 모델 배포 (ADR-011)

Ollama는 ADR-011로 제거됨. 임베딩은 log-analyzer 컨테이너 내 FastEmbed ONNX가 담당.
**모델은 이미지에서 분리되어 서버 볼륨(`/opt/synapse/models`)으로 마운트됨** — 코드 배포 시 ~500MB만 전송, 모델(~4.6GB)은 최초 1회만 배포.

### 최초 모델 배포 (인터넷 환경 빌드 서버에서 1회)

```bash
# 1. 모델 전용 tar.gz 추출
./build-images.sh export-models
# → main-server/synapse-models.tar.gz 생성 (~1.5GB compressed)

# 2. 서버로 전송 및 압축 해제
scp main-server/synapse-models.tar.gz user@server-a:/tmp/
ssh user@server-a "mkdir -p /opt/synapse/models && \
  pigz -d -c /tmp/synapse-models.tar.gz | tar -xf - -C /opt/synapse/models"
# 결과: /opt/synapse/models/{dense-models,fastembed-models,reranker-models}/
```

> HuggingFace 직접 접근이 막혀 있으면 `HF_ENDPOINT=https://hf-mirror.com` 환경변수 설정 후 export.

### 일반 코드 배포 (이후 매번)

```bash
# 1. 이미지 빌드 및 저장 (~500MB)
./build-images.sh

# 2. 서버로 전송 후 로드
scp main-server/synapse-log-analyzer-1.0.tar.gz user@server-a:/tmp/
ssh user@server-a "pigz -d -c /tmp/synapse-log-analyzer-1.0.tar.gz | docker load"

# 3. 재시작 (볼륨은 그대로 유지)
docker compose up -d log-analyzer
```

### 모델 변경 시

1. `Dockerfile`의 `model-downloader` 스테이지 수정
2. `./build-images.sh export-models` 재실행 후 서버 재배포
3. 차원 변경되면 Qdrant 컬렉션 재생성 필수
