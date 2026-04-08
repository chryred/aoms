# Synapse-V 향후 개선 방향

> 작성일: 2026-04-07  
> 현재 구현 상태: Phase 1~5 완료, Frontend UI 완료

---

## 현재 시스템의 구조적 공백

```
현재 관측 가능성(Observability) 커버리지:

  Metrics  ████████████████  ✅ Prometheus + 집계
  Logs     ████████████░░░░  ✅ Loki, 단 수집 범위 제한
  Traces   ░░░░░░░░░░░░░░░░  ❌ 완전 부재
  Events   ░░░░░░░░░░░░░░░░  ❌ 완전 부재
  Profiles ░░░░░░░░░░░░░░░░  ❌ 완전 부재 (선택적)
```

**가장 큰 공백: 분산 추적(Tracing) 없음**  
메트릭은 "CPU 90%"를 알려주고, 로그는 "에러 발생"을 알려주지만, "A → B → C 어디서 느려졌나"를 추적하는 수단이 없다.

---

## 1. 수집 계층 확장

### 1-1. 분산 추적 — Grafana Tempo + OpenTelemetry

**왜 필요한가**  
현재 JEUS/Java 미들웨어에서 JMX로 집계 지표만 수집하는데, 실제 트랜잭션이 어느 컴포넌트에서 지연되는지 알 수 없다.

```yaml
# 추가 구성 예시 (Server A)
tempo:
  image: grafana/tempo:latest
  ports: ["3200:3200"]
  # Grafana → Tempo 데이터소스 연결
  # Loki-Tempo 상관관계: logfmt에 traceId 포함 → 로그↔추적 클릭 연결
```

```
수집 방식:
  Java(JEUS) → OpenTelemetry Java Agent → Grafana Alloy → Tempo
  Alloy 설정에 otelcol.receiver.otlp 추가만으로 연동
```

**폐쇄망 적합성**: Alloy에 OTLP Receiver 추가는 바이너리 업그레이드 없이 설정만으로 가능.

---

### 1-2. 합성 모니터링 — Blackbox Exporter

**왜 필요한가**  
현재 모든 수집은 "서버 내부" 관점. 실제 사용자 관점의 가용성(HTTP 200 응답, SSL 인증서 만료 등)을 체크하지 않는다.

```yaml
- job_name: synthetic_http
  metrics_path: /probe
  params: {module: [http_2xx]}
  static_configs:
    - targets:
        - https://결제서비스.내부/health
        - https://POS시스템.내부/api/status
  relabel_configs:
    - source_labels: [__address__]
      target_label: __param_target
```

```
추가 체크 가능:
  - HTTP 응답시간 / 상태코드
  - TCP 포트 연결 가능 여부
  - SSL 인증서 만료 D-day 알림
  - DNS 해석 시간
```

---

### 1-3. 로그 수집 범위 확장

| 로그 유형 | 현재 수집 | 개선 방향 |
|---|---|---|
| 애플리케이션 ERROR/WARN | ✅ Alloy | - |
| DB 슬로우 쿼리 | ❌ | PostgreSQL `pg_stat_statements` + slow query log |
| OS 감사 로그 | ❌ | `/var/log/audit/audit.log` → Alloy |
| 네트워크 장비 | ❌ | syslog → Alloy (RHEL 8.9 호환) |
| 배포/변경 이벤트 | ❌ | 별도 이벤트 수집 체계 필요 |

```
슬로우 쿼리 알림 가치:
  DB CPU 90% 알림 발생 → "어떤 쿼리가 원인?"을 지금은 DBA가 직접 확인
  → pg_stat_statements 집계 + LLM 분석으로 자동 진단 가능
```

---

### 1-4. 이벤트 수집 — 변경 관리 연동

**왜 필요한가**  
알림이 발생했을 때 "방금 뭔가 배포됐나?"가 가장 먼저 확인하는 것인데, 지금은 수동 확인만 가능하다.

```
이벤트 소스 후보:
  - 배포 완료 시 n8n webhook → Prometheus Alertmanager annotation
  - Grafana Annotations API → 그래프에 배포 시점 수직선 표시
  - admin-api에 /api/v1/events 엔드포인트 추가
    → 담당자가 "금일 14:30 결제모듈 v2.3.1 배포" 등록
    → Grafana 대시보드에 자동 표시 + LLM 분석 컨텍스트 제공
```

---

## 2. AI 분석 고도화

### 2-1. Phase 4d 구체화 — Agentic LLM (ReAct 루프)

계획된 기능의 구체적 설계 방향.

```
현재 (단순 LLM 호출):
  로그 수집 → 프롬프트 구성 → LLM → 결과 반환

개선 (ReAct 루프):
  로그 수집 → LLM에게 "도구 사용 권한" 부여
    → LLM: "Prometheus에서 CPU 추이를 더 봐야겠다"
    → Tool: query_prometheus("cpu_usage[1h]", system="결제서버")
    → LLM: "Loki에서 DB 연결 에러도 확인"
    → Tool: query_loki("{system_name='결제서버'} |= 'Connection refused'")
    → LLM: "근본 원인은 DB 연결 풀 고갈 → 해결 방안 제시"
    → 결과 반환 (근거 포함)
```

**사용 도구 목록 (Tools)**:
```python
TOOLS = [
    prometheus_query,    # 메트릭 조회
    loki_query,          # 추가 로그 조회
    qdrant_search,       # 과거 유사 사례
    tempo_trace_search,  # 트레이스 조회 (Tempo 도입 시)
    get_system_topology, # 시스템 의존관계
]
```

**구현 복잡도**: 기존 Loki/Prometheus 클라이언트 재사용 가능, `tool_definitions` + `function_call` 응답 처리 루프만 추가.

---

### 2-2. 동적 베이스라인 / 시계열 이상 감지

**현재 한계**: Prometheus alert rules는 정적 임계값 (`cpu > 80%`). 백화점 환경은 주말 트래픽이 평일 3배인데, 같은 임계값을 적용하면 오탐/미탐이 발생한다.

```
옵션 A — Prometheus 통계적 베이스라인 (권장, 즉시 적용 가능)
  record rules로 7일 이동평균 + 표준편차 계산
  alert: current > avg + 3σ (요일/시간대별 그룹)

옵션 B — log-analyzer에 Prophet/IsolationForest 추가
  매주 모델 재학습 → dynamic threshold 생성
  → admin-api aggregations 테이블에 저장
  → Prometheus alert rules를 동적으로 업데이트 (파일 생성 + reload)

옵션 C — 오픈소스 anomaly-detection 라이브러리
  Grafana Enterprise 없이 유사 기능 구현
```

---

### 2-3. 멀티 시스템 상관관계 분석

**현재**: 시스템별 독립 분석.

```
상관관계 탐지 흐름:
  1. 동일 시간대 여러 시스템에서 이상 감지
  2. LLM: "결제서버 에러 + DB서버 CPU 급등 + 네트워크 지연 동시 발생"
     → "공통 원인: DB 서버 장애 가능성"
  3. 연쇄 알림 대신 단일 "인시던트 카드" 발송

구현 포인트:
  analyzer.py에 run_analysis() 호출 후
  동일 5분 윈도우의 이상 목록을 모아 cross-system LLM 분석 추가
  → Qdrant에 "incident_cluster" 컬렉션 추가 고려
```

---

### 2-4. 자연어 쿼리 인터페이스 (NL2PromQL)

```
프론트엔드에 자연어 검색 추가:
  담당자: "어제 오후 결제 서버 응답시간 어떻게 됐어?"
  LLM → PromQL 생성 → Prometheus API 호출 → 차트 + 해석 반환

  담당자: "지난 주 에러가 제일 많았던 시스템은?"
  LLM → LogQL 생성 → Loki 집계 → 순위 반환

구현: log-analyzer에 /query/natural 엔드포인트 추가
```

---

### 2-5. 해결책(Solution) 신뢰도 시스템

현재는 해결책이 Qdrant에 저장되지만 효과 검증이 없다.

```
개선 흐름:
  해결책 등록 → Qdrant 저장
    → 이후 동일 패턴 재발 여부 추적 (3일 이내 재발 = 미해결)
    → 재발 없음 = 신뢰도 +1, 재발 = 신뢰도 -1
  
  LLM 프롬프트: "신뢰도 높은 해결책 우선 제시"
  Teams 알림: "검증된 해결책 (5회 적용, 성공률 80%)"
```

---

## 3. 알림 / 대응 품질 개선

### 3-1. Alert Fatigue 해결

현재 5분 쿨다운은 동일 alert 중복만 막는다. 서로 다른 alert이 동시에 쏟아지는 경우가 더 큰 문제다.

```
개선 방안:

  A. 시간대별 severity 필터링
     오전 9시-오후 6시: 모든 severity 알림
     야간/주말: critical만 알림 (warning 억제)
     → systems 테이블에 alert_schedule JSON 컬럼 추가

  B. 의존성 기반 알림 억제 (Alert Dependency)
     인프라 서버 다운 → 해당 서버의 모든 서비스 알림 억제
     → system_dependencies 테이블: parent_system_id, child_system_id
     → 부모 시스템 firing 중이면 자식 알림 생략

  C. Smart Grouping
     동일 5분 내 3개 이상 시스템 동시 이상 → 개별 알림 대신
     "인시던트 요약 카드" 1장 발송 (LLM이 요약)
```

---

### 3-2. Runbook 자동화 + 1-click 대응

```
현재: Teams 알림 → 담당자가 수동 조치 → 피드백 등록

개선 — Teams 카드에 LLM 추천 조치 포함:
  [이상 감지] DB 연결 풀 고갈
  원인 분석: ...
  
  추천 조치 (유사 해결 이력 기반):
  1. DB 연결 수 확인: show processlist
  2. 연결 풀 재시작: docker restart ...
  
  [확인함] [조치 완료] [에스컬레이션]
  ↑ 버튼 클릭 → n8n webhook → 상태 업데이트
```

---

### 3-3. MTTR / SLA 트래킹

```
현재 누락된 데이터:
  - 장애 시작 시각: alert_history.created_at 있음
  - 장애 해결 시각: 명확하지 않음
  - MTTR 계산 불가

개선:
  alert_history에 resolved_at, resolution_type 컬럼 추가
  → acknowledged / auto_resolved / manual_resolved 구분
  → 주간/월간 리포트에 시스템별 MTTR, 가용성(%) 자동 계산 포함
```

---

## 4. 백화점 특화 모니터링

### 4-1. 비즈니스 메트릭 연동

기술 메트릭과 비즈니스 영향을 연결하는 것이 백화점 환경에서 가장 큰 가치다.

```
수집 대상:
  - 결제 트랜잭션 수 / 오류율 (POS, 온라인몰)
  - 재고 조회 API 응답시간
  - 영수증 발행 실패율

방법:
  애플리케이션에 /metrics 엔드포인트 추가 (Prometheus client 라이브러리)
  또는 DB에서 집계 쿼리 → Prometheus Pushgateway

알림 메시지 강화:
  현재: "CPU 90% 초과"
  개선: "CPU 90% 초과 — 동시간대 결제 실패율 2.3% 증가 중"
```

---

### 4-2. 계절성 인식 (Seasonal Awareness)

```
백화점 특수 기간 대응:
  admin-api에 /api/v1/events/calendar 추가
  → 특수 기간 등록: {"name": "추석연휴", "start": "...", "end": "..."}
  → LLM 분석 컨텍스트에 포함: "현재 추석 연휴 기간, 트래픽 증가 정상"
  → 동적 임계값 배율 자동 적용

효과:
  연휴 기간 트래픽 3배 급증 → 오탐 방지
  세일 기간 패턴 학습 → 임계값 자동 조정
```

---

## 5. 운영성 개선

### 5-1. Self-Monitoring (Phase 6 보완)

```
모니터링 대상에 Synapse-V 자신 추가:

  admin-api 메트릭:
    - 엔드포인트별 응답시간 (Prometheus instrumentator)
    - Teams 발송 성공률
    - 알림 처리 큐 깊이

  log-analyzer 메트릭:
    - LLM API 호출 시간 / 실패율
    - Qdrant 검색 레이턴시
    - 분석 사이클 완료 시간
    - 시스템별 로그 수집 개수 (0이면 Alloy 장애 가능성)

  이상 감지:
    "log-analyzer가 5분 동안 분석을 완료하지 못함" → Self-alert
```

---

### 5-2. 토폴로지 맵 (Dependency Visualization)

```
프론트엔드에 서비스 의존성 맵 추가:

  현재: 목록형 시스템 관리 화면
  개선: 노드-엣지 그래프로 시스템 간 의존성 시각화
    → 장애 발생 시 영향 받는 다운스트림 서비스 즉시 파악
    → D3.js 또는 React Flow 활용 (추가 서비스 불필요)

  데이터 모델:
    system_dependencies 테이블: source_id, target_id, dependency_type
    (call / db / cache / queue)
```

---

## 우선순위 로드맵

| 우선순위 | 개선 항목 | 복잡도 | 효과 |
|---|---|---|---|
| **즉시** | Blackbox Exporter (합성 모니터링) | 낮음 | 높음 |
| **즉시** | 동적 베이스라인 (Prometheus 통계 rules) | 낮음 | 높음 |
| **즉시** | 배포 이벤트 수집 + Grafana annotation | 낮음 | 중간 |
| **단기** | Alert 시간대별 필터링 + Grouping | 중간 | 높음 |
| **단기** | MTTR 트래킹 (alert_history 컬럼 추가) | 낮음 | 중간 |
| **단기** | Phase 4d Agentic LLM (ReAct 루프) | 높음 | 매우 높음 |
| **중기** | Grafana Tempo (분산 추적) | 중간 | 높음 |
| **중기** | 자연어 쿼리 인터페이스 (NL2PromQL) | 중간 | 높음 |
| **중기** | 멀티 시스템 상관관계 분석 | 높음 | 높음 |
| **중기** | 해결책 신뢰도 시스템 | 중간 | 중간 |
| **장기** | 비즈니스 메트릭 연동 | 높음 | 매우 높음 |
| **장기** | 토폴로지 맵 (프론트엔드) | 중간 | 중간 |
| **장기** | 계절성 인식 캘린더 | 중간 | 중간 |
