# agent-t — Synapse-V Java 트랜잭션 에이전트 (JDK 1.6~21)

설계: `docs/superpowers/specs/2026-10-29-agent-t-design.md`, 전송 계약: `contracts/agent-t/protocol.md`.

## 빌드 (`build.sh`, javac 직접 호출, Gradle/Maven 없음, 컴파일은 항상 Docker)
| 타깃 | 내용 |
|---|---|
| `fetch` | ASM 5.2/9.7 소스, JUnit 4.13.2, hamcrest 1.3 다운로드 → `third_party/versions.properties` SHA256 검증(매 실행) → ASM 패키지를 `com.synapsev.agentt.shaded.asm` 으로 sed 이동 → `third_party/src/` (gitignore) |
| `test-legacy` | `azul/zulu-openjdk:7`(`--platform linux/amd64`), `-source/-target 1.6`, ASM 5.2 |
| `test-modern` | `eclipse-temurin:21-jdk`, `--release 8`, ASM 9.7 |
| `jar` | `build/dist/{agent-t-legacy.jar, agent-t.jar, agent-t-attacher.jar, SHA256SUMS}` (attacher 는 G4 전까지 빈 main 자리표시) |
| `install-artifacts` | `build/dist` → `main-server/artifacts/agent-t/` |

## 규칙
- 코어는 Java 6 API 만 사용: 람다·diamond·try-with-resources·`java.util.Objects`·`Long.toUnsignedString` 금지.
- 런타임 의존성 0. JSON 은 `json/JsonWriter`, `json/JsonReader` 직접 구현.
- WAS 스레드(`Sender.offer*`)는 절대 블로킹·예외 전파 금지. 버퍼 8MB 초과 시 상세 → SQL 집계 → 트랜잭션 순 제거.
- 테스트는 `agentt.repo.root` 시스템 프로퍼티(build.sh 가 설정)로 `contracts/` 를 읽는다.
