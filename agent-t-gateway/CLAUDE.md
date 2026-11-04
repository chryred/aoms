# agent-t-gateway

Agent-T(Java 에이전트) 배치 수신 게이트웨이 (Go, 포트 8330). 계약: `contracts/agent-t/protocol.md`.

- `internal/protocol`: 배치/응답 구조체 + `Decode` (본문 32MB 상한)
- `internal/registry`: PG(`agent_instances`+`systems`) 30초 캐시(미등록 토큰은 `Lookup` 이 즉시 재로드 후 재확인 — 전역 2초당 1회, 동시 호출은 한 번의 재로드 공유, 실패도 간격에 포함), 토큰 sha256 → Instance. `Store` 인터페이스 뒤에 PG 구현(`pgstore.go`)
- `internal/ingest`: `POST /t/v1/batch` 핸들러, 시계 보정(`skew.go`, |차이|>2s 일 때 EWMA)
- `internal/store`: `Writer`(Sink+Backpressure; 테이블별 버퍼 → ClickHouse HTTP `JSONEachRow` gzip, 상한(기본 128MB) 초과 시 상세→SQL→요약 순 폐기, 80% 이상 `BackoffMs=2000`. 청크마다 고정 `insert_deduplication_token`, 실패 청크는 통째·같은 토큰으로 재큐(재청킹 금지), 재시도 대기 청크는 폐기 시 청크 단위. 폐기·영구 거부된 dict 행은 `OnDictLost` 로 캐시에서 제거해 `need_dict` 로 재요청), `Dict`(LRU 200k, 미적재 시작 → `need_dict`; `dict_sql`/`dict_uri` 적재, 두 테이블은 TTL 없음), `Commands`(PG `agent_commands` 2초 폴링, 전달 시 `sent`, 덤프 적재 후 `done`+`result_ref=cmd_id`; 120초 넘은 `pending` 은 전달하지 않음(admin-api 가 `failed` 처리); PG 는 `CommandStore` 인터페이스 뒤)
- `internal/live`: `State`(Sink; 인스턴스별 메모리 상태, 5초 집계 → 10분 링 `RingSize=120`, `OnAgg` 훅), `Hub`(SSE 팬아웃), `API`(`GET /t/v1/stream` SSE, `GET /t/v1/snapshot`; admin-api 사용자 JWT HS256 검증). `system_ids` 파싱 불가 값은 400(전체로 해석하지 않음). SSE 쓰기당 데드라인 10초
- `internal/promrw`: 5초 집계 → Prometheus remote write(protobuf+snappy). WriteRequest 는 `protowire` 로 직접 인코딩(prometheus/prometheus 의존성 회피). 공통 레이블 `system_name, display_name, instance_role, host`(agent `metrics/mod.rs` 와 동일). 유한 큐(32, 가득 차면 가장 오래된 것 폐기), HTTP 타임아웃 5초. `PROMETHEUS_REMOTE_WRITE_URL` 이 비면 비활성(시작 시 1회 로그). 시계열: `agent_t_tx_*`, `agent_t_active{bucket}`, `agent_t_jvm_*`, `agent_t_dropped_total{kind}`, `agent_t_uri_*{uri}`(상위 200 + `_other`), DB 커넥션 풀: 합계 `agent_t_jvm_conn_{active,idle,max,wait}`(배치에 `jvm.conn_*` 가 있을 때만) + 풀별 `agent_t_db_pool_{active,idle,max,wait}{pool,kind}`(인스턴스당 최대 64개 `MaxPoolSeries`, 같은 `(pool,kind)` 중복은 첫 값, 풀 이름 128자 절단). `protocol.JVM` 의 `ConnActive/Idle/Max/Wait` 는 `*int64`+`omitempty`(구 에이전트=미수집과 실제 0 구분), `Pools []PoolStat`. live SSE 는 `JVM` 을 그대로 복사해 내보내므로 추가 코드 없이 `jvm.pools` 가 프론트로 간다. ClickHouse 저장 없음(이력은 Prometheus)
- DateTime64/DateTime 은 `'YYYY-MM-DD hh:mm:ss.sss'` UTC 문자열로 전송. `expire_at`(= 보정된 start_ts + 보관일)이 과거면 ClickHouse TTL 이 INSERT 즉시 행을 버린다
- `tx_sql.db`: 배치 `sql[].db`(선택, 없으면 `""`)를 128자로 잘라 `LowCardinality(String)` 컬럼에 적재. **ClickHouse 에 `20261104_tx_sql_db.sql` 을 먼저 적용한 뒤 이 gateway 를 배포**(컬럼이 없으면 JSONEachRow INSERT 가 unknown field 로 실패)
- `tx_detail.params`: 배치 `tx[].detail.params`(선택, `{q,p,t}`)를 한도(쌍 50·값 256·이름 64·q 1024자)로 재절단해 JSON 텍스트로 `String DEFAULT ''` 컬럼에 적재(없으면 `''`). **ClickHouse 에 `20261104_tx_detail_params.sql` 을 먼저 적용한 뒤 gateway·admin-api 를 배포**(컬럼이 없으면 INSERT/SELECT 실패)
- `cmd/agentsim`: 부하 생성기 `agentsim -gateway URL -tokens tokens.txt -jvms 50 -tps 5000 -duration 10m`
- 통합 테스트: `docker compose -f main-server/docker-compose.dev.yml up -d clickhouse` 후 `go test -tags integration ./internal/store/...`
- 토큰 인증: Bearer 토큰 sha256 hex == `label_info.agent_token_sha256`
- 킬 스위치: `label_info.enabled='false'` → 응답 `config.enabled=false`
- 환경변수: `GATEWAY_LISTEN`, `GATEWAY_PG_DSN`, `SECRET_KEY`(필수 — 없으면 기동 실패, admin-api 와 동일 값), `CLICKHOUSE_*`, `PROMETHEUS_REMOTE_WRITE_URL`(선택), `GATEWAY_FLUSH_INTERVAL`, `GATEWAY_FLUSH_ROWS`, `GATEWAY_CH_QUEUE_MAX_BYTES`(기본 134217728=128MB), `GOMEMLIMIT`(compose 에서 `400MiB`, 컨테이너 mem_limit 512m 아래). PG 비밀번호는 DSN 에 넣지 않고 `PGPASSWORD` 로 전달
- 전달 보장: **at-least-once** (`contracts/agent-t/protocol.md` §5). gateway→ClickHouse 는 토큰으로 중복 제거되지만, 에이전트가 읽기 타임아웃 후 같은 배치를 재전송하면 중복 행이 가능하다(코드로 막지 않음)
- 레지스트리: `label_info` 는 텍스트로 읽어 행마다 Go 에서 JSON 파싱 — 객체가 아닌 행은 에이전트 ID 당 1회 로그 후 건너뜀(전체 refresh 실패 방지)
- 테스트: `go test ./... && go vet ./...` (PG 는 가짜 Store 사용)
