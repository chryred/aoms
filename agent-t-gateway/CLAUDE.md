# agent-t-gateway

Agent-T(Java 에이전트) 배치 수신 게이트웨이 (Go, 포트 8330). 계약: `contracts/agent-t/protocol.md`.

- `internal/protocol`: 배치/응답 구조체 + `Decode` (본문 32MB 상한)
- `internal/registry`: PG(`agent_instances`+`systems`) 30초 캐시, 토큰 sha256 → Instance. `Store` 인터페이스 뒤에 PG 구현(`pgstore.go`)
- `internal/ingest`: `POST /t/v1/batch` 핸들러, 시계 보정(`skew.go`, |차이|>2s 일 때 EWMA)
- 인터페이스 `Sink`/`CommandSource`/`DictCache`/`Backpressure` — B2/B3 에서 구현. 현재 main.go 는 no-op 연결
- 토큰 인증: Bearer 토큰 sha256 hex == `label_info.agent_token_sha256`
- 킬 스위치: `label_info.enabled='false'` → 응답 `config.enabled=false`
- 환경변수: `GATEWAY_LISTEN`, `GATEWAY_PG_DSN`, `SECRET_KEY`, `CLICKHOUSE_*`, `PROMETHEUS_REMOTE_WRITE_URL`, `GATEWAY_FLUSH_INTERVAL`, `GATEWAY_FLUSH_ROWS`, `GATEWAY_CH_QUEUE_MAX_BYTES`
- 테스트: `go test ./... && go vet ./...` (PG 는 가짜 Store 사용)
