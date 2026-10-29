# agent-t-gateway

Agent-T(Java 에이전트) 배치 수신 게이트웨이 (Go, 포트 8330). 계약: `contracts/agent-t/protocol.md`.

- `internal/protocol`: 배치/응답 구조체 + `Decode` (본문 32MB 상한)
- `internal/registry`: PG(`agent_instances`+`systems`) 30초 캐시, 토큰 sha256 → Instance. `Store` 인터페이스 뒤에 PG 구현(`pgstore.go`)
- `internal/ingest`: `POST /t/v1/batch` 핸들러, 시계 보정(`skew.go`, |차이|>2s 일 때 EWMA)
- `internal/store`: `Writer`(Sink+Backpressure; 테이블별 버퍼 → ClickHouse HTTP `JSONEachRow` gzip, 상한 초과 시 상세→SQL→요약 순 폐기, 80% 이상 `BackoffMs=2000`), `Dict`(LRU 200k, 미적재 시작 → `need_dict`; `dict_sql`/`dict_uri` 적재), `Commands`(PG `agent_commands` 2초 폴링, 전달 시 `sent`, 덤프 적재 후 `done`+`result_ref=cmd_id`; PG 는 `CommandStore` 인터페이스 뒤)
- `internal/live`: `State`(Sink; 인스턴스별 메모리 상태, 5초 집계 → 10분 링 `RingSize=120`, `OnAgg` 훅), `Hub`(SSE 팬아웃), `API`(`GET /t/v1/stream` SSE, `GET /t/v1/snapshot`; admin-api 사용자 JWT HS256 검증). `system_ids` 파싱 불가 값은 400(전체로 해석하지 않음). SSE 쓰기당 데드라인 10초
- `internal/promrw`: 5초 집계 → Prometheus remote write(protobuf+snappy). WriteRequest 는 `protowire` 로 직접 인코딩(prometheus/prometheus 의존성 회피). 공통 레이블 `system_name, display_name, instance_role, host`(agent `metrics/mod.rs` 와 동일). 유한 큐(32, 가득 차면 가장 오래된 것 폐기), HTTP 타임아웃 5초. `PROMETHEUS_REMOTE_WRITE_URL` 이 비면 비활성(시작 시 1회 로그). 시계열: `agent_t_tx_*`, `agent_t_active{bucket}`, `agent_t_jvm_*`, `agent_t_dropped_total{kind}`, `agent_t_uri_*{uri}`(상위 200 + `_other`)
- DateTime64/DateTime 은 `'YYYY-MM-DD hh:mm:ss.sss'` UTC 문자열로 전송. `expire_at`(= 보정된 start_ts + 보관일)이 과거면 ClickHouse TTL 이 INSERT 즉시 행을 버린다
- `cmd/agentsim`: 부하 생성기 `agentsim -gateway URL -tokens tokens.txt -jvms 50 -tps 5000 -duration 10m`
- 통합 테스트: `docker compose -f main-server/docker-compose.dev.yml up -d clickhouse` 후 `go test -tags integration ./internal/store/...`
- 토큰 인증: Bearer 토큰 sha256 hex == `label_info.agent_token_sha256`
- 킬 스위치: `label_info.enabled='false'` → 응답 `config.enabled=false`
- 환경변수: `GATEWAY_LISTEN`, `GATEWAY_PG_DSN`, `SECRET_KEY`(필수 — 없으면 기동 실패, admin-api 와 동일 값), `CLICKHOUSE_*`, `PROMETHEUS_REMOTE_WRITE_URL`(선택), `GATEWAY_FLUSH_INTERVAL`, `GATEWAY_FLUSH_ROWS`, `GATEWAY_CH_QUEUE_MAX_BYTES`
- 테스트: `go test ./... && go vet ./...` (PG 는 가짜 Store 사용)
