# Synapse-V 아키텍처 설계서

> **문서 버전**: v1.2
> **작성일**: 2026-03-08
> **상태**: 설계 검토 단계
> **기반 문서**: [요구사항 명세서](./requirements-specification.md)
> **변경 이력**:
> - v1.1 - Ollama 제거 → 내부 LLM API 연동, 서버 사양 최적화 (4Core/10GB/50GB)
> - v1.2 - Promtail → Grafana Alloy 교체 (glibc 2.34+ 의존성 문제, RHEL 8.9 호환성 확보)

---

## 1. 아키텍처 방안 비교

### 방안 A: PLG 스택 (Prometheus + Loki + Grafana) — 추천

| 항목 | 내용 |
|------|------|
| **메트릭** | Prometheus (Pull 모델, 30초 주기) |
| **로그** | Grafana Alloy → Loki |
| **대시보드** | Grafana (통합) |
| **알림** | Alertmanager + Grafana Alerting |

**장점**:
- Docker Compose로 **단일 서버 배포** 가능
- 리소스 소모 적음 (13개 시스템 규모에 최적)
- Grafana 하나로 메트릭 + 로그 통합 시각화
- Linux/Windows exporter 모두 공식 지원
- 커뮤니티 거대, 문서 풍부

**단점**:
- Loki의 로그 검색이 Elasticsearch보다 제한적
- 복잡한 로그 파싱에 추가 설정 필요

### 방안 B: Prometheus + ELK 스택

| 항목 | 내용 |
|------|------|
| **메트릭** | Prometheus |
| **로그** | Filebeat → Logstash → Elasticsearch |
| **대시보드** | Grafana (메트릭) + Kibana (로그) |
| **알림** | Alertmanager + ElastAlert |

**장점**: 로그 풀텍스트 검색/집계 강력
**단점**: Elasticsearch 최소 4GB RAM → **현재 서버 사양(10GB)에서는 ELK 단독으로 메모리 부족**, 대시보드 이원화, 관리 복잡도 높음

### 방안 C: Zabbix 올인원

| 항목 | 내용 |
|------|------|
| **전체** | Zabbix Server + Agent |

**장점**: 단일 도구로 메트릭+로그+알림, Windows 지원 우수
**단점**: LLM 연동 어려움, 현대적 시각화 부족, 학습 곡선 높음

### 결론

> **방안 A (PLG 스택)를 채택**합니다.
> Docker 기반 간단 설계 요구에 가장 부합하며, 제한된 서버 사양(4Core/10GB/50GB)에서 운영 가능한 유일한 방안입니다. LLM은 별도 내부 API를 호출하므로 모니터링 서버의 부담이 최소화됩니다.

---

## 2. 전체 시스템 아키텍처

### 2.1 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        대상 시스템 (13개 서버)                                │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │ Linux Server        │  │ Windows Server      │  │ DB Server           │  │
│  │                     │  │                     │  │                     │  │
│  │ ◆ node_exporter     │  │ ◆ windows_exporter  │  │ ◆ node/win_exporter │  │
│  │   (시스템 메트릭)    │  │   (시스템 메트릭)    │  │   (시스템 메트릭)    │  │
│  │ ◆ jmx_exporter      │  │ ◆ jmx_exporter      │  │ ◆ db_exporter       │  │
│  │   (JVM/Tomcat)      │  │   (JVM/Tomcat)      │  │   (Oracle/PG/MSSQL) │  │
│  │ ◆ nginx_exporter    │  │                     │  │                     │  │
│  │   (웹서버 메트릭)    │  │                     │  │                     │  │
│  │ ◆ alloy             │  │ ◆ alloy             │  │ ◆ alloy             │  │
│  │   (로그 수집)        │  │   (로그 수집)        │  │   (로그 수집)        │  │
│  └──────┬──────────────┘  └──────┬──────────────┘  └──────┬──────────────┘  │
│         │ :9100/:9404/:9113      │ :9182/:9404            │ :9100/:9xxx     │
└─────────┼────────────────────────┼────────────────────────┼─────────────────┘
          │                        │                        │
          │      ◄── metrics pull (Prometheus, 30s) ──►     │
          │      ──► log push (Grafana Alloy → Loki) ──►    │
          │                        │                        │
┌─────────▼────────────────────────▼────────────────────────▼─────────────────┐
│              모니터링 서버 (Docker Compose) — 4Core / 10GB / 50GB            │
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────────┐   │
│  │ Prometheus   │───►│ Alertmanager │───►│ Notification Router          │   │
│  │ :9090        │    │ :9093        │    │ (Admin API의 webhook 수신)    │   │
│  │              │    └──────────────┘    └──────────┬───────────────────┘   │
│  │ - 30s scrape │                                   │                      │
│  │ - 15d retain │                                   ▼                      │
│  │ - alert rules│                        ┌──────────────────┐              │
│  └──────┬───────┘                        │ Admin API        │              │
│         │                                │ :8080            │              │
│         │                                │                  │              │
│  ┌──────▼───────┐                        │ - 담당자 관리     │              │
│  │ Grafana      │                        │ - 시스템 설정     │              │
│  │ :3000        │                        │ - 알림 라우팅     │              │
│  │              │                        │ - 알림 이력       │              │
│  │ - 대시보드    │                        └────────┬─────────┘              │
│  │ - 통합 시각화 │                                 │                        │
│  │ - 드릴다운    │                                 ▼                        │
│  └──────┬───────┘                        ┌──────────────────┐              │
│         │                                │ PostgreSQL       │              │
│  ┌──────▼───────┐                        │ :5432            │              │
│  │ Loki         │                        │                  │              │
│  │ :3100        │                        │ - 시스템 정보     │              │
│  │              │◄──── 로그 쿼리 ────────│ - 담당자 매핑     │              │
│  │ - 5d retain  │                        │ - 알림 이력       │              │
│  │ - label index│    ┌──────────────┐    │ - 분석 결과       │              │
│  │ - gzip 압축  │    │ Log Analyzer │    └──────────────────┘              │
│  └──────────────┘    │ :8000        │                                      │
│                      │              │                                      │
│                      │ - 5분 크론    │──── HTTP ────► ┌──────────────────┐  │
│                      │ - 프리필터    │◄── REST ──────  │ 내부 LLM API     │  │
│                      │ - LLM 분석   │                 │ (외부 서버)       │  │
│                      │ - 알림 발송   │                 └──────────────────┘  │
│                      └──────────────┘                   (모니터링 서버 외부)  │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                 ┌────────────────────────┐
                 │   알림 수신 채널        │
                 │                        │
                 │  ◆ Slack / Teams       │
                 │  ◆ Webhook (커스텀)    │
                 └────────────────────────┘
```

### 2.2 컴포넌트 요약 (7개 서비스)

| 컴포넌트 | 역할 | 포트 | Docker 이미지 | 메모리 제한 |
|----------|------|------|---------------|------------|
| **Prometheus** | 메트릭 수집/저장/알림 규칙 | 9090 | `prom/prometheus` | 2.5GB |
| **Alertmanager** | 알림 라우팅/그룹핑/쿨다운 | 9093 | `prom/alertmanager` | 128MB |
| **Loki** | 로그 저장소 | 3100 | `grafana/loki` | 1.5GB |
| **Grafana** | 통합 대시보드 | 3000 | `grafana/grafana` | 512MB |
| **Log Analyzer** | LLM 로그 분석 서비스 | 8000 | 커스텀 빌드 | 256MB |
| **Admin API** | 담당자/설정 관리 | 8080 | 커스텀 빌드 | 256MB |
| **PostgreSQL** | 관리 데이터 저장 | 5432 | `postgres:16-alpine` | 512MB |

> **참고**: Ollama는 사용하지 않습니다. LLM 분석은 내부 LLM API를 HTTP로 호출합니다.

---

## 3. 기술 스택 상세

### 3.1 메트릭 수집 — Exporter 매핑

| 대상 | Exporter | 수집 항목 |
|------|----------|-----------|
| Linux 서버 | `node_exporter` | CPU, Memory, Disk, Network I/O, Disk I/O, Uptime, Process, TCP |
| Windows 서버 | `windows_exporter` | CPU, Memory, Disk, Network I/O, Service 상태, IIS (해당 시) |
| Java/Tomcat | `jmx_exporter` | JVM 힙, GC, 스레드, Tomcat 스레드풀/세션/요청 |
| Nginx | `nginx-prometheus-exporter` | 활성 연결, 요청률, 응답 상태 |
| Apache | `apache_exporter` | 워커 상태, 요청률, 바이트 전송 |
| Oracle DB | `oracledb_exporter` | 커넥션, 테이블스페이스, 세션, Wait 이벤트 |
| PostgreSQL | `postgres_exporter` | 커넥션, 슬로우 쿼리, Lock, Replication |
| MSSQL | `sql_exporter` | 커넥션, 배치 요청, Lock, 버퍼 캐시 |

### 3.2 로그 수집 — Grafana Alloy 구성

> **변경 이유**: Promtail v3.x는 glibc 2.34+를 요구하나 대상 서버(RHEL 8.9)의 glibc 버전이 2.28이므로 실행 불가. Grafana Alloy(glibc 의존성 없음)로 대체.

```alloy
// Alloy 설정 예시 (각 대상 서버에 설치, River 언어)

// Loki 전송 설정
loki.write "default" {
  endpoint {
    url = "http://<monitoring-server>:3100/loki/api/v1/push"
    min_backoff_period  = "500ms"
    max_backoff_period  = "5m"
    max_backoff_retries = 10
  }
}

// 로그 파일 수집
local.file_match "app_logs" {
  path_targets = [{
    __path__      = "/app/logs/*.log",
    system_name   = "system-01",
    instance_role = "was1",
    host          = "server-hostname",
    log_type      = "application",
    job           = "app-logs",
  }]
}

loki.source.file "app_logs" {
  targets    = local.file_match.app_logs.targets
  forward_to = [loki.process.app_logs.receiver]
}

loki.process "app_logs" {
  // ERROR/WARN/FATAL 키워드만 필터링 (RE2 정규식)
  stage.regex { expression = "(?P<error_match>(?i)(error|warn|fatal|critical|exception|fail))" }
  stage.drop  { source = "error_match"; expression = "^$" }
  stage.label_drop { values = ["error_match"] }
  forward_to = [loki.write.default.receiver]
}
```

- **증분 수집**: Alloy 내부적으로 파일 위치 기록 (`--storage.path` 경로)
- **멀티 로그**: 컴포넌트 여러 개로 파일별 독립 파이프라인 구성
- **JEUS 로그**: ACL(`setfacl`)로 `alloy` 사용자에게 읽기 권한 부여 — 스크립트 자동 처리
- **설치 스크립트**: `install-agents.sh --type all|node|alloy|jmx` (폐쇄망 지원)

### 3.3 알림 엔진 — 이중 구조

```
┌──────────────────────────────────────────────────────────────────┐
│                        알림 처리 흐름                              │
│                                                                  │
│  [메트릭 알림]                     [LLM 분석 알림]                 │
│                                                                  │
│  Prometheus Alert Rules            Log Analyzer Service           │
│         │                                   │                    │
│         ▼                                   │                    │
│  Alertmanager                               │                    │
│  (그룹핑, 쿨다운)                            │                    │
│         │                                   │                    │
│         ▼                                   ▼                    │
│  ┌─────────────────────────────────────────────────┐             │
│  │          Admin API — Notification Router         │             │
│  │                                                  │             │
│  │  1. 알림 수신 (webhook)                          │             │
│  │  2. system_name으로 담당자 조회                    │             │
│  │  3. 담당자별 채널로 알림 발송                      │             │
│  │  4. 알림 이력 저장                                │             │
│  └─────────────┬─────────────┬──────────────────────┘             │
│                │             │                                    │
│                ▼             ▼                                    │
│          Slack/Teams    Webhook (커스텀)                           │
└──────────────────────────────────────────────────────────────────┘
```

**Alertmanager → Admin API 연동 방식**:
- Alertmanager의 webhook receiver를 Admin API 엔드포인트로 설정
- Admin API가 `system_name` 라벨로 담당자를 조회하여 동적 라우팅
- 담당자 변경 시 Alertmanager 재시작 없이 즉시 반영

### 3.4 LLM 로그 분석 — 내부 LLM API 연동

```
┌─────────────────────────────────────────────────────────────┐
│                  Log Analyzer 처리 흐름 (5분 주기)            │
│                                                             │
│  ① Loki API 호출                                            │
│     GET /loki/api/v1/query_range                            │
│     쿼리: {system_name=~".+"} |~ "ERROR|WARN|Exception"     │
│     범위: 최근 5분                                           │
│                                                             │
│  ② 프리필터링 (Pre-filter)                                   │
│     - 중복 로그 제거 (동일 메시지 해시)                        │
│     - 알려진 무시 패턴 제외 (설정 가능)                        │
│     - 로그 배치 그룹핑 (시스템별, 유형별)                      │
│                                                             │
│  ③ LLM 분석 (내부 LLM API 호출)                              │
│     POST http://<내부-LLM-API-URL>/v1/chat/completions      │
│     프롬프트:                                                │
│       "다음 로그를 분석하세요:                                 │
│        1. 에러 원인 추정                                      │
│        2. 심각도 (Critical/Warning/Info)                      │
│        3. 권장 조치"                                          │
│                                                             │
│     ※ 내부 LLM API는 모니터링 서버 외부에 위치               │
│     ※ OpenAI 호환 API 포맷 또는 커스텀 포맷 지원              │
│                                                             │
│  ④ 결과 처리                                                 │
│     - 심각도가 Warning 이상이면 알림 발송                      │
│     - Admin API를 통해 담당자 조회 → 알림 라우팅               │
│     - 분석 결과를 PostgreSQL에 저장                           │
│                                                             │
│  ⑤ 알림 메시지 포맷                                          │
│     ┌────────────────────────────────────┐                   │
│     │ [Critical] system-03 로그 이상      │                   │
│     │                                    │                   │
│     │ 시스템: POS-서비스                   │                   │
│     │ 시각: 2026-03-08 14:35:22          │                   │
│     │ 원본 로그: NullPointerException ... │                   │
│     │                                    │                   │
│     │ [LLM 분석 결과]                     │                   │
│     │ 원인: 주문 객체 null 참조            │                   │
│     │ 심각도: Critical                    │                   │
│     │ 권장 조치: OrderService.process()   │                   │
│     │         의 null 체크 추가 필요       │                   │
│     └────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 데이터 흐름 다이어그램

### 4.1 메트릭 수집 흐름

```
[대상 서버 Exporter]
        │
        │ HTTP GET /metrics (Pull, 30초 주기)
        │
        ▼
[Prometheus] ──► 시계열 DB 저장 (15일 보존)
        │
        │ Alert Rule 평가 (매 30초)
        │ 예: cpu_usage > 80% for 2m
        │
        ▼
[Alertmanager] ──► 그룹핑 (30초 대기)
        │           ──► 쿨다운 (5분 반복 방지)
        │
        │ Webhook POST
        ▼
[Admin API] ──► 담당자 조회 (system_name 기반)
        │
        │ 채널별 발송
        ├──► Slack API
        ├──► Teams Webhook
        └──► Custom Webhook
```

### 4.2 로그 수집 + LLM 분석 흐름

```
[대상 서버 로그 파일]
        │
        │ Tail (실시간, positions 기반 증분)
        │
        ▼
[Grafana Alloy] ──► 라벨 추가 (system_name, instance_role, host, log_type, level)
        │
        │ HTTP POST /loki/api/v1/push
        │
        ▼
[Loki] ──► 인덱스(라벨) + 청크(로그 본문) 저장 (5일 보존)
        │
        │ (5분 주기 폴링)
        │
        ▼
[Log Analyzer] ──► Loki API로 최근 5분 ERROR/WARN 조회
        │
        │ 프리필터 (중복 제거, 무시 패턴 제외)
        │
        ▼
[내부 LLM API] ──► LLM 분석 (원인 추정, 심각도 판단)
  (외부 서버)     ※ 모니터링 서버 리소스 미사용
        │
        │ 분석 결과
        ▼
[Admin API] ──► 담당자 조회 → 알림 발송
        │
        └──► PostgreSQL (분석 결과 이력 저장)
```

### 4.3 대시보드 시각화 흐름

```
[사용자 브라우저]
        │
        │ HTTPS :3000
        ▼
[Grafana] ──► Prometheus 쿼리 (PromQL) ──► 메트릭 차트
        │
        ├──► Loki 쿼리 (LogQL) ──► 로그 뷰어
        │
        ├──► Admin API 쿼리 ──► 알림 이력, 분석 결과
        │
        └──► 대시보드 렌더링
              ├── 전체 시스템 현황 (Overview)
              ├── 시스템별 상세 (Drill-down)
              ├── 알림 이력
              └── LLM 분석 결과
```

---

## 5. Prometheus Alert Rules 설계

```yaml
# alert_rules.yml
groups:
  - name: resource_alerts
    rules:
      # CPU 80% 이상 (2분 지속)
      - alert: HighCpuUsage
        expr: |
          (1 - avg by(instance, system_name) (rate(node_cpu_seconds_total{mode="idle"}[5m]))) * 100 > 80
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "CPU 사용률 80% 초과"
          description: "{{ $labels.system_name }} ({{ $labels.instance }}): CPU {{ $value | printf \"%.1f\" }}%"

      # CPU 90% 이상 (2분 지속) - Critical
      - alert: CriticalCpuUsage
        expr: |
          (1 - avg by(instance, system_name) (rate(node_cpu_seconds_total{mode="idle"}[5m]))) * 100 > 90
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "CPU 사용률 90% 초과 (위험)"
          description: "{{ $labels.system_name }} ({{ $labels.instance }}): CPU {{ $value | printf \"%.1f\" }}%"

      # Memory 80% 이상
      - alert: HighMemoryUsage
        expr: |
          (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100 > 80
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "메모리 사용률 80% 초과"
          description: "{{ $labels.system_name }} ({{ $labels.instance }}): Memory {{ $value | printf \"%.1f\" }}%"

      # Disk 80% 이상
      - alert: HighDiskUsage
        expr: |
          (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes) * 100 > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "디스크 사용률 80% 초과"
          description: "{{ $labels.system_name }} ({{ $labels.instance }}): Disk {{ $labels.mountpoint }} {{ $value | printf \"%.1f\" }}%"

  - name: service_alerts
    rules:
      # 프로세스 다운
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "서비스 다운 감지"
          description: "{{ $labels.system_name }} ({{ $labels.instance }}): Exporter 응답 없음"

      # Windows 서비스 - 동일 패턴, windows_exporter 메트릭 사용
      - alert: HighCpuUsageWindows
        expr: |
          100 - (avg by(instance, system_name) (rate(windows_cpu_time_total{mode="idle"}[5m]))) * 100 > 80
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "[Windows] CPU 사용률 80% 초과"
```

---

## 6. DB 스키마 설계 (PostgreSQL — Admin API용)

```sql
-- 시스템 정보
CREATE TABLE systems (
    id              SERIAL PRIMARY KEY,
    system_name     VARCHAR(100) UNIQUE NOT NULL,   -- Prometheus label과 동일
    display_name    VARCHAR(200) NOT NULL,           -- 표시명 (예: "POS-서비스")
    description     TEXT,
    host            VARCHAR(200) NOT NULL,           -- 호스트명/IP
    os_type         VARCHAR(20) NOT NULL,            -- 'linux' | 'windows'
    system_type     VARCHAR(50) NOT NULL,            -- 'web' | 'was' | 'db' | 'middleware'
    status          VARCHAR(20) DEFAULT 'active',    -- 'active' | 'inactive'
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- 담당자 정보
CREATE TABLE contacts (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(200),
    slack_id        VARCHAR(100),                    -- Slack mention용
    teams_email     VARCHAR(200),                    -- Teams 알림용
    webhook_url     TEXT,                            -- 옵션
    llm_api_key     VARCHAR(500),
    agent_code      VARCHAR(100),
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- 시스템-담당자 매핑
CREATE TABLE system_contacts (
    id              SERIAL PRIMARY KEY,
    system_id       INTEGER REFERENCES systems(id) ON DELETE CASCADE,
    contact_id      INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    role            VARCHAR(50) DEFAULT 'primary',   -- 'primary' | 'secondary'
    notify_channels VARCHAR(200) NOT NULL,            -- 'slack,webhook' (콤마 구분)
    UNIQUE(system_id, contact_id)
);

-- 알림 이력
CREATE TABLE alert_history (
    id              SERIAL PRIMARY KEY,
    system_id       INTEGER REFERENCES systems(id),
    alert_type      VARCHAR(50) NOT NULL,            -- 'metric' | 'log_analysis'
    severity        VARCHAR(20) NOT NULL,            -- 'info' | 'warning' | 'critical'
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    metric_name     VARCHAR(100),                    -- 메트릭 알림인 경우
    metric_value    FLOAT,
    notified_contacts TEXT,                          -- 알림 발송된 담당자 (JSON)
    acknowledged    BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMP,
    acknowledged_by VARCHAR(100),
    created_at      TIMESTAMP DEFAULT NOW()
);

-- LLM 분석 결과 이력
CREATE TABLE log_analysis_history (
    id              SERIAL PRIMARY KEY,
    system_id       INTEGER REFERENCES systems(id),
    log_content     TEXT NOT NULL,                    -- 원본 로그 (요약)
    analysis_result TEXT NOT NULL,                    -- LLM 분석 결과
    severity        VARCHAR(20) NOT NULL,            -- LLM이 판단한 심각도
    root_cause      TEXT,                            -- 원인 추정
    recommendation  TEXT,                            -- 권장 조치
    model_used      VARCHAR(100),                    -- 사용된 LLM 모델명
    processing_time FLOAT,                           -- 분석 소요 시간(초)
    alert_sent      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 알림 쿨다운 추적
CREATE TABLE alert_cooldown (
    id              SERIAL PRIMARY KEY,
    system_id       INTEGER REFERENCES systems(id),
    alert_key       VARCHAR(500) NOT NULL,           -- 알림 고유 키 (시스템+메트릭+상태)
    last_sent_at    TIMESTAMP NOT NULL,
    UNIQUE(system_id, alert_key)
);

-- 인덱스
CREATE INDEX idx_alert_history_system ON alert_history(system_id, created_at DESC);
CREATE INDEX idx_alert_history_created ON alert_history(created_at DESC);
CREATE INDEX idx_log_analysis_system ON log_analysis_history(system_id, created_at DESC);
CREATE INDEX idx_alert_cooldown_lookup ON alert_cooldown(system_id, alert_key);
```

---

## 7. Docker Compose 구성

```yaml
# docker-compose.yml

services:
  # ============================================
  # 메트릭 수집/저장
  # ============================================
  prometheus:
    image: prom/prometheus:v2.51.0
    container_name: aoms-prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./config/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - ./config/prometheus/alert_rules.yml:/etc/prometheus/alert_rules.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=15d'
      - '--storage.tsdb.retention.size=15GB'
      - '--web.enable-lifecycle'
    deploy:
      resources:
        limits:
          memory: 2560M
          cpus: '1.0'
    restart: unless-stopped
    networks:
      - aoms-network

  # ============================================
  # 알림 라우팅
  # ============================================
  alertmanager:
    image: prom/alertmanager:v0.27.0
    container_name: aoms-alertmanager
    ports:
      - "9093:9093"
    volumes:
      - ./config/alertmanager/alertmanager.yml:/etc/alertmanager/alertmanager.yml
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.2'
    restart: unless-stopped
    networks:
      - aoms-network

  # ============================================
  # 로그 저장소
  # ============================================
  loki:
    image: grafana/loki:3.0.0
    container_name: aoms-loki
    ports:
      - "3100:3100"
    volumes:
      - ./config/loki/loki-config.yml:/etc/loki/local-config.yaml
      - loki_data:/loki
    command: -config.file=/etc/loki/local-config.yaml
    deploy:
      resources:
        limits:
          memory: 1536M
          cpus: '0.5'
    restart: unless-stopped
    networks:
      - aoms-network

  # ============================================
  # 대시보드
  # ============================================
  grafana:
    image: grafana/grafana:10.4.0
    container_name: aoms-grafana
    ports:
      - "3000:3000"
    volumes:
      - ./config/grafana/provisioning:/etc/grafana/provisioning
      - ./config/grafana/dashboards:/var/lib/grafana/dashboards
      - grafana_data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-admin}
      - GF_USERS_ALLOW_SIGN_UP=false
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.3'
    depends_on:
      - prometheus
      - loki
    restart: unless-stopped
    networks:
      - aoms-network

  # ============================================
  # LLM 로그 분석 서비스 (내부 LLM API 호출)
  # ============================================
  log-analyzer:
    build: ./services/log-analyzer
    container_name: aoms-log-analyzer
    ports:
      - "8000:8000"
    environment:
      - LOKI_URL=http://loki:3100
      - LLM_API_URL=${LLM_API_URL}                  # 내부 LLM API 엔드포인트
      - LLM_API_KEY=${LLM_API_KEY:-}                 # API 키 (필요 시)
      - LLM_MODEL_NAME=${LLM_MODEL_NAME:-default}    # 사용할 모델명
      - ADMIN_API_URL=http://admin-api:8080
      - ANALYSIS_INTERVAL_SECONDS=300
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.3'
    depends_on:
      - loki
      - admin-api
    restart: unless-stopped
    networks:
      - aoms-network

  # ============================================
  # 관리 API
  # ============================================
  admin-api:
    build: ./services/admin-api
    container_name: aoms-admin-api
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgresql://aoms:${DB_PASSWORD:-aoms}@postgres:5432/aoms
      - SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL}
      - TEAMS_WEBHOOK_URL=${TEAMS_WEBHOOK_URL}
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.3'
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - aoms-network

  # ============================================
  # 관리 데이터 저장소
  # ============================================
  postgres:
    image: postgres:16-alpine
    container_name: aoms-postgres
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=aoms
      - POSTGRES_USER=aoms
      - POSTGRES_PASSWORD=${DB_PASSWORD:-aoms}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./config/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.3'
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U aoms"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - aoms-network

volumes:
  prometheus_data:
  loki_data:
  grafana_data:
  postgres_data:

networks:
  aoms-network:
    driver: bridge
```

### 환경 변수 (.env)

```bash
# .env
GRAFANA_ADMIN_PASSWORD=your-grafana-password
DB_PASSWORD=your-db-password

# 내부 LLM API 설정
LLM_API_URL=http://내부-llm-서버:포트/v1/chat/completions
LLM_API_KEY=                    # 필요 시 설정
LLM_MODEL_NAME=default          # 사용할 모델명

# 알림 채널
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
TEAMS_WEBHOOK_URL=https://outlook.office.com/webhook/xxx
```

---

## 8. 서버 사이징 — 최적화 적용

### 8.1 모니터링 서버 사양

| 항목 | 사양 |
|------|------|
| **CPU** | 4코어 |
| **RAM** | 10GB |
| **Disk** | 50GB |
| **OS** | Linux (Ubuntu 22.04+ 권장) |

### 8.2 컴포넌트별 리소스 할당 (Hard Limit)

| 컴포넌트 | CPU 제한 | RAM 제한 | Disk 예상 |
|----------|---------|---------|-----------|
| Prometheus | 1.0코어 | 2.5GB | ~10GB (15일, 30초 주기) |
| Loki | 0.5코어 | 1.5GB | ~8GB (5일, gzip 압축) |
| Grafana | 0.3코어 | 512MB | 500MB |
| Alertmanager | 0.2코어 | 128MB | 50MB |
| Log Analyzer | 0.3코어 | 256MB | 100MB |
| Admin API | 0.3코어 | 256MB | 100MB |
| PostgreSQL | 0.3코어 | 512MB | 2GB |
| OS + Docker | — | ~1.5GB | ~3GB |
| **합계** | **2.9코어** | **7.2GB** | **~24GB** |
| **여유** | **1.1코어 (27%)** | **2.8GB (28%)** | **~26GB (52%)** |

### 8.3 최적화 항목 (v1.0 대비 변경)

| 항목 | v1.0 (기존) | v1.1 (최적화) | 절약 효과 |
|------|-------------|---------------|-----------|
| Ollama | 8~12GB RAM | **제거** (내부 API 사용) | RAM 8~12GB 절약 |
| Prometheus 보존 | 30일 | **15일** | Disk ~50% 감소 |
| Prometheus scrape | 15초 | **30초** | CPU/Disk ~50% 감소 |
| Prometheus size limit | 없음 | **15GB** | Disk 초과 방지 |
| Loki 보존 | 7일 | **5일** | Disk ~30% 감소 |
| Loki 압축 | 기본 | **gzip** | Disk ~40% 감소 |
| 컨테이너 메모리 | 무제한 | **Hard Limit** | OOM 방지 |

### 8.4 대상 서버 에이전트 리소스

| 에이전트 | CPU | RAM |
|----------|-----|-----|
| node_exporter / windows_exporter | < 1% | ~20MB |
| alloy (Grafana Alloy) | < 1% | ~60MB |
| jmx_exporter | < 1% | ~50MB |
| DB exporter | < 1% | ~30MB |
| **총 에이전트 오버헤드** | **< 3%** | **< 150MB** |

### 8.5 디스크 모니터링 경고

> **중요**: 13개 시스템의 로그 양에 따라 실제 디스크 사용량이 달라집니다.
> 운영 시작 후 1~2주간 디스크 증가 추이를 확인하고, 필요 시 보존 기간을 추가 조정하세요.
> Prometheus의 `--storage.tsdb.retention.size=15GB` 설정으로 디스크 사용량이 15GB를 초과하면 자동으로 오래된 데이터를 삭제합니다.

---

## 9. 대시보드 설계

### 9.1 대시보드 구성

| 대시보드 | 설명 | 주요 패널 |
|----------|------|-----------|
| **System Overview** | 전체 시스템 현황 | 13개 시스템 상태 맵, 전체 알림 카운터 |
| **System Detail** | 시스템별 상세 (변수: system_name) | CPU/Memory/Disk 게이지, 네트워크, 프로세스 |
| **WAS Monitoring** | Java/Tomcat 모니터링 | JVM 힙, GC, 스레드풀, HTTP 응답시간 |
| **Database Monitoring** | DB 모니터링 | 커넥션, 슬로우 쿼리, Lock, 테이블스페이스 |
| **Web Server** | Nginx/Apache 모니터링 | 활성 연결, 요청률, 상태코드 |
| **Log Explorer** | 로그 검색/탐색 | Loki 로그 스트림, 필터링 |
| **Alert History** | 알림 이력 | 최근 알림 테이블, 알림 추이 그래프 |
| **LLM Analysis** | LLM 분석 결과 | 최근 분석 결과, 심각도별 분포 |

### 9.2 Overview 대시보드 레이아웃

```
┌─────────────────────────────────────────────────────────────────┐
│  Synapse-V - 백화점 통합 모니터링                     [정상]12 [경고]1 [위험]0 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─── system-01 ──┐ ┌─── system-02 ──┐ ┌─── system-03 ──┐     │
│  │ [정상]          │ │ [경고]          │ │ [정상]          │     │
│  │ CPU: 45%       │ │ CPU: 82%       │ │ CPU: 32%       │     │
│  │ MEM: 62%       │ │ MEM: 71%       │ │ MEM: 55%       │     │
│  │ DISK: 38%      │ │ DISK: 56%      │ │ DISK: 44%      │     │
│  └────────────────┘ └────────────────┘ └────────────────┘     │
│                                                                 │
│  ┌─── system-04 ──┐ ┌─── system-05 ──┐  ...                   │
│  │ [정상]          │ │ [정상]          │                        │
│  └────────────────┘ └────────────────┘                        │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  최근 알림                                                       │
│  ┌────────┬──────────┬─────────────────────┬──────────────────┐ │
│  │ 시각    │ 시스템    │ 내용                 │ 심각도           │ │
│  ├────────┼──────────┼─────────────────────┼──────────────────┤ │
│  │ 14:35  │ system-02│ CPU 82% 초과         │ Warning         │ │
│  │ 14:20  │ system-07│ LLM: DB Lock 감지    │ Critical        │ │
│  │ 13:50  │ system-01│ Disk I/O 지연         │ Warning         │ │
│  └────────┴──────────┴─────────────────────┴──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. 디렉토리 구조

```
aoms/
├── docker-compose.yml
├── .env                              # 환경 변수 (비밀번호, LLM API URL, Webhook URL 등)
├── .env.example
│
├── config/
│   ├── prometheus/
│   │   ├── prometheus.yml            # Prometheus 설정 (scrape targets, 30초 주기)
│   │   └── alert_rules.yml           # 알림 규칙
│   ├── alertmanager/
│   │   └── alertmanager.yml          # Alertmanager 설정 (라우팅, receiver)
│   ├── loki/
│   │   └── loki-config.yml           # Loki 설정 (5일 보존, gzip 압축)
│   ├── grafana/
│   │   ├── provisioning/
│   │   │   ├── datasources/
│   │   │   │   └── datasources.yml   # Prometheus + Loki 자동 등록
│   │   │   └── dashboards/
│   │   │       └── dashboards.yml    # 대시보드 프로비저닝
│   │   └── dashboards/
│   │       ├── overview.json         # 전체 현황 대시보드
│   │       ├── system-detail.json    # 시스템 상세 대시보드
│   │       ├── was-monitoring.json   # WAS 모니터링
│   │       ├── db-monitoring.json    # DB 모니터링
│   │       └── log-analysis.json     # LLM 분석 결과
│   ├── postgres/
│   │   └── init.sql                  # DB 초기화 스크립트
│   └── alloy/
│       └── alloy-template.alloy      # 대상 서버용 Alloy 설정 템플릿 (River 언어)
│
├── services/
│   ├── log-analyzer/
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   ├── main.py                   # FastAPI 앱 + 분석 스케줄러
│   │   ├── analyzer.py               # Loki 조회 → 내부 LLM API 호출 로직
│   │   └── notifier.py               # 알림 발송 로직
│   └── admin-api/
│       ├── Dockerfile
│       ├── requirements.txt
│       ├── main.py                   # FastAPI 앱
│       ├── models.py                 # SQLAlchemy 모델
│       ├── routes/
│       │   ├── systems.py            # 시스템 CRUD
│       │   ├── contacts.py           # 담당자 CRUD
│       │   ├── alerts.py             # 알림 webhook 수신 + 이력
│       │   └── analysis.py           # LLM 분석 결과 조회
│       └── services/
│           ├── notification.py       # Slack/Teams/Webhook 발송
│           └── cooldown.py           # 알림 쿨다운 관리
│
├── agents/                           # 대상 서버 설치용 에이전트 패키지
│   ├── linux/
│   │   ├── install-agents.sh         # 원클릭 설치 스크립트 (node/alloy/jmx)
│   │   ├── node_exporter/
│   │   ├── alloy/                    # Grafana Alloy (Promtail 대체, glibc 독립)
│   │   └── jmx_exporter/
│   └── windows/
│       ├── install.ps1               # PowerShell 설치 스크립트
│       ├── windows_exporter/
│       ├── alloy/                    # Grafana Alloy Windows 바이너리
│       └── jmx_exporter/
│
└── docs/
    ├── requirements-specification.md
    ├── architecture-design.md        # (이 문서)
    └── agent-install-guide.md        # 에이전트 설치 가이드
```

---

## 11. 구현 우선순위 (권장)

| Phase | 내용 |
|-------|------|
| **Phase 1** | **인프라 구성** |
| | Docker Compose 기본 구성 (Prometheus, Loki, Grafana, Alertmanager, PostgreSQL) |
| | 1~2개 시스템에 에이전트 설치 (파일럿) |
| | 기본 대시보드 구성 |
| **Phase 2** | **알림 체계** |
| | Alert Rules 설정 (CPU/Memory/Disk 80%) |
| | Admin API 개발 (담당자/시스템 관리) |
| | Alertmanager → Admin API → Slack/Teams 연동 |
| **Phase 3** | **전체 확장** |
| | 나머지 11개 시스템 에이전트 배포 |
| | DB/WAS/웹서버 Exporter 추가 |
| | 상세 대시보드 구성 |
| **Phase 4** | **LLM 분석** |
| | 내부 LLM API 연동 설정 |
| | Log Analyzer 서비스 개발 |
| | LLM 분석 알림 연동 |
| **Phase 5** | **고도화** |
| | 알림 에스컬레이션 정책 |
| | 대시보드 UI 개선 |
| | Self-monitoring 구성 |

---

## 12. 다음 단계

이 설계서가 승인되면:
1. **`/sc:implement`** → Phase 1부터 순차 구현
2. **`/sc:workflow`** → 상세 구현 워크플로우 수립

---

> **참고**: 이 문서는 아키텍처 설계서입니다. 구현 단계에서 세부 사항이 조정될 수 있습니다.
