# agent-t — Synapse-V Java 트랜잭션 에이전트 (JDK 1.6~21)

설계: `docs/superpowers/specs/2026-10-29-agent-t-design.md`, 전송 계약: `contracts/agent-t/protocol.md`.

## 빌드 (`build.sh`, javac 직접 호출, Gradle/Maven 없음, 컴파일은 항상 Docker)
| 타깃 | 내용 |
|---|---|
| `fetch` | ASM 5.2/9.7 소스, JUnit 4.13.2, hamcrest 1.3 다운로드 → `third_party/versions.properties` SHA256 검증(매 실행) → ASM 패키지를 `com.synapsev.agentt.shaded.asm` 으로 sed 이동 → `third_party/src/` (gitignore) |
| `test-legacy` | `azul/zulu-openjdk:7`(`--platform linux/amd64`), `-source/-target 1.6`, ASM 5.2 |
| `test-modern` | `eclipse-temurin:21-jdk`, `--release 8`, ASM 9.7 |
| `jar` | `build/dist/{agent-t-legacy.jar, agent-t.jar, agent-t-attacher.jar, SHA256SUMS}` (attacher 는 legacy javac `-target 1.6` 로 한 번 빌드, JDK 6~21 공용) |
| `it-attach` | `jar` 선행. Docker 통합 테스트: zulu 7(legacy jar)·temurin 17(modern jar) attach + `--check` 옵션 판정, `eclipse-temurin:8-jre` → `PRECHECK:no_tools_jar` |
| `install-artifacts` | `build/dist` → `main-server/artifacts/agent-t/` |

## 모듈 (`build.sh` 가 전부 한 번에 컴파일, 테스트는 각 `*/src/test/java`)
| 모듈 | 내용 |
|---|---|
| `core` | 모델·직렬화·정규화·설정·전송(G1) + `tx/`(TxTracker·TxContext·TraceParent·DetailDecider, 훅 수신) |
| `bridge` | `Hooks`·`HookSink` — **부트 클래스로더**에 올라가는 정적 진입점(파라미터는 JDK 타입만). jar 에는 최상위가 아니라 `bridge/agent-t-bridge.jar` 리소스로 포함, `AgentMain` 이 임시 파일로 풀어 `appendToBootstrapClassLoaderSearch` |
| `instrument` | `AgentTransformer`(ASM `AdviceAdapter`, 실패 시 원본 유지+카운터)·`Matchers`(계측 대상)·`HierarchyResolver`(클래스 로딩 없이 상위 타입 판정) |
| `boot` | `AgentMain`(premain/agentmain, `agent_t.loaded` 마커, `{jar 디렉터리}/DISABLE`, `props=` 인자) + `AgentRuntime`(킬 스위치: transformer 제거 + retransform 복원 + `Hooks.sink=null`) |
| `attacher` | `Attacher`: `java -jar agent-t-attacher.jar [--check] <pid> [<agentJar> [args]]`. 종료코드 0 성공 / 2 전제조건 불충족(`PRECHECK:<reason>` 한 줄) / 1 기타. reason: `no_tools_jar` `attach_disabled` `dynamic_loading_disabled` `not_same_user` `tmpdir_not_writable` `jdk_too_old` `no_such_pid`. JDK 6~8 은 tools.jar 리플렉션, 9+ 는 jdk.attach. 대상 JVM 의 java 로 실행할 것 |

- ASM API 레벨은 빌드가 생성하는 `AsmApi.LEVEL`(legacy `ASM5`, modern `ASM9`) — instrument 소스는 ASM 5.2 에 있는 API 만 쓴다.
- 계측은 메서드 본문만 변경(필드·메서드 추가 금지). `jakarta.servlet` 은 별도 빌드 없이 같은 코드에서 함께 매칭.

## 규칙
- 코어는 Java 6 API 만 사용: 람다·diamond·try-with-resources·`java.util.Objects`·`Long.toUnsignedString` 금지.
- 런타임 의존성 0. JSON 은 `json/JsonWriter`, `json/JsonReader` 직접 구현.
- WAS 스레드(`Sender.offer*`)는 절대 블로킹·예외 전파 금지. 버퍼 8MB 초과 시 상세 → SQL 집계 → 트랜잭션 순 제거.
- 테스트는 `agentt.repo.root` 시스템 프로퍼티(build.sh 가 설정)로 `contracts/` 를 읽는다.
