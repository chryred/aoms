# main-server — 개발 주의사항 (CLAUDE.md)

각 서비스별 상세 가이드는 해당 디렉터리의 `CLAUDE.md`를 참고하세요.
전체 아키텍처·ADR·데이터 흐름 등 상세 컨텍스트는 **`.claude/memory/`** 에 분리 보관되어 있습니다(필요 시 Read tool로 로드).

---

## 환경변수 주입 구조

`.env.local` → `docker-compose.dev.yml`에서 `${VAR}` 방식으로 컨테이너에 주입됩니다.

```
.env.local
  └──(docker compose up)──▶ dev-prometheus, dev-alertmanager 컨테이너
```

> `.env.local` 수정 후에는 반드시 해당 컨테이너를 재시작해야 새 값이 반영됩니다.

```bash
# 예: TEAMS_WEBHOOK_URL 변경 후
cd main-server
docker compose -f docker-compose.dev.yml up -d alertmanager
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
| `CLICKHOUSE_URL` / `CLICKHOUSE_DB` / `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` | admin-api, agent-t-gateway | ClickHouse 접속. 비밀번호는 ClickHouse 컨테이너 안에서 `AGENT_T_CH_PASSWORD` 로 매핑(이미지 entrypoint 가 `CLICKHOUSE_PASSWORD` 를 default 사용자 설정으로 해석하므로 컨테이너에 그 이름으로 넘기지 않는다) |
| `AGENT_T_GATEWAY_URL` / `AGENT_T_ARTIFACT_DIR` | admin-api | 설치 Job 이 에이전트에 심는 gateway 주소 — **필수, WAS 에서 닿는 `http://{server-a-ip}:8330`** (compose 기본값 없음, 컨테이너명·루프백은 설치 Job 이 거부) / 에이전트 jar 디렉터리 (`artifacts/agent-t/`) |
| `GATEWAY_PG_DSN` / `GATEWAY_LISTEN` / `PROMETHEUS_REMOTE_WRITE_URL` | agent-t-gateway | PG(`agent_instances`·`systems` 캐시, `agent_commands`) / 수신 포트 `:8330` / 5초 집계 remote write 대상(비면 비활성). `SECRET_KEY` 는 admin-api 와 동일 값 필수. 큐 상한 `GATEWAY_CH_QUEUE_MAX_BYTES` 기본 128MB + `GOMEMLIMIT=400MiB`. PG 비밀번호는 DSN 이 아니라 `PGPASSWORD` 로 전달 |
| `STEP_CA_INTERMEDIATE_CERT` | admin-api | 사설 CA intermediate 인증서 경로 (`/app/secrets/ssl/intermediate_ca.crt`) — leaf 직접 서명 (ADR-019) |
| `STEP_CA_INTERMEDIATE_KEY` | admin-api | 사설 CA intermediate 개인키(무암호 PEM) 경로 (`/app/secrets/ssl/intermediate_ca_key`) — `ssl_issuer.sign_leaf`가 로드 |
| `STEP_CA_CERT_DIR` | admin-api | 발급 결과 저장 루트 (`/app/ssl/certs`, `CERT_BASE`). `wildcard/`·`{domain}/` 하위에 fullchain.cer/cert.key/ca.cer |
| `STEP_CA_ROOT_CA` | admin-api | Root CA 인증서 경로 (`/app/secrets/ssl/root_ca.crt`) — Root CA 다운로드 엔드포인트(`/ssl/root-ca/*`)용 |
| `SSL_DEPLOY_KEY_PATH` | admin-api | 배포용 SSH private key 경로 (`/app/secrets/ssl/deploy_key`) |
| `SSL_DEPLOY_PUBKEY_PATH` | admin-api | 배포용 SSH public key 경로 (`/app/secrets/ssl/deploy_key.pub`) |

> SSL 발급은 ADR-019로 acme.sh/Step-CA(ACME http-01) → intermediate 키 `cryptography` 직접 서명으로 전환됨. `STEPPATH`/`STEP_CA_ACME_URL`/`ACMESH_PATH` 및 `secrets/step`·`secrets/.acme.sh` 마운트는 내부망 경로에서 제거. DMZ(`ssl_dmz.py`)만 acme.sh http-01 번들 유지. 상세: `docs/ssl-automation.md`.

---

## Agent-T 인프라 (ADR-022)

- **컨테이너**: `synapse-clickhouse`(clickhouse-server 24.8), `synapse-agent-t-gateway`(Go) 추가. `tempo`·`otel-collector`·`n8n` 제거 → Server A compose 기준 10개 → 9개 (운영 Server A 에는 타 프로젝트 sr_streamlit·sr_api 포함 12개 → 11개). dev compose 는 `dev-clickhouse`/`dev-agent-t-gateway`. gateway 는 `image: synapse-agent-t-gateway:1.0`(`build-images.sh` 가 빌드·save), ClickHouse 이미지는 같은 스크립트가 pull·save 해 폐쇄망에 반입한다.
- **포트 8330 게시**: WAS 서버의 Agent-T 가 gateway(`POST /t/v1/batch`)로 직접 접속하므로 호스트에 게시한다. 방화벽에서 WAS 대역만 허용. ClickHouse 8123/9000 은 호스트에 게시하지 않는다(컨테이너 네트워크 내부).
- **ClickHouse DDL**: `configs/clickhouse/init/*.sql` 은 **빈 데이터 디렉터리의 최초 기동 때만** 실행된다(`/docker-entrypoint-initdb.d`). 이후 변경은 `configs/clickhouse/migrations/` 에 날짜 prefix SQL(`20261101_xxx.sql`)로 추가하고 수동 적용한다(init 파일은 최초 생성용 정본으로 같이 갱신). 적용 대기: `20261031_dict_no_ttl.sql`(dict TTL 제거 + 이벤트 테이블 dedup window). 사용자·한도 설정은 `configs/clickhouse/users.d/`, `config.d/limits.xml`.
- **데이터 디렉터리**: 운영 `./services/clickhouse/data` 는 호스트에서 **uid 101(clickhouse)** 소유여야 한다 (`chown -R 101:101`, SELinux 라벨은 compose 의 `:z`). 소유자가 다르면 기동 직후 종료된다. 개발은 named volume `clickhouse_dev_data`.
- **비밀번호**: `.env` 의 `CLICKHOUSE_PASSWORD` 하나로 admin-api·gateway 에 주입, ClickHouse 컨테이너에는 `AGENT_T_CH_PASSWORD` 로 매핑. 운영은 필수값(기본값 없음), 개발 기본값만 존재.
- **Prometheus remote write**: gateway 가 5초 집계를 `agent_t_*` 시계열로 Prometheus remote write 로 푼다 → Prometheus 기동 옵션 `--web.enable-remote-write-receiver` 필요. 대상은 `PROMETHEUS_REMOTE_WRITE_URL`(예: `http://prometheus:9090/api/v1/write`).
- **에이전트 jar**: `main-server/artifacts/agent-t/` (repo 미포함, `agent-t/build.sh install-artifacts` 로 생성). 절차는 해당 디렉터리 README.

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
**모델은 이미지에서 분리되어 서버 볼륨(`/opt/synapse/models`)으로 마운트됨** — 코드 배포 시 ~500MB만 전송, 모델(압축 해제 **2.70GB** / tar.gz **1.65GB**)은 최초 1회만 배포.
> reranker를 FP32(2.11GB) → int8(544MB)로 전환하면서 압축 해제 기준 ~4.3GB → 2.70GB로 줄었다.
> 구성: dense bge-m3 `model.onnx_data` 2.11GB + reranker `model_int8.onnx` 544MB + 토크나이저 등 ~48MB.
> (과거 문서의 "~1.5GB compressed"는 잘못된 값이었다 — FP32를 포함한 상태로는 1.65GB보다 작을 수 없다.)
> **이미 모델 볼륨이 배포된 서버는 `export-models`를 다시 받아 재배포해야 한다** — 기존 볼륨에는 `model_int8.onnx`가 없어 reranker 로딩이 실패한다(경고 로그만 남고 검색 품질 저하).

### 최초 모델 배포 (인터넷 환경 빌드 서버에서 1회)

```bash
# 1. 모델 전용 tar.gz 추출
./build-images.sh export-models
# → main-server/synapse-models.tar.gz 생성 (1.65GB, 압축 해제 2.70GB — 2026-09 실측)

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
