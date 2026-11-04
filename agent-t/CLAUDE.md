# agent-t — Synapse-V Java 트랜잭션 에이전트 (JDK 1.6~21)

설계: `docs/superpowers/specs/2026-10-29-agent-t-design.md`, 전송 계약: `contracts/agent-t/protocol.md`.

## 빌드 (`build.sh`, javac 직접 호출, Gradle/Maven 없음, 컴파일은 항상 Docker)
| 타깃 | 내용 |
|---|---|
| `fetch` | ASM 5.2/9.7 소스, JUnit 4.13.2, hamcrest 1.3 다운로드 → `third_party/versions.properties` SHA256 검증(매 실행) → ASM 패키지를 `com.synapsev.agentt.shaded.asm` 으로 sed 이동 → `third_party/src/` (gitignore) |
| `test-legacy` | `azul/zulu-openjdk:7`(`--platform linux/amd64`), `-source/-target 1.6`, ASM 5.2 |
| `test-modern` | `eclipse-temurin:21-jdk`, `--release 8`, ASM 9.7 |
| `jar` | `dist/{agent-t-legacy.jar, agent-t.jar, agent-t-attacher.jar, SHA256SUMS}` (attacher 는 legacy javac `-target 1.6` 로 한 번 빌드, JDK 6~21 공용) |
| `it-attach` | `jar` 선행. Docker 통합 테스트: zulu 7(legacy jar)·temurin 17(modern jar) attach + `--check` 옵션 판정, `eclipse-temurin:8-jre` → `PRECHECK:no_tools_jar` |

## 배포 (agent-v 와 동일 구조)
- `dist/` 는 **git 추적**(agent-v 의 `agent/dist/agent-v` 와 같음). admin-api Dockerfile 이 `agent-t/dist/` 를 `/app/bin/agent-t/` 로 COPY → 폐쇄망 반입은 admin-api 이미지 tar 하나(jar 별도 반입 없음). `build-images.sh` 가 빌드 전 4개 파일·SHA256SUMS 일치와 `dist/SOURCE_STAMP`(소스·산출물 해시, `scripts/agent-build-stamp.sh`) 일치를 확인하고, 소스가 바뀌었는데 재빌드하지 않았으면 `make build-agent-t` 안내 후 중단한다.
- 설치 Job(`admin-api/services/agent_t_installer.py`)은 `AGENT_T_ARTIFACT_DIR`(기본 `/app/bin/agent-t`, 로컬 `make run-api` 는 `agent-t/dist`)에서 jar 를 읽어 SHA256SUMS 대조 후 SFTP 로 WAS 에 올린다. 대상 JDK 로 `agent-t.jar`(8~21)/`agent-t-legacy.jar`(1.6~1.7) 자동 선택. 불일치 시 설치 실패.
- jar 교체: `make build-agent-t`(fetch 필요 시 자동 → `build.sh jar` → 스탬프 기록) → `dist/`(SOURCE_STAMP 포함) 커밋 → `build-images.sh` → admin-api 이미지 반입·재기동. 이미 설치된 서버는 재설치 시 갱신. `fetch` 는 인터넷 필요(폐쇄망 안에서는 빌드하지 않음).
- tools.jar 없는 JRE·`-XX:+DisableAttachMechanism` 서버는 즉시 적용 불가 → 설치 Job 이 `PRECHECK:*` 를 남기고 영구 적용(기동 옵션 주입)만 해 다음 재기동부터 적용.

## 모듈 (`build.sh` 가 전부 한 번에 컴파일, 테스트는 각 `*/src/test/java`)
| 모듈 | 내용 |
|---|---|
| `core` | 모델·직렬화·정규화·설정·전송(G1) + `tx/`(TxTracker·TxContext·TraceParent·DetailDecider, 훅 수신) |
| `bridge` | `Hooks`·`HookSink` — **부트 클래스로더**에 올라가는 정적 진입점(파라미터는 JDK 타입만). jar 에는 최상위가 아니라 `bridge/agent-t-bridge.jar` 리소스로 포함, `AgentMain` 이 임시 파일로 풀어 `appendToBootstrapClassLoaderSearch` |
| `instrument` | `AgentTransformer`(ASM `AdviceAdapter`, 실패 시 원본 유지+카운터)·`Matchers`(계측 대상)·`HierarchyResolver`(클래스 로딩 없이 상위 타입 판정) |
| `boot` | `AgentMain`(premain/agentmain, `agent_t.loaded` 마커(값 = 로드된 agent jar 절대경로; 구버전은 `true`), `{jar 디렉터리}/DISABLE`, `props=` 인자) + `AgentRuntime`(킬 스위치: transformer 제거 + retransform 복원 + `Hooks.sink=null`) |
| `attacher` | `Attacher`: `java -jar agent-t-attacher.jar [--check] <pid> [<agentJar> [args]]`. 종료코드 0 성공 / 2 전제조건 불충족(`PRECHECK:<reason>` 한 줄) / 1 기타. `--check` 는 `OK` 일 때 대상 JVM 에 Agent-T 가 이미 로드돼 있으면(Attach API `getSystemProperties()` 의 `agent_t.loaded`) 다음 줄에 `LOADED:<값>` 을 추가 출력한다(종료코드 0 유지, 읽기 실패 시 생략). reason: `no_tools_jar` `attach_disabled` `dynamic_loading_disabled` `not_same_user` `tmpdir_not_writable` `jdk_too_old` `no_such_pid`. JDK 6~8 은 tools.jar 리플렉션, 9+ 는 jdk.attach. 대상 JVM 의 java 로 실행할 것 |

- ASM API 레벨은 빌드가 생성하는 `AsmApi.LEVEL`(legacy `ASM5`, modern `ASM9`) — instrument 소스는 ASM 5.2 에 있는 API 만 쓴다.
- `getConnection()`/`getConnection(String,String)`(반환 타입이 `java.sql.Connection` 또는 하위 타입, static·bridge 제외)은 조상에 `javax.sql.CommonDataSource` 또는 `javax.sql.PooledConnection` 이 있는 클래스에서만 "커넥션 open" 으로 계측한다(pgjdbc `BaseDataSource` 는 `DataSource` 가 아니라 `CommonDataSource` 만 구현). `Statement`/`ResultSet`/`DatabaseMetaData` 계열과, 풀이 물리 커넥션을 돌려주는 접근자(Tomcat-JDBC `PooledConnection` 등 JDBC 상위 타입이 없는 클래스)는 open 이 아니다. 바깥쪽 호출만 집계(깊이 가드).
- `TxTracker` 의 요청/응답 클래스 → 접근자 캐시는 `WeakHashMap<Class,Access>` + `Method` `WeakReference`(값이 키 클래스를 강하게 잡지 않음; 비면 재탐색). webapp 언로드 후 클래스로더가 고정되지 않아야 한다(`TxTrackerAccessLeakTest`).
- **DB 접속명(`sql[].db`)**: `TxTracker.sqlEnter` 가 `Statement.getConnection()` → `getMetaData().getURL()` 을 **Connection 객체(identity, `WeakIdentityMap`)당 1회**만 읽어 `norm/JdbcUrlNormalizer` 로 `host:port/db` 로 정규화(자격증명·파라미터 제거, 128자 상한, 포트 생략 시 벤더 기본 포트, 해석 불가 시 벤더명). 실패는 `""` 로 음성 캐시(재시도 없음), 50ms 넘는 조회가 3회 누적되면 조회 자체를 끈다(`""`). `sqlDepth++` 이후에 조회해 드라이버 내부 SQL 의 재진입을 막는다. SQL 집계 키는 `(sql_id, db)`. 풀이 borrow 마다 새 프록시를 주면 프록시당 1회 조회된다.
- 계측은 메서드 본문만 변경(필드·메서드 추가 금지). `jakarta.servlet` 은 별도 빌드 없이 같은 코드에서 함께 매칭.

## 요청 파라미터 수집 (opt-in, `capture.params`)
- `agent-t.properties`(정적, gateway 가 바꾸지 못함): `capture.params=true`(기본 false), 선택 `capture.params.uri.include` / `.exclude`(쉼표 구분 glob `*` `?`, 요청 URI 대상, 빈 include = 전체, exclude 우선). 설치 Job 이 `label_info.capture_params`·`capture_params_include`·`capture_params_exclude` 로 기록한다.
- **서블릿 exit 에서만** `getQueryString()`/`getParameterMap()` 을 리플렉션 호출(javax·jakarta 공통, 진입 시점에 읽지 않아 앱이 본문을 먼저 소비). 진입 시에는 URI 허용 여부만 판단해 요청 객체 참조를 `TxContext.captureReq` 에 잡았다가 exit 에서 해제. 모든 예외 무시.
- **상세 보존(`DetailDecider.keep`) 된 건에만** `detail.params` 로 첨부(느림·에러·누수·샘플링 — 물량 제한). 마스킹·한도는 `tx/ParamCapture`(이름 부분일치 마스킹, 주민번호/카드/이메일 값 패턴, 값 256자·최대 50개·query 1024자·전체 4KB, 초과 시 `t=true`). 이름 부분일치라 `author`·`hotel` 같은 이름도 마스킹(보수적).
- 본문(body)은 수집하지 않는다. 사전 동의된 URI 에만 켜는 것을 권장.

## DB 커넥션 풀 지표 (JMX, `jvm/pool/PoolCollector`, ADR-023)
- 전용 데몬 스레드 `agent-t-pool` 이 수집하고, `agent-t-jvm` 루프는 마지막 스냅샷만 `fill()` 로 읽는다(JMX 호출로 JVM 샘플이 지연되지 않음). 첫 탐색은 시작 30초 후, 이후 60초마다 재탐색(풀이 안 나오면 3회 뒤 5분 주기, `queryNames` 100ms 초과 2회여도 5분), 폴링 주기 1초(`collectPeriodMs`, 같은 `agent-t-pool` 스레드·같은 200ms 예산 — 쿼리가 커넥션을 수 ms 만 잡아 5초 시점 값은 거의 0 이므로 5초 창 최대값(peak)을 함께 보고; 예산 초과 3회 연속이면 30초 주기로 후퇴).
- **MBeanServer 는 `MBeanServerFactory.findMBeanServer(null)` 로만 찾는다.** JEUS 는 `jeus.jmx.usePlatformMBeanServer` 가 없으면 플랫폼이 아닌 자체 MBeanServer 를 만든다. 플랫폼 MBeanServer 를 생성시키는 API(`ManagementFactory.getPlatformMBeanServer`)는 **절대 호출 금지**(JBoss 등에서 기동 장애 선례, 이미 만들어진 서버만 대상). `PoolCollectorTest.sourceNeverUsesForbiddenCalls` 가 소스 문자열로 강제한다.
- **MBean 에는 `getAttribute` 만**(+탐색용 `queryNames`/`getMBeanInfo`). `invoke`/`setAttribute`/`getAttributes`(일괄) 금지 — JEUS 풀 MBean 에는 `shrink`·`disableCP` 같은 상태 변경 오퍼레이션과 무거운 `PooledConnectionInfo` 가 있어, JEUS(`JEUS:j2eeType=JDBCDataSource,*`)는 **`stats` 속성 하나만** 읽는다(테스트가 호출 목록 == `[getAttribute:stats]` 를 검증).
- JEUS `stats` 값 객체(JSR-77 `JDBCConnectionPoolStats`)는 JEUS 클래스 의존 없이 **리플렉션**으로만 읽는다: `getPoolSize`/`getFreePoolSize`/`getMaxPoolSize`/`getWaitingThreadCount` 의 `getCurrent()`. active = PoolSize − FreePoolSize(0 미만이면 0), max ≤ 0 이면 `PoolSize.getUpperBound()`. 메서드 캐시는 `WeakHashMap<Class, Map<이름, WeakReference<Method>>>` — 값이 클래스를 강하게 잡지 않아 webapp 언로드가 막히지 않는다(`methodCacheDoesNotPinClassLoader`).
- HikariCP(`com.zaxxer.hikari:type=Pool (name)`, max 는 `PoolConfig (name)` 의 `MaximumPoolSize`, `registerMbeans=true` 일 때만), Tomcat JDBC(`tomcat.jdbc:type=ConnectionPool,*`)/`*:type=DataSource,*`, DBCP2(`org.apache.commons.dbcp2:*`)는 최초 1회 `getMBeanInfo` 로 속성 동의어(대소문자 무시: `ActiveConnections|NumActive|Active`, `IdleConnections|NumIdle|Idle`, `MaxTotal|MaxActive|MaximumPoolSize`, `ThreadsAwaitingConnection|WaitCount`)를 매핑하고 속성마다 `getAttribute`. active 속성이 없는 MBean 은 풀이 아니라 버린다. 같은 풀이 두 서버/패턴에 있어도 `kind|ObjectName` 키로 한 번만 센다.
- 안전장치: 한 사이클 예산 200ms(`nanoTime`, 초과 시 남은 풀은 라운드로빈 커서로 다음 사이클, 못 읽은 풀은 직전 값 유지), 1초 넘는 단일 호출은 해당 풀 6사이클 건너뜀, 예산 초과 3회 연속이면 주기 30초, 5분 이어지면 수집 자체를 끄고(WARN 1회) 에이전트 나머지는 영향 없음. 풀 5회 연속 실패 시 대상 제거(다음 재탐색에서 재등록). `SecurityException`·`LinkageError` 등 모든 `Throwable` 은 삼키고 스냅샷이 30초 넘게 갱신되지 않으면 `conn_*`/`pools` 를 생략한다.
- 첫 수집 성공 시 INFO 1줄(`pool metrics: mbeanServers=N pools=M [name(kind,max=..), ...] sum ... e.g. <ObjectName>`) — dev_cxm 에서 JEUS ObjectName 형식·max 값 확인용.
- 킬 스위치: `agent-t.properties` `pool.metrics=false`(기본 true, gateway 가 못 바꿈). 설치 Job 은 `label_info.pool_metrics=false` 일 때만 이 줄을 쓴다(프론트 설치 폼에는 노출하지 않음 — properties/label_info 전용).
- **peak**: 풀마다 최근 폴링 (시각, active) 8칸 링을 두고 `PEAK_WINDOW_MS`=5초 안 최대 → `PoolSample.peak`(≥active), 합계 `JvmSample.connPeak`(풀별 peak 의 합). 요청 스레드 계측(JDBC borrow 카운트)은 추가하지 않았다 — `conn_open/close` 훅은 물리 커넥션이 아니라 `getConnection()` 호출을 세고 풀 프록시/커넥션 반환 경로는 풀 구현마다 달라 단순·안전하게 일반화할 수 없다(ADR-024).
- 프로토콜: `jvm.conn_active/idle/max/wait`(합계) + `jvm.conn_peak`(선택) + `jvm.pools[{name,kind,active,idle,max,wait,peak}]`(사용률 내림차순 최대 64개), 풀이 없으면 키 생략.

## 규칙
- 코어는 Java 6 API 만 사용: 람다·diamond·try-with-resources·`java.util.Objects`·`Long.toUnsignedString` 금지.
- 런타임 의존성 0. JSON 은 `json/JsonWriter`, `json/JsonReader` 직접 구현.
- WAS 스레드(`Sender.offer*`)는 절대 블로킹·예외 전파 금지. 버퍼 8MB 초과 시 상세 → SQL 집계 → 트랜잭션 순 제거.
- 테스트는 `agentt.repo.root` 시스템 프로퍼티(build.sh 가 설정)로 `contracts/` 를 읽는다.
