# AOMS Agent 테스트 케이스 명세

> **작성 기준**: `aoms-agent` v0.1.0  
> **대상 환경**: x86_64-unknown-linux-musl (RHEL 8.9, Docker)  
> **실행 명령**: `cargo test` / `cargo test --target x86_64-unknown-linux-musl`

---

## 목차

1. [설정(Config) 로딩](#1-설정config-로딩)
2. [메트릭 수집기](#2-메트릭-수집기)
3. [로그 모니터 — PII 마스킹](#3-로그-모니터--pii-마스킹)
4. [로그 모니터 — 키워드 매칭](#4-로그-모니터--키워드-매칭)
5. [로그 모니터 — 파일 테일링](#5-로그-모니터--파일-테일링)
6. [웹서버 모니터 — 액세스 로그 파서](#6-웹서버-모니터--액세스-로그-파서)
7. [웹서버 모니터 — URL 정규화](#7-웹서버-모니터--url-정규화)
8. [Remote Write — 인코딩/압축/전송/WAL](#8-remote-write--인코딩압축전송wal)
9. [부하(Load) 테스트](#9-부하load-테스트)

---

## 1. 설정(Config) 로딩

> `src/config.rs` — TOML 파싱 및 핫리로드 검증

### 1-1. 정상 케이스

| # | 케이스명 | 입력 / 조건 | 기대 결과 |
|---|---------|-----------|---------|
| C-N-01 | 전체 필드 정상 로드 | `config.example.toml` 경로 제공 | `Config` 구조체 파싱 성공, `system_name = "crm"` 등 값 정확 |
| C-N-02 | 다중 `[[services]]` 로드 | services 3개 이상 | `Config.services.len() == 3` |
| C-N-03 | 다중 `[[web_servers]]` 로드 | web_servers 2개 | `Config.web_servers.len() == 2` |
| C-N-04 | `collect_interval_secs = 15` | 기본값 설정 | 타이머 15초 주기로 동작 |
| C-N-05 | 모든 `collectors.*` 활성화 | `cpu/memory/disk/network/process/log_monitor/web_servers/heartbeat = true` | 모든 수집기 활성 플래그 true |
| C-N-06 | `preprocessor = false` (기본) | `collectors.preprocessor = false` | Summarizer/Correlator 초기화 안 됨 |

### 1-2. 엣지 케이스

| # | 케이스명 | 입력 / 조건 | 기대 결과 |
|---|---------|-----------|---------|
| C-E-01 | `[[services]]` 빈 배열 | services 항목 없음 | 파싱 성공, `services = []` |
| C-E-02 | `[[web_servers]]` 빈 배열 | web_servers 항목 없음 | 파싱 성공, `web_servers = []` |
| C-E-03 | `collect_interval_secs = 1` | 최소값 1초 | 파싱 성공, 타이머 1초 주기 |
| C-E-04 | `collect_interval_secs = 3600` | 최대 현실값 | 파싱 성공, 1시간 주기 |
| C-E-05 | `wal_retention_hours = 0` | 보존 0시간 | 파싱 성공; gc() 즉시 전체 삭제 |
| C-E-06 | `top_process_count = 0` | 프로세스 0개 수집 | 파싱 성공, process collector 빈 결과 |
| C-E-07 | 선택 필드(`display_name`) 누락 | `display_name` 키 없음 | 기본값 또는 빈 문자열로 파싱 |
| C-E-08 | `url_patterns = []` 빈 배열 | 패턴 없는 web_server | 파싱 성공, 모든 URL → "other" |
| C-E-09 | 동일 `system_name` 중복 서비스 | services 2개가 같은 name | 파싱 성공 (중복 허용 여부 확인) |

### 1-3. 오류 케이스

| # | 케이스명 | 입력 / 조건 | 기대 결과 |
|---|---------|-----------|---------|
| C-F-01 | 파일 없음 | 존재하지 않는 경로 | `anyhow::Error` 반환, 프로세스 종료 |
| C-F-02 | 잘못된 TOML 문법 | `system_name = [` (닫히지 않은 배열) | 파싱 오류, 명확한 에러 메시지 출력 |
| C-F-03 | 타입 불일치 | `collect_interval_secs = "fifteen"` | 파싱 오류 반환 |
| C-F-04 | 필수 필드 누락 | `[agent]` 섹션 없음 | 파싱 오류 반환 |
| C-F-05 | `endpoint` URL 잘못된 형식 | `endpoint = "not-a-url"` | 파싱 성공, sender 초기화 시 오류 |
| C-F-06 | `wal_dir` 읽기 전용 경로 | `wal_dir = "/proc/no-write"` | WAL 디렉토리 생성 실패, 에러 로그 출력 |

### 1-4. 핫리로드 케이스

| # | 케이스명 | 입력 / 조건 | 기대 결과 |
|---|---------|-----------|---------|
| C-R-01 | `log_monitor.paths` 추가 | 파일 수정 후 새 경로 추가 | 200ms 후 새 tailer 스폰 |
| C-R-02 | `log_monitor.paths` 제거 | 기존 경로 삭제 | 해당 tailer stop 신호 전송 |
| C-R-03 | `web_servers` 새 항목 추가 | web_server 1개 추가 | 새 access log tailer 스폰 |
| C-R-04 | `collectors.preprocessor` 토글 | false → true | Summarizer/Correlator 재초기화 |
| C-R-05 | 잘못된 TOML로 수정 | 핫리로드 중 문법 오류 | 기존 설정 유지, warn 로그 출력 |
| C-R-06 | 짧은 연속 파일 수정 | 100ms 간격으로 10회 수정 | 마지막 유효 설정만 적용, 중간 파싱 생략 |

---

## 2. 메트릭 수집기

### 2-1. CPU (`src/metrics/cpu.rs`)

> `/proc/stat` 델타 기반 CPU 사용률 및 load average 검증

| # | 케이스명 | 입력 / 조건 | 기대 결과 |
|---|---------|-----------|---------|
| M-CPU-N-01 | 정상 델타 계산 | prev(user=100, idle=900) → curr(user=200, idle=1800) | `cpu_usage_percent{core="cpu0"} ≈ 9.09%` |
| M-CPU-N-02 | 멀티코어 전체 수집 | `/proc/stat` cpu0~cpu7 존재 | `cpu_usage_percent` 샘플 8개 반환 |
| M-CPU-N-03 | load average 수집 | `/proc/loadavg = "0.5 1.0 1.5 ..."` | `cpu_load_avg{interval="1m"}=0.5`, `5m=1.0`, `15m=1.5` |
| M-CPU-E-01 | 첫 수집 (이전 상태 없음) | OnceLock 초기화 전 | 빈 Vec 반환 (delta 계산 불가) |
| M-CPU-E-02 | 유휴 100% | idle=전체, 나머지=0 | `cpu_usage_percent = 0.0%` |
| M-CPU-E-03 | 모든 코어 100% | idle=0, user+system=전체 | `cpu_usage_percent = 100.0%` |
| M-CPU-E-04 | delta = 0 (수집 주기 너무 짧음) | 연속 2회 동일 값 | 0% 반환 (0으로 나누기 방지) |
| M-CPU-F-01 | `/proc/stat` 없음 | 파일 부재 | 빈 Vec 반환, warn 로그 |
| M-CPU-F-02 | `/proc/loadavg` 없음 | 파일 부재 | load avg 샘플 생략, 나머지 정상 |
| M-CPU-F-03 | `/proc/stat` 파싱 실패 | `cpu0 abc def` 비정상 포맷 | 해당 코어 생략, 나머지 정상 |

### 2-2. Memory (`src/metrics/memory.rs`)

> `/proc/meminfo` 파싱 및 계산 검증

| # | 케이스명 | 입력 / 조건 | 기대 결과 |
|---|---------|-----------|---------|
| M-MEM-N-01 | 정상 파싱 | `MemTotal=8GB, MemAvailable=4GB` | `memory_used_bytes{type="used"} = 4*1024^3` |
| M-MEM-N-02 | cached 수집 | `Cached=2GB` | `memory_used_bytes{type="cached"} = 2*1024^3` |
| M-MEM-N-03 | swap 사용 중 | `SwapTotal=4GB, SwapFree=2GB` | `memory_used_bytes{type="swap_used"} = 2*1024^3` |
| M-MEM-E-01 | swap 없음 | `SwapTotal=0, SwapFree=0` | `swap_used = 0`, 크래시 없음 |
| M-MEM-E-02 | MemAvailable = MemTotal | 완전 여유 | `used = 0` |
| M-MEM-E-03 | MemAvailable > MemTotal | 비정상값 | 음수 방지 (0 클램프 또는 warn 로그) |
| M-MEM-F-01 | `/proc/meminfo` 없음 | 파일 부재 | 빈 Vec 반환, warn 로그 |
| M-MEM-F-02 | 필수 키 누락 | `MemTotal` 라인 없음 | 해당 샘플 생략 또는 오류 처리 |

### 2-3. Disk (`src/metrics/disk.rs`)

> `/proc/diskstats` 파싱 및 파티션 필터링 검증

| # | 케이스명 | 입력 / 조건 | 기대 결과 |
|---|---------|-----------|---------|
| M-DISK-N-01 | 정상 읽기/쓰기 델타 | `sda` r_sectors 1000→2000 | `disk_bytes_total{device="sda",direction="read"} = 512*1000` |
| M-DISK-N-02 | I/O wait time 수집 | `sda` io_time_ms 100→500 | `disk_io_time_ms{device="sda"} = 400` |
| M-DISK-E-01 | 파티션 필터링 | `sda`, `sda1`, `sda2` 존재 | `sda`만 수집, `sda1`/`sda2` 제외 |
| M-DISK-E-02 | nvme 디바이스 | `nvme0n1`, `nvme0n1p1` | `nvme0n1`만 수집 |
| M-DISK-E-03 | 첫 수집 (이전 상태 없음) | OnceLock 초기화 전 | 빈 Vec 반환 |
| M-DISK-E-04 | 카운터 롤오버 | curr < prev (32bit 오버플로우) | 음수 방지 처리 확인 |
| M-DISK-F-01 | `/proc/diskstats` 없음 | 파일 부재 | 빈 Vec 반환, warn 로그 |

### 2-4. Network (`src/metrics/network.rs`)

> `/proc/net/dev`, `/proc/net/tcp` 파싱 검증

| # | 케이스명 | 입력 / 조건 | 기대 결과 |
|---|---------|-----------|---------|
| M-NET-N-01 | rx/tx bytes 정상 수집 | `eth0` rx 1000→2000 bytes | `network_bytes_total{interface="eth0",direction="rx"} = 1000` |
| M-NET-N-02 | rx/tx errors 수집 | `eth0` rx_errors 0→5 | `network_errors_total{interface="eth0",direction="rx"} = 5` |
| M-NET-N-03 | TCP ESTABLISHED 수집 | `/proc/net/tcp` ESTABLISHED 10개 | `tcp_connections{port="8080",state="ESTABLISHED"} = 10` |
| M-NET-N-04 | 포트별 TCP 상태 분류 | TIME_WAIT, CLOSE_WAIT 혼재 | 각 상태별 레이블로 분리 수집 |
| M-NET-E-01 | loopback(lo) 포함 여부 | `lo` 인터페이스 존재 | 설계에 따라 포함 또는 필터링 일관성 확인 |
| M-NET-E-02 | 가상 인터페이스 | `docker0`, `veth*` 존재 | 포함 여부 일관성 확인 |
| M-NET-E-03 | 첫 수집 (이전 상태 없음) | OnceLock 초기화 전 | 빈 Vec 반환 |
| M-NET-F-01 | `/proc/net/dev` 없음 | 파일 부재 | 빈 Vec 반환, warn 로그 |
| M-NET-F-02 | `/proc/net/tcp` 없음 | 파일 부재 | TCP 샘플 생략, warn 로그 |

### 2-5. Process (`src/metrics/process.rs`)

> `/proc/[pid]/stat`, `/proc/[pid]/cmdline` 서비스 매핑 검증

| # | 케이스명 | 입력 / 조건 | 기대 결과 |
|---|---------|-----------|---------|
| M-PROC-N-01 | 서비스 매핑 정상 | PID 1234 cmdline에 "was1" 포함 | `process_cpu_percent{service_name="jeus-was1"}` 수집 |
| M-PROC-N-02 | 복수 PID → 동일 서비스 집계 | PID 2개가 같은 service_match | CPU/메모리 합산 |
| M-PROC-N-03 | top-N 미매칭 프로세스 | top_process_count=5, 미매칭 10개 | CPU 상위 5개만 `service_name="unmatched"` |
| M-PROC-N-04 | RSS 메모리 수집 | `/proc/[pid]/stat` VmRSS 필드 | `process_memory_bytes` 반환 |
| M-PROC-E-01 | `process_match` 대소문자 | "Was1" vs cmdline "was1" | 서비스 정책(case-sensitive 여부) 확인 |
| M-PROC-E-02 | 동일 cmdline에 여러 서비스 매치 | "was1-common-was2" | 첫 번째 또는 모든 매칭 서비스 확인 |
| M-PROC-E-03 | 짧은 수명 프로세스 | 수집 중 PID 소멸 | ENOENT 처리, 해당 PID 생략 |
| M-PROC-E-04 | top_process_count=0 | 미매칭 수집 안 함 | unmatched 샘플 없음 |
| M-PROC-F-01 | `/proc/[pid]/stat` 읽기 실패 | 권한 없음 | 해당 PID 생략, warn 로그 |
| M-PROC-F-02 | `/proc` 없음 | 비Linux 환경 | 빈 Vec 반환, 컴파일 에러(procfs Linux-only) |

---

## 3. 로그 모니터 — PII 마스킹

> `src/log_monitor/template.rs` — 민감정보 치환 및 트런케이션 검증

### 3-1. 정상 케이스

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| T-N-01 | IPv4 주소 마스킹 | `"Error from 192.168.1.100:8080"` | `"Error from <IP>"` |
| T-N-02 | UUID 마스킹 | `"id=550e8400-e29b-41d4-a716-446655440000"` | `"id=<UUID>"` |
| T-N-03 | 이메일 마스킹 | `"user@example.com logged in"` | `"<EMAIL> logged in"` |
| T-N-04 | 주민번호 마스킹 | `"주민번호: 900101-1234567"` | `"주민번호: <JUMINNO>"` |
| T-N-05 | 카드번호 마스킹 | `"card: 1234-5678-9012-3456"` | `"card: <CARD>"` |
| T-N-06 | 전화번호 마스킹 | `"tel: 010-1234-5678"` | `"tel: <PHONE>"` |
| T-N-07 | 5자리 이상 숫자 마스킹 | `"order_id=1234567"` | `"order_id=<NUM>"` |
| T-N-08 | 4자리 이하 숫자 유지 | `"retry=1234"` | `"retry=1234"` (변경 없음) |

### 3-2. 엣지 케이스

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| T-E-01 | 여러 PII 중첩 | `"user@mail.com ip=1.2.3.4 id=550e..."` | 모든 PII 각각 마스킹 |
| T-E-02 | 주민번호 경계 — 유효 | `"900101-1234567"` (14자리) | `<JUMINNO>` |
| T-E-03 | 주민번호 경계 — 앞 6자리만 | `"900101"` | 변경 없음 |
| T-E-04 | 주민번호 뒷자리 5/6로 시작 | `"900101-5123456"` | `<JUMINNO>` (5/6도 유효 패턴 확인) |
| T-E-05 | 200자 이하 전체 보존 | 199자 로그 | 원본 길이 유지 (마스킹만 적용) |
| T-E-06 | 200자 초과 트런케이션 | 300자 로그 | 결과 최대 200자, `...` 접미사 확인 |
| T-E-07 | IPv6 주소 | `"::1"`, `"2001:db8::1"` | 처리 여부 확인 (현재 IPv4만 지원) |
| T-E-08 | 한글 포함 로그 | `"오류: 사용자 900101-1234567"` | 한글 유지, 주민번호만 마스킹 |
| T-E-09 | URL 내 숫자 | `"/api/users/12345/orders"` | `<NUM>` 치환 여부 확인 (URL normalizer와 비교) |

### 3-3. 오류 케이스

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| T-F-01 | 빈 문자열 | `""` | 빈 문자열 반환, 크래시 없음 |
| T-F-02 | 공백만 | `"   "` | 변경 없음 |
| T-F-03 | 특수문자만 | `"!@#$%^&*()"` | 변경 없음 |
| T-F-04 | 바이너리 포함 문자열 | 널 바이트(`\x00`) 포함 | 처리 또는 생략, 크래시 없음 |
| T-F-05 | 매우 긴 단일 토큰 | 10000자 숫자열 | 트런케이션 적용, 크래시 없음 |

---

## 4. 로그 모니터 — 키워드 매칭

> `src/log_monitor/matcher.rs` — AhoCorasick DFA 매칭 검증

### 4-1. 정상 케이스

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| K-N-01 | ERROR 매칭 | `"[ERROR] DB connection failed"` | 매칭, keyword="ERROR" 반환 |
| K-N-02 | CRITICAL 매칭 | `"CRITICAL: out of memory"` | 매칭, keyword="CRITICAL" |
| K-N-03 | PANIC 매칭 | `"PANIC at thread main"` | 매칭, keyword="PANIC" |
| K-N-04 | Fatal 매칭 | `"Fatal error occurred"` | 매칭, keyword="Fatal" |
| K-N-05 | Exception 매칭 | `"NullPointerException in ..."` | 매칭, keyword="Exception" |
| K-N-06 | 커스텀 키워드 | keywords=["SEVERE", "ALERT"] | 설정 키워드 정상 매칭 |

### 4-2. 엣지 케이스

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| K-E-01 | 소문자 "error" (case-sensitive) | `"error occurred"` | 매칭 없음 (대소문자 구분) |
| K-E-02 | 부분 일치 방지 | `"ERRORHANDLER"` | 단어 경계 없으면 매칭, 구현 확인 |
| K-E-03 | 여러 키워드 동일 줄 | `"ERROR CRITICAL PANIC"` | 첫 번째 매칭 또는 복수 반환 확인 |
| K-E-04 | 빈 줄 | `""` | None 반환, 크래시 없음 |
| K-E-05 | 공백만 | `"   "` | None 반환 |
| K-E-06 | 키워드가 줄 중간에 위치 | `"process ERROR terminated"` | 매칭 |
| K-E-07 | 유니코드 포함 줄 | `"오류ERROR발생"` | ERROR 매칭 |

### 4-3. 오류 케이스

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| K-F-01 | 빈 keywords 배열 | `keywords = []` | AhoCorasick 초기화 성공, 모든 줄 None |
| K-F-02 | 매칭 없는 줄 | `"INFO server started"` | None 반환 |
| K-F-03 | 매우 긴 줄 | 100KB 단일 줄 | 정상 처리, 크래시 없음 |
| K-F-04 | 키워드와 동일한 줄 | `"ERROR"` (키워드 자체) | 매칭 |

---

## 5. 로그 모니터 — 파일 테일링

> `src/log_monitor/tailer.rs` — inotify 기반 파일 감시 및 로테이션 처리

### 5-1. 정상 케이스

| # | 케이스명 | 조건 | 기대 결과 |
|---|---------|------|---------|
| L-N-01 | 신규 줄 감지 | 파일에 새 줄 추가 | `LogCounter` 업데이트 |
| L-N-02 | 파일 로테이션 감지 (이름 변경 + 신규 생성) | inotify `Create` 이벤트 | 파일 포지션 0부터 재오픈 |
| L-N-03 | 다중 줄 일괄 추가 | 한 번에 1000줄 append | 모두 처리, 누락 없음 |
| L-N-04 | 서비스 매핑 | process_match와 cmdline 일치 | `service_name` 레이블 정확 |
| L-N-05 | glob 패턴 경로 | `"/opt/app/logs/*.log"` | 매칭 파일 모두 tailer 스폰 |

### 5-2. 엣지 케이스

| # | 케이스명 | 조건 | 기대 결과 |
|---|---------|------|---------|
| L-E-01 | 파일 삭제 후 재생성 | `Remove` → `Create` 이벤트 | 재생성 감지, 재오픈 성공 |
| L-E-02 | `\r\n` 줄 끝 (Windows 형식) | CRLF 로그 파일 | 정상 줄 분리, `\r` 아티팩트 없음 |
| L-E-03 | 줄 끝 없는 마지막 줄 | `\n` 없는 EOF | 다음 수집 주기에 처리 또는 보류 |
| L-E-04 | 빈 파일 | 0바이트 파일 감시 | 에러 없음, 이벤트 대기 |
| L-E-05 | 파일 크기 급증 (로그 폭발) | 1초에 100MB 추가 | 처리 지연 허용, 크래시 없음 |
| L-E-06 | inotify 이벤트 폭발 | 초당 10000 `Modify` 이벤트 | 각 이벤트 처리 또는 배치 처리 |
| L-E-07 | 심볼릭 링크 경로 | symlink → 실제 파일 | 실제 파일 감시 |
| L-E-08 | 감시 중 파일 chmod 변경 | 읽기 권한 제거 후 복원 | 권한 복원 시 자동 재개 |

### 5-3. 오류 케이스

| # | 케이스명 | 조건 | 기대 결과 |
|---|---------|------|---------|
| L-F-01 | 파일 없음(감시 시작 시) | 경로 존재하지 않음 | `warn!` 로그, 크래시 없음, 생성 대기 |
| L-F-02 | 읽기 권한 없음 | `chmod 000 logfile` | `warn!` 로그, 해당 tailer 비활성 |
| L-F-03 | 디렉토리 감시 실패 | 부모 디렉토리 없음 | `warn!` 로그, 크래시 없음 |
| L-F-04 | inotify 한도 초과 | `fs.inotify.max_user_watches` 초과 | 에러 로그, 기존 watches 영향 없음 |
| L-F-05 | stop 신호 정상 종료 | `AtomicBool` stop=true | 1초 이내 tailer OS thread 종료 |

---

## 6. 웹서버 모니터 — 액세스 로그 파서

> `src/web_monitor/parser/` — 세 가지 포맷 파서 검증

### 6-1. nginx_json (`parser/nginx_json.rs`)

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| W-NJ-N-01 | 정상 JSON 파싱 | `{"method":"GET","uri":"/api","status":200,"duration_ms":50}` | `method=GET, uri=/api, status=200, duration_ms=50.0` |
| W-NJ-N-02 | `duration_ms` 최우선 | `duration_ms=100, request_time_ms=200, request_time=0.3` | `duration=100ms` |
| W-NJ-N-03 | `request_time_ms` 두 번째 우선 | `duration_ms` 없음, `request_time_ms=200` | `duration=200ms` |
| W-NJ-N-04 | `request_time`(초) 세 번째 | `duration_ms`, `request_time_ms` 없음, `request_time=0.5` | `duration=500ms` |
| W-NJ-E-01 | `duration_ms` 필드 없음 | JSON에 duration 관련 필드 없음 | `duration_ms=None` |
| W-NJ-E-02 | 상태코드 500 | `"status":500` | `status="500"`, 정상 파싱 |
| W-NJ-E-03 | URI 쿼리스트링 포함 | `"uri":"/api?page=1&size=10"` | 파서에서 쿼리 보존, normalizer에서 제거 |
| W-NJ-F-01 | 잘못된 JSON | `{method: GET}` (따옴표 없음) | None 반환, warn 로그 |
| W-NJ-F-02 | 빈 줄 | `""` | None 반환 |
| W-NJ-F-03 | 필수 필드 누락 | `{}` 빈 JSON | None 반환 또는 기본값 처리 |

### 6-2. Combined Format (`parser/combined.rs`)

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| W-CB-N-01 | 정상 Apache Combined | `127.0.0.1 - - [..] "GET /path HTTP/1.1" 200 1234` | `method=GET, status=200` |
| W-CB-N-02 | `%D` 마이크로초 변환 | duration 필드 `15000` (µs) | `duration_ms=15.0` (÷1000) |
| W-CB-N-03 | float초 변환 | duration 필드 `0.5` | `duration_ms=500.0` (×1000) |
| W-CB-N-04 | 정수 ms (100 이상) | duration 필드 `150` | `duration_ms=150.0` (as-is) |
| W-CB-E-01 | duration 필드 없음 | 표준 CLF 형식 | `duration_ms=None` |
| W-CB-E-02 | POST 메서드 | `"POST /api HTTP/1.1"` | `method=POST` |
| W-CB-E-03 | 상태코드 301 리다이렉트 | status=301 | `status="301"` |
| W-CB-F-01 | 정규식 불일치 | 완전히 비정상 포맷 줄 | None 반환 |
| W-CB-F-02 | 빈 줄 | `""` | None 반환 |

### 6-3. CLF (`parser/clf.rs`)

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| W-CLF-N-01 | 정상 CLF 파싱 | `127.0.0.1 - frank [10/Oct/2000:..] "GET / HTTP/1.0" 200 2326` | `method=GET, status=200` |
| W-CLF-E-01 | `duration_ms` 항상 None | 모든 CLF 입력 | `duration_ms=None` 확인 |
| W-CLF-F-01 | 잘못된 형식 | 비정상 줄 | None 반환 |

---

## 7. 웹서버 모니터 — URL 정규화

> `src/web_monitor/url_normalizer.rs` — 경로 정규화 및 패턴 매칭

### 7-1. 정상 케이스

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| U-N-01 | 숫자 ID 치환 | `/api/users/12345` | `/api/users/{id}` |
| U-N-02 | UUID 치환 | `/api/users/550e8400-e29b-41d4-a716-446655440000` | `/api/users/{id}` |
| U-N-03 | 혼합 경로 | `/api/users/123/orders/456` | `/api/users/{id}/orders/{id}` |
| U-N-04 | 패턴 매칭 | `/api/customers` + patterns=[`/api/customers`] | `(pattern="/api/customers", display="고객조회")` |
| U-N-05 | 쿼리스트링 제거 | `/api/users?page=1&size=10` | `/api/users` |
| U-N-06 | 패턴 매칭 — 정규화 후 | `/api/customers/123` → `/api/customers/{id}` | 정규화된 경로로 패턴 매칭 |

### 7-2. 엣지 케이스

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| U-E-01 | 5세그먼트 초과 자르기 | `/a/b/c/d/e/f/g` | `/a/b/c/d/e` (5개 제한) |
| U-E-02 | 정확히 5세그먼트 | `/a/b/c/d/e` | `/a/b/c/d/e` (변경 없음) |
| U-E-03 | 루트 경로 | `/` | `/` |
| U-E-04 | 슬래시만 연속 | `//api//users` | 중복 슬래시 처리 확인 |
| U-E-05 | 문자열 세그먼트 유지 | `/api/users/profile` | `/api/users/profile` (숫자 아님) |
| U-E-06 | 해시 포함 | `/api/users#section` | `#section` 제거 확인 |
| U-E-07 | 숫자로 시작하는 문자열 | `/api/123abc` | 변경 없음 (순수 숫자 아님) |

### 7-3. 오류 케이스

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| U-F-01 | 빈 문자열 | `""` | `"/"` 또는 빈 결과, 크래시 없음 |
| U-F-02 | 패턴 미매칭 | `/api/unknown/path` + 패턴 없음 | `("other", "기타")` 반환 |
| U-F-03 | `url_patterns = []` | 빈 패턴 목록 | 모든 URL → `("other", "기타")` |
| U-F-04 | 비정상 UTF-8 경로 | `"/api/\xFF\xFE"` | 처리 또는 생략, 크래시 없음 |

---

## 8. Remote Write — 인코딩/압축/전송/WAL

### 8-1. Protobuf 인코딩 (`src/writer/encode.rs`)

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| E-N-01 | 단일 샘플 인코딩 | 1개 MetricSample | 유효한 protobuf 바이트 생성 |
| E-N-02 | 레이블 알파벳 정렬 | `z=1, a=2` 순서로 전달 | 인코딩 결과에서 `a` 레이블 선행 |
| E-N-03 | `__name__` 레이블 포함 | `name="cpu_usage_percent"` | `__name__=cpu_usage_percent` 레이블 포함 |
| E-N-04 | 타임스탬프 ms 정확도 | `timestamp_ms=1712563200000` | 인코딩된 Sample에 동일 타임스탬프 |
| E-N-05 | 멀티 레이블 | 5개 레이블 | 모두 포함, 정렬 확인 |
| E-N-06 | 빈 샘플 배열 | `samples = []` | 빈 WriteRequest 바이트 |
| E-E-01 | value = NaN | `f64::NAN` | 처리 또는 생략 확인 |
| E-E-02 | value = Infinity | `f64::INFINITY` | 처리 또는 생략 확인 |
| E-E-03 | 레이블값 빈 문자열 | `label_value = ""` | 인코딩 포함 (빈값 허용) |
| E-E-04 | 레이블값 특수문자 | `label_value = "a/b:c=d"` | 이스케이프 없이 인코딩 |

### 8-2. Snappy 압축 (`src/writer/compress.rs`)

| # | 케이스명 | 입력 | 기대 결과 |
|---|---------|------|---------|
| C-N-01 | 라운드트립 | 임의 바이트 슬라이스 | compress → decompress 원본 일치 |
| C-N-02 | 빈 데이터 | `&[]` | 빈 압축 결과, 크래시 없음 |
| C-N-03 | 반복 패턴 데이터 | 동일 바이트 10000개 | 높은 압축률 (< 원본 크기) |
| C-E-01 | 대용량 데이터 | 10MB protobuf payload | 압축 성공, OOM 없음 |
| C-E-02 | 이미 압축된 데이터 | snappy 이중 압축 | 결과 크기 증가 허용 (이중 압축) |

### 8-3. Remote Write Sender (`src/writer/sender.rs`)

| # | 케이스명 | 조건 | 기대 결과 |
|---|---------|------|---------|
| S-N-01 | 정상 전송 성공 | mock 서버 200 응답 | `Ok(())` 반환 |
| S-N-02 | 올바른 헤더 전송 | 전송 요청 캡처 | `Content-Type: application/x-protobuf`, `Content-Encoding: snappy`, `X-Prometheus-Remote-Write-Version: 0.1.0` 포함 |
| S-E-01 | 1회 실패 후 성공 | 첫 요청 500, 두 번째 200 | `Ok(())` 반환 |
| S-E-02 | 3회 재시도 후 실패 | 모든 응답 500 | `Err(String)` 반환 |
| S-E-03 | 지수백오프 타이밍 | 3회 실패 시 | 재시도 간격 500ms → 1000ms → 2000ms |
| S-E-04 | 타임아웃 | 서버 응답 없음 (`timeout_secs` 초과) | `Err` 반환 |
| S-F-01 | 연결 거부 | endpoint unreachable | `Err` 반환, 로그 출력 |
| S-F-02 | 잘못된 endpoint URL | `"not-a-url"` | 연결 오류 반환 |

### 8-4. WAL (`src/writer/wal.rs`)

| # | 케이스명 | 조건 | 기대 결과 |
|---|---------|------|---------|
| W-N-01 | append 정상 | 압축 payload 전달 | `wal-{hour}.bin` 파일 생성 |
| W-N-02 | drain_pending 정상 | 1개 세그먼트 파일 존재 | payload 반환, 파일 경로 반환 |
| W-N-03 | confirm_sent 파일 삭제 | `confirm_sent(paths)` 호출 | WAL 파일 삭제 |
| W-N-04 | has_pending true | .bin 파일 존재 | `true` 반환 |
| W-N-05 | has_pending false | .bin 파일 없음 | `false` 반환 |
| W-N-06 | gc retention 초과 삭제 | 파일 생성 시각 > retention_hours | 해당 파일 삭제 |
| W-N-07 | gc retention 미초과 보존 | 최신 파일 | 삭제 안 됨 |
| W-N-08 | 시간당 세그먼트 분리 | 2시간에 걸쳐 append | `wal-{h1}.bin`, `wal-{h2}.bin` 분리 |
| W-E-01 | 여러 세그먼트 drain | 3개 .bin 파일 | 오래된 순서부터 반환 |
| W-E-02 | drain 후 confirm 없이 재drain | confirm_sent 생략 | 같은 payload 다시 반환 (멱등성) |
| W-E-03 | wal_dir 없을 시 생성 | 경로 미존재 | 디렉토리 자동 생성 |
| W-F-01 | 손상된 .bin 파일 | 헤더 4바이트 truncated | 해당 엔트리 건너뜀, warn 로그 |
| W-F-02 | 빈 .bin 파일 | 0바이트 WAL 파일 | 빈 결과 반환, 크래시 없음 |
| W-F-03 | 쓰기 권한 없는 wal_dir | `chmod 444 wal_dir` | `Err` 반환, 에러 로그 |

---

## 9. 부하(Load) 테스트

> 정상 케이스 처리량 및 동시성 한계 검증. 기준 수치는 타깃 환경(2 vCPU, 4GB RAM) 기준.

### 9-1. 대량 메트릭 인코딩/압축

| # | 케이스명 | 조건 | 기대 기준 |
|---|---------|------|---------|
| LD-01 | 10만 샘플 인코딩 | `encode_samples(&samples)` × 100,000개 | 완료 시간 < 500ms |
| LD-02 | 10만 샘플 압축 | encode → compress 전체 파이프라인 | 완료 시간 < 1000ms, 메모리 < 200MB |
| LD-03 | 1천 레이블 샘플 | 레이블 1000개짜리 단일 샘플 | 정렬 포함 완료 < 10ms |

### 9-2. 로그 키워드 매칭 처리량

| # | 케이스명 | 조건 | 기대 기준 |
|---|---------|------|---------|
| LD-04 | 초당 10만 줄 매칭 | AhoCorasick `find_first()` 반복 호출 | 처리량 ≥ 100,000 lines/sec |
| LD-05 | 대용량 단일 줄 | 10KB 줄 × 10만회 | 크래시 없음, 처리 완료 |
| LD-06 | PII 마스킹 처리량 | 100자 로그 × 100만 줄 | 처리량 ≥ 500,000 lines/sec |

### 9-3. HTTP 카운터 동시 기록

| # | 케이스명 | 조건 | 기대 기준 |
|---|---------|------|---------|
| LD-07 | 100만 요청 동시 record | 8 스레드 × 125,000회 `HttpCounter.record()` | 데이터 손실 없음, deadlock 없음 |
| LD-08 | drain 중 record 경쟁 | record 스레드 + drain 스레드 동시 실행 | 정합성 유지, 음수 카운트 없음 |
| LD-09 | 고카디널리티 URL 패턴 | 10,000개 고유 URL 패턴 | 메모리 증가 < 100MB, OOM 없음 |

### 9-4. WAL 대용량 처리

| # | 케이스명 | 조건 | 기대 기준 |
|---|---------|------|---------|
| LD-10 | 1GB WAL drain | 1GB 단일 세그먼트 파일 | 완료 시간 < 30초, OOM 없음 |
| LD-11 | 10,000 WAL 세그먼트 | 10,000개 소형 .bin 파일 | `drain_pending` 완료 < 5초 |
| LD-12 | 연속 WAL append | 1MB payload × 1000회 | 디스크 I/O 실패 시 graceful 처리 |

### 9-5. 멀티 Tailer 동시 감시

| # | 케이스명 | 조건 | 기대 기준 |
|---|---------|------|---------|
| LD-13 | 100개 파일 동시 감시 | log_monitor.paths 100개 glob 매칭 | inotify watch 한도 내, 스레드 100개 정상 스폰 |
| LD-14 | 100개 파일 동시 로테이션 | 100개 파일 동시 `Create` 이벤트 | 모두 재오픈 성공, 메모리 < 500MB |
| LD-15 | 장시간 연속 실행 | 24시간 수집 루프 (테스트 시 가속) | 메모리 리크 없음, RSS 증가 < 50MB/24h |

### 9-6. 전체 수집 주기 부하

| # | 케이스명 | 조건 | 기대 기준 |
|---|---------|------|---------|
| LD-16 | 15초 주기 전체 수집 | CPU+MEM+DISK+NET+PROC+LOG+WEB 동시 | 1회 수집 < 1000ms (15초 주기 내 완료) |
| LD-17 | Remote Write 지연 시 WAL 축적 | 5분 네트워크 차단 | WAL 파일 누적 후 복구 시 자동 재전송, 데이터 손실 없음 |
| LD-18 | 수집 주기 중 CPU spike | 수집 중 CPU 99% | 타이머 지연 허용, 다음 주기 정상 실행 |

---

## 부록: 기존 단위 테스트 매핑

기존 `#[cfg(test)]` 테스트와 위 케이스의 대응 관계:

| 기존 테스트 위치 | 커버하는 케이스 |
|---------------|--------------|
| `writer/encode.rs` | E-N-01 ~ E-N-06 |
| `writer/compress.rs` | C-N-01 ~ C-E-02 |
| `log_monitor/matcher.rs` | K-N-01 ~ K-F-04 |
| `log_monitor/template.rs` | T-N-01 ~ T-F-05 |
| `web_monitor/url_normalizer.rs` | U-N-01 ~ U-F-04 |
| `web_monitor/parser/nginx_json.rs` | W-NJ-N-01 ~ W-NJ-F-03 |
| `web_monitor/parser/combined.rs` | W-CB-N-01 ~ W-CB-F-02 |
| `web_monitor/parser/clf.rs` | W-CLF-N-01 ~ W-CLF-F-01 |
| `preprocessor/summarize.rs` | (별도 확장 가능) |
| `metrics/memory.rs` | M-MEM-N-01 |

> **미커버 케이스**: C-F-01 ~ C-R-06 (Config 로딩/핫리로드), L-N-01 ~ L-F-05 (Tailer), W-N-01 ~ W-F-03 (WAL), S-N-01 ~ S-F-02 (Sender), LD-01 ~ LD-18 (부하) — 신규 테스트 구현 필요.
