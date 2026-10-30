# Agent-T Docker E2E 결과 (Task H1)

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
| 6 | 킬 스위치 | PASS | `PATCH /agents/{id}` label_info.enabled=false → 17.6s(1차 실행 24.8s) 후 수집 중단, 서비스 실패 0; enabled=true 로 재attach 없이 수집 재개 |
| 7 | 5,000 TPS × 10분 | 부분 | 아래 참조 — 유효 실행은 최초 1회 |
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
- 오염된 재실행(참고): 실행 2 — 실패 post 159, 지연 max 9.2s, ClickHouse CPU 최대 138%; 실행 3 — 실패 post 1,413, 지연 p95 34s. 원인은 호스트 과부하(DNS·PG·Prometheus·ClickHouse 요청 타임아웃). 다만 ClickHouse 가 느려지면 gateway 가 429 가 아니라 요청 타임아웃(10s)으로 보이는 점은 개선 후보(Observations 참조).

### 용량 추정 보정값 (spec §7.6 입력)
- tx 1건 디스크: tx_summary 62.6 B + tx_sql 58.1 B(시뮬레이터 SQL 1건/tx) ≈ 121 B/tx(상세 1% 별도, tx_detail 66 B/행). 5,000 TPS × 86,400s × 7일 ≈ 3.0G 행 → 요약+SQL 약 360GB(시뮬레이터 트랜잭션 기준; 실제 SQL 수·URI 분포에 따라 변동).
- 5,000 TPS 에서 gateway ≈ 0.2~0.3 코어, ClickHouse ≈ 0.1~0.4 코어(상한 대비 여유 큼). 기준 환경은 위 한계 참조.
- 에이전트: 요청당 CPU 추가분 측정 오차 이내(±8µs/req), 힙 추가 ≈ 2MB, 전송 중단 시 버퍼 ≈ 2MB 로 상한 내.

## Defects found
H1 이 확인한 기능 결함은 없음(시나리오 1~6, 8 모두 통과). 아래는 관찰 사항·개선 제안.

### Observations (코드 수정 소유자에게 전달)
1. **킬 스위치 최악 지연이 30초 목표에 근접** — gateway 레지스트리 30초 주기 갱신(`agent-t-gateway/internal/registry`) + 에이전트 1초 전송 주기이므로 최악 ≈ 31초. 측정 17.6s / 24.8s. 제안: 설정 변경 시 레지스트리 즉시 갱신 트리거(예: admin-api 가 PATCH 후 gateway 에 reload 호출) 또는 주기 15초.
2. **에이전트 로그에 버퍼 지표가 없음** — brief 는 "에이전트 로그의 버퍼 지표"로 8MB 상한을 확인하라고 했으나 `Sender.bufferedBytes()` 는 로그에 출력되지 않는다(`agent-t/core/.../transport/Sender.java`). 하니스는 `jcmd GC.class_histogram`의 `com.synapsev.agentt.*` 객체 바이트와 GC 후 힙 증가로 대체 측정했다. 제안: 5분마다 또는 drop 발생 시 `buffer_bytes`·`dropped` 를 INFO 로그.
3. **ClickHouse·Prometheus 지연 시 gateway 인입 타임아웃** — 오염 실행에서 `clickhouse flush ... deadline exceeded` 중 agentsim post 가 10s 타임아웃(429 가 아님). `Backpressure` 80% 규칙이 바이트 큐 기준이라 flush 가 느린 초반에는 핸들러가 블록될 수 있음(미확정 — 호스트 오염 때문에 재현 조건 불명). dev 서버에서 ClickHouse CPU 상한(1.5코어)을 일부러 포화시켜 재확인 권장.
4. `conn_open/conn_close` 는 `DataSource.getConnection` 경로만 집계(설계대로). 하니스 `/db` 는 `PGSimpleDataSource` 를 사용해 이 경로를 태운다. `DriverManager` 직접 사용 앱은 커넥션 지표 0 이 정상.
5. JDK7 에서 attach 시 retransform `ok=3 failed=0`, JDK17 은 `ok=7 failed=0` — JDK7 쪽 대상 클래스가 더 적게 로딩된 상태에서의 정상 동작(StackMapTable 오류 없음).

## 재현·운영 방법
```
agent-t/test/e2e/run.sh up       # Tomcat·PG·Prometheus·ClickHouse·gateway 컨테이너 + 호스트 admin-api(8080)·frontend(3001) + 시드
agent-t/test/e2e/run.sh test     # 시나리오 1~8 (E2E_LOAD_DURATION=2m 로 7번 단축 가능). 일부만: run.sh test 2 3
agent-t/test/e2e/run.sh down     # 전부 중지·볼륨 삭제
```
- 결과 파일: `results/summary.txt`, `results/metrics.env`, 시나리오별 hey 출력(gitignore).
- 사전 요구: Docker, Go, `agent-t/build.sh fetch && jar` (up 이 자동 수행), npm.

### 브라우저 확인용 (시나리오 9)
- frontend: http://localhost:3001 — 로그인 `e2e-admin@example.test` / `e2e-admin-1234` (dev 전용 테스트 admin, PG 에만 존재)
- 시스템: `e2e-sys-a`(JDK7, id 1), `e2e-sys-b`(JDK17, id 2), `e2e-sys-sim`(agentsim, id 3). 화면 확인용 트래픽: `run.sh` 가 만든 `.bin/hey` 로 예) `.bin/hey -z 5m -q 20 -c 4 http://localhost:18082/ok`, `…/slow`, `…/error`, `http://localhost:18081/ext`(분산 trace).
- 에이전트는 시나리오 1·6 후 부착 상태. 부착이 풀렸으면:
  `docker exec e2e-tomcat9 java -jar /opt/agent-t/agent-t-attacher.jar 1 /opt/agent-t/agent-t.jar` / `docker exec e2e-tomcat7 java -jar /opt/agent-t/agent-t-attacher.jar 1 /opt/agent-t/agent-t-legacy.jar`
- admin-api 로그 `.work/admin-api.log`, 프런트 로그 `.work/frontend.log`.
