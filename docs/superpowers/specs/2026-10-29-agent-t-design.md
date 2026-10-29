# Agent-T 설계 — 자체 트랜잭션 추적 에이전트 + 트랜잭션 저장소 (레거시 JDK + 표준 JDK)

- 작성일: 2026-10-29 (rev.2 2026-10-30 — 전량 요약 저장 · ClickHouse · OTel/Tempo 제거 · 신규 메뉴 반영)
- 상태: Draft (승인 대기)
- 관련 ADR: ADR-008 (OTel + Tempo) — 본 설계 승인 시 **ADR-022** 로 기록하고 ADR-008 은 "ADR-022 로 대체" 표시
- 대체 문서: `docs/jvm-metrics-collection-decision.md` (GC 로그 tailing 권고) → §6.10 으로 대체
- 표기: **[결정]** = 사용자 결정 사항, **[판단]** = 작성자(Claude) 판단 — 검토 시 우선 확인 요망

---

## 1. 배경과 의도

### 1.1 문제
- 현재 트랜잭션 추적은 OTel Java Agent 에 의존 — **JDK 8 미만에서는 동작 불가** (agent 자체가 class major 52 + Java 8 API 사용 → `UnsupportedClassVersionError`).
- 백화점 WAS 중 JDK 1.7 시스템이 존재 (예: `scdep-isic-wasdev` `sic_server1` = `/usr/local/jdk1.7.0_79` + JEUS 7). 이 시스템들은 Synapse-V 에서 trace 가 전혀 보이지 않음.
- 반면 동일 서버의 TmaxSoft SysMaster 는 JDK 1.7 에서 트랜잭션 추적·실시간 대시보드를 제공 중.
- 운영기 확인(2026-10-30): **OTel 에이전트 설치 시스템 0대** (`agent_instances` 에 `otel_javaagent` 없음, `synapse-otel-collector` unhealthy 상태로 방치). 즉 OTel/Tempo 스택은 현재 아무 데이터도 처리하지 않는다.

### 1.2 의도
- **Synapse-V 자체 Java 에이전트 "Agent-T"** 를 만들어 JDK 버전과 무관하게 **SysMaster·InterMAX 수준의 실시간 모니터링 + 트랜잭션 분석**을 Synapse-V 안에서 제공한다. **[결정]**
- 1.8 이상도 OTel 이 아닌 Agent-T 로 통일한다 — 화면·기능·데이터 모양을 JDK 구분 없이 동일하게 하기 위함. **[결정]**
- **InterMAX 방식의 계층 저장** **[결정]**: 모든 트랜잭션의 요약과 SQL 집계는 **전량** 저장하고, 무거운 호출 트리·스택만 선별 저장한다 (§4.2 근거).
- 사용하지 않는 OTel Collector · Tempo 는 **제거**하고 트랜잭션 데이터는 ClickHouse 한 곳에 모은다. **[결정]**
- 시스템이 늘어나지 않게 **통합** 원칙을 따른다 **[결정]**: 신규 서비스는 gateway 1개, 컨테이너 수는 순감(§5.3). JVM 에 붙는 것은 Agent-T 하나로 모으고(트랜잭션 + 힙·GC + 스레드 덤프), 지표·관리는 agent-v(Rust)와 같은 경로·체계를 탄다.
- 배포는 agent-v 처럼 admin-api 에서 SFTP 로 바로 배포하고, **WAS 재기동 없이 즉시 적용**되는 경로를 제공한다. **[결정]**

### 1.3 성공 기준
1. `sic_server1`(JDK 1.7 / JEUS 7)에 admin-api 화면에서 설치 → **재기동 없이** 수 분 내 실시간 모니터링 화면에 큐(이퀄라이저)·TPS·산점도가 표시된다.
2. 7일 이내 **아무 트랜잭션이나**(0.004초짜리 포함) 시간·URL·IP·사용자·응답시간으로 검색되고, 요약·SQL 목록을 볼 수 있다.
3. 느린 트랜잭션(시스템 기준 이상)은 호출 트리(서블릿 → JDBC → 외부 호출)와 **미계측 구간의 원인 스택**까지 확인할 수 있다.
4. JDK 1.7 시스템 → JDK 8+ 시스템 HTTP 호출이 같은 trace_id 로 연결되어 경로 화면에 함께 보인다.
5. sysmaster 와 동일 JVM 에 함께 붙어도 WAS 기동·서비스에 영향이 없다.
6. 피크 5,000 TPS 에서 Server A 기존 서비스(admin-api·PG·Prometheus·log-analyzer)의 응답이 퇴행하지 않는다.

---

## 2. 목표 / 비목표 / 안티목표

### 목표
- JDK **1.6 ~ 1.7** (레거시 빌드), JDK **8 ~ 21** (표준 빌드) 지원
- 트랜잭션 추적: HTTP 진입 / JDBC / 커넥션 풀 / 외부 HTTP 호출 / 예외
- **전 트랜잭션 요약 + SQL 집계 저장**, 기본 7일 · 시스템별 설정
- 실행 중 트랜잭션(액티브) 1초 갱신 + 장시간 트랜잭션 스택 샘플링
- 커넥션 리소스 추적: 트랜잭션별 open/close/미반환/미커밋
- JVM 힙·GC·스레드·CPU 지표 (기존 JVM 메트릭 수집 계획 대체), 요청 시 스레드 덤프
- 신규 '트랜잭션' 메뉴: 사용자 구성형 실시간 모니터링 + 트랜잭션 분석 + 건별 상세
- SFTP 배포 + Dynamic Attach 즉시 적용 + 기동 스크립트 영구 적용
- W3C `traceparent` 전파 (시스템 간 연결)

### 비목표 (이번 설계 범위 밖)
- JDK 1.4 이하 (JVMPI) 및 JDK 1.5 — **[판단]** Attach API 미지원, 대상 시스템 미확인. 필요 시 별도 검토 (§12)
- 힙·컬렉션 누수 탐지 (SysMaster LeakHunter 대응)
- 메서드 단위 전체 프로파일링, JVMTI 네이티브 에이전트 (락 경합 등)
- 에이전트 무중단 버전 업그레이드 (업그레이드는 WAS 재기동 시 반영)
- SysMaster DB/데이터 연동 (브리지 방식 검토 제외) **[결정]**
- SQL 바인드 값 수집 (§6.5 — 필요 시 후속으로 관리자 전용 옵션 검토)
- 힙 덤프·프로세스 종료·재기동 자동화 (LLM 진단 요구사항 범위, §6.11)

### 안티목표 (기술적으로 동작해도 실패로 간주)
- **에이전트 때문에 WAS 가 기동 실패하거나 서비스 장애가 나는 것** — 계측 오류·수신 서버 장애는 반드시 "계측 포기 / 데이터 버림 + 원본 유지"로 끝나야 한다.
- 트랜잭션 수집 부하 때문에 Server A 의 기존 서비스(알림·화면·분석)가 느려지는 것.
- JDK 표준 클래스 바꿔치기 (`-Xbootclasspath/p` 로 `java.util.HashMap` 등 패치 — SysMaster `_rt` 방식) — JDK 업데이트마다 깨짐.
- SysMaster·InterMAX 디컴파일 코드 복제 — **클린룸 원칙**: 분석 결과는 구조·아이디어 참고용으로만 사용, 코드·클래스명·프로토콜 차용 금지.
- 기능 추가할 때마다 컨테이너·에이전트·수집 경로가 하나씩 늘어나는 구조.

---

## 3. 제약

| 구분 | 제약 |
|---|---|
| 네트워크 | 폐쇄망. 에이전트 의존성은 jar 내 shading, 외부 다운로드 없음 |
| 전송 | JDK 1.7 TLS 기본 설정 문제 → **내부망 평문 HTTP** 기본 (TLS 는 1.8+ 선택 옵션) |
| 계정 | 설치·attach 는 **WAS 기동 계정**으로 (root 금지) |
| SSH | 일부 서버는 SSH `exec` 채널 거부 — 10.253.21.78 은 `appsic`(`exec request failed on channel 0`)·`jeussic`(출력 없이 종료) 모두 exec 불가, 대화형 셸만 가능 (2026-10-29 확인) → 기존 `ssh_exec`(paramiko exec) 만으로는 설치 불가 |
| 계정 확인 | 개발기 `sic_server1` 은 `jeussic` 계정으로 기동, `jeussic` SSH 직접 접속 가능 **[결정]** |
| 처리량 | 전체 피크 **4,000~5,000 TPS** 수용 **[결정]** (§7.6) |
| Server A 자원 (2026-10-30 실측) | 4코어 / 15GB (가용 7GB), 평시 load ≈ 1.6. Docker root `/app/docker`, **`/app` 100GB 중 여유 18GB(83%)**, `/` 여유 57GB |
| Server B 자원 (2026-10-30 실측) | **2코어** / 15GB (가용 10GB), `/` 여유 31GB, `/app/mtr` 여유 36GB — Qdrant 전용 유지 |
| 운영 PG (2026-10-30 실측) | PostgreSQL 16, DB 전체 1.1GB(`log_analysis_history` 958MB), `shared_buffers` 128MB, `max_connections` 100 → 트랜잭션 데이터(7일 수백 GB) 수용 불가 |
| admin-api | `UVICORN_MAX_REQUESTS=500` 로 워커 주기 재시작 → 실시간 인메모리 상태 보관·고빈도 수신 부적합 (§7.2) |
| 타임존 | 수집·전송·저장 UTC, 표출 KST (ADR-013) |
| 스키마 | PG 변경은 `models.py` + `configs/postgres/init.sql` + `configs/postgres/migrations/` 3중 동기화. ClickHouse DDL 은 별도 경로(§7.3) |
| 성능 예산 | **[판단]** WAS CPU 오버헤드 ≤ 3%, 응답시간 p95 증가 ≤ 5ms, 힙 추가 사용 ≤ 64MB |

---

## 4. 참고 분석 요약

### 4.1 SysMaster (2026-10-29)
> 근거: `sminst14/15/16/17_rt.jar`, `libdcagent64.so` 정적 분석, SysMaster 웹 콘솔, Oracle `SYSMASTER`/`SYSMASTER2` 스키마.

| 항목 | SysMaster 방식 | Agent-T 반영 |
|---|---|---|
| JDK 호환 | Java 5 바이트코드로 컴파일, JDK별 jar 분리(1.4 / 1.5~1.6 / 1.7_rt) | 공통 코어 + 빌드 2종 (§5.2). JDK별 jar 분리 원인(1.4 지원, `_rt` 패치)은 제거 |
| BCI | `java.lang.instrument` + ASM shading | 동일 원리, 자체 구현 |
| 계측 대상 | 제품별 하드코딩 (JEUS servlet/jdbc pool, WebT, ProFrame, AnyLink, Tibero/Oracle 드라이버, 표준 servlet·jdbc) | 단계별 계측 모듈 (§6.3) |
| 트랜잭션 ID | 자체 GID(ThreadLocal + byte[]) + 제품 헤더에 실어 전파 | W3C `traceparent` |
| 네이티브 | JVMTI: 스레드 CPU·락 경합·힙 | 범위 밖 (CPU 는 `ThreadMXBean` 으로 대체) |
| 저장 정책 | 전체 트리는 `TX_THLD=3000ms` 이상만 저장 + 샘플링, 7일 보존 | 동일 기준(3초, 7일) + 요약은 전량 (§7.1) |
| 문자열 | `SMB_META_STRING_ID` 문자열 사전 | SQL·URI 사전 (§6.5) |
| 트리 저장 | `SMWS_TX_INVOCATION_S` (`SEQ_NUM`/`PARENT_SEQ_NUM`) | 건당 압축 트리 1행 (§7.3) |
| 요약 지표 | 헤더에 CPU·SQL·fetch·예외, `EXT_PARAM_0~19` | 요약 행 컬럼 (§6.5) |
| 리소스 | 트랜잭션별 open/close/uncommit | 동일 (§6.4) |
| 통계 | 서비스별 S/I/H/D/M/Y 롤업, SLA 등급 건수 | Prometheus 지표 + 기존 집계 스케줄러 (§7.5) |
| 관찰된 한계 | `doSearchBuyAmt.do` 28.4s 중 SQL 8ms·CPU 10ms, 나머지 99% 가 "WorkTime"(미계측) | **스택 샘플링으로 미계측 구간 원인 표시** (§6.6) — 차별점 |
| 관찰된 한계 | 다중 hop GMID 0건 — 시스템 간 연결 사실상 미동작 | W3C 전파 + 전량 요약으로 시스템 간 경로 항상 연결 — 차별점 |

### 4.2 InterMAX 5.3 (2026-10-30, 성능테스트 환경 약 12.6 TPS)
- 수행시간 하한 0 으로 조회 시 20분간 **15,137건 전부** 조회됨(0.004초 건 포함) → 트랜잭션 요약은 전량 저장.
- 0.426초 건도 경로(WAS→DB 0.005s/3회)·SQL 목록(SQL별 실행·fetch 통계) 보유, **콜 트리는 "조회된 데이터가 없습니다"** → 호출 상세는 선별 저장.
- 시사점 **[판단]**: 많은 트랜잭션에도 느려지지 않는 이유는 "작은 요약은 전부, 큰 상세는 일부" 계층 저장 + 에이전트 측 판정(서버에서 전량을 들고 판정하지 않음) + 조건 검색에 강한 저장소. 이 설계의 §6.5·§7.1·§7.3 이 같은 구조를 따른다.
- 큐(액티브 트랜잭션 이퀄라이저)·산점도·진행 중 목록·실시간 차트를 한 화면에 사용자 구성형으로 배치 → §9.2 대응.

---

## 5. 전체 구조

### 5.1 구성도

```
 [대상 WAS JVM]                               [Server A]
 ┌──────────────────────────┐   HTTP 1초    ┌───────────────────────────────┐   SSE    ┌──────────────────┐
 │ Agent-T                  │ ────────────▶ │ agent-t-gateway (Go, 신규)      │ ───────▶ │ frontend          │
 │  ├ 계측(BCI)              │ 액티브·요약·   │  ① JVM별 최신 상태(메모리)       │          │ 실시간 모니터링    │
 │  ├ Active Registry        │ SQL·상세·JVM  │  ② 완료 점 즉시 push            │          │ (큐·산점도·차트)   │
 │  ├ 스택 샘플러             │ ◀──────────── │  ③ 5초 집계                     │          └────────┬─────────┘
 │  ├ JVM 지표(MXBean)       │ 설정·명령 응답  │  ④ 1초 묶음 적재 ─────┐          │                   │ 조회
 │  └ 전송기(상한 버퍼)        │               │  ⑤ remote write ──┐  │          │          ┌────────▼─────────┐
 └──────────────────────────┘               └─────────┬─────────┼──┼──────────┘          │ admin-api        │
                                     설정 원본 조회(PG) │         │  ▼                     │ 검색·상세·화면저장 │
                                                      │         │ ┌────────────┐  조회    │ 설치·attach·설정  │
                                                      │         │ │ ClickHouse │ ◀────────┤                  │
                                                      │         │ │ (7일, 신규) │          └──────────────────┘
                                                      ▼         ▼ └────────────┘           log-analyzer 도 조회
                                               PostgreSQL   Prometheus ─▶ 기존 알림·집계·챗봇
```

- **실시간**(큐·진행 중 목록·완료 점·5초 집계): Agent-T → gateway 메모리 → SSE. DB 를 거치지 않는다.
- **보관**(요약·SQL 집계·선별 상세·스레드 덤프): gateway 가 1초 묶음으로 ClickHouse 적재. 검색·상세·산점도 과거 구간은 admin-api 가 ClickHouse 조회.
- **장기 지표**(TPS·응답시간·에러·힙·GC 등): gateway 가 agent-v 와 같은 Prometheus remote write + 같은 레이블 규약으로 기록 → 기존 알림 규칙·집계 스케줄러·LLM 분석·챗봇이 그대로 사용.
- **설정**: 원본은 PostgreSQL(시스템 기준정보·`agent_instances`), gateway 가 주기 조회·캐시해 에이전트 응답에 실어 보낸다.

### 5.2 에이전트 빌드 구성 **[판단]**

| 모듈 | 내용 | 컴파일 타깃 |
|---|---|---|
| `agent-core` | TxContext, 요약·SQL 집계·상세 모델, Active Registry, JVM 지표, 사전, 직렬화, HTTP 전송, 설정, 안전장치 | Java 6 (`-source 1.6 -target 1.6`, JDK 6 API 만 사용 — animal-sniffer 류 검사) |
| `agent-instrument` | 계측 어드바이스(진입/종료 훅), 대상 클래스 매칭 규칙 | Java 6 |
| `agent-legacy` | ASM(구버전 JVM 호환 버전) shading + 1.6/1.7 StackMapTable 처리 + `premain`/`agentmain` | Java 6 → **`agent-t-legacy.jar`** (JDK 1.6~1.7) |
| `agent-modern` | ASM(최신, Java 21 클래스 파싱 가능) shading + Java 9+ 모듈 처리(`Instrumentation.redefineModule`) | Java 8 → **`agent-t.jar`** (JDK 8~21) |
| `agent-attacher` | 대상 JVM 에 attach 하는 독립 실행 jar (§8.3) | Java 6 → `agent-t-attacher.jar` |

- 소스는 `agent-core`/`agent-instrument` 단일 코드베이스. 빌드만 2종. 설치 시 JDK 버전으로 **자동 선택** **[결정]**.
- ASM 의 구체 버전은 빌드 PoC 에서 "해당 JVM 에서 로딩 가능 + 대상 class major 파싱 가능" 두 조건으로 확정 (빌더 결정).
- 명칭 **[결정]**: 제품명 Agent-T, `agent_type` 값 `agent_t`, 수집 서버 `agent-t-gateway`.
- 리포 위치 **[판단]**: 에이전트 `agent-t/` (기존 `agent/`(Rust), `synapse-cli/`(Go)와 동급 최상위), gateway `agent-t-gateway/` (Go, 최상위). 빌드 도구는 빌더 선택. 산출 jar 는 `main-server/artifacts/agent-t/` 에 배치 (repo 미포함 + SHA256SUMS).

### 5.3 구성 요소 증감 (통합 원칙) **[결정]**

| Server A 컨테이너 | 변경 | 사유 |
|---|---|---|
| `otel-collector` | **제거** | OTel 시스템 0대, 현재 unhealthy |
| `tempo` | **제거** | 트레이스는 ClickHouse 로 |
| `n8n` | **제거** | 미사용. WF4/WF5 JSON 은 `main-server/n8n-workflows/` 에 보존, 향후 log-analyzer 스케줄러로 이관 |
| `clickhouse` | 추가 | 트랜잭션 7일 저장 |
| `agent-t-gateway` | 추가 | 수집·적재·실시간 |
| 나머지(prometheus, alertmanager, grafana, postgres, admin-api, log-analyzer, frontend) | 유지 | |

→ 11개 → 10개 (`sr_streamlit`/`sr_api` 는 타 프로젝트로 범위 밖).

| JVM 측 | 이전 계획 | 이후 |
|---|---|---|
| 트랜잭션 | OTel Java Agent (8+ 만) | Agent-T |
| 힙·GC | `jvm-metrics-collection-decision.md` GC 로그 tailing (agent-v 확장) | Agent-T MXBean (§6.10) |
| 스레드 덤프 | LLM 진단 요구사항의 SSH `kill -3` | Agent-T 요청 명령 (§6.11) |

검토 후 **합치지 않은 것** **[판단]**:
| 후보 | 기각 사유 |
|---|---|
| gateway 를 admin-api 에 통합 | 워커 주기 재시작으로 메모리 상태 유실, 5,000 TPS 수신이 API 워커 점유 |
| Agent-T → ClickHouse 직접 적재 | WAS 마다 DB 계정 배포, 큐(실시간 상태)·설정 전달 주체 부재 |
| agent-v(Rust) 가 Agent-T 데이터 중계 | JDK 1.7 서버에 agent-v 설치 보장 없음, 장애 지점 증가 |
| 알림 WebSocket(`/ws/dashboard`)과 APM SSE 통합 | 송신 서비스가 다름 — 프론트 프록시 경로 접두어만 정리 |

---

## 6. 에이전트 상세

### 6.1 기동 방식 (두 진입점, 같은 코드)
- `premain` — `-javaagent:` 로 기동 시 로딩 (영구 적용)
- `agentmain` — Dynamic Attach 로 실행 중 로딩 (즉시 적용)
- 두 경로 모두 **retransform 안전 계측만** 사용 (§6.2). 즉 attach 로 붙든 기동 옵션으로 붙든 결과 동일.
- 동일 JVM 중복 로딩 방지: 시스템 프로퍼티 마커(`agent_t.loaded`)로 두 번째 로딩은 no-op.

### 6.2 계측 원칙 (안전장치 포함)
1. **메서드 본문만 변경** — 클래스에 필드·메서드 추가 금지 (retransform 제약 + 다른 에이전트 공존). 트랜잭션 상태는 에이전트 쪽 `ThreadLocal` / 약한 참조 맵에 보관.
2. 주입 코드는 `try { 훅 } catch (Throwable) { 무시 }` 로 감싸 **애플리케이션 흐름에 예외를 절대 전파하지 않음**.
3. 변환 실패(검증 오류 등) 시 해당 클래스는 원본 바이트 반환 + 실패 카운터 증가 + 로그.
4. **킬 스위치**: 원격 설정 `enabled=false` 수신 시 transformer 제거 + retransform 으로 원본 복원. 로컬 파일(`{install_dir}/DISABLE`) 존재 시 기동 시점에도 계측 비활성.
5. 제외 목록: 패키지/클래스 패턴 단위 계측 제외 (원격 설정).
6. 에이전트 자체 클래스·ASM 은 shading(`com.synapsev.agentt.shaded.*`) — 애플리케이션·타 에이전트와 클래스 충돌 방지.
7. 부트 클래스로더 주입이 필요한 브리지 클래스(JDBC/servlet 훅 호출부)는 `Instrumentation.appendToBootstrapClassLoaderSearch` 사용 (Java 6+). `-Xbootclasspath/p` 사용 금지.
8. 오버헤드 가드: 트랜잭션당 노드 상한(기본 2,000), 전송 버퍼 상한(§6.8), 초과 시 drop + 카운터.

### 6.3 계측 대상 (단계별)

| 단계 | 대상 | 비고 |
|---|---|---|
| P1 | `javax.servlet.http.HttpServlet.service`, `javax.servlet.Filter.doFilter` (최외곽만 루트) | JEUS·Tomcat 공통. `jakarta.servlet` 은 modern 빌드에서 추가 |
| P1 | `java.sql.Connection`/`Statement`/`PreparedStatement`/`ResultSet` (execute*, next→fetch 집계) | 드라이버 무관 인터페이스 구현체 계측 |
| P1 | `javax.sql.DataSource.getConnection` + `Connection.close` / `commit` / `rollback` | 풀 대기·미반환·미커밋 (§6.4) |
| P1 | `java.net.HttpURLConnection` (외부 호출 노드 + `traceparent` 주입) | |
| P1 | 진입 시 `traceparent` 헤더 추출 → 부모 trace 연결 | 시스템 간 경로 |
| P3 | Apache HttpClient 3.x/4.x | 사내 사용 빈도 확인 후 |
| P3 | JEUS 내부(커넥션 풀 `jeus.jdbc.*`, WebtoB 연계 요청) | JEUS 7 버전 확인 필요 |
| P3 | WebT, ProFrame, AnyLink (Tmax 미들웨어 호출) | 제품 버전별 테스트 환경 필요 |
| P3 | 업무키 추출 규칙 (HTTP 파라미터/헤더 → 요약 컬럼) | 설정형, 런타임 컴파일 미사용 |

### 6.4 커넥션 리소스 추적
- 트랜잭션 컨텍스트에 `getConnection` 횟수, `close` 횟수, 트랜잭션 종료 시점 미반환 수, autocommit=false 상태에서 commit/rollback 없이 반환된 수(미커밋)를 누적.
- 요약 행 컬럼으로 기록. 미반환·미커밋 > 0 이면 상세 보존 대상(§7.1) + 알림 후보(P4).

### 6.5 데이터 모델 — 3계층 + 사전 **[결정: 계층 저장] / [판단: 필드]**
OTLP 는 더 이상 사용하지 않는다(수신처가 gateway 로 바뀜). 직렬화 형식은 빌더 결정(압축 JSON 또는 경량 바이너리 — 1.6 에서 의존성 없이 구현 가능할 것).

| 계층 | 보내는 시점 | 내용 | 저장 |
|---|---|---|---|
| **요약** (전량) | 트랜잭션 종료 → 다음 1초 배치 | tx_id(trace_id), parent(traceparent 상위), 시작 시각, 응답시간, 상태(HTTP code), 에러 여부·예외 클래스, CPU, SQL 시간·건수, fetch 건수·시간, 외부 호출 시간·건수, 커넥션 open/close/미반환/미커밋, uri_id, 사용자 IP, 사용자 ID(추출 규칙 설정 시), 업무키, has_detail | `tx_summary` |
| **SQL 집계** (전량) | 요약과 함께 | 트랜잭션 × sql_id 단위: 실행 횟수, 시간 합·최대, fetch 건수·시간, 에러 수 | `tx_sql` |
| **상세** (선별, §7.1) | 요약과 함께 | 호출 트리(노드: 종류·이름·시작 오프셋·소요·sql_id/대상), 스택 샘플 빈도표(§6.6) | `tx_detail` |
| **사전** | 해당 JVM 에서 처음 본 문자열일 때 1회 (gateway 가 모르면 재요청) | sql_id ↔ 정규화 SQL 문장, uri_id ↔ 정규화 URI | `dict_sql`, `dict_uri` |

- sql_id·uri_id 는 정규화 문자열의 해시(64bit) — JVM·재기동과 무관하게 같은 문장은 같은 ID.
- URI 정규화: 쿼리스트링 제거 + 숫자·UUID 경로 변수 치환 (규칙은 빌더 결정, 시스템별 추가 규칙 원격 설정).
- **SQL 바인드 값은 수집하지 않는다** **[결정]** — SQL 문장(`?` 자리표시)만 보낸다. 리터럴이 박힌 SQL 은 정규화 시 숫자·문자열 리터럴을 `?` 로 치환해 개인정보가 사전에 들어가지 않게 한다 **[판단]**.
- 사용자 IP·ID 는 원문 저장, 화면에서 마스킹 표시 (§9.5) **[결정]**.

### 6.6 액티브 트랜잭션 · 스택 샘플링
- Active Registry: 진입 시 등록 / 종료 시 제거. 항목 = 스레드, tx_id, uri_id, 시작 시각, 현재 단계(SQL 실행 중·외부 호출 중 등), 현재 sql_id.
- **1초마다** 배치에 포함 **[결정]**: 경과 구간별 건수(큐용, §9.2) + 경과시간 상위 N(기본 50) 목록.
- **장시간 트랜잭션 스택 샘플링**: 경과 ≥ 시스템 느린 기준(기본 3000ms) 인 트랜잭션은 주기(기본 1s)마다 `Thread.getStackTrace()` 수집. 최신 샘플은 액티브 목록에 실어 "현재 스택"으로 표시, 종료 시 프레임별 빈도로 압축해 상세에 첨부 → 화면 "미계측 구간 상위 스택".
- 스택 수집은 별도 데몬 스레드 1개, 동시 대상 상한(기본 20) — 오버헤드 가드.

### 6.7 전송 주기
| 데이터 | 주기 | 크기(JVM 당) |
|---|---|---|
| 액티브 스냅샷 | 1초 **[결정]** | 수 KB (구간별 건수 + 상위 50) |
| 완료 요약·SQL 집계·상세·사전 | 1초 배치 **[결정]** | 해당 JVM TPS 에 비례 |
| JVM 지표 | 5초 **[판단]** | 1KB 미만 |
- 차트용 집계(TPS·응답시간 등)는 **gateway 가 5초 단위로 계산**한다 — 에이전트는 원본 요약만 보내고 집계 로직은 서버 한 곳에 둔다 **[판단]**.

### 6.8 과부하 시 버리는 순서
- 전송 스레드 1개, 배치 전송 실패 시 재시도 1회 후 폐기. gateway 가 `429`(과부하)를 주면 다음 배치부터 지정 시간 동안 감속.
- 전송 버퍼 상한(기본 8MB) 초과 또는 감속 중일 때 **상세 → SQL 집계 → 요약** 순으로 버린다(액티브 스냅샷은 최신 1개만 유지). 버린 건수는 카운터로 보고 → 화면에 "수집 누락" 표시.
- 장애 시 느린 트랜잭션 폭증 대비: JVM 당 상세 전송 상한(기본 초당 50건), 초과분은 요약·SQL 만 전송(`has_detail=false`) + 카운터.
- 어떤 경우에도 WAS 스레드는 전송을 기다리지 않는다(비동기 큐, 가득 차면 즉시 버림).

### 6.9 원격 설정 · 명령
- 배치 응답 본문으로 설정 버전·변경분과 **대기 중 명령**(스레드 덤프 요청 등)을 수신 (별도 폴링 없음).
- 설정 항목: `enabled`, 제외 패턴, 느린 기준(`tx_slow_threshold_ms`), 정상 상세 샘플률, 스택 샘플 주기, URI 정규화 추가 규칙, 업무키 추출 규칙, 로그 레벨.
- 설정 원본은 PostgreSQL(`systems`, `agent_instances.label_info`) → gateway 가 30초 주기 조회·캐시 **[판단]**.

### 6.10 JVM 지표 (기존 JVM 메트릭 수집 계획 대체) **[결정]**
- 수집: `MemoryMXBean`·`MemoryPoolMXBean`(heap/non-heap, 풀별 사용·최대), `GarbageCollectorMXBean`(횟수·누적 시간), `ThreadMXBean`(스레드 수·데드락 감지), `OperatingSystemMXBean`(프로세스 CPU — 1.6 은 `com.sun.management` 확장 존재 시), 클래스 로딩 수. 모두 JDK 1.6+ 표준.
- JVM 안에서 읽으므로 `jvm-metrics-collection-decision.md` 가 GC 로그 tailing 을 고른 사유(hsperfdata/jstat 의 OS 계정 비대칭)와 착수 전 블로커 중 "synapse-agent 실행 OS 계정 확인"이 해소된다. JVM 기동 옵션(`-Xloggc` 등) 추가도 불필요.
- 판정 규칙은 그 문서의 HotSpot `UseGCOverheadLimit` 기준(GC 시간 98% / 회수 2%)을 그대로 재사용 → Prometheus 알림 규칙으로 구현.
- 해당 문서에는 "ADR-022 / 본 설계 §6.10 으로 대체" 표시를 추가한다 (구현 시).

### 6.11 스레드 덤프 (요청형) **[결정]**
- 명령 `thread_dump` 수신 시 `ThreadMXBean.dumpAllThreads(true, true)`(JDK 1.6+) 결과를 텍스트로 만들어 다음 배치로 전송 → ClickHouse `jvm_thread_dump` (보관은 시스템 보관일).
- JVM 당 1분 1회 상한, 덤프 크기 상한(기본 2MB, 초과 시 잘라냄 + 표시).
- 요청 경로: 화면(진행 중 목록의 [스레드 덤프] 버튼) → admin-api → PG 명령 큐 → gateway 가 다음 응답에 실음.
- LLM 진단 요구사항의 "JEUS 힙 고갈 행 복구" 1단계(`kill -3`)는 이 명령으로 대체 예정 — 연결 작업은 그 요구사항 구현 시 수행. 힙 덤프·종료·재기동은 기존 SSH 진단 경로 유지.

### 6.12 타 에이전트 공존
- JVM 은 `-javaagent` 다중 지정을 허용. Agent-T 는 §6.2-1 원칙(본문만 변경)으로 타 에이전트(sysmaster, jmx_prometheus_javaagent)와 같은 클래스를 함께 계측해도 동작해야 한다.
- 같은 JVM 에 OTel javaagent 가 있으면 설치 단계에서 경고 + 진행 여부 확인 **[판단]**.
- sysmaster 동시 적용 테스트는 필수 검증 항목 (§10).

---

## 7. 서버 측 설계

### 7.1 보존 정책 **[결정]**
| 대상 | 기준 | 보관 |
|---|---|---|
| 요약·SQL 집계 | **전량** | 시스템별 `tx_retention_days`, 기본 **7일**, 범위 1~30 |
| 상세(호출 트리·스택) | `응답시간 ≥ 시스템 느린 기준(기본 3000ms)` 또는 에러 또는 미반환/미커밋 커넥션 + 정상 건 `normal_detail_sample_rate`(기본 1%) | 같은 보관일 |
| 스레드 덤프 | 요청 시 | 같은 보관일 |
| 사전(SQL·URI) | 마지막 사용 후 30일 **[판단]** | |

- 판정은 **에이전트가 트랜잭션 종료 시점에** 한다 — 서버는 전량을 들고 기다리지 않는다.
- 시스템 간 trace: 상세는 JVM 별로 독립 판정하므로 하위 시스템 상세가 없을 수 있다. 그러나 **요약은 전량이므로 경로(어느 시스템을 몇 ms 거쳤는지)는 항상 연결**된다.
- 보관일 변경은 **새로 들어오는 데이터부터** 적용된다(적재 시점에 만료일을 계산하기 때문) — 화면에 안내 **[판단]**.

### 7.2 `agent-t-gateway` (신규, Go) **[결정]**
- 역할: Agent-T 배치 수신, JVM별 최신 상태 메모리 보관(최근 10분 링버퍼), 5초 집계, SSE 송신, ClickHouse 묶음 적재, Prometheus remote write, 설정·명령 전달.
- Go 선택 사유: 5,000 TPS 배치 해석이 가장 무거운 작업 — Python 대비 CPU 3~5배 절감 추정. 리포에 Go 프로젝트(`synapse-cli`) 선례 있음. 단일 바이너리 컨테이너.
- admin-api 에 두지 않는 이유: §3 admin-api 제약.
- 상태 유실 허용: 재기동 시 실시간 화면은 수 초 후 자동 복구, 보관 데이터는 ClickHouse 담당. 적재 대기 중 데이터는 정상 종료 시 flush, 비정상 종료 시 최대 1초분 유실 허용 **[판단]**.
- 엔드포인트 (경로는 빌더가 조정 가능):
  - `POST /t/v1/batch` — Agent-T 배치 (인증: 설치 시 발급 에이전트 토큰). 응답 = 설정 변경분 + 명령
  - `GET /t/v1/stream?system_id=&instance=` — SSE (프론트, JWT — admin-api 와 같은 SECRET_KEY 로 검증)
  - `GET /t/v1/snapshot?system_id=` — 최초 진입·SSE 폴백용 현재 상태
  - `GET /healthz`, `GET /metrics`(gateway 자체 지표: 수신·적재·버림 카운터)
- ClickHouse 적재: 1초 또는 1만 행마다 테이블별 한 번에 INSERT. ClickHouse 장애 시 메모리 대기열 상한(기본 256MB)까지 보관 후 오래된 것부터 버림 + 카운터.
- 노출 포트는 WAS 대역에서 접근 가능해야 함 — 방화벽 요청 포함 (포트 번호 빌더 결정).
- 수평 분할은 비목표. JVM 수 100 초과 또는 CPU 상한 지속 도달 시 §7.6 이전 계획으로 대응.

### 7.3 ClickHouse 저장소 (신규) **[결정]**
- 배치: Server A 컨테이너, 데이터는 `/app` 하위. **선행 조건: Server A `/app` 약 +400GB 증설** (현재 여유 18GB) **[결정]**.
- 테이블 (핵심 컬럼만, 상세 스키마는 빌더 결정):

| 테이블 | 엔진·키 **[판단]** | 비고 |
|---|---|---|
| `tx_summary` | MergeTree, `PARTITION BY toYYYYMMDD(start_ts)`, `ORDER BY (system_id, start_ts, tx_id)`, `TTL expire_at DELETE` | §6.5 요약 컬럼 + system_id, instance_role, expire_at. tx_id 로 찾는 보조 인덱스(bloom filter) |
| `tx_sql` | MergeTree, `ORDER BY (system_id, start_ts, tx_id, sql_id)`, TTL 동일 | |
| `tx_detail` | MergeTree, `ORDER BY (system_id, tx_id)`, TTL 동일 | 트리·스택은 압축 컬럼(`CODEC(ZSTD)`) 통째 저장 — 건 ID 로만 열기 때문 |
| `jvm_thread_dump` | MergeTree, TTL 동일 | |
| `dict_sql`, `dict_uri` | ReplacingMergeTree, TTL `last_seen + 30일` | |

- **시스템별 보관일**: gateway 가 적재 시 `expire_at = start_ts + 해당 시스템 tx_retention_days` 를 계산해 넣는다 → ClickHouse TTL 이 행 단위로 삭제.
- DDL 관리: `main-server/configs/clickhouse/init/*.sql` (컨테이너 최초 기동 시 실행) + 변경은 `main-server/configs/clickhouse/migrations/` 날짜 prefix 파일 **[판단]** — PG 3중 동기화 규칙과 별개.
- 자원 상한 **[결정: 안전장치]**: 컨테이너 CPU 1.5코어·메모리 3GB, 쿼리 `max_threads=2`·쿼리당 메모리 1.5GB, 동시 쿼리 상한 — 무거운 검색이 적재·기존 서비스를 막지 않게.
- 조회 주체: admin-api(검색·상세·산점도 과거 구간·요약 카드)와 log-analyzer(LLM 분석 근거) — ClickHouse HTTP 인터페이스를 `httpx` 비동기로 호출 **[판단]** (async 일관성 규칙 준수, 동기 드라이버 금지).
- 용량 추정 **[판단]** (압축 후): 평균 1,500 TPS 가정 시 하루 약 16GB(요약 5 + SQL 8 + 상세 3) → 7일 약 110GB, 피크 5,000 TPS 종일 지속 시 7일 약 370GB. 실측으로 P2 에서 보정.

### 7.4 실시간 방식: SSE **[판단]**
| 방식 | 판단 |
|---|---|
| **SSE** | **채택**. 서버→브라우저 단방향이면 충분, HTTP 그대로(프록시·방화벽 친화), 브라우저 자동 재연결, 챗봇 스트리밍에서 이미 사용 |
| WebSocket | `/ws/dashboard`(알림 브로드캐스트)는 admin-api 에 그대로 유지. APM 은 양방향 불필요 |
| 1~3초 polling | SSE 실패 환경(프록시 버퍼링 등)의 폴백으로 `snapshot` 재사용 |
- 송신 주기: 액티브 스냅샷·완료 점은 수신 즉시(≈1초), 5초 집계는 5초.
- 한 화면 = SSE 연결 1개 (위젯이 여러 개여도 화면 단위로 묶어 구독) **[판단]**.
- 프론트에서 gateway 로 가는 경로는 기존 프론트 프록시에 경로 접두어(`/t/`)로 추가 — 브라우저가 별도 포트를 알 필요 없음 **[판단]**.

### 7.5 장기 지표·분석 연계 (기존 경로 재사용) **[결정]**
- gateway 가 5초 집계를 **Prometheus remote write** 로 기록 — agent-v(Rust)와 같은 방식, 같은 base 레이블(`system_name`, `display_name`, `instance_role`, `host`). Prometheus scrape 설정 추가 없음.
- 지표명 접두어 `agent_t_*` (TPS, 응답시간 구간 카운터, 에러, 액티브 구간별 수, 힙·GC·스레드·CPU, 수집 누락 카운터).
- 결과적으로 `alert_rules.yml`·`metric_exclusions`·log-analyzer 집계 스케줄러·`prometheus_analyzer`·챗봇 `prometheus_query` 에 metric_group 추가만으로 편입 — 상세 매핑은 빌더 결정.
- URI 단위 지표: 인스턴스당 상위 200개만 개별 레이블, 나머지 `_other` — 카디널리티 상한. 서비스별 상세는 ClickHouse 조회로.
- SLA 등급: 응답시간 구간 카운터로 good/normal/bad/critical 비율 산출 (SysMaster `SLA_*_CNT` 대응, P4).

### 7.6 처리량·부하 설계 (피크 4,000~5,000 TPS)

**네트워크·저장 흐름**
| 경로 | 양 (5,000 TPS 기준) | 비고 |
|---|---|---|
| Agent-T → gateway | 요약 5천 + SQL 집계 약 1.5만 + 상세 수십 건/s, 압축 후 수 MB/s | JVM 당 초당 1요청 — WAS 50대여도 50 req/s |
| gateway → ClickHouse | 테이블별 초당 1회 INSERT | 묶음 적재 |
| gateway → 브라우저 | 화면당 초당 수 KB~수십 KB | 산점도 점은 JVM 당 초당 최대 200점, 느린 것·에러 점은 전부 포함·정상 점만 균등 샘플 **[판단]** |
| gateway → Prometheus | 5초마다, JVM 50대 기준 약 3만 시계열 | URI 상위 200 + `_other` |

**Server A 추가 CPU (추정)** **[판단]**
| 작업 | 추가 CPU |
|---|---|
| gateway 배치 해석·집계 (Go) | 약 0.3~0.5코어 |
| ClickHouse 적재 | 0.2~0.3코어 |
| ClickHouse 병합·압축 | 0.3~0.7코어 |
| SSE 송신 | 0.1코어 이하 |
| 검색 (조회 시에만) | 순간 최대 2코어 (상한) |
| **합계** | 평시 피크 약 1~1.5코어 (검색 동시 시 순간 +2) |

- 평시 load 1.6 + 추가분 → 피크 시 약 3 내외로 예상. **안전장치 [결정]**:
  1. 컨테이너 CPU 상한: ClickHouse 1.5코어, gateway 1코어 → PG·admin-api·Prometheus 보호.
  2. 과부하 시 상세부터 버림 (§6.8) — WAS 영향 없음, 모니터링 데이터 일부만 누락.
  3. ClickHouse 쿼리 상한 (§7.3).
- **이전 계획 [결정]**: Server A load average 3.0 초과가 잦으면 전용 서버(4코어+ / 16GB / 500GB+)로 ClickHouse 와 gateway 를 옮긴다. 이전 작업이 "ClickHouse 데이터 디렉터리 이동 + `CLICKHOUSE_URL`·gateway 주소 변경"으로 끝나도록, 두 서비스는 Server A 내부 서비스에 의존하지 않게 만든다(PG 설정 조회만 네트워크로).
- 프론트 큐·산점도는 **Canvas 렌더링**(SVG 금지).
- P2 완료 기준에 **5,000 TPS 부하 테스트** 포함 (§11).

### 7.7 admin-api 변경
- **시스템 기준정보 컬럼 추가** **[결정]** (`systems`, 3중 동기화):
  - `environment` — `dev` / `prod`. 시스템 관리 화면에서 설정·표시·필터.
  - `tx_slow_threshold_ms` — 느린 트랜잭션 기준, 기본 `3000`. 변경 시 원격 설정으로 해당 시스템 에이전트에 반영(재기동 불필요). 상세 보존·큐 구간·SLA·화면 기준선에 공통 사용.
  - `tx_retention_days` — 트랜잭션 데이터 보관일, 기본 `7`, 1~30.
  - **[판단]** 느린 기준은 시스템 단위, 인스턴스(JVM) 단위 예외는 `agent_instances.label_info.tx_slow_threshold_ms` 로 덮어쓰기만 허용. 보관일은 시스템 단위만.
- `agent_type` 신규 값 **`agent_t`** **[결정]** — `schemas.py` pattern, `routes/agents.py` SSH 계정 필수 규칙. 기존 `otel_javaagent` 참조(`routes/alerts.py`, `routes/traces.py`, log-analyzer `aggregation_processor.py` 등)는 `agent_t` 로 교체.
- **JVM 1개 = `agent_instances` 1행** **[판단]**. 한 호스트에 JEUS 서버가 여러 개면 각각 등록. `label_info.jvm_match`(예: `-Dsic_server1`) 저장, `instance_role` 기본값은 JEUS 서버명(`sic_server1`)으로 제안·수정 가능. 실시간 상태 키·Prometheus 레이블·ClickHouse 컬럼 모두 `(system_id/system_name, instance_role)` 기준.
- 신규 PG 테이블 (3중 동기화):
  - `apm_dashboards` — 사용자 구성 화면 (§9.2): `owner_user_id`, `name`, `layout`(JSON: 위젯 종류·위치·크기·대상 override), `filters`(JSON), `is_shared_default`, 감사 필드는 맨 끝.
  - `agent_commands` — 에이전트 명령 큐 (§6.11): `agent_instance_id`, `command`, `status`(pending/sent/done/failed), `result_ref`, 감사 필드.
- 신규 엔드포인트 (경로는 빌더 조정):
  - 트랜잭션 검색 `GET /api/v1/apm/transactions` (기간·시스템·인스턴스·URI·IP·사용자·응답시간·SQL 시간·에러·tx_id 조건, 페이지)
  - 건별 상세 `GET /api/v1/apm/transactions/{tx_id}` (요약 + SQL + 상세 + 같은 trace_id 의 다른 시스템 요약)
  - 산점도 과거 구간 `GET /api/v1/apm/scatter`
  - 시스템 요약 카드 `GET /api/v1/apm/systems/{id}/summary` (최근 1시간 TPS·평균 응답·느린 건수)
  - 화면 구성 CRUD `GET/POST/PUT/DELETE /api/v1/apm/dashboards`, 공유 기본 지정(admin)
  - 스레드 덤프 요청·조회 `POST /api/v1/agents/{id}/thread-dump`, `GET .../thread-dumps`
- 기존 `routes/traces.py`·`api/traces.ts`·`TraceDetailPanel` 은 ClickHouse 기반 위 엔드포인트로 교체·재사용 (Tempo 호출 제거).
- 설치·attach·해제 Job (§8).

### 7.8 제거 대상 (OTel · Tempo · n8n) **[결정]**
| 대상 | 처리 |
|---|---|
| compose 서비스 `otel-collector`, `tempo`, `n8n` + 볼륨 | 제거 (운영 반영 시 볼륨 백업 여부는 운영 판단) |
| `main-server/configs/otel-collector*`, tempo 설정, Grafana Tempo 데이터소스 | 제거 |
| `main-server/artifacts/otel/` | 제거 |
| admin-api `_run_otel_install` 및 OTel 설치 경로·`otel_javaagent` 분기 | 제거 (운영 DB 에 해당 행 0건 — 2026-10-30 확인) |
| 환경변수 `TEMPO_URL`, `OTEL_COLLECTOR_ENDPOINT` | 제거 → 신규 `CLICKHOUSE_URL`, `AGENT_T_GATEWAY_URL` |
| log-analyzer Tempo 조회(trace 근거) | ClickHouse 조회로 교체 (ADR-008 의 trace 근거 예산 규칙은 유지) |
| `_SLOW_THRESHOLD_MS` 동기화 규칙(ADR-008) | 폐기 → 시스템별 `tx_slow_threshold_ms` |
| n8n WF4/WF5 JSON | 보존 (`main-server/n8n-workflows/`), log-analyzer 이관 시 사용 |

---

## 8. 배포 · 즉시 적용

### 8.1 흐름 (기존 설치 Job 패턴 확장)
```
[1] SSH 세션 (기존 X-SSH-Session, WAS 기동 계정)
[2] 대상 JVM 탐색: 프로세스 목록에서 java 프로세스 + 식별 옵션(-D<서버명>, 예: -Dsic_server1) 매칭
    → PID, 실행 계정, java 실행 파일 경로(/proc/<pid>/exe), 기존 -javaagent 목록 수집
[3] JDK 판별: <java> -version → 1.6~1.7 = agent-t-legacy.jar / 8+ = agent-t.jar  (자동 선택 [결정])
    + 같은 JVM 에 OTel agent 감지 시 경고 (§6.12)
[4] SFTP 업로드: agent jar + attacher jar + agent-t.properties(gateway 주소·토큰·instance_role) + SHA256SUMS → sha256 검증
[5] 즉시 적용 (선택, 기본 ON): attacher 로 대상 PID 에 attach → agentmain → 계측 시작
[6] 영구 적용: 기동 스크립트에 -javaagent 주입 (service_type 별, 기존 inject 파일 방식 확장)
[7] 확인: gateway 에 해당 인스턴스 배치 수신 확인 (최대 30초 대기) → status=running
```

### 8.2 SSH 실행 방식 보강
- 기존 `ssh_exec`(exec 채널) 실패 시 **PTY 셸 세션으로 폴백**(invoke_shell + 프롬프트 마커 기반 명령 실행). 10.253.21.78 사례 대응. `services/ssh_session.py` 확장.

### 8.3 즉시 적용 (Dynamic Attach)
- attacher 는 **대상 JVM 의 java** 로 실행 (`<대상 java> -jar agent-t-attacher.jar <pid> <agent.jar> <args>`) — JDK 6~8 은 `tools.jar` 를 classpath 에 동적 추가, 9+ 는 `jdk.attach` 모듈 사용.
- **기본값: 즉시 적용 ON** (개발·운영 공통) **[결정]**. 설치 확인 대화상자에 안내 문구 표시 (§8.6).
- 개발기 `sic_server1`(PID 42318) 사전 점검 결과 (2026-10-29): 소유자 `jeussic` = SSH 계정, `/usr/local/jdk1.7.0_79/lib/tools.jar` 존재, `DisableAttachMechanism`·`EnableDynamicAgentLoading` 미지정, `/tmp` 쓰기 가능, `/tmp/hsperfdata_jeussic` 에 PID 노출(`jps` 로 확인) → **attach 전제 조건 모두 충족**. 실제 attach 는 P0 에서 수행.
- 전제 조건 (설치 단계에서 사전 점검 → 불충족 시 "영구 적용만, 재기동 필요"로 안내):

| 조건 | 점검 |
|---|---|
| 대상 JVM 과 **같은 OS 계정** | 프로세스 소유자 == SSH 계정 |
| JRE 가 아닌 **JDK** (1.6~8 은 `lib/tools.jar` 존재) | 파일 존재 확인 |
| `-XX:+DisableAttachMechanism` 미지정 | 프로세스 옵션 확인 |
| `java.io.tmpdir`(기본 `/tmp`) 접근 가능 (attach 소켓) | 쓰기 확인 |
| JDK 1.6 이상 (1.5 Attach 미지원) | 버전 |
- 이미 로딩된 클래스(서블릿·JDBC 구현체)는 `retransformClasses` 로 계측 — §6.2-1 원칙 덕분에 가능.
- JDK 21 은 dynamic agent 로딩 시 경고 로그 출력(JEP 451) — 동작은 함. `-XX:-EnableDynamicAgentLoading` 지정 JVM 은 attach 불가로 판정.
- 해제: 원격 설정 `enabled=false` → transformer 제거 + 원본 복원 (재기동 없이). 에이전트 클래스 자체 언로드는 불가 — 완전 제거는 영구 주입 제거 후 재기동.

### 8.4 영구 적용 (기동 스크립트 주입)
| service_type | 주입 방식 | 자동화 수준 |
|---|---|---|
| tomcat | `bin/setenv.sh` 마커 블록 (기존 방식 재사용) | 자동 |
| jboss | `standalone.conf.d` (기존) | 자동 |
| systemd | drop-in (기존, root) | 자동 |
| **jeus** | **`domain.xml` 의 해당 서버 `<jvm-option>` 에 `-javaagent` 1줄 추가** — sysmaster 와 같은 위치(개발기 `sic_domain/config/domain.xml` `sic_server1` 항목에서 확인). 원본 백업 + 변경 diff 미리보기 + 사용자 확인 후 반영 | 반자동 |
| standalone | wrapper (기존) | 수동 |
- JEUS 확인 사항 (2026-10-29 개발기): 도메인 관리 서버가 `config/config.lck` 로 설정을 잠그고 있음 → 실행 중 파일 직접 편집은 덮어써질 위험. **`jeusadmin` 명령으로 jvm-option 추가하는 방식 우선**, 불가 시 파일 편집 + 도메인 설정 동기화. 구체 명령은 빌더가 JEUS 7 매뉴얼·개발기에서 확정. 기존 수동 백업 관례(`domain.xml_20220915`)와 같은 형식으로 백업 파일 생성.
- JEUS 서버는 NodeManager(`jeus.server.NodemanagerBootstrapper`)가 띄우는 구조 — 프로세스 탐색 시 `ServerBootstrapper` + `-D<서버명>` 으로 식별.
- 다음 재기동부터 `-javaagent` 로 로딩 → attach 로 붙은 상태와 동일 동작 (§6.1). 재기동 전까지는 attach 상태 유지.

### 8.5 업그레이드·롤백
- 업그레이드: 새 jar 업로드 + 영구 주입 경로 갱신 → **다음 재기동 시 반영** (무중단 업그레이드 비목표).
- 롤백: (즉시) 킬 스위치 → (영구) 주입 제거 + 재기동. 이전 jar 1개 보관.

### 8.6 설치 안내 문구 **[결정: 안내 표시] / [판단: 문구]**
설치 실행 전 확인 대화상자 (운영 `environment=prod` 시스템은 강조 표시):
> **에이전트를 적용합니다.**
> - **즉시 적용**: 실행 중인 WAS 에 바로 붙습니다. 적용 직후 수 초간 CPU 사용률이 일시적으로 오를 수 있습니다.
> - **영구 적용**: WAS 기동 설정(`domain.xml` 등)에 등록됩니다. **다음 WAS 재기동부터 기동 옵션으로 적용되며, 재기동은 운영 일정에 맞춰 별도로 진행해 주세요.**
> - 적용을 끄려면 에이전트 화면의 "계측 중지"를 누르세요(재기동 불필요).

---

## 9. 화면

> 뉴모피즘 디자인 시스템 준수, CSS 변수 사용, 표출 KST(`formatKST`). UI 변경 시 CLAUDE.md 규정대로 design-review → qa subagent 순차 검증.

### 9.1 메뉴 **[결정]**
- 사이드바 '운영'과 '알림' 사이에 **'트랜잭션'** 그룹 신설:
  - **실시간 모니터링** `/apm/live`
  - **트랜잭션 분석** `/apm/transactions`
  - 건별 상세 `/apm/tx/:txId` (메뉴 항목 없음, 링크 공유 가능)
- `constants/routes.ts`, `App.tsx`, `Sidebar.tsx`, ⌘K `CommandSearch.tsx` 의 `NAV_ITEMS` 함께 갱신.
- 접근: 로그인 사용자 전체 (AuthGuard). 공유 기본 화면 지정만 admin.

### 9.2 실시간 모니터링 — 사용자 구성형 **[결정]**
- **위젯을 끌어 놓고 크기 조절해 원하는 구성으로 저장** (InterMAX 방식). 그리드 라이브러리 `react-grid-layout` 신규 도입 **[판단]**.
- **저장 범위 [결정]**: 사용자별로 이름 붙인 화면 여러 개(`apm_dashboards`). admin 은 하나를 **공유 기본 화면**으로 지정, 신규 사용자는 공유 기본 화면의 복사본으로 시작.
- **대상 지정 [결정]**: 화면 상단 시스템/WAS 다중 선택 필터가 기본, 위젯별로 대상 덮어쓰기 가능.
- **위젯 12종 [결정]**:

| 구분 | 위젯 | 데이터 |
|---|---|---|
| 트랜잭션 | **큐(액티브 이퀄라이저)** | SSE 액티브 스냅샷(1초). WAS 별 막대, 경과 구간 3색 — 정상 < T, 경고 T~3T, 위험 ≥ 3T (T = 시스템 느린 기준, 기본 3초) **[판단: 구간]**. 막대 클릭 → 진행 중 목록 필터 |
| | **산점도** | 실시간 점은 SSE, 화면 범위를 과거로 옮기면 ClickHouse 조회. 드래그로 영역 선택 → 해당 트랜잭션 목록 → 클릭 시 건별 상세 |
| | **진행 중 트랜잭션 목록** | SSE 액티브 상위 N: URI, 경과, 현재 단계/SQL, 스레드. 행 클릭 → 현재 스택, 인스턴스 [스레드 덤프] 버튼(§6.11) |
| | TPS / 평균 응답시간 / 에러율 | SSE 5초 집계 (최근 10분), 더 긴 구간은 Prometheus |
| | URL 상위 / SQL 상위 | SSE 5초 집계 (건수·누적 시간 기준) |
| JVM | 동시 사용자·활성 스레드 / CPU / 힙·GC / DB 커넥션 풀 | SSE 5초 집계 (§6.10). 커넥션 풀은 계측 가능한 풀만(P1: 트랜잭션별 open/close 기반 근사, P3: JEUS 풀) |
- 큐·산점도는 Canvas 렌더링. 화면 1개 = SSE 연결 1개.
- 수집 누락(§6.8) 발생 시 화면 상단에 해당 인스턴스 경고 배지.

### 9.3 트랜잭션 분석 (`/apm/transactions`)
- 조건: 기간(KST 입력 → `kstDateToUtcStart/End`), 시스템, 인스턴스, URI, 사용자 IP, 사용자 ID, 응답시간 >, SQL 시간 >, 에러만, tx_id
- 목록: 시작 시각, 시스템·인스턴스, URI, 응답, CPU, SQL 시간·건수, fetch, 예외, IP(마스킹), 상세 보유 여부 — ClickHouse 페이지 조회
- 보관일 밖 조회 시 "보관 기간(N일) 지난 데이터" 안내.

### 9.4 건별 상세 (`/apm/tx/:txId`)
- 탭:
  - **경로**: 같은 trace_id 의 모든 시스템 요약을 시간축으로 (요약 전량이므로 항상 표시)
  - **SQL**: SQL 별 실행 횟수·시간·fetch (전량)
  - **호출 트리**: 노드 시간·비율, 노드 사이 빈 구간을 **"미계측 구간"** 노드로 계산 표시 — 상세 보유 건만
  - **스택 샘플**: 미계측 구간 상위 프레임 (§6.6) — 상세 보유 건만
  - **리소스**: 커넥션 open/close/미반환/미커밋
- 상세가 없는 건: "호출 트리는 느린 기준(N초) 이상·에러 건만 보관합니다" 안내.
- 기존 `TraceDetailPanel` 은 이 화면 구성요소로 재사용 **[판단]**.
- LLM 연계: 상세 요약(미계측 비율, 상위 스택, 느린 SQL)을 기존 trace 근거 예산(ADR-008 §5 규칙 승계) 안에서 분석 프롬프트에 포함 — 상세는 빌더 결정.

### 9.5 개인정보 표시 **[결정]**
- SQL 바인드 값: 수집하지 않음 (§6.5).
- 사용자 IP: 끝자리 일부 마스킹(예: `10.253.21.*`), 사용자 ID: 앞 2자 외 마스킹(예: `ab****`). 마스킹은 admin-api 응답 단계에서 적용(원문은 저장). 마스킹 해제 권한은 이번 범위 밖.

### 9.6 기존 화면 변경 **[결정]**
- **시스템 상세페이지(`/dashboard/:systemId`)는 유지**. 다른 영역(수집 현황·프로세스·활성 이슈·예방적 패턴·담당자)은 그대로.
- **'성능 분석' 영역만 교체**: OTel 점 차트(`TraceDotChart`)·트레이스 drawer 를 빼고 **요약 카드** — 최근 1시간 TPS·평균 응답시간·느린 기준 초과 건수 + **[실시간 모니터링 열기]** → `/apm/live?system=<id>`. Agent-T 미설치 시스템은 기존처럼 에이전트 설치 안내 링크.
- 대시보드 `TraceTreemapSection` 타일 클릭 → `/apm/live?system=<id>` 로 변경 (데이터는 ClickHouse 요약 기반으로 교체).
- `TraceDotChart` 는 산점도 위젯 구현에 참고·재사용 여부 빌더 결정 (Canvas 요구 충족 필요).
- 시스템 관리 화면: `environment`, `tx_slow_threshold_ms`, `tx_retention_days` 입력·표시 추가.

---

## 10. 검증

| 구분 | 항목 |
|---|---|
| 호환 매트릭스 | JDK 1.6 / 1.7(HotSpot) / 8 / 11 / 17 / 21 × JEUS 7 / Tomcat 7·8.5·9·10 (jakarta) |
| 즉시 적용 | 기동 중 JVM attach → 이미 로딩된 서블릿·JDBC 계측 확인, 해제 후 원본 복원 확인 |
| 공존 | sysmaster(`-agentpath` + `-javaagent` + bootclasspath) 동시 적용, jmx_prometheus_javaagent 동시 적용 |
| 안전장치 | 고의 변환 실패 클래스 주입 → WAS 정상 기동·서비스 확인. gateway 다운·ClickHouse 다운·`429` 상황에서 WAS 영향 없음 + 버림 순서(§6.8) 확인 |
| 성능 | 부하 테스트로 §3 성능 예산 확인 (에이전트 OFF 대비) |
| 전량 저장 | 부하 테스트 중 발생 건수 = `tx_summary` 적재 건수 (누락 카운터 0 일 때) |
| 보관 | 시스템별 보관일 다르게 설정 → TTL 삭제 확인 |
| 전파 | JDK 1.7 → JDK 17 HTTP 호출이 같은 trace_id 로 경로 탭에 연결 |
| Server A 영향 | 5,000 TPS 부하 중 admin-api p95·Prometheus 수집 지연·log-analyzer 주기 퇴행 없음, load average 기록 |
| 서버 | `make test-api`, gateway 단위 테스트(`go test`), ClickHouse DDL 적용 테스트, 프론트 design-review/qa |
| 운영 리허설 | `sic_server1`(개발기) 설치 → 재기동 없이 화면 표시 → 재기동 후 영구 적용 확인 |

**테스트 환경** **[판단]**: JEUS 7 + JDK 1.7 + sysmaster 공존은 `sic_server1`(개발기)에서 검증. JDK·Tomcat 매트릭스와 부하 테스트는 로컬/빌드 서버의 Docker 컨테이너(JDK 6~21 이미지 + Tomcat)로 구성. JDK 1.6 이미지 확보가 안 되면 1.6 은 "best effort" 로 낮춘다.

---

## 11. 단계 계획 (완료 기준)

| 단계 | 범위 | 완료 기준 |
|---|---|---|
| **선행** | Server A `/app` +400GB 증설 요청, gateway 포트 방화벽 요청 | 디스크·방화벽 반영 |
| **P0 PoC** | legacy/modern 빌드 골격, servlet+JDBC 계측, gateway 최소 수신, ClickHouse 요약 적재, attach | `sic_server1` 에 attach → `tx_summary` 에 건 적재 |
| **P1 MVP** | §6.3 P1 대상 전체, §6.4·6.5 3계층·사전, 설치 Job(§8, JEUS 반자동 포함), 시스템 기준정보 3컬럼, 트랜잭션 분석·건별 상세 화면, OTel/Tempo/n8n 제거(§7.8), 상세페이지 성능 분석 영역 교체 | 성공 기준 2·3·4·5 충족 |
| **P2 실시간** | Active Registry 1초, 스택 샘플링, gateway SSE·5초 집계·remote write, JVM 지표, 실시간 모니터링(위젯 12종·화면 저장), 스레드 덤프 | 성공 기준 1·6 충족 + **5,000 TPS 부하 테스트**에서 §3 예산·§7.6 Server A 영향 확인, 용량 추정 보정 |
| **P3 제품 확장** | HttpClient, JEUS 내부, WebT·ProFrame·AnyLink, 업무키 추출 | 대상 제품별 계측 검증 |
| **P4 분석 고도화** | SLA 등급, 리소스 알림, 서비스명 매핑, LLM 분석 연계, 힙 고갈 알림 규칙, LLM 진단 스레드 덤프 연결 | 알림·리포트에 반영 |

---

## 12. 열린 질문

1. JDK 1.5(또는 1.4) 시스템이 실제로 있는가? — 있으면 attach 불가·별도 빌드로 범위 재검토.
2. JDK 1.7 시스템이 IBM J9 등 HotSpot 외 JVM 을 쓰는 경우가 있는가? — attach·CPU 시간 API 동작 차이.
3. 실제 일 평균 TPS 프로파일 — 용량 추정(§7.3)의 30% 가정 확인. P2 부하 테스트·운영 초기 실측으로 보정.

---

## 13. 빌더에게 맡긴 것
- ASM 버전, 빌드 도구(Gradle/Maven), 패키지 구조
- 에이전트 ↔ gateway 직렬화 형식, gateway 포트·내부 구조, 에이전트 토큰 발급 방식
- ClickHouse 상세 스키마(컬럼 타입·코덱·보조 인덱스), 버전
- URI 정규화 기본 규칙
- JEUS 7 영구 주입 구체 방식 (파일 편집 vs jeusadmin)
- Prometheus 지표 상세 이름·기존 분석 편입 매핑
- 화면 세부 레이아웃 (디자인 시스템 범위 내), `TraceDotChart` 재사용 여부

## 14. 문서·ADR 반영 (구현과 동시)
- `.claude/memory/adrs.md` **ADR-022** (Agent-T + agent-t-gateway(Go) + ClickHouse + SSE, 전량 요약·선별 상세, OTel/Tempo/n8n 제거) + ADR-008 "ADR-022 로 대체" 표시
- `docs/jvm-metrics-collection-decision.md` 상단에 "§6.10 으로 대체" 표시
- `CLAUDE.md` 서비스 구성·환경변수(`CLICKHOUSE_URL`, `AGENT_T_GATEWAY_URL` 추가 / `TEMPO_URL`, `OTEL_COLLECTOR_ENDPOINT` 제거 / n8n 항목 정리), `main-server/CLAUDE.md`(포트·컨테이너·ClickHouse DDL 경로), `admin-api/CLAUDE.md`(agent_type, 엔드포인트), `frontend/CLAUDE.md`(트랜잭션 메뉴)
- `.claude/memory/architecture.md`, `code-layout.md`
- 신규 `agent-t/CLAUDE.md`, `agent-t-gateway/CLAUDE.md`, `main-server/artifacts/agent-t/README.md`
