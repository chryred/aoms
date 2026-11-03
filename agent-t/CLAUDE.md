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
- `dist/` 는 **git 추적**(agent-v 의 `agent/dist/agent-v` 와 같음). admin-api Dockerfile 이 `agent-t/dist/` 를 `/app/bin/agent-t/` 로 COPY → 폐쇄망 반입은 admin-api 이미지 tar 하나(jar 별도 반입 없음). `build-images.sh` 가 빌드 전 4개 파일·SHA256SUMS 일치를 확인한다.
- 설치 Job(`admin-api/services/agent_t_installer.py`)은 `AGENT_T_ARTIFACT_DIR`(기본 `/app/bin/agent-t`, 로컬 `make run-api` 는 `agent-t/dist`)에서 jar 를 읽어 SHA256SUMS 대조 후 SFTP 로 WAS 에 올린다. 대상 JDK 로 `agent-t.jar`(8~21)/`agent-t-legacy.jar`(1.6~1.7) 자동 선택. 불일치 시 설치 실패.
- jar 교체: `./build.sh jar` → `dist/` 커밋 → `build-images.sh` → admin-api 이미지 반입·재기동. 이미 설치된 서버는 재설치 시 갱신. `fetch` 는 인터넷 필요(폐쇄망 안에서는 빌드하지 않음).
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
- 계측은 메서드 본문만 변경(필드·메서드 추가 금지). `jakarta.servlet` 은 별도 빌드 없이 같은 코드에서 함께 매칭.

## 규칙
- 코어는 Java 6 API 만 사용: 람다·diamond·try-with-resources·`java.util.Objects`·`Long.toUnsignedString` 금지.
- 런타임 의존성 0. JSON 은 `json/JsonWriter`, `json/JsonReader` 직접 구현.
- WAS 스레드(`Sender.offer*`)는 절대 블로킹·예외 전파 금지. 버퍼 8MB 초과 시 상세 → SQL 집계 → 트랜잭션 순 제거.
- 테스트는 `agentt.repo.root` 시스템 프로퍼티(build.sh 가 설정)로 `contracts/` 를 읽는다.
