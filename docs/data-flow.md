# Synapse-V 데이터 흐름 전체 가이드

> 최종 업데이트: 2026-04-11 | Phase 8 기준

---

## 개요

```
타겟 서버 (synapse_agent)
  → Prometheus Remote Write
    → log-analyzer (집계 · LLM 분석)
    → admin-api (알림 · 집계 저장 · 대시보드)
      → Teams (알림)
      → Frontend (대시보드 표시)
```

---

## 1. 에이전트 수집 (synapse_agent)

### 1-1. 수집 주기
- `collect_interval_secs` (기본 15초) 마다 메트릭 수집
- 수집 → snappy 압축 → Prometheus Remote Write (HTTP POST)

### 1-2. 에이전트가 발행하는 Prometheus 메트릭

#### 공통 기본 라벨 (모든 메트릭 포함)
| 라벨 | 설명 | 예시 |
|---|---|---|
| `system_name` | 시스템 식별자 (DB `systems.system_name`과 일치해야 함) | `crm` |
| `display_name` | 표시명 | `고객관리시스템` |
| `instance_role` | HA 이중화 식별자 | `was1`, `db-primary` |
| `host` | 물리 서버 IP | `192.168.1.10` |

#### CPU
| 메트릭명 | 추가 라벨 | 설명 |
|---|---|---|
| `cpu_usage_percent` | `core` (total/cpu0/cpu1/…) | CPU 사용률 % |
| `cpu_load_avg` | `interval` (1m/5m/15m) | 로드 평균 |

#### 메모리
| 메트릭명 | 추가 라벨 | 설명 |
|---|---|---|
| `memory_used_bytes` | `type` (used/cached/free/swap_used/total) | 메모리 사용량 (bytes) |

#### 디스크
| 메트릭명 | 추가 라벨 | 설명 |
|---|---|---|
| `disk_bytes_total` | `device`, `direction` (read/write) | 디스크 I/O 누적 bytes |
| `disk_io_time_ms` | `device` | I/O 대기 시간 ms |

#### 네트워크
| 메트릭명 | 추가 라벨 | 설명 |
|---|---|---|
| `network_bytes_total` | `interface`, `direction` (rx/tx) | 네트워크 트래픽 누적 bytes |
| `network_errors_total` | `interface`, `direction` (rx/tx) | 네트워크 에러 누적 |
| `network_speed_mbps` | `interface` | 현재 속도 Mbps |
| `network_utilization_percent` | `interface`, `direction` (rx/tx) | 대역폭 사용률 % |

#### TCP
| 메트릭명 | 추가 라벨 | 설명 |
|---|---|---|
| `tcp_connections` | `port`, `state` (ESTABLISHED/TIME_WAIT/…) | TCP 연결 수 |

#### 프로세스 → 서비스
| 메트릭명 | 추가 라벨 | 설명 |
|---|---|---|
| `process_cpu_percent` | `process`, `service_name`, `service_display`, [`pid`, `command`] | 프로세스 CPU % |
| `process_memory_bytes` | `process`, `service_name`, `service_display`, [`pid`, `command`] | 프로세스 메모리 bytes |

#### 로그 에러 카운터
| 메트릭명 | 추가 라벨 | 설명 |
|---|---|---|
| `log_error_total` | `log_type`, `level`, `service_name`, `template` | 키워드 매칭 로그 에러 누적 카운터 |

> `log_type`: `[[log_monitor]]` 설정의 `log_type` 값 (예: `jeus`, `app`)
> `template`: PII 마스킹 + 카디널리티 억제 후 로그 템플릿 (200자 truncate)

#### HTTP 트래픽 (웹서버 access log)
| 메트릭명 | 추가 라벨 | 설명 |
|---|---|---|
| `http_request_total` | `web_server`, `web_server_display`, `url_pattern`, `url_pattern_display`, `was_service`, `method`, `status_code` | 요청 수 누적 |
| `http_request_duration_ms` | (동일) | 수집 주기별 평균 응답 시간 ms |
| `http_request_slow_total` | `web_server`, `web_server_display`, `url_pattern`, `url_pattern_display` | 슬로우 요청 수 누적 |

#### 에이전트 생존 신호
| 메트릭명 | 추가 라벨 | 설명 |
|---|---|---|
| `agent_up` | `version` | 에이전트 동작 중 (값=1) |
| `agent_heartbeat` | `version`, `collector` | 수집기별 생존 신호 (collector: cpu/memory/disk/network/process/log/web) |

#### 전처리기 (preprocessor=true 시에만)
| 메트릭명 | 추가 라벨 | 설명 |
|---|---|---|
| `{metric_name}_avg` | `window` (60s/300s) | 이동 평균 |
| `{metric_name}_p95` | `window` (60s/300s) | 이동 p95 |
| `anomaly_correlation_total` | `metric_name`, `log_errors_in_window`, `corr_type` | 메트릭 이상 ↔ 로그 에러 상관 |

### 1-3. WAL (Write-Ahead Log)
- Remote Write 실패 시 `/var/lib/synapse-agent/wal/` 에 저장
- 보존 기간: `wal_retention_hours` (기본 2시간)
- 재기동/네트워크 복구 시 자동 재전송

---

## 2. Prometheus 저장

- synapse_agent → `POST http://prometheus:9090/api/v1/write` (Remote Write)
- Prometheus는 `--web.enable-remote-write-receiver` 플래그 필수
- 메트릭은 Prometheus TSDB에 저장되며 `retention.time` 기간 유지 (기본 15일)

---

## 3. Alertmanager — 메트릭 알림 흐름

```
Prometheus alert_rules.yml 평가 (매 15s)
  → 조건 충족 시 Alertmanager firing
  → POST admin-api/api/v1/alerts/receive
    → system_name으로 시스템 + 담당자 조회
    → 5분 쿨다운 체크 (alert_cooldown 테이블)
    → TeamsNotifier.send_metric_alert() → Teams Adaptive Card
    → alert_cooldown upsert + alert_history INSERT
```

**Alertmanager → admin-api 페이로드 핵심 필드:**
- `labels.alertname` — 알림 규칙명
- `labels.severity` — `warning` | `critical`
- `labels.system_name` — DB systems.system_name과 매칭
- `labels.instance_role` — HA 인스턴스 식별
- `status` — `firing` | `resolved`

---

## 4. log-analyzer — LLM 로그 분석 흐름

```
내부 스케줄러 (ANALYSIS_INTERVAL_SECONDS마다, 기본 300초)
  → analyzer.run_analysis()
    → GET admin-api/api/v1/systems (활성 시스템 목록)
    → 각 시스템별:
        PromQL: sum(increase(log_error_total{system_name=X}[5m])) by (level, template, log_type)
        → PII 마스킹 확인 (에이전트에서 이미 마스킹됨)
        → normalize_log_for_embedding() → Ollama 임베딩 (Server B bge-m3)
        → Qdrant log_incidents 컬렉션 유사도 검색
          → score ≥ 0.95: duplicate → 알림 억제
          → score ≥ 0.85: recurring → "반복 이상" 알림
          → score ≥ 0.70: related → "유사 이상" 알림
          → score < 0.70: new → "신규 이상" 알림
        → analyze_with_vector_context() → LLM API 호출 (담당자별 llm_api_key 사용)
        → POST admin-api/api/v1/analysis
          → warning/critical이면 TeamsNotifier.send_log_analysis_alert()
          → log_analysis_history INSERT
```

**Prometheus PromQL (로그 분석용):**
```promql
sum(increase(log_error_total{system_name="X"}[5m])) by (level, template, log_type, service_name)
```

---

## 5. log-analyzer — 집계 흐름 (Phase 5)

### WF6 대체: 1시간 집계 (매 시간 :05)
```
_hourly_agg_scheduler() → run_hourly_aggregation()
  → GET admin-api/api/v1/collector-config (활성 수집기 설정 조회)
  → 각 (system_name, collector_type, metric_group) 조합:
      PROMQL_MAP[collector_type][metric_group] 쿼리 목록 조회
      → _query_prometheus() 각 지표 수집
      → _detect_anomaly() 이상 감지
      → _call_llm() LLM 예측 생성 (이상 감지 시)
      → aggregation_vector_client 유사 패턴 검색 (Qdrant)
      → POST admin-api/api/v1/aggregations/hourly
      → 이상 감지 시 Teams 프로액티브 알림
```

**collector_type → PROMQL_MAP 매핑:**

| collector_type | metric_group | 예시 PromQL |
|---|---|---|
| `synapse_agent` | `cpu` | `avg_over_time(cpu_usage_percent{system_name="X",core="total"}[1h])` |
| `synapse_agent` | `memory` | `avg_over_time(...)` / `memory_used_bytes{type="used\|total"}` |
| `synapse_agent` | `disk` | `avg_over_time(rate(disk_bytes_total{direction="read"}[5m])[1h:5m])` |
| `synapse_agent` | `network` | `avg_over_time(rate(network_bytes_total{direction="rx"}[5m])[1h:5m])` |
| `synapse_agent` | `log` | `sum_over_time(increase(log_error_total[5m])[1h:5m])` |
| `synapse_agent` | `web` | `sum_over_time(increase(http_request_total[5m])[1h:5m])` |
| `node_exporter` | `cpu` | `avg_over_time(node_cpu_usage_percent[1h])` _(레거시)_ |
| `jmx_exporter` | `jvm_heap` | `avg_over_time(jvm_heap_used_percent[1h])` _(레거시)_ |
| `db_exporter` | `db_connections` | `avg_over_time(db_connections_active_percent[1h])` _(레거시)_ |

### WF7~WF11 대체: 일/주/월/장기 집계 및 추세 알림
```
_daily_agg_scheduler()   → 07:30 — 시간별 → 일별 롤업
_weekly_agg_scheduler()  → 월요일 08:00 — 일별 → 주간 리포트
_monthly_agg_scheduler() → 1일 08:00 — 일별 → 월간 리포트
_longperiod_agg_scheduler() → 1일 09:00 — 분기/반기/연간
_trend_agg_scheduler()   → 4시간마다 — 추세 이상 패턴 감지 → 임박 장애 알림
```

---

## 6. admin-api — 대시보드 API

```
GET /api/v1/dashboard/health
  → systems 목록 조회
  → 각 시스템별:
      alert_history (최근 24h metric alerts 수)
      log_analysis_history (최근 24h warning/critical 수)
      metric_hourly_aggregations (최근 llm_prediction)
  → 종합 상태 판정:
      critical: alert 있음 or log critical 있음
      warning: log warning 있음 or hourly 이상 감지
      normal: 모두 정상
```

```
GET /api/v1/dashboard/systems/{id}/detail
  → 시스템 정보 + 최근 알림 + 최근 로그 분석 + 최근 집계
```

```
WebSocket /ws/alerts
  → 알림 발생 시 실시간 push (notify_alert_fired, notify_log_analysis)
```

---

## 7. 프론트엔드 컴포넌트 매핑

### 대시보드 (`/` — DashboardPage.tsx)
| 컴포넌트 | API 출처 | 표시 데이터 |
|---|---|---|
| `DashboardSummary` | `GET /api/v1/dashboard/health` | 전체 시스템 수, critical/warning/normal 카운트 |
| `SystemHealthGrid` | `GET /api/v1/dashboard/health` | 시스템별 상태 카드 그리드 |
| `EnhancedSystemCard` | 시스템별 health 데이터 | 상태 뱃지, 최근 알림, 로그 분석 요약 |
| `useWebSocket` | `WebSocket /ws/alerts` | 실시간 알림 토스트 |
| `useDashboardHealth` | polling (30s) | 헬스 데이터 자동 갱신 |

### 시스템 상세 (`/systems/:id`)
| 컴포넌트 | API 출처 | 표시 데이터 |
|---|---|---|
| `AgentDetailPage` | `GET /api/v1/agents/{id}/live-status` | agent_up, agent_heartbeat → 수집기 활성 뱃지 |
| 집계 탭 | `GET /api/v1/aggregations/hourly?system_id=X` | metrics_json → cpu_avg/mem_used_pct/disk_util_pct 등 |
| 로그 분석 탭 | `GET /api/v1/analysis?system_id=X` | LLM 분석 결과, 심각도 |

### metrics_json 내부 필드 구조
`metric_hourly_aggregations.metrics_json` 에 저장되는 JSON 키:

| 키 | 단위 | collector_type |
|---|---|---|
| `cpu_avg`, `cpu_max`, `cpu_min`, `cpu_p95` | % | synapse_agent / node_exporter |
| `iowait` | % | node_exporter |
| `mem_used_pct`, `mem_p95`, `mem_avail_gb` | %, %, GB | synapse_agent / node_exporter |
| `disk_util_pct`, `disk_read_iops`, `disk_write_iops` | %, IOPS, IOPS | node_exporter |
| `disk_read_mb`, `disk_write_mb` | MB | synapse_agent |
| `net_rx_mb`, `net_tx_mb` | MB | synapse_agent / node_exporter |
| `load1`, `load5`, `load15` | — | synapse_agent / node_exporter |
| `log_errors` | count | synapse_agent |
| `heap_used_pct`, `heap_p95`, `gc_time_pct` | % | jmx_exporter |
| `conn_active_pct`, `cache_hit_rate`, `repl_lag_sec` | %, %, s | db_exporter |

> **프론트엔드 참조 파일:** `src/types/aggregation.ts` (MetricsPayload), `src/lib/metrics-transform.ts`, `src/lib/utils.ts`

---

## 8. PostgreSQL 핵심 테이블 ↔ 서비스 매핑

| 테이블 | Write | Read | 설명 |
|---|---|---|---|
| `systems` | admin-api (관리) | log-analyzer, admin-api | 모니터링 대상. system_name = Prometheus 라벨 |
| `contacts` | admin-api (관리) | admin-api | 담당자. llm_api_key, teams_upn |
| `alert_history` | admin-api | admin-api, dashboard | 알림 이력. alert_type: metric/metric_resolved/log_analysis |
| `alert_cooldown` | admin-api | admin-api | 5분 중복 발송 방지 |
| `log_analysis_history` | admin-api | admin-api, dashboard | LLM 로그 분석 결과 |
| `system_collector_config` | admin-api | log-analyzer | 집계 수집기 등록. collector_type + metric_group |
| `metric_hourly_aggregations` | log-analyzer | admin-api, frontend | 1시간 집계 + LLM 이상 분석 |
| `metric_daily_aggregations` | log-analyzer | admin-api | 일별 롤업 |
| `metric_weekly_aggregations` | log-analyzer | admin-api | 주간 롤업 |
| `metric_monthly_aggregations` | log-analyzer | admin-api | 월/분기/반기/연간. period_type으로 구분 |
| `aggregation_report_history` | log-analyzer | admin-api | Teams 주기 리포트 발송 이력 |

---

## 9. Qdrant 벡터 컬렉션

| 컬렉션 | Write | Read | 용도 |
|---|---|---|---|
| `log_incidents` | log-analyzer (analyzer.py) | log-analyzer | 로그 이상 이력 + 해결책 벡터 |
| `metric_hourly_patterns` | log-analyzer (aggregation_vector_client.py) | log-analyzer | 1시간 집계 패턴 벡터 |
| `aggregation_summaries` | log-analyzer (aggregation_vector_client.py) | log-analyzer | 집계 요약 벡터 |
| `metric_baselines` | log-analyzer (vector_client.py) | log-analyzer | 메트릭 기준선 벡터 |

---

## 10. n8n 워크플로우 현황

| WF | 역할 | 현재 상태 |
|---|---|---|
| WF2 | Alertmanager webhook → metric 유사도 검색 → admin-api 알림 | **n8n 운영 중** |
| WF3 | Teams 피드백 버튼 → 해결책 Qdrant 업데이트 | **n8n 운영 중** |
| WF4 | 매일 08:00 전일 집계 요약 Teams 발송 | **n8n 운영 중** |
| WF5 | 30분 주기 미확인 알림 에스컬레이션 | **n8n 운영 중** |
| WF12 | 수동/배포 시 집계 컬렉션 초기화 | **n8n 운영 중** |
| WF1, WF6~WF11 | 로그 분석, 집계, 리포트 | **log-analyzer 내부 스케줄러로 이관** |
