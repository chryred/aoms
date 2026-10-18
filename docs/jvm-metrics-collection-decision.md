# JEUS(JDK 1.7) JVM 힙·GC 메트릭 수집 — 방식 결정 문서

> 작성일: 2026-08-28
> 유형: 의사결정 기록 (Decision Record). 설계·구현 미착수
> 관련 문서: `docs/llm-agentic-diagnostics-requirements.md` (Step 1에 해당)
> 상태: **권고안 제시 — 확정에 필요한 정보 1건 미확보(§6)**

---

## 1. 목적

JEUS WAS가 힙 고갈로 **"프로세스는 살아 있으나 응답 불능"** 상태에 빠지는 장애를 **사전에 인지**하기 위해, JVM 힙 사용량과 GC 동작을 메트릭으로 수집한다.

현재 수집 중인 신호로는 이 상태를 **탐지는 가능하지만 예측은 불가능**하다.

| 신호 | 메트릭 | 성격 |
|---|---|---|
| 응답 불능 (확정) | `http_request_total{status_code, was_service}` — 5xx 급증 / 요청량 붕괴 | 이미 장애가 난 뒤 |
| 응답 지연 (선행) | `http_request_duration_ms`, `http_request_slow_total` | 완전 정지 직전 |
| GC 데스 스파이럴 (선행) | `process_cpu_percent{service_name}` — 처리량 없이 CPU 100% | 간접 신호 |
| OOM 발생 (확정·후행) | log_monitor 키워드 `java.lang.OutOfMemoryError` | 터지는 순간 |
| 좀비 누적 (보조) | `process_zombie_by_parent{service_name}` | 자식 OOM 사망 흔적 |
| 프로세스 RSS | `process_memory_bytes{service_name}` | **거의 무용** — JVM RSS는 `-Xmx` 에서 평평해져 건강할 때와 죽어갈 때가 같아 보인다 |

**공백**: 힙 사용률, GC 소요 시간, Full GC 빈도, **Full GC 후 회수량 추세**. 마지막 항목이 OOM 예측의 정답에 가장 가깝다.

---

## 2. 선행 조건 — 이 문서가 필요한지부터 확인할 것

**이 작업에 착수하기 전에 반드시 원인 판별을 먼저 해야 한다.** 실패 원인이 리눅스 커널 OOM Killer라면 **JVM 힙 메트릭으로는 탐지되지 않으며**(힙은 멀쩡한데 호스트 물리 메모리가 고갈된 것), 이미 수집 중인 호스트 `memory_used_bytes` 로 충분하다. 즉 이 문서의 작업 전체가 잘못된 대상을 겨냥한 것이 된다.

판별 순서(다음 장애 발생 시, 비용 거의 없음):

1. `hs_err_pid<pid>.log` 존재 → **JVM 크래시** (힙 덤프는 원래 안 생김)
2. `dmesg` / `/var/log/messages` 에 `Out of memory: Killed process ... (java)` → **커널 OOM Killer** → 이 문서 불필요, 호스트 메모리 과제로 전환
3. `JeusServer.log` 에 `java.lang.OutOfMemoryError` 존재 → **JVM 힙 부족 확정** → 이 문서 진행. 덤프가 없다면 `HeapDumpPath` 권한·여유 공간 확인
4. 위 셋 다 없음 → 외부 `kill` 또는 정상 종료. exit status 확인

> `-XX:+HeapDumpOnOutOfMemoryError` 는 **JVM이 실제로 `OutOfMemoryError` 를 던질 때만** 작동한다. GC 데스 스파이럴은 힙이 99%에 붙어 Full GC만 반복할 뿐 예외 발생 조건에 안 걸릴 수 있고, 이때 **덤프가 없는 것은 정상 동작**이다. "덤프가 없어서 원인을 모른다"는 상황의 상당수가 이 케이스이거나 위 2번이다.

---

## 3. 제약 — OTel 경로는 배제됨

기존 스택에 OTel Java Agent가 이미 배포 대상으로 관리되고 있으나(`agent_type = 'otel_javaagent'`, ADR-008), **JEUS 대상 시스템이 모두 JDK 1.7이라 사용할 수 없다.**

| 근거 | 위치 |
|---|---|
| OTel Java Agent는 **JDK 8 이상**만 지원 | ADR-008 "JDK 8: JAR v1.33.x, JDK 11+: v2.x" |
| 설치 폼이 JDK 8 미만을 아예 받지 않음 | `agents_control.py:1380-1385` — `jdk_version="8"\|"11"\|"17"\|"21"` |
| JAR 분기도 8이 하한 | `agents_control.py:1424` — `use_v1 = jdk_major == 8` |

> 참고: `agents_control.py:1489` 의 `OTEL_METRICS_EXPORTER='none'` 을 켜는 것만으로 JVM 메트릭을 얻는 방법이 있으나(OTel Java Agent는 JVM 런타임 메트릭을 기본 계측한다), **JDK 1.7에서는 애초에 agent가 붙지 않으므로 해당 없음.** 향후 JDK 8+ 시스템에 한해서는 유효한 선택지이며, 그 경로의 실제 작업 항목은 **§8** 에 정리했다.

---

## 4. 현재 agent-v 상태 (선택지를 가르는 사실)

| 사실 | 위치 | 함의 |
|---|---|---|
| `log_monitor` 는 **키워드/레벨 카운트만** 수행 → `log_error_total` | `log_monitor/mod.rs:25,54` | 로그에서 **숫자 추출 로직은 신규 개발 필요** |
| 파일 추적·로테이션·glob 타일러는 이미 완성 | `log_monitor/tailer.rs` (커밋 855988c) | 로그 수집의 어려운 부분은 재사용 가능 |
| **`Command::new` 가 단 한 곳도 없음** | `agent/src/` 전역 | agent는 서브프로세스를 띄운 적이 없다. exec 도입은 성격 변경 |
| procfs 직접 읽기 패턴 확립 | `metrics/process.rs` | 파일 읽기 방식은 기존 성격과 일치 |

---

## 5. 선택지 비교

| | **① GC 로그 tailing** | **② hsperfdata 직접 읽기** | **③ jstat 파싱** |
|---|---|---|---|
| 방식 | `-Xloggc:` + `-XX:+PrintGCDetails` 출력을 tail | `/tmp/hsperfdata_<user>/<pid>` 바이너리 파싱 | `jstat -gc <pid>` 실행 후 출력 파싱 |
| 서브프로세스 | 없음 | 없음 | **필요 (성격 변경)** |
| 필요 권한 | **GC 로그 파일 읽기 권한만** | JVM과 **동일 OS 계정** (또는 root) | JVM과 **동일 OS 계정** (또는 root) |
| JVM 기동 옵션 변경 | **필요** (재기동 동반) | 불필요 | 불필요 |
| 재사용 | `tailer.rs` (glob·로테이션) | procfs 읽기 패턴 | 없음 |
| 신규 개발 | GC 로그 **수치 파싱** | **바이너리 포맷 파싱** (공수 큼) | 출력 텍스트 파싱 (공수 작음) |
| 데이터 성격 | 이벤트 기반 (GC 발생 시점) | 실시간 게이지 | 실시간 게이지 |
| 핵심 지표 | **Full GC 후 회수량 추세** 획득 | 힙 사용량·GC 카운트 | 힙 사용량·GC 카운트 |
| JDK 1.7 | 지원 | 지원 (포맷 안정) | 지원 |

### 판별 조건 — 계정 권한 비대칭

②와 ③은 `hsperfdata` 파일에 접근해야 하므로 **agent 프로세스가 JVM과 같은 OS 계정으로 실행되어야 한다.** ADR-008은 WAS 기동 계정을 `jeussic`, `jeuserp` 등으로 기록하고 있고, synapse-agent 배포 원칙은 별도 서비스 계정(non-root)이다. **두 계정이 다르면 ②③은 권한에서 막힌다.**

①은 GC 로그 파일에 읽기 권한만 있으면 되므로 이 제약을 받지 않는다.

---

## 6. 권고 — ① GC 로그 tailing

**근거:**

1. **계정 불일치에도 살아남는 유일한 방법이다.** 위 비대칭이 사실상 결정적이다.
2. **가장 좋은 지표를 준다.** "Full GC를 돌리고도 회수되는 힙이 계속 줄어든다"는 단순 힙 사용률보다 판별력이 훨씬 높다. 힙이 90%인 것과, 90%인데 Full GC 후에도 안 내려가는 것은 전혀 다른 상황이다.
3. **어려운 부분이 이미 있다.** `tailer.rs` 의 파일 추적·로테이션·glob 처리를 그대로 쓴다. 단, **수치 파싱은 신규 개발**임을 분명히 한다 — 현재 `log_monitor` 는 키워드를 세기만 한다.
4. **agent 성격을 바꾸지 않는다.** 서브프로세스가 없다.

**비용:** JVM 기동 옵션 변경이 필요해 재기동을 동반한다. 다만 이 과제의 배경 자체가 "재기동을 하고 있다"는 것이므로 그 기회에 함께 적용 가능하다.

**필수 동반 옵션:** `-XX:+UseGCLogFileRotation -XX:NumberOfGCLogFiles -XX:GCLogFileSize` — 없으면 GC 로그가 무한정 증가한다.

### ⚠ 확정에 필요한 미확보 정보

> **synapse-agent가 JEUS 호스트에서 어느 OS 계정으로 실행되는가?**
>
> 이 한 가지가 선택지 셋 중 둘을 지운다. 저장소 코드로는 확인할 수 없다.
>
> - **JVM과 같은 계정(`jeussic` 등)이면** → ②(hsperfdata 직접 읽기)도 유효해진다. 기동 옵션 변경과 재기동이 필요 없다는 장점이 있어 재검토할 가치가 있다.
> - **다른 계정이면** → ①이 유일한 선택지다.

---

## 7. 수집 항목 (①안 기준 초안)

GC 로그 한 줄에서 추출할 값. 구체적 메트릭명·레이블은 설계 단계에서 확정한다.

JDK 1.7 `-XX:+PrintGCDetails` Full GC 라인 예시:

```
2026-08-28T14:23:11.123+0900: 3612.456: [Full GC [PSYoungGen: 12288K->0K(153600K)]
  [ParOldGen: 349184K->350012K(349696K)] 361472K->350012K(503296K)
  [PSPermGen: 82340K->82340K(83968K)], 2.8471230 secs]
```

| 항목 | 추출 위치 | 용도 |
|---|---|---|
| **GC 직후 전체 힙 사용량** (`350012K`) | 전체 힙 트리플 `A->B(C)` 의 **B** | **핵심** — Full GC를 돌리고도 이 값이 계속 오르면 회수 실패 = OOM 예정 |
| 전체 힙 용량 (`503296K`) | 같은 트리플의 **C** | 사용률 계산 기준 |
| GC 소요 시간 (`2.847 secs`) | 라인 끝 `secs` | 누적 시간 비율이 곧 서비스 정지 시간 |
| GC 종류·횟수 | `[Full GC` / `[GC` 헤더 | 빈도 급증 = 위험 신호 |
| 이벤트 시각 | 앞머리 datestamp | 샘플 타임스탬프 |
| (보조) Old 영역 before→after | `[ParOldGen: ...]` / `[CMS: ...]` | **파싱되면 추가**. 표기가 GC 알고리즘마다 달라 필수 항목으로 삼지 않는다 |

> **전체 힙 트리플을 1순위로 삼는 이유**: `A->B(C)` 는 GC 알고리즘과 무관하게 항상 같은 자리에 있다.
> Old 영역 표기는 ParallelGC면 `[ParOldGen: ...]`, CMS면 `[CMS: ...]` 로 달라지는데
> **JEUS가 어느 collector로 기동되는지는 아직 미확인 정보다**(§6 OS 계정 건에 이은 두 번째 미확인).
> 전체 힙만으로도 판별력이 거의 같으므로 이 미확인이 착수 블로커가 되지 않게 한다.

### 판정 규칙 — JVM 자신의 기준을 재사용한다

임의 임계치를 발명하지 않는다. HotSpot의 `-XX:+UseGCOverheadLimit` 판정 기준을 그대로 외부에서 계산한다:

> **연속된 Full GC 구간에서 전체 경과 시간의 98% 이상을 GC에 쓰면서 회수한 힙이 2% 미만이면 힙 회수 실패로 간주한다.**

- GC 시간 비율 = `Σ duration / 경과 시간`
- 회수율 = `(A - B) / C`

두 값 모두 위 추출 항목만으로 계산되며, JVM이 이 선을 넘어 `OutOfMemoryError: GC overhead limit exceeded` 를 던지기 **전에** 수치가 올라가는 것을 관측할 수 있다. NFR-14가 요구하는 "사람의 판단이 아닌, 기계로 검증 가능한 메트릭 조건"에 해당한다.

기존 규칙과 마찬가지로 시스템별 예외는 `metric_exclusions` 로 처리한다.

### 필수 JVM 기동 옵션

```
-Xloggc:/logs/gc.log -XX:+PrintGCDetails
-XX:+PrintGCDateStamps                    ← 없으면 절대시각 없이 기동 후 경과초만 기록됨
-XX:+UseGCLogFileRotation -XX:NumberOfGCLogFiles=5 -XX:GCLogFileSize=20M
```

`PrintGCDateStamps` 가 없으면 `3612.456:` (기동 후 경과초)만 남아 프로세스 시작 시각을 별도로 알아야 절대시각을 복원할 수 있다. 사실상 필수.
로테이션 옵션이 없으면 GC 로그가 무한정 증가한다.

### 구현 시 확인된 사실 / 주의 사항

| 항목 | 상태 |
|---|---|
| **agent 재시작 시 중복 계상** | **없음.** `tailer.rs:89,250` 최초 open은 `SeekFrom::End(0)`, 새 파일 감지 시에만 `Start(0)`. 대신 agent 다운타임 중 GC 이벤트는 유실된다(카운터 성격상 허용) |
| 로테이션 파일명 | HotSpot은 로테이션 사용 시 활성 파일에 `.current` 접미사를 붙인다(`gc.log.0.current`). glob 패턴 + 최신 mtime 선택(`find_latest_matching`)이 이를 흡수하나 설계 단계에서 실기 확인 필요 |
| `log_monitor` 와의 차이 | 현행은 "매칭 시 +1"(`log_error_total`) 카운터. GC 파서는 줄에서 **수치를 추출해 값으로 낸다** — 카운터와 게이지가 섞인다 |

---

## 8. 범위 밖 / 별도 경로

### JDK 8 이상 시스템 — OTel Java Agent 경로 (별도 검토 완료)

JDK 8+ 시스템에는 GC 로그 파서 대신 이미 배포 체계가 있는 OTel Java Agent를 쓴다. 단 **설정 한 줄이 아니라 세 가지 작업**이다.

| # | 작업 | 근거 / 현황 |
|---|---|---|
| 1 | Java Agent `OTEL_METRICS_EXPORTER` 를 `'none'` → `'otlp'` | `agents_control.py:1489`. 실제 한 줄 |
| 2 | Collector에 `metrics` 파이프라인 + `prometheusremotewrite` exporter 추가 | `otel-collector-config.yml` 에 현재 `traces` 파이프라인만 존재. contrib 이미지(`0.123.0`)라 exporter는 이미 포함. Prometheus remote-write 수신은 Rust agent 때문에 이미 열려 있음 |
| 3 | **resource attribute → 라벨 매핑 결정 (실제 작업량)** | OTel의 `jvm_memory_used_bytes{pool,area}` 에는 Rust agent의 base 라벨 규약(`system_name`/`display_name`/`instance_role`/`host`)이 없다. `alert_rules.yml`·`metric_exclusions`·집계 쿼리·챗봇 `prometheus_query` 가 모두 이 규약을 전제하므로, 매핑 없이는 나머지 스택과 조인되지 않는다 |

> **JDK 9+ 는 GC 로그가 unified logging(`-Xlog:gc*`)으로 변경되어 본 문서의 1.7용 파서가 동작하지 않는다.**
> 따라서 분기는 **1.7 → GC 로그 파서 / 8+ → OTel** 로 고정한다. 1.7용 파서를 상위 버전에 재사용하려 하지 말 것(8은 동작하나 9+에서 깨진다).

### 범위 밖

- 힙 덤프 자동 분석 — 수집이 아니라 사후 분석 영역
- 조치(재기동) 자동화 — `docs/llm-agentic-diagnostics-requirements.md` Phase 2 소관

---

## 9. 다음 단계

1. **§2 원인 판별 선행** — 커널 OOM Killer면 이 문서 자체가 불필요
2. **§6 미확보 정보 확인** — synapse-agent 실행 계정
3. 방식 확정 후 `/sc:design` 으로 agent-v 수집 모듈 설계
4. 확정 결정은 `.claude/memory/adrs.md` 에 ADR로 기록 (JDK 1.7 → OTel 배제 근거 포함)
