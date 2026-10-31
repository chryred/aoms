# Agent-T 배치 프로토콜 v1

Agent-T(Java 에이전트) -> gateway(Go) 단방향 배치 전송 계약. 샘플: `batch-v1.sample.json`, `batch-response-v1.sample.json`. 저장 스키마: `main-server/configs/clickhouse/init/001_agent_t.sql`.

## 1. 요청

`POST /t/v1/batch`

| 헤더 | 값 |
|---|---|
| `Authorization` | `Bearer <agent_token>` |
| `Content-Encoding` | `gzip` |
| `Content-Type` | `application/json` |

JVM 당 약 1초마다 1회 전송. 본문 최상위 필드:

| 필드 | 설명 |
|---|---|
| `v` | 프로토콜 버전. 현재 `1` |
| `seq` | 에이전트 단조 증가 배치 번호 |
| `ts` | 전송 시각 (ms epoch, UTC) |
| `cfg_v` | 에이전트가 보유한 config 버전 |
| `agent` | `{version, jvm, pid, host, start_ts}` |
| `active` | `{buckets:[n,w,c], top:[...]}` 현재 진행 중 트랜잭션 |
| `tx` | 완료 트랜잭션 배열 |
| `dict` | `{sql:{id:text}, uri:{id:text}}` ID -> 원문 사전 |
| `jvm` | JVM 지표. **5초마다만 포함, 그 외 `null`** |
| `dumps` | 명령 응답 스레드 덤프 `[{cmd_id, ts, text, truncated}]` |
| `dropped` | 과부하로 버린 건수 `{detail, sql, tx}` |

`dumps`, `dict`, `dropped` 는 빈 값(`[]`, `{}`, 0) 허용.

### active
- `buckets`: `[정상, 경고, 위험]` 구간별 진행 건수.
- `top[]`: `{trace_id, span_id, thread, uri_id, start_ts, phase, sql_id, stack[]}`. `phase` = `run` | `sql` | `ext`. `sql_id` 는 `phase` 가 `sql` 일 때만 값, 아니면 `null`.

### tx[]
`trace_id, span_id, parent_span(없으면 ""), start_ts, elapsed_ms, method, uri_id, status, error, exc, cpu_ms, sql_ms, sql_cnt, fetch_cnt, fetch_ms, ext_ms, ext_cnt, conn_open, conn_close, conn_leak, conn_uncommit, user_ip, user_id, biz_key, sql[], detail`

- `sql[]`: `{sql_id, cnt, ms, max_ms, fetch_cnt, fetch_ms, err}` — 트랜잭션 내 SQL 별 집계.
- `detail`: 상세 보존 건만 객체, 그 외 `null`.
  `{"nodes":[{"i","p","k","n","s","d","sql_id"}], "stacks":[{"f":[frame...],"c":count}]}`
  - `i` 노드 번호, `p` 부모 노드 번호(루트 -1), `k` = `http` | `sql` | `ext`, `n` 이름, `s` 트랜잭션 시작 대비 시작 오프셋(ms), `d` 소요(ms), `sql_id` 없으면 `""`.

## 2. ID 규칙
- `trace_id`: 32자리 소문자 hex, `span_id`: 16자리 소문자 hex (W3C Trace Context).
- `uri_id`, `sql_id`: FNV-1a 64bit(정규화된 UTF-8 바이트) 값의 **소문자 16자리 hex**. ClickHouse 에는 UInt64 로 저장.
- tx/active 가 참조하는 `uri_id`·`sql_id` 는 `dict` 에 포함하거나 gateway 가 이미 알고 있어야 한다. 모르면 응답 `need_dict` 로 재요청.

## 3. 단위
- 모든 시각은 ms epoch(UTC). 기간은 ms. 메모리는 byte. `cpu_ratio` 는 0.0~1.0.

## 4. 응답

| 코드 | 의미 |
|---|---|
| `200` | 수신 성공. 본문은 아래 응답 JSON |
| `400` | 스키마·`v` 오류. 에이전트는 해당 배치를 폐기 |
| `401` | 토큰 불일치. 에이전트는 60초 후 재시도 |
| `429` | 과부하. 본문 `{"backoff_ms": N}` — N ms 후 전송 재개 |

`200` 본문:
```json
{"config": {...}, "commands": [{"id": 7, "type": "thread_dump"}],
 "need_dict": {"sql": ["16hex"], "uri": []}, "backoff_ms": 0}
```
- `config`: `{version, enabled, slow_ms, normal_detail_rate, stack_interval_ms, exclude, uri_rules, log_level}`. 요청 `cfg_v` 와 서버 버전이 같으면 **필드 생략**.
- `commands`: 에이전트가 실행할 명령. 결과는 이후 배치 `dumps` 로 회신(`cmd_id` 매칭).
- `need_dict`: 사전에 없어 원문을 요청하는 ID 목록. 다음 배치 `dict` 에 포함.
- `backoff_ms`: 0 이 아니면 해당 시간만큼 전송 지연.

## 5. 전달 보장 (at-least-once)

파이프라인 전체는 **at-least-once** 이다. 중복 제거 범위는 구간별로 다르다.

- **gateway → ClickHouse**: 청크마다 고정된 `insert_deduplication_token` 을 보내고 실패한 청크는 같은 토큰·같은 본문으로 통째 재시도한다. 커밋 후 타임아웃이 나도 ClickHouse 가 중복을 제거한다 (`non_replicated_deduplication_window = 1000`, 최근 1000 블록 한정).
- **에이전트 → gateway**: 에이전트가 읽기 타임아웃 후 같은 배치를 재전송하면 gateway 는 이를 구별하지 못한다 (배치 단위 멱등 키 없음). 이미 수신·적재된 배치가 한 번 더 들어오면 `tx_summary`/`tx_sql` 등에 **중복 행**이 생길 수 있다. 의도된 한계이며 코드로 막지 않는다.
- 소비자(조회·집계)는 `span_id` 중복 가능성을 알고 있어야 한다. E2E 는 `count() - uniqExact(span_id)` 로 중복 비율을 기록한다.
