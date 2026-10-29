# Agent-T 에이전트 아티팩트 (`main-server/artifacts/agent-t/`)

Agent-T(Java 트랜잭션 에이전트)의 배포용 jar 를 두는 디렉터리. **jar 와 `SHA256SUMS` 는 repo 에 커밋하지 않는다** (이 README 만 추적).
설계: `docs/superpowers/specs/2026-10-29-agent-t-design.md`, ADR-022.

## 필요한 파일

| 파일 | 용도 | 대상 JDK |
|---|---|---|
| `agent-t.jar` | modern 빌드 | JDK 8~21 |
| `agent-t-legacy.jar` | legacy 빌드 | JDK 1.6~1.7 |
| `agent-t-attacher.jar` | 실행 중 JVM 에 즉시 적용(Dynamic Attach) 하는 실행 jar | JDK 6~21 공용 |
| `SHA256SUMS` | 위 3개의 SHA256 (`sha256sum` 형식) | — |

설치 Job 이 대상 서버 JDK 버전을 판별해 `agent-t.jar` / `agent-t-legacy.jar` 중 하나를 자동 선택한다.

## 빌드 (인터넷 되는 빌드 서버, Docker 필요)

```bash
cd agent-t
./build.sh fetch               # ASM/JUnit 소스 다운로드 + SHA256 검증 + shading (최초 1회, 이후 매 빌드에서 검증)
./build.sh test-legacy test-modern
./build.sh jar                 # → agent-t/build/dist/{agent-t-legacy.jar, agent-t.jar, agent-t-attacher.jar, SHA256SUMS}
./build.sh install-artifacts   # → main-server/artifacts/agent-t/ 로 복사
```

컴파일은 항상 Docker(`azul/zulu-openjdk:7` / `eclipse-temurin:21-jdk`)에서 수행한다. 로컬 JDK 버전에 의존하지 않는다.

## admin-api 가 읽는 위치

- 컨테이너 안 경로는 환경변수 `AGENT_T_ARTIFACT_DIR`(기본 `/app/artifacts/agent-t`). 서버의 이 디렉터리를 해당 경로로 **읽기 전용 마운트**해야 한다.
- 설치 Job(`services/agent_t_installer.py`)이 jar 를 읽어 SFTP 로 대상 서버 설치 디렉터리에 올린다. `SHA256SUMS` 가 있으면 파일별로 대조하고, **불일치 시 설치 Job 이 실패**한다. 대상 서버에도 `SHA256SUMS` 를 함께 올려 둔다.
- jar 를 교체하면 이후 설치·재설치부터 새 jar 가 쓰인다(admin-api 재기동 불필요, 이미 설치된 서버는 재설치 시 갱신).

## 폐쇄망 반입

1. 인터넷 되는 빌드 서버에서 위 빌드를 수행해 `build/dist` 의 4개 파일을 확보한다. (`./build.sh fetch` 는 인터넷 필요 — 폐쇄망 안에서는 빌드하지 않는다.)
2. 4개 파일을 사내 승인된 반입 경로로 Server A 의 `main-server/artifacts/agent-t/` 에 복사한다.
3. 반입 후 서버에서 `sha256sum -c SHA256SUMS` 로 무결성을 확인한다.
4. Server A 방화벽에서 WAS 대역 → `:8330`(agent-t-gateway)을 허용하고, admin-api 의 `AGENT_T_GATEWAY_URL` 을 WAS 서버에서 접근 가능한 주소로 설정한다.

> JDK 가 tools.jar 없는 JRE 이거나 attach 가 비활성(`-XX:+DisableAttachMechanism`)인 서버는 즉시 적용이 불가하다. 이 경우 설치 Job 이 사유(`PRECHECK:*`)를 로그에 남기고 attach 를 건너뛰며, 영구 적용(기동 옵션 주입)만 하고 다음 WAS 재기동부터 적용된다.
