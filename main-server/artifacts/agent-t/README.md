# Agent-T 에이전트 아티팩트 (`main-server/artifacts/agent-t/`)

Agent-T(Java 트랜잭션 에이전트)의 배포용 jar 를 두는 **admin-api 이미지 빌드 입력 디렉터리**. agent-v 와 같이 jar 는 admin-api 이미지 안(`/app/artifacts/agent-t/`)에 포함되어 배포된다. **jar 와 `SHA256SUMS` 는 repo 에 커밋하지 않는다** (이 README 만 추적).
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
cd .. && ./build-images.sh     # admin-api 이미지에 jar 포함 (4개 파일 존재·SHA256SUMS 일치를 먼저 확인, 없으면 빌드 중단)
```

컴파일은 항상 Docker(`azul/zulu-openjdk:7` / `eclipse-temurin:21-jdk`)에서 수행한다. 로컬 JDK 버전에 의존하지 않는다.

## admin-api 가 읽는 위치

- 컨테이너 안 경로는 환경변수 `AGENT_T_ARTIFACT_DIR`(기본 `/app/artifacts/agent-t`). Dockerfile 이 이 디렉터리의 4개 파일을 해당 경로로 COPY 한다(마운트 없음).
- 설치 Job(`services/agent_t_installer.py`)이 jar 를 읽어 SFTP 로 대상 서버 설치 디렉터리에 올린다. `SHA256SUMS` 가 있으면 파일별로 대조하고, **불일치 시 설치 Job 이 실패**한다. 대상 서버에도 `SHA256SUMS` 를 함께 올려 둔다.
- jar 를 교체하려면 admin-api 이미지를 다시 빌드·반입·재기동한다(agent-v 와 동일). 이미 설치된 서버는 재설치 시 새 jar 로 갱신된다.
- 로컬 개발(`make run-api`)은 이 디렉터리를 직접 읽는다(`AGENT_T_ARTIFACT_DIR` 를 Makefile 이 지정).

## 폐쇄망 반입

1. 인터넷 되는 빌드 서버에서 위 빌드(`jar` → `install-artifacts` → `build-images.sh`)를 수행한다. (`./build.sh fetch` 는 인터넷 필요 — 폐쇄망 안에서는 빌드하지 않는다.)
2. 생성된 `synapse-admin-api-1.0.tar.gz` 를 다른 이미지와 같이 Server A 로 반입해 `docker load` 한다. jar 를 따로 반입하지 않는다.
3. Server A 방화벽에서 WAS 대역 → `:8330`(agent-t-gateway)을 허용하고, admin-api 의 `AGENT_T_GATEWAY_URL` 을 WAS 서버에서 접근 가능한 주소로 설정한다.

> JDK 가 tools.jar 없는 JRE 이거나 attach 가 비활성(`-XX:+DisableAttachMechanism`)인 서버는 즉시 적용이 불가하다. 이 경우 설치 Job 이 사유(`PRECHECK:*`)를 로그에 남기고 attach 를 건너뛰며, 영구 적용(기동 옵션 주입)만 하고 다음 WAS 재기동부터 적용된다.
