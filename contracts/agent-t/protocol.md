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

### jvm
`{ts, heap_used, heap_max, nonheap_used, gc_count, gc_ms, threads, cpu_ratio, classes}` + **선택** DB 커넥션 풀 지표(하위 호환 추가):

| 필드 | 설명 |
|---|---|
| `conn_active` / `conn_idle` / `conn_max` / `conn_wait` | 수집된 모든 풀의 합계(개수). `conn_wait` = 커넥션을 기다리는 스레드 수. `max` 가 무제한/미상인 풀은 `conn_max` 합계에서 0 으로 계산 |
| `pools[]` | 풀별 `{name, kind, active, idle, max, wait}`. `kind` = `jeus` \| `hikari` \| `tomcat` \| `dbcp2`. `name` = 풀 이름(JEUS 데이터소스 id 등, 자격증명·URL 미포함). 사용률(active/max) 내림차순, 최대 64개 |

- 풀을 하나도 못 찾았거나 스냅샷이 30초 넘게 갱신되지 않으면 `conn_*` 와 `pools` 키 **자체를 생략**한다(0 과 구분). 필드가 없으면 "풀 미수집"(구 에이전트·`pool.metrics=false`)으로 취급.
- 수집 방식: 에이전트 전용 스레드가 `MBeanServerFactory.findMBeanServer(null)` 로 찾은 MBeanServer 에서 JMX `getAttribute` 만 읽는다(JEUS `JEUS:j2eeType=JDBCDataSource,*` 의 `stats`, HikariCP, Tomcat JDBC/DataSource, DBCP2). active = 사용 중, idle = 유휴, JEUS active = PoolSize - FreePoolSize.
- gateway: live SSE `jvm` 객체에 그대로 전달, Prometheus 는 `agent_t_jvm_conn_{active,idle,max,wait}`(합계) 와 `agent_t_db_pool_{active,idle,max,wait}{pool,kind}`(풀별, 인스턴스당 64개 상한).

### tx[]
`trace_id, span_id, parent_span(없으면 ""), start_ts, elapsed_ms, method, uri_id, status, error, exc, cpu_ms, sql_ms, sql_cnt, fetch_cnt, fetch_ms, ext_ms, ext_cnt, conn_open, conn_close, conn_leak, conn_uncommit, user_ip, user_id, biz_key, sql[], detail`

- `sql[]`: `{sql_id, cnt, ms, max_ms, fetch_cnt, fetch_ms, err, db}` — 트랜잭션 내 SQL 별 집계. 집계 키는 `(sql_id, db)` — 한 트랜잭션이 같은 SQL 을 서로 다른 DB 에 실행하면 `db` 별로 별도 행.
  - `db`(선택, string): 해당 SQL 이 실행된 DB 접속 표시명(`host:port/database|service|SID`, 예 `10.103.1.61:1433/stap`, `ora-db01:1521/ORCL`). 에이전트가 JDBC URL 에서 자격증명·파라미터를 제거해 정규화, 최대 128자. URL 을 해석할 수 없으면 벤더명(`oracle` 등), 알 수 없으면 `""`. **하위 호환**: 필드가 없으면 `""` 로 취급(구 에이전트). gateway 는 `agent_t.tx_sql.db` 에 저장.
- `detail`: 상세 보존 건만 객체, 그 외 `null`.
  `{"nodes":[{"i","p","k","n","s","d","sql_id"}], "stacks":[{"f":[frame...],"c":count}]}`
  - `params`(선택, 에이전트 opt-in `capture.params=true`): 마스킹된 **요청 파라미터**(본문 아님) `{"q": "<마스킹된 query string>", "p": [[name, value], ...], "t": true|false}`. `t` = 건수(50)·값 길이(256자)·전체 4KB 한도로 잘렸는지. 서블릿 종료(exit) 시점에만 수집하고 **상세(detail)가 있는 건(느림·에러·누수·샘플링)에만** 붙는다(물량 제한). 이름에 password/passwd/pwd/pass/token/secret/auth/card/cvc/ssn/jumin/resident/rrn/account/acct/phone/mobile/tel/email/birth/addr 가 들어가면(대소문자 무시) 값은 `****`, 값이 주민번호·카드번호(13~19자리)·이메일 패턴이면 해당 부분을 `****`. **하위 호환**: 필드가 없으면 파라미터 없음. gateway 는 `agent_t.tx_detail.params`(String, JSON 텍스트 `{"q","p","t"}`, 없으면 `''`)에 저장.
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
