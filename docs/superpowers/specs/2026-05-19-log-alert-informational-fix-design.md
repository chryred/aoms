# 로그 알림성 오분류 및 prometheus_analyzer 로그 에러율 알림 개선 설계

## Context

synapse_agent가 수집하는 `log_error_total` 메트릭에는 알림성(비즈니스 상태 통보) 로그도 ERROR 레벨로
포함된다. 현재 두 가지 문제가 있다.

**Issue 1 — LLM 오분류**: log-analyzer의 LLM이 알림성 로그를 경고성(warning)으로 오판하여
Qdrant에 `is_notification=false`로 저장 → Teams 불필요 알림 발송.

원인: Java 구조화 로그 형식 `{ClassName(File.java:line)}`이 스택트레이스 패턴(`at com.xxx`)과
시각적으로 유사하여 LLM이 혼동. `java.lang.SomeException: message` 단독(뒤에 `at` 라인 없음)도
마찬가지로 스택트레이스로 오인.

예: `{com.shinsegae.support.batch.ScheduledJobInvoker.executeInternal(ScheduledJobInvoker.java:160)}`
→ 이는 구조화 로그 호출 위치 필드이며 스택트레이스가 아님.

**Issue 2 — prometheus_analyzer 로그 에러율 알림**: admin-api `prometheus_analyzer`가 5분마다
`rate(log_error_total[5m]) * 60`을 집계해 임계치(`PROM_ALERT_LOG_ERROR_RATE`, 기본 5건/분)
초과 시 Teams 알림을 발송한다. 이 집계는 알림성 로그를 구분하지 않아 알림성 로그가 5건/분을
넘으면 불필요 알림이 발생한다.

log-analyzer의 LLM 파이프라인이 이미 로그 기반 이상 감지를 담당하므로,
`prometheus_analyzer`의 로그 에러율 알림은 역할 중복이자 노이즈 원인이다.

---

## 설계

### Issue 1: LLM 프롬프트 개선

**파일**: `main-server/services/log-analyzer/analyzer.py`
**위치**: `ANALYSIS_QUERY` 상수 (라인 62-70)

현재 판단 기준 1번 조건에 구조화 로그 형식 예외 규칙을 추가한다.

**변경 전**:
```
1. 스택트레이스가 없다 (at com., at org., Caused by: 패턴 없음)
   ※ 예외 클래스명만 있고 스택트레이스 없는 경우 → 메시지 내용으로 판단
```

**변경 후**:
```
1. 스택트레이스가 없다 (at com., at org., Caused by: 패턴 없음)
   ※ {ClassName(File.java:line)} 형식은 구조화 로그 위치 필드이며 스택트레이스가 아님
   ※ {java.lang.SomeException: message} 단독 형식(뒤에 at 라인 없음)도 스택트레이스 아님
   ※ 예외 클래스명만 있고 스택트레이스 없는 경우 → 메시지 내용으로 판단
```

`is_notification=true` 시 root_cause 작성 규칙 아래에 few-shot 예시 2개를 추가한다:
```
is_notification 분류 예시:
- {com.xxx.BatchJob.execute(BatchJob.java:160)} {java.lang.IllegalAccessException: 배치는 사용중지 되었습니다.}
  → is_notification=true (스택트레이스 없음, 비즈니스 규칙 거부)
- SSO Auth Server is NOT AVAILABLE / is SSO activated = false
  → is_notification=true (외부 연결 실패 아님, 설정 상태 통보)
```

---

### Issue 2: prometheus_analyzer 로그 에러율 anomaly 검출 제거

**파일**: `main-server/services/admin-api/services/prometheus_analyzer.py`
**위치**: 라인 377-398 (`for hc in hosts.values()` 블록 내 `log_error_rate` anomaly 추가 부분)

`log_error_rate` **데이터 수집은 유지**한다. `sm.log_error_rate`와 `sm.log_by_level`은
`prompts.py`의 LLM 프롬프트 컨텍스트(`build_prometheus_llm_prompt`)에서 CPU·메모리 교차 분석에
활용된다. 수집 코드(라인 360-375)는 건드리지 않는다.

**제거 대상**: 라인 377-398의 `for hc in hosts.values():` 블록 전체.
이 블록은 `log_error_rate > threshold` 조건을 검사해 `sm.anomalies`에 추가하고
`sm.matched_metric_types`에 `LOG_ERROR_RATE`를 넣는다. 이 부분만 삭제한다.

**제거 후 상태**:
- `sm.log_error_rate` 값은 수집됨 (LLM 프롬프트에서 "로그 에러 X건/분 ⚠️" 형태로 노출)
- `sm.anomalies`에 log_error_rate 항목이 추가되지 않음 → 로그 에러율만으로 Teams 알림 발화 없음
- CPU·메모리 등 다른 메트릭이 임계치를 초과할 경우, LLM 프롬프트에 log_error_rate 맥락은
  포함되어 교차 분석 품질 유지됨

**`metric_exclusions` 연동**: 라인 380-388의 `_excluded()` 호출(LOG_ERROR_RATE exclusion 검사)도
함께 제거한다. anomaly 자체를 추가하지 않으므로 exclusion 검사가 불필요하다.

---

## 변경 파일 목록

| 파일 | 변경 내용 |
|---|---|
| `main-server/services/log-analyzer/analyzer.py` | `ANALYSIS_QUERY` 라인 64-65에 구조화 로그 형식 예외 규칙 2줄 추가. 라인 70 아래에 few-shot 예시 블록 추가 |
| `main-server/services/admin-api/services/prometheus_analyzer.py` | 라인 377-398 (`log_error_rate` anomaly 검출 블록) 삭제 |

---

## 검증 방법

1. **Issue 1 검증**:
   - 로컬에서 `make run-analyzer` 실행
   - `POST /analyze/trigger` 수동 트리거
   - 문제 로그 샘플(BatchJobVocAnswer, SSO checkSSOActivate)이 포함된 시스템 확인
   - log-analyzer 로그에서 `is_notification=true, severity=info` 결과 확인
   - Qdrant `log_incidents` 컬렉션에 `is_notification: true` payload로 저장됨을 확인

2. **Issue 2 검증**:
   - `make run-api` 실행
   - prometheus_analyzer 5분 주기 실행 후 로그 확인
   - `log_error_rate` 임계치 초과 시에도 Teams 알림이 발송되지 않음을 확인
   - CPU·메모리 임계치 초과 시 LLM 프롬프트에 로그 에러 컨텍스트가 포함됨을 확인 (⚠️ 표기)
   - `make test-api` 단위 테스트 통과 확인

---

## 영향 범위

- **제거되는 기능**: `prometheus_analyzer`의 로그 에러율 단독 Teams 알림
  - 로그 이상은 log-analyzer LLM 파이프라인(5분 주기)이 완전히 대체
  - CPU/메모리/HTTP/네트워크/디스크 메트릭 기반 알림은 그대로 유지
- **유지되는 기능**: CPU·메모리 등 다른 메트릭과 동시 이상 시 LLM 프롬프트에 로그 컨텍스트 포함
- **`metric_exclusions.metric_type='log_error_rate'`**: 기존 등록 규칙은 효과 없어지므로
  운영 중 해당 규칙이 있다면 비활성화 권장 (코드에서 검사 자체를 제거하므로 오류는 없음)
