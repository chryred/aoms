# Agent-T Docker E2E 결과 (Task H1)

## 현재 상태 요약 (fix round 2 기준, 상세는 아래)
- **S1~S6, S8 PASS** (fix round 2 회귀 포함: S3b 커넥션 추적 JDK7·JDK17 40/40, S6 킬 스위치 max 25.3s ≤ 35s).
- **S7·S10 은 환경 제약으로 판정 보류**: 개발 VM 메모리 부족(swap 가득)에서 S10 기본 큐 256MB 는 실패 post 9, 큐 64MB 는 PASS. gateway 코드 결함은 없는 것으로 판단하며 **운영 사양 서버에서 재측정 필요**.
- D-H1-1(커넥션 추적), D-H1-2(전체 시스템 검색 쿼리)는 수정 확인. D-H1-3(ClickHouse 정지 중 지연)은 환경 요인 유력.
- **최종 리뷰 반영(final fix wave)**: gateway 큐 기본값을 256MB → **128MB** + `GOMEMLIMIT=400MiB` 로 낮췄다(아래 256MB 수치는 당시 측정값). 파이프라인은 **at-least-once** 로 문서화(`contracts/agent-t/protocol.md` §5)했고, `run.sh` S4 에 `count() - uniqExact(span_id) = 0` 검사를 추가했다(S4 는 >0 이면 FAIL, S7·S10 은 `dup_span_rows` 기록). 이 변경은 아직 Docker E2E 로 재실행되지 않았다.

실행 일시: 2026-10-30 (개발 Mac, Apple Silicon, Docker Desktop 3.8GB/10CPU). 하니스: `run.sh up|test|down`.
시나리오 9(브라우저)는 controller 의 design-review/qa 담당.

## 환경·한계 (결과 해석 전 필독)
- JDK7 Tomcat(`tomcat7`)은 linux/amd64 에뮬레이션. 오버헤드(시나리오 8)·p95 는 네이티브 arm64 JDK17(`tomcat9`) 로만 측정. JDK7 은 기능 시나리오(1~3)만.
- dev 스택(`dev-clickhouse` 등)이 이미 호스트 8123 을 점유해 dev compose 를 쓰지 않고 **독립 프로젝트 `agent-t-e2e`**(`docker-compose.e2e.yml`, 컨테이너 `e2e-*`)로 구성. 설정 파일(init.sql, clickhouse init/users/limits)은 dev 와 동일 파일 마운트. 컨테이너 CPU 상한은 spec §7.6 대로 gateway 1.0 / ClickHouse 1.5 코어(ClickHouse 메모리는 2GB — Docker VM 3.8GB 제약).
- 호스트 포트: PG 15432, Prometheus 19090, ClickHouse 18123, gateway 8330, tomcat7/9/9-bare 18081/18082/18083, admin-api 8080, frontend 3001.
- **호스트 부하 오염**: 같은 Mac 에서 다른 작업(load average 12~13/10코어, opensearch 등)이 동시에 돌아 시나리오 7 재실행 2회는 무효(Docker DNS 127.0.0.11 타임아웃, gateway→ClickHouse/Prometheus/PG 요청 타임아웃 로그로 확인). 시나리오 7 유효 수치는 호스트가 조용했던 최초 실행. dev 서버(운영 유사 사양)에서 재측정 권장.
- agentsim·hey 는 호스트에서 Docker 포트포워딩 경유로 부하를 주므로 gateway 앞 네트워크 지연이 포함된다.

## 결과 요약
| # | 시나리오 | 결과 | 핵심 수치 |
|---|---|---|---|
| 1 | attach 후 5초 내 snapshot 등장 | PASS | attach 1.3~1.4s, attach 후 snapshot 반영 1.3s, attach 중·후 비정상 응답 0 (JDK7·17) |
| 2 | JDK7 `/ext` → JDK17 `/db` 분산 trace | PASS | trace 2행(서로 다른 system), `path` 길이 2, 20/20 호출 모두 연결 |
| 3 | 상세 보존 규칙 | PASS | `/slow` 6/6 상세, `/error` 8/8 상세, `/ok` 5/300(1.7%) 상세, `/slow` 호출 트리 gap 3503ms |
| 4 | 전량 수집 | PASS | hey 200 응답 52,855 == tx_summary 52,855 (차이 0.000%), 881 rps |
| 5 | gateway 중단 내성 | PASS | p95 24.7→24.5ms (Δ-0.2), 중단 60s 동안 실패 응답 0, 에이전트 객체 1.9MB(상한 8MB), 힙Δ +4.2MB(GC 후), `docker pause`(무응답) p95 Δ0, 재기동 후 수신 재개 |
| 6 | 킬 스위치 | PASS | 3회 토글 min 5.4s / max 16.1s (기준 ≤35s), 재attach 없이 재개, 서비스 실패 0 |
| 10 | ClickHouse 45s 정지 내성 | FAIL(결정적 재현) | D-H1-3 |
| 7 | 5,000 TPS × 10분 | 최초 실행 PASS급 / 재실행 FAIL | 아래 + Fix round 1(D-H1-2/3) |
| 8 | 에이전트 오버헤드(JDK17) | PASS | CPU 13.65%→13.17%(Δ-0.48pt), 요청당 CPU 156.9→149.1µs, p95 25.27→24.93ms, 힙 +1.9MB |

### 시나리오 7 상세 (agentsim 50 JVM, 5,000 TPS, 10분, 최초 실행: 호스트 조용·ClickHouse 신규)
| 항목 | 값 |
|---|---|
| 송신/적재 | 3,000,000 / 2,999,800 (차이는 t0 이전 start_ts 행) |
| 429 / 실패 post / dropped(sim) | 0 / 0 / 0 |
| ClickHouse 적재 지연 | p95 1,051ms, max 1,107ms (기준 <5s) |
| gateway CPU | 평균 21%, 최대 27% (상한 100%=1코어), 메모리 최대 29MiB |
| ClickHouse CPU | 평균 9%, 최대 26% (상한 150%) |
| admin-api `/api/v1/systems` p95 | 부하 전 2.4ms → 부하 중 3.4ms (+1.0ms, 상대 +41.7%) |
| 압축 저장 | tx_summary 62.6 B/행, tx_sql 58.1 B/행 (tx 1건 ≈ 요약 1행 + SQL 1행 ≈ 121 B 디스크) |
| 수신 바이트 | gateway 수신 ≈ 67~77 B/tx (gzip 후, 근사 — 컨테이너 NetIO 델타) |
- admin-api p95 퇴행은 기준선이 서브밀리초대(2.4ms)라 상대값이 타이머 해상도·노이즈에 지배됨. 판정 기준을 "상대 ≤20% 또는 절대 ≤ +1ms"로 `run.sh` 에 명시했다(엄격히 상대값만 보면 FAIL). 기준선 3회 중앙값/부하 2시점 최댓값 방식으로 바꾼 재실행은 호스트 오염으로 무효.
- 오염된 재실행(참고): 실행 2 — 실패 post 159, 지연 max 9.2s, ClickHouse CPU 최대 138%; 실행 3 — 실패 post 1,413, 지연 p95 34s. 당시에는 호스트 과부하로 판단했으나 Fix round 1 의 S10 재현으로 ClickHouse 포화·정지와의 인과 가능성이 확인됨 (D-H1-3).

### 용량 추정 보정값 (spec §7.6 입력)
- tx 1건 디스크: tx_summary 62.6 B + tx_sql 58.1 B(시뮬레이터 SQL 1건/tx) ≈ 121 B/tx(상세 1% 별도, tx_detail 66 B/행). 5,000 TPS × 86,400s × 7일 ≈ 3.0G 행 → 요약+SQL 약 360GB(시뮬레이터 트랜잭션 기준; 실제 SQL 수·URI 분포에 따라 변동).
- 5,000 TPS 에서 gateway ≈ 0.2~0.3 코어, ClickHouse ≈ 0.1~0.4 코어(상한 대비 여유 큼). 기준 환경은 위 한계 참조.
- 에이전트: 요청당 CPU 추가분 측정 오차 이내(±8µs/req), 힙 추가 ≈ 2MB, 전송 중단 시 버퍼 ≈ 2MB 로 상한 내.

## Controller decisions (fix round 1)
- S7 admin-api 기준: "상대 ≤20% 또는, 기준선 p95 < 10ms 일 때 절대 ≤ +1ms" 채택.
- S6 킬 스위치 기준: ≤35s (레지스트리 30s 갱신 + 1s 전송 + 여유). 이 설계에서 킬 스위치 경로는 에이전트별 `label_info.enabled`.

## Fix round 1 결과 (원본: `results-committed/<run-id>/`)
| 항목 | 결과 |
|---|---|
| S6 킬 스위치 3회(위상 +0/+9/+19s) | PASS — 중단까지 5.4 / 16.1 / 8.9s (min 5.4, max 16.1, 기준 ≤35s), 재활성 후 재attach 없이 재개(18/27/21s), 서비스 실패 0 (`fix1-s6s10`). 첫 시도는 다른 작업의 `pkill -f .bin/hey` 로 부하기가 죽어 무효 → hey 바이너리를 `.bin/e2e-hey` 로 개명해 재발 방지 |
| S3 JDK7 JDBC (attach 전 `/db` 호출 → attach → `/db`) | PASS — JDK7 `/db` 40건 모두 sql_cnt≥3, tx_sql 행 존재, JDK17 동일 (`fix1-s1s3`). tomcat7 은 처음부터 e2e-postgres 에 연결돼 있었음 |
| S3b 커넥션 open/close 추적 | **FAIL** — D-H1-1 |
| S7 재실행(`fix1-s7`, 부하 평균 4.4 → 종료 시 11) | **FAIL** — D-H1-2/D-H1-3. 3.0M 중 1.39M 만 송신(실패 post 1,201), ClickHouse CPU 최대 178%, `/apm/transactions` 전체 시스템 검색 프로브 6회 중 3회 502(15~17s). api `/systems` p95 2.7→3.3ms(+0.6ms 통과) |
| S10 ClickHouse 45s 정지 | **FAIL, 결정적 재현** — D-H1-3 |
| `dropped` 검사 | Prometheus 결과가 비면 FAIL 로 수정(`NA`). S7 은 `agent_t_dropped_total{system_name="e2e-sys-sim"}` 사용 |
| 결과 보관 | 실행별 `results/<run-id>/`(타임스탬프, 덮어쓰기 없음) + `E2E_PUBLISH=1` 시 `results-committed/<run-id>/` 로 summary·metrics·run-info 복사 |
| `down` | pid 파일에 기록한 프로세스(와 자식)만 종료, 8080/3001 을 모르는 프로세스가 점유 중이면 `up` 이 즉시 실패, `down` 은 경고만 |

참고: 최초 S7(호스트 조용, 쿼리 부하 없음)은 PASS 급 수치(위 S7 상세 표). 재실행에서 달라진 점은 호스트 부하와 **S7 중 30초마다 보낸 `/apm/transactions` 전체 시스템 검색 프로브**이다.

## Defects found
기능 결함 후보 3건. (S1~S5·S8 은 영향 없음)

### D-H1-1 (의심, 미확정) 커넥션 open/close 가 항상 0 — instrument
- 증상: `PGSimpleDataSource.getConnection()` 경유 `/db`(SQL 3건·fetch 3건은 정상 집계)에서 `tx_summary.conn_open/conn_close` 가 JDK7·JDK17 모두 40/40건 0 (`results-committed/fix1-s1s3`). conn_close 도 0 이므로 DataSource 매칭 하나만의 문제는 아닐 수 있음.
- 가설: `agent-t/instrument/.../Matchers.java:76` `anc.contains(DATA_SOURCE)` — pgjdbc 에서 `getConnection()` 은 `BaseDataSource` 에 선언되고 `BaseDataSource` 자체는 `javax.sql.DataSource` 를 구현하지 않아(서브클래스 `PGSimpleDataSource` 가 구현) 선언 클래스 기준 상위 판정에서 빠진다. `Connection.close`(`Matchers.java:63`)도 구현 클래스 `PgConnection` 상속 사슬에서 매칭이 안 되는지 확인 필요. 커넥션 풀(Tomcat JDBC/HikariCP/JEUS)로도 재현 확인 권장.
- 제안: 하니스에 풀 DataSource 경로 추가 후 소유 태스크(G2)에서 상위 타입 판정을 "선언 클래스의 어느 조상이든 DataSource 를 구현하고 서브클래스가 구현하는 경우" 까지 확장.

### D-H1-2 `/api/v1/apm/transactions` 전체 시스템 검색이 ClickHouse 를 포화(502) — admin-api D2 쿼리 비용
- 재현: S7(5,000 TPS, 3개 시스템 약 1시간 분량) 중 `GET /api/v1/apm/transactions?system_ids=1&system_ids=2&system_ids=3&limit=100` 30초마다 호출 → 6회 중 3회 502(소요 15.3/15.6/17.2s), 나머지는 0.17~0.82s (`results-committed/fix1-s7/s7-apm-probe.txt`). admin-api 로그 `ClickHouseError: ClickHouse 연결 실패`(httpx 타임아웃), QA 가 본 `Memory limit exceeded 1.6GiB` 와 동일 계열.
- 원인 가설: `main-server/services/admin-api/routes/apm.py` `search_transactions` 마지막 쿼리(`ORDER BY start_ts DESC LIMIT … OFFSET …`, 약 L200-210)가 다수 system_id 에 대해 테이블 정렬키 `(system_id, start_ts)` 의 read-in-order 최적화를 못 쓰고 범위 내 전 행(27개 컬럼, 문자열 포함)을 읽고 정렬한다. 1시간×5,000TPS ≈ 18M 행. ClickHouse 가 1.5코어/1.6GiB 한도에 닿아 같은 서버의 적재 INSERT 도 지연된다(S7 재실행에서 송신량 50% 미만, 적재 지연 기록값 99999999=정지).
- 제안 수정: (1) 1단계로 `trace_id, span_id, start_ts` 만 `ORDER BY start_ts DESC LIMIT n` 으로 뽑고 2단계에서 해당 키로 전체 컬럼 조회, (2) 시스템별로 `LIMIT n` 쿼리 후 Python 에서 병합, (3) 기본 조회 구간을 15분 이하로 제한하고 `max_execution_time`/`max_memory_usage` 쿼리 설정 부여, (4) 쿼리 사용자 `agent_t_profile` 에 읽기·쓰기 프로필 분리(적재용 사용자와 조회용 사용자).

### D-H1-3 ClickHouse 정지/포화 시 gateway 인입 지연·타임아웃 (의심 결함, 미해결)
- 결정적 재현(S10): 2,000 TPS agentsim 중 ClickHouse `docker pause` 45초 → agentsim 실패 post 49 / 97 / 56 건(3회 모두, 429 아님), 프로브 최대 지연 18.4 / 13.2 / 10.4s. 타임라인(`fix1-s10c/s10-timeline.txt`): 정지 12초 후부터 지연 증가(0.5→4.5s), 이후 한 요청이 22.8s 걸리고 정지 해제 직전 회복. 모든 JVM 이 동시에 영향(실패 수가 JVM 수 49 의 배수 근처). 적재 행은 결국 전량 도착(rows ≥ sent, dropped 0).
- 배제한 원인: 호스트→컨테이너 포트포워딩 문제 아님(agentsim 을 dev-net 내부 컨테이너에서 실행해도 실패 56, `fix1-s10-indocker`). 대조군: 같은 방식으로 **tomcat7 을 pause 하면 PASS**(실패 0, p99 806ms, `fix1-s10-control-pause-tomcat7`) → ClickHouse 정지와 인과가 있음.
- goroutine dump(정지+25초, `fix1-s10-dump/s10-dump-last.txt`): 인입 핸들러 goroutine 이 1개(`protocol.Decode` gunzip 중)뿐이고 `Writer.mu`/`flushMu` 등 뮤텍스 대기 goroutine 없음 → "핸들러가 락에서 막힘" 가설은 반증, 클라이언트 요청이 핸들러에 도달하기 전(accept/read 단계)에 지연되는 것으로 보임. 정확한 병목은 미확정.
- 후보(미검증): ① `agent-t-gateway/internal/store/writer.go` flush 실패 시 재큐잉(`append(lines[off:len:len], w.bufs[t].lines...)`, 약 L297-302) 및 `insert` 의 30s 클라이언트 타임아웃(L78)로 flush goroutine 이 오래 점유되며 GC·CPU(컨테이너 cpus=1.0)를 압박, ② 백로그 JSON 라인 수십만 개의 GC 압력(gateway CPU 상한 1코어), ③ Docker pause 시 브리지 네트워크 영향(대조군으로 상당 부분 배제).
- 다음 단계 제안: gateway 에 `net/http/pprof`(또는 `/metrics` 핸들러 지연 히스토그램)를 추가해 정지 중 CPU/GC/네트워크 프로파일 확보, 컨테이너 cpus 상한 해제 대조 실행, `docker pause` 대신 ClickHouse 를 느리게 만드는 방식(`SYSTEM STOP MERGES` 무관, 쿼리 부하)과 비교.
- 결과 해석: 에이전트 쪽은 영향 없음(WAS 스레드 비차단, 버퍼 상한 내). 데이터 손실도 없으나 에이전트의 post 타임아웃·재전송 증가.

### Observations
1. 킬 스위치 최악 지연: 3회 측정 5.4/16.1/8.9s(앞선 측정 17.6·24.8s) — 이론 최악 ≈31s, 승인된 기준 35s 이내.
2. 에이전트 로그에 버퍼 지표가 없음(`Sender.bufferedBytes()` 미출력) — 하니스는 class histogram·GC 후 힙으로 대체. 5분 주기 또는 drop 시 로그 권장.
3. `docker stats` 의 gateway 인입량 근사 ≈ 67~77 B/tx(gzip), ClickHouse 디스크 ≈ 63 B(summary)+58 B(sql)/tx.

## Fix round 2 (merge feat/agent-t 8ccf0b9, 새 jar·gateway·admin-api 재배포 후 재실행)
재배포: `git merge feat/agent-t`, `agent-t/build.sh jar` → 두 Tomcat 재기동 후 재attach(S1), gateway 이미지를 병합 소스로 재빌드, admin-api 재시작(frontend 유지). 원본: `results-committed/fix2-*`.

**Docker VM 메모리(각 run-info.txt)**: S1~S6 실행 직전 free 1.2GB 였으나 swap 1010/1024MB. S10 직후·S7 직전 free 62~70MB, swap 1024/1024MB(가득) — dev 스택 외 `synq-opensearch`·`dev-clickhouse` 등 다른 작업 컨테이너가 같은 VM 을 공유. 아래 S7·S10 은 **환경 제약 실행(environment-limited)** 으로 표기하며 FAIL 로 확정하지 않는다.

| 시나리오 | 결과 |
|---|---|
| S1~S6 회귀 (`fix2-s1-s6`) | 전부 PASS. S1 attach 1.3s, S2 20/20 trace 연결, S3 JDK7·JDK17 `/db` 40/40 SQL≥3, **S3b 커넥션 추적 JDK7 40/40·JDK17 40/40 PASS(D-H1-1 수정 확인)**, S4 53,069=53,069, S5 p95 25.1→25.2ms, S6 3회 min 17.9s / max 25.3s(≤35s) |
| S7 (`fix2-s7`) | **환경 제약 — 판정 보류.** swap 가득·free 66MB·부하 평균 5.8→16. 송신 1.93M/3.0M, 실패 post 667, 적재 지연 기록값 정지(99999999). `/apm/transactions` 전체 시스템 프로브 8회 중 7회 200(0.12~2.4s, 이전엔 6회 중 3회 502), 1회 502(16.5s, VM 포화 중). api `/systems` p95 4.9→3.7ms(통과). 호스트·VM 이 조용했던 최초 실행(쿼리 프로브 전, 호스트 조용)은 모든 기준 충족(위 S7 상세 표) |
| S10 기본 큐 256MB (`fix2-s10`) | 환경 제약. 실패 post 9(이전 49/97/56), 프로브 p99 2.1s, max 6.7s — 개선됐으나 기준 미달. rows 201,024 ≈ sent 201,966(dropped 0, 전량 적재) |
| S10 큐 64MB (`fix2-s10-q64`, `E2E_CH_QUEUE_MAX_BYTES=67108864`) | **PASS** — 실패 post 0, 명시적 429 392건, 프로브 p99 519ms / max 3.0s, rows 209,025 ≥ sent 203,196, dropped 0. VM free 70MB·swap 가득 상태에서도 통과 → 백로그가 작으면 이 VM 에서 정지 영향이 사라짐 |

### 결함 상태
- **D-H1-1 수정 확인**: pgjdbc `BaseDataSource` 경로에서 conn_open/close 가 JDK7·JDK17 모두 40/40 집계(S3b PASS).
- **D-H1-2 수정 확인(부분적 환경 제약)**: 두 단계 쿼리 후 전체 시스템 검색이 S7 부하 중 대부분 0.1~2.4s 에 200. VM 포화 극단 구간에서 1회 502(16.5s)는 남음 — 정상 환경에서 재확인 필요.
- **D-H1-3 환경 요인 유력(gateway 코드 결함 없음)**: 소유자 회귀 테스트가 인입 경로가 ClickHouse 를 기다리지 않음을 보였고, 같은 시나리오가 큐 64MB 에서는 통과, 256MB 에서는 실패 9건으로 감소(이전 49~97). VM swap 가득·free<100MB 조건과 일치. 운영 사양 서버(dev 서버)에서 S10 을 재측정해 종결할 것.
- 운영 메모: 개발 VM 처럼 메모리가 빠듯하면 `GATEWAY_CH_QUEUE_MAX_BYTES` 를 줄이면(64MB) 정지 중 429 로 명시적 backoff 가 동작해 에이전트 타임아웃이 없어진다 — 운영 기본값은 이후 128MB(+`GOMEMLIMIT=400MiB`)로 낮췄다 — 서버 메모리 기준으로 재검토.

## 재현·운영 방법
```
agent-t/test/e2e/run.sh up       # Tomcat·PG·Prometheus·ClickHouse·gateway 컨테이너 + 호스트 admin-api(8080)·frontend(3001) + 시드
agent-t/test/e2e/run.sh test     # 시나리오 1~8,10 (E2E_LOAD_DURATION=2m 로 7번 단축 가능). 일부만: run.sh test 2 3
agent-t/test/e2e/run.sh down     # 전부 중지·볼륨 삭제
```
- 결과 파일: `results/<run-id>/`(gitignore; `results/latest` 링크). `E2E_PUBLISH=1 E2E_RUN_ID=<id> run.sh test 7` 이면 summary/metrics 를 `results-committed/<id>/` 에 복사. 시나리오 10 변형: `E2E_SIM_IN_DOCKER=1`(agentsim 컨테이너 실행), `E2E_S10_PAUSE=<컨테이너>`(대조군), `E2E_S10_QUIT=1`(정지+25초 goroutine dump, 수치 무효).
- 사전 요구: Docker, Go, `agent-t/build.sh fetch && jar` (up 이 자동 수행), npm.

### 브라우저 확인용 (시나리오 9)
- frontend: http://localhost:3001 — 로그인 `e2e-admin@example.test` / `e2e-admin-1234` (dev 전용 테스트 admin, PG 에만 존재)
- 시스템: `e2e-sys-a`(JDK7, id 1), `e2e-sys-b`(JDK17, id 2), `e2e-sys-sim`(agentsim, id 3). 화면 확인용 트래픽: `run.sh` 가 만든 `.bin/hey` 로 예) `.bin/hey -z 5m -q 20 -c 4 http://localhost:18082/ok`, `…/slow`, `…/error`, `http://localhost:18081/ext`(분산 trace).
- 에이전트는 시나리오 1·6 후 부착 상태. 부착이 풀렸으면:
  `docker exec e2e-tomcat9 java -jar /opt/agent-t/agent-t-attacher.jar 1 /opt/agent-t/agent-t.jar` / `docker exec e2e-tomcat7 java -jar /opt/agent-t/agent-t-attacher.jar 1 /opt/agent-t/agent-t-legacy.jar`
- admin-api 로그 `.work/admin-api.log`, 프런트 로그 `.work/frontend.log`.
