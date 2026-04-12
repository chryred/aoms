# aoms-agent — Claude 컨텍스트 가이드

## 목적

**단일 Rust 바이너리** 초경량 수집 에이전트.
타겟 서버(RHEL 8.9, glibc 2.28)에서 동작하는 `x86_64-unknown-linux-musl` static binary.

**설계 원칙**:
- 런타임 의존성 0 (musl static)
- CPU < 1%, RSS < 50MB
- 모든 데이터를 **Prometheus Remote Write**로만 전송 (Loki 불필요)
- 수집 항목별 on/off, 재기동 없이 설정 변경 적용

---

## 아키텍처 개요

```
타겟 서버
  └── agent (단일 바이너리)
        ├── [main loop / tokio async]  collect_interval_secs 마다 실행
        │     ├── metrics/cpu, memory, disk, network, process, tcp
        │     ├── log_counter.drain()       ← 백그라운드 스레드에서 집계
        │     ├── web_counter.drain()       ← 백그라운드 스레드에서 집계
        │     ├── heartbeat metrics
        │     ├── preprocessor (optional)
        │     └── writer: encode → snappy compress → Remote Write
        │
        ├── [OS threads] log tailers (파일당 1개)
        │     └── inotify 감시 → keyword match → LogCounter 업데이트
        │
        ├── [OS threads] web access log tailers (웹서버당 1개)
        │     └── inotify 감시 → 로그 파싱 → HttpCounter 업데이트
        │
        └── [OS thread] config file watcher
              └── config.toml 변경 감지 → 메인 루프에 새 Config 전달

메인 서버
  └── Prometheus (--web.enable-remote-write-receiver 필수)
```

---

## 디렉토리 구조

```
agent/
├── Cargo.toml
├── CLAUDE.md                  # 이 파일
├── config.example.toml        # 설정 예시
└── src/
    ├── main.rs                # 진입점 — 메인 루프, 핫 리로드, 타일러 생명주기
    ├── config.rs              # TOML 설정 구조체 (serde::Deserialize)
    ├── metrics/
    │   ├── mod.rs             # MetricSample 타입, base_labels() 헬퍼
    │   ├── cpu.rs             # /proc/stat — per-core cpu_usage_percent
    │   ├── memory.rs          # /proc/meminfo — memory_used_bytes
    │   ├── disk.rs            # /proc/diskstats — disk_bytes_total, disk_io_time_ms
    │   ├── network.rs         # /proc/net/dev → network_bytes_total + /proc/net/tcp → tcp_connections
    │   └── process.rs         # /proc/[pid]/stat+cmdline → services 매핑 → process_cpu_percent/memory_bytes
    ├── log_monitor/
    │   ├── mod.rs             # LogCounter (Arc<Mutex<HashMap>>)
    │   ├── tailer.rs          # inotify tail, 로테이션 재오픈, stop flag
    │   ├── matcher.rs         # AhoCorasick DFA 키워드 매칭
    │   └── template.rs        # PII 마스킹 + 카디널리티 억제 (200자 truncate)
    ├── web_monitor/
    │   ├── mod.rs             # HttpCounter (Arc<Mutex<HashMap>>)
    │   ├── access_log.rs      # inotify tail, 로테이션 재오픈, stop flag
    │   ├── url_normalizer.rs  # /users/123 → /users/{id}, UUID 정규화
    │   └── parser/
    │       ├── mod.rs         # LogParser trait, create_parser() factory
    │       ├── nginx_json.rs  # nginx JSON 포맷 ($request_time_ms)
    │       ├── combined.rs    # Apache/WebtOB Combined (%D μs 또는 %T s)
    │       └── clf.rs         # CLF 기본 포맷 (응답시간 없음)
    ├── writer/
    │   ├── mod.rs
    │   ├── encode.rs          # MetricSample → protobuf WriteRequest (수동 varint 인코딩, protoc 불필요)
    │   ├── compress.rs        # snappy 압축 (snap crate)
    │   ├── sender.rs          # HTTP POST, 3회 retry (500ms/1000ms 지수 백오프)
    │   └── wal.rs             # WAL — append/drain_pending/confirm_sent/gc
    └── preprocessor/
        ├── mod.rs
        ├── summarize.rs       # ring buffer → avg/p95 (1min/5min 윈도우)
        └── correlate.rs       # 메트릭 이상 ↔ 로그 에러 상관 → anomaly_correlation_total
```

---

## 핵심 타입

### `MetricSample` (`metrics/mod.rs`)
```rust
pub struct MetricSample {
    pub name: String,
    pub labels: Vec<(String, String)>,
    pub value: f64,
    pub timestamp_ms: i64,
}
```
모든 수집기가 이 타입으로 반환. `encode.rs`가 protobuf WriteRequest로 변환.

### `Config` (`config.rs`)
```toml
[agent]       # system_name, display_name, instance_role (HA 식별자: was1/was2 등), host, collect_interval_secs
[remote_write] # endpoint, wal_dir, wal_retention_hours, timeout_secs
[collectors]  # cpu/memory/disk/network/process/tcp_connections/log_monitor/web_servers/preprocessor/heartbeat
[[log_monitor]] # paths (glob 지원), keywords, log_type  ← Vec: 여러 섹션으로 다중 log_type 지원
[[services]]  # name, display_name, process_match (cmdline 매칭)
[[web_servers]] # name, display_name, type, log_path, log_format, was_services, slow_threshold_ms
[preprocessor] # summary_intervals_secs, corr_window_secs, cpu_threshold, memory_threshold
```

### `LogCounter` (`log_monitor/mod.rs`)
- `Arc<Mutex<HashMap<(level, template, service_name), count>>>`
- 타일러 OS 스레드 → `increment()` → 메인 루프 → `drain_as_samples()` → `log_error_total` 메트릭

### `HttpCounter` (`web_monitor/mod.rs`)
- `Arc<Mutex<HashMap<(url_pattern, url_pattern_display, method, status_code, was_service), (count, slow_count, total_duration_ms)>>>`
- 타일러 OS 스레드 → `record()` → 메인 루프 → `drain_as_samples()` → `http_request_total`, `http_request_duration_ms`, `http_request_slow_total`

---

## 수집 메트릭 목록

```
# 시스템 메트릭
cpu_usage_percent{system_name, display_name, instance_role, host, core}
cpu_load_avg{..., interval}              # 1m/5m/15m
memory_used_bytes{..., type}             # used|cached|swap
disk_bytes_total{..., device, direction} # read|write
disk_io_time_ms{..., device}
network_bytes_total{..., interface, direction}
network_errors_total{..., interface, direction}
tcp_connections{..., port, state}        # ESTABLISHED|TIME_WAIT|CLOSE_WAIT

# 프로세스 → 서비스 상관관계
process_cpu_percent{..., process, service_name, service_display}
process_memory_bytes{..., process, service_name, service_display}

# 로그 에러 (log_monitor)
log_error_total{..., log_type, level, service_name, template}

# HTTP 트래픽 (web_monitor)
http_request_total{..., web_server, url_pattern, method, status_code, was_service}
http_request_duration_ms{...}            # 수집 주기별 평균
http_request_slow_total{..., web_server, url_pattern, url_pattern_display}

# 에이전트 생존 (Frontend live-status용)
agent_up{..., version}
agent_heartbeat{..., version, collector} # collector=cpu|memory|disk|...|web

# 전처리기 (preprocessor=true 시에만)
{metric_name}_avg{..., window}           # e.g. cpu_usage_percent_avg{window="60s"}
{metric_name}_p95{..., window}
anomaly_correlation_total{..., metric_name, log_errors_in_window, corr_type}
```

---

## 로그 로테이션 처리

**문제**: JEUS 등에서 `JeusServer.log` → `JeusServer_20260409.log` 로테이션 시
파일 직접 감시(`watch file`)이면 이벤트 끊김.

**구현** (`tailer.rs`, `access_log.rs` 동일):
- **부모 디렉토리**를 `RecursiveMode::NonRecursive`로 감시
- 이벤트 필터: `event.paths.iter().any(|p| p == &target_path)`
- `EventKind::Create` → 파일 re-open (처음부터 읽기, `SeekFrom::Start(0)`)
- `EventKind::Modify` → 새 라인 읽기 (파일 포인터 유지)
- `EventKind::Remove` → 파일 포인터 해제, recreate 대기
- `recv_timeout(1s)` 루프로 `stop` AtomicBool 체크 (shutdown 가능)

**glob 지원**: `main.rs::expand_glob()` — `*`, `?`, `[` 포함 시 `glob::glob()` 확장,
아니면 literal 경로 그대로 사용. 매칭 파일당 별도 스레드 스폰.

---

## WAL (Write-Ahead Log)

**파일 위치**: `wal_dir/wal-{hour_timestamp}.bin` (시간 단위 세그먼트)

**바이너리 포맷**: `[8B timestamp_ms BE][4B len BE][len bytes snappy data]`

**흐름**:
```
Remote Write 실패 → wal.append(payload)     # 현재 시간 세그먼트에 추가

기동 시  → replay_wal()
          → wal.drain_pending()             # 모든 세그먼트 읽기
          → sender.send(each payload)
          → wal.confirm_sent(paths)         # 성공 시 세그먼트 파일 삭제

런타임  → WAL_RETRY_CYCLES(4) 마다 has_pending() 체크
         → pending 있으면 replay_wal() 재시도    # 네트워크 복구 시 자동 재전송

GC      → 매 1h — wal_retention_hours 초과 세그먼트 삭제
```

**중요**: `drain_pending()` 은 읽기만 한다. `confirm_sent()` 호출 후에만 삭제.
전송 실패 시 세그먼트 유지 → 다음 retry 시 재전송.

---

## 핫 리로드

**동작 방식**:
1. OS 스레드가 `config.toml`을 `notify`로 감시 (`watch_config_file()`)
2. `Modify` 이벤트 → 200ms 대기 (파일 쓰기 완료 보장) → `Config::load()` → `mpsc::Sender<Config>` 전송
3. 메인 루프 tick마다 `reload_rx.try_recv()` → 새 Config 수신 시 즉시 적용

**적용 항목**:

| 변경 | 적용 시점 |
|---|---|
| `collectors.cpu = false` | 다음 tick |
| `collectors.preprocessor` toggle | 다음 tick (Summarizer/Correlator 재생성) |
| `log_monitor.paths` 경로 추가 | 즉시 새 타일러 스폰 |
| `log_monitor.paths` 경로 제거 | 해당 타일러 stop AtomicBool=true |
| `web_servers` 추가/제거 | 동일 — 스폰/stop |
| `collectors.log_monitor = false` | 모든 로그 타일러 stop |

**타일러 추적**: `HashMap<String, Arc<AtomicBool>>` — path → stop flag
- 타일러 내부: `recv_timeout(1s)` 루프, 매 timeout마다 `stop.load(Relaxed)` 확인

---

## Protobuf 인코딩 (`writer/encode.rs`)

`protoc` 없이 수동 varint 인코딩. Prometheus Remote Write 규격:
- `WriteRequest { timeseries: Vec<TimeSeries> }`
- `TimeSeries { labels: Vec<Label>, samples: Vec<Sample> }`
- `Label { name, value }` — **알파벳순 정렬 필수** (`__name__` 포함)
- `Sample { value: f64, timestamp: i64 }`
- Wire type: 2(len-delimited) for messages/strings, 1(64-bit) for f64, 0(varint) for i64

---

## URL 정규화 (`web_monitor/url_normalizer.rs`)

경로를 세그먼트 단위로 분리하여 가변 부분을 `{id}`/`{uuid}`로 치환.
- 숫자: `^\d+$` → `{id}`
- UUID: `^[0-9a-fA-F]{8}-...$` → `{uuid}`
- 최대 5 depth 이후 생략
- 쿼리스트링 제거

---

## PII 마스킹 (`log_monitor/template.rs`)

OnceLock regex — 매칭 순서:
1. IPv4 주소 → `[IP]`
2. UUID → `[UUID]`
3. 이메일 → `[EMAIL]`
4. 주민번호 (6-7자리) → `[JUMIN]`
5. 카드번호 (13-16자리) → `[CARD]`
6. 전화번호 → `[PHONE]`
7. 5자리 이상 숫자 → `[NUM]`
8. 200자 truncate (Prometheus label 크기 제한)

---

## 빌드

```bash
# 개발/테스트 (macOS)
cargo test
cargo build

# 운영 배포 (Linux musl static)
cargo build --release --target x86_64-unknown-linux-musl
# → target/x86_64-unknown-linux-musl/release/agent
```

**주요 의존성**:
- `tokio` — async 런타임 (메인 루프)
- `notify 6.x` — inotify 파일 감시
- `aho-corasick` — DFA 키워드 매칭
- `snap` — snappy 압축
- `regex` — URL 정규화, PII 마스킹
- `glob` — 로그 경로 glob 확장
- `procfs` (Linux only) — /proc 파싱
- `reqwest (rustls)` — Prometheus Remote Write HTTP 클라이언트

---

## 설정 파일 예시 (`config.example.toml`)

```toml
[agent]
system_name    = "crm"
display_name   = "고객관리시스템"
instance_role  = "web"
host           = "192.168.x.x"
collect_interval_secs = 15

[remote_write]
endpoint          = "http://<main-server>:9090/api/v1/write"
wal_dir           = "/var/lib/aoms-agent/wal"
wal_retention_hours = 2

[collectors]
cpu              = true
memory           = true
disk             = true
network          = true
process          = true
tcp_connections  = true
log_monitor      = true
web_servers      = true
preprocessor     = false   # LLM 전처리 — 기본 OFF
heartbeat        = true

[log_monitor]
paths    = ["/var/log/messages", "/jeus/logs/JeusServer.log"]
keywords = ["ERROR", "CRITICAL", "PANIC", "Fatal", "Exception"]
log_type = "app"

[[services]]
name          = "jeus-was1"
display_name  = "업무서버-1"
process_match = "was1"    # /proc/[pid]/cmdline 포함 문자열

[[web_servers]]
name             = "nginx-main"
display_name     = "메인 웹서버"
type             = "nginx"           # nginx | apache | webtob
log_path         = "/var/log/nginx/access.log"
log_format       = "nginx_json"      # nginx_json | combined | clf
was_services     = ["jeus-was1"]
slow_threshold_ms = 2000
url_patterns     = [
  { pattern = "/api/customers", display = "고객조회" },
]

[preprocessor]
summary_intervals_secs = [60, 300]
corr_window_secs       = 300
cpu_threshold          = 80.0
memory_threshold       = 85.0
log_error_min          = 1.0
```

---

## 운영 연동

### Prometheus 설정
`docker-compose.yml`과 `docker-compose.dev.yml` 모두에 추가되어 있음:
```yaml
command:
  - '--web.enable-remote-write-receiver'   # agent Remote Write 수신 필수
```

### admin-api 연동
- `GET /api/v1/agents/{id}/live-status` — `agent_up{system_name, host}` 쿼리 → `AgentLiveStatusOut` 반환
- `POST /api/v1/agents/install` (synapse_agent 타입) — `config.toml` 자동 생성 후 SFTP 업로드
- `PROMETHEUS_URL` 환경변수 설정 시 `prometheus_analyzer.py`가 CPU/HTTP/로그 이상 자동 감지

### frontend 연동
- `AgentDetailPage.tsx` — `synapse_agent` 타입 선택 시 "수집 상태 (Prometheus)" 카드 표시
  - `agent_up` last_seen 기준 live_status: `collecting`(<30s) / `delayed`(<90s) / `stale` / `no_data`
  - `agent_heartbeat{collector=...}` 기준 활성 수집기 뱃지

---

## Claude 작업 규칙

### 실수 방지 목록

- **protoc 없음**: `encode.rs`는 수동 varint. prost/prost-build 추가 금지.
- **regex lookahead 없음**: Rust `regex` crate는 lookahead/lookbehind 미지원. 세그먼트 단위 처리로 우회.
- **타일러 감시 대상**: 파일이 아닌 **부모 디렉토리**. `watch(file_path)` 아닌 `watch(parent_dir)`.
- **WAL confirm_sent 호출**: `drain_pending()` 후 전송 성공 확인 후에만 `confirm_sent()` 호출.
- **설정 변경 적용 범위**: `collectors.*` 토글은 메인 루프에서 처리. 타일러 추가/제거는 `reconcile_*_tailers()` 함수에서.
- **메트릭명 prefix**: `aoms_` prefix 없음. `cpu_usage_percent`, `log_error_total` 등 직관적 이름 그대로.
- **labels 공통 구조**: 항상 `system_name`, `display_name`, `instance_role`, `host` 포함. `base_labels()` 헬퍼 사용.
