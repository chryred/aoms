# OTel Java Agent — 폐쇄망 배포 가이드

## 이 디렉터리에 필요한 파일

```
artifacts/otel/
├── opentelemetry-javaagent-2.x.x.jar   ← JDK 11+ 권장 (이 파일 없으면 v1.33.x 사용)
├── opentelemetry-javaagent-1.33.x.jar   ← JDK 8 레거시용 (CVE 완화 필수)
├── SHA256SUMS                            ← 무결성 검증 체크섬
└── README.md                             ← 이 파일
```

> **JAR 파일은 repo에 포함되지 않습니다.** 폐쇄망 환경에서 아래 지침에 따라 수동 배치하세요.

---

## 버전 선정 근거

### v2.x 최신 (JDK 11+ 권장)
- CVE-2026-33701(RMI deserialization RCE) 패치 반영 (v2.26.1+)
- 공식 다운로드: `https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases`
- 파일명 패턴: `opentelemetry-javaagent-2.X.Y.jar`
- 이 디렉터리에 배치 시 파일명: `opentelemetry-javaagent-2.x.x.jar`

### v1.33.x (JDK 8 레거시, 완화 조치 필수)
- ❌ CVE-2026-33701 미패치 — JMX/RMI 원격 공격 경로 잔존
- 필수 완화 조치:
  1. `-Dotel.instrumentation.rmi.enabled=false` (admin-api install이 otel-env.sh에 자동 주입)
  2. 방화벽에서 JMX/RMI 원격 포트(1099, 9999) 차단
  3. 컴플라이언스 검토 시 "JDK 8 레거시 예외 승인" 문서화
- 공식 다운로드: `https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/tag/v1.33.5`
- 이 디렉터리에 배치 시 파일명: `opentelemetry-javaagent-1.33.x.jar`

---

## SHA256SUMS 생성 방법 (JAR 배치 후)

```bash
cd main-server/artifacts/otel/
sha256sum opentelemetry-javaagent-*.jar > SHA256SUMS
cat SHA256SUMS
```

admin-api install 라우트가 SFTP 업로드 후 타겟 서버에서 `sha256sum -c` 검증을 수행합니다.

---

## 설치 계정 (Important)

OTel Java Agent는 기본적으로 **WAS 기동 계정**으로 설치합니다 — `synapse-agent` 배포 원칙과 동일.
- 예: JEUS를 `jeussic` 계정으로 실행한다면 SSH 계정도 `jeussic` 사용
- 기본 설치 경로: `~/otel` (= `/home/<user>/otel`), admin-api가 `~`를 자동으로 SSH 홈 디렉토리로 치환
- **root SSH 금지** (특별한 이유 없는 한) — JEUS/WebtoB 로그가 `jeussic:jeussic 0640` 소유이므로 다른 계정으로는 권한 문제 발생

### 서비스 유형별 권한 요구사항

| service_type | 설치 계정 | 주입 대상 파일 | root 필요 |
|---|---|---|---|
| `tomcat` | Tomcat 기동 계정 | `$TOMCAT/bin/setenv.sh` | ❌ |
| `jboss` | JBoss 기동 계정 | `$JBOSS/bin/standalone.conf.d/otel.conf` | ❌ |
| `jeus` | JEUS 기동 계정 | `$JEUS/otel.sh` | ❌ |
| `standalone` | WAS 기동 계정 | `{install_dir}/otel-launch.sh` | ❌ |
| `systemd` | root | `/etc/systemd/system/*.service.d/otel.conf` | ✅ (비-root SSH 차단됨) |

→ systemd 시스템 유닛이 필요한 경우에만 root SSH 계정으로 등록. 그 외는 서비스 계정 사용.

---

## admin-api 컨테이너에 JAR 배치

운영 docker-compose에서 admin-api 서비스에 volumes 마운트가 필요합니다:

```yaml
admin-api:
  volumes:
    - ./artifacts/otel:/app/artifacts/otel:ro,z
```

환경변수로 경로를 지정합니다:
```env
OTEL_AGENT_V2_JAR=/app/artifacts/otel/opentelemetry-javaagent-2.x.x.jar
OTEL_AGENT_V1_JAR=/app/artifacts/otel/opentelemetry-javaagent-1.33.x.jar
```

---

## JDK 8 시스템 마이그레이션 로드맵

2026 3분기 내 모든 JDK 8 타겟을 JDK 11+로 업그레이드 후 v1.x 완전 제거가 목표입니다.
- admin-api UI에서 `agent_instances.label_info.jar_version`으로 현황 추적
- v1.x 사용 시스템을 0으로 줄인 후 이 파일에서 v1.33.x 항목 삭제

---

## CVE-2026-33701 완화 조치 검증

admin-api install 후 타겟 서버에서 확인:

```bash
# otel-env.sh에 RMI disable이 주입되었는지 확인
cat /opt/otel/otel-env.sh | grep RMI
# → export OTEL_INSTRUMENTATION_RMI_ENABLED='false'

# JMX/RMI 포트가 외부 노출되지 않는지 확인 (출력 없어야 함)
ss -tlnp | grep -E '1099|9999'
```
