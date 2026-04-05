# Synapse-V 테스트 계획서

> **기준일**: 2026-04-05
> **시스템**: 개발 환경 (localhost)
> **제약 조건**: Teams Webhook 실제 발송 / LLM API (내부망) / Ollama 임베딩은 선택 테스트

---

## 1. 테스트 범위 개요

| 레이어 | 도구 | 자동화 | 비고 |
|---|---|---|---|
| 단위 테스트 | pytest | ✅ | SQLite in-memory, Teams 목 |
| API 통합 테스트 | curl / Makefile | 부분 | 실 DB 사용 |
| 워크플로우 테스트 | curl → log-analyzer | 수동 | LLM 실패 허용 |
| Frontend E2E | Preview MCP / 브라우저 | 수동 | 로그인 후 화면 순회 |
| 알림 파이프라인 | Makefile inject | 수동 | Teams 실패 허용 |

---

## 2. 사전 조건

### 2-1. 서비스 기동 확인

```bash
# 인프라 컨테이너
docker ps --format "{{.Names}}\t{{.Status}}" | grep dev-

# 필수: dev-postgres, dev-loki, dev-prometheus, dev-qdrant

# 앱 기동
make run-api       # admin-api :8080
make run-analyzer  # log-analyzer :8000
make run-frontend  # frontend :3002(or 3001)
```

### 2-2. 헬스체크

```bash
curl -s http://localhost:8080/health   # {"status":"ok"}
curl -s http://localhost:8000/health   # {"status":"ok","running":false,...}
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001  # 200
```

### 2-3. 테스트 계정

```bash
# admin 계정 생성 (최초 1회)
cd main-server/services/admin-api
ADMIN_EMAIL=admin@test.com ADMIN_PASSWORD=Test1234! \
  python scripts/create_admin.py

# 토큰 획득 (이후 API 테스트에서 사용)
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Test1234!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

---

## 3. 단위 테스트 (자동화)

### 실행 방법

```bash
cd /path/to/aoms
make test-api          # 전체 실행
# 또는
cd main-server/services/admin-api
python -m pytest -v    # 상세 출력
python -m pytest -v tests/test_alerts.py   # 개별 파일
```

### 테스트 파일 목록 및 커버리지

| 파일 | 케이스 수 | 주요 검증 항목 |
|---|---|---|
| `test_auth.py` | 8 | 로그인 성공/실패, 토큰 갱신, 로그아웃, /me |
| `test_systems.py` | 9 | 시스템 CRUD, os_type/system_type 유효성 |
| `test_contacts.py` | 10 | 담당자 CRUD, 시스템-담당자 N:M 연결 |
| `test_alerts.py` | 10 | 알림 수신, 쿨다운, resolved 처리, acknowledge |
| `test_analysis.py` | 10 | LLM 분석 결과 수신, severity별 Teams 발송 |
| `test_aggregations.py` | 10 | hourly/daily/weekly/monthly upsert·조회 |
| `test_collector_config.py` | 14 | 수집기 CRUD, 템플릿 조회 |
| `test_reports.py` | 7 | 리포트 이력 저장·조회·upsert |
| **합계** | **78** | |

### 합격 기준

```
N passed, 0 failed, M warnings
```

---

## 4. API 통합 테스트

> 실 PostgreSQL 사용. `make seed-db` 선행 필요.

### 4-1. 인증 (Auth)

| ID | 테스트 케이스 | 요청 | 기대 결과 |
|---|---|---|---|
| A-01 | 정상 로그인 | POST /auth/login (올바른 자격증명) | 200, access_token 반환 |
| A-02 | 잘못된 비밀번호 | POST /auth/login (틀린 pw) | 401 |
| A-03 | 미승인 계정 | POST /auth/login (is_approved=false) | 403 |
| A-04 | 토큰 갱신 | POST /auth/refresh (refresh 쿠키 포함) | 200, 새 access_token |
| A-05 | 내 정보 조회 | GET /auth/me (Bearer 포함) | 200, email·role 반환 |
| A-06 | 로그아웃 | POST /auth/logout | 204, refresh 쿠키 삭제 |

```bash
# A-01 예시
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Test1234!"}' | python3 -m json.tool
```

---

### 4-2. 시스템 관리 (Systems)

| ID | 테스트 케이스 | 요청 | 기대 결과 |
|---|---|---|---|
| S-01 | 시스템 등록 | POST /systems (전체 필드) | 201, id 반환 |
| S-02 | 중복 system_name 등록 | POST /systems (동일 name) | 409 또는 500 |
| S-03 | 전체 목록 조회 | GET /systems | 200, 배열 |
| S-04 | 단건 조회 | GET /systems/{id} | 200, 상세 |
| S-05 | 존재하지 않는 ID | GET /systems/99999 | 404 |
| S-06 | 수정 | PATCH /systems/{id} | 200, 수정된 값 |
| S-07 | 삭제 | DELETE /systems/{id} | 204 |
| S-08 | 담당자 연결 | POST /systems/{id}/contacts | 201 |
| S-09 | 담당자 연결 해제 | DELETE /systems/{id}/contacts/{cid} | 204 |

```bash
# S-01 예시
curl -s -X POST http://localhost:8080/api/v1/systems \
  -H "Content-Type: application/json" \
  -d '{"system_name":"test-sys","display_name":"테스트","host":"host1",
       "os_type":"linux","system_type":"was"}' | python3 -m json.tool
```

---

### 4-3. 알림 파이프라인 (Alerts)

| ID | 테스트 케이스 | 요청 | 기대 결과 |
|---|---|---|---|
| AL-01 | firing 알림 수신 | POST /alerts/receive (status=firing) | {"processed":[{"status":"sent" 또는 "no_webhook"}]} |
| AL-02 | resolved 알림 수신 | POST /alerts/receive (status=resolved) | {"processed":[{"status":"resolved"}]} |
| AL-03 | 쿨다운 중 재수신 | AL-01 직후 동일 payload 재전송 | status="cooldown_skipped" |
| AL-04 | 쿨다운 초기화 후 재수신 | make reset-cooldown → 재전송 | status="sent" 또는 "no_webhook" |
| AL-05 | 알림 이력 조회 | GET /alerts?limit=10 | 배열, alert_type 포함 |
| AL-06 | severity 필터 | GET /alerts?severity=critical | critical만 반환 |
| AL-07 | acknowledge | POST /alerts/{id}/acknowledge | acknowledged=true |

```bash
# AL-01: 메트릭 알림 주입
make test-metric

# AL-03: 쿨다운 확인
make test-metric   # cooldown_skipped 예상

# AL-04: 쿨다운 초기화 후 재테스트
make reset-cooldown && make test-metric
```

---

### 4-4. LLM 분석 결과 (Analysis)

| ID | 테스트 케이스 | 요청 | 기대 결과 |
|---|---|---|---|
| AN-01 | critical 결과 수신 | POST /analysis (severity=critical) | 201, alert_sent 필드 포함 |
| AN-02 | warning 결과 수신 | POST /analysis (severity=warning) | 201 |
| AN-03 | info 결과 수신 | POST /analysis (severity=info) | 201, alert_sent=false |
| AN-04 | 분석 이력 조회 | GET /analysis?limit=20 | 배열 |
| AN-05 | anomaly_type 확인 | AN-01~03 응답 | new/recurring/related/duplicate 중 하나 |

```bash
# AN-01: LLM 우회 직접 주입
make inject-analysis

# AN-02: warning severity 주입
curl -s -X POST http://localhost:8080/api/v1/analysis \
  -H "Content-Type: application/json" \
  -d '{"system_id":1,"instance_role":"was1","log_content":"WARN...",
       "analysis_result":"경고 감지","severity":"warning",
       "root_cause":"메모리 누수","recommendation":"재시작",
       "anomaly_type":"recurring","similarity_score":0.88}'
```

---

### 4-5. 집계 데이터 (Aggregations)

| ID | 테스트 케이스 | 요청 | 기대 결과 |
|---|---|---|---|
| AGG-01 | hourly 저장 | POST /aggregations/hourly | 201 |
| AGG-02 | hourly upsert | 동일 system_id+hour_bucket 재전송 | 201, 기존 ID 반환 |
| AGG-03 | from_dt/to_dt 필터 (Z포함) | GET /aggregations/hourly?from_dt=...Z | 200 (버그 수정 확인) |
| AGG-04 | daily 저장/조회 | POST+GET /aggregations/daily | 201/200 |
| AGG-05 | weekly 저장/조회 | POST+GET /aggregations/weekly | 201/200 |
| AGG-06 | monthly (period_type 4종) | POST monthly/quarterly/half_year/annual | 201 |
| AGG-07 | trend-alert 조회 | GET /aggregations/trend-alert | 200, prediction 있는 항목 |

```bash
# AGG-03: timezone Z 버그 수정 확인 (핵심)
curl -s "http://localhost:8080/api/v1/aggregations/hourly?\
system_id=1&collector_type=node_exporter\
&from_dt=2026-04-04T00:00:00.000Z&to_dt=2026-04-05T00:00:00.000Z" \
| python3 -c "import sys,json; d=json.load(sys.stdin); print(f'OK {len(d)}건')"
```

---

### 4-6. 수집기 설정 (Collector Config)

| ID | 테스트 케이스 | 요청 | 기대 결과 |
|---|---|---|---|
| CC-01 | 수집기 등록 | POST /collector-config | 201 |
| CC-02 | 활성화/비활성화 | PATCH /collector-config/{id} (enabled) | 200 |
| CC-03 | 템플릿 조회 (node_exporter) | GET /collector-config/templates/node_exporter | cpu, memory, disk, network, system |
| CC-04 | 템플릿 조회 (jmx_exporter) | GET /collector-config/templates/jmx_exporter | jvm_heap, thread_pool, ... |
| CC-05 | 미지원 타입 | GET /collector-config/templates/unknown | 404 |

---

## 5. log-analyzer 엔드포인트 테스트

| ID | 테스트 케이스 | 요청 | 기대 결과 |
|---|---|---|---|
| LA-01 | 헬스체크 | GET /health | {"status":"ok",...} |
| LA-02 | 분석 트리거 | POST /analyze/trigger | {"status":"triggered"} |
| LA-03 | 분석 상태 확인 | GET /analyze/status | running/finished 상태 |
| LA-04 | hourly 집계 트리거 | POST /aggregation/hourly/trigger | {"status":"triggered"} |
| LA-05 | daily 집계 트리거 | POST /aggregation/daily/trigger | {"status":"triggered"} |
| LA-06 | weekly 집계 트리거 | POST /aggregation/weekly/trigger | {"status":"triggered"} |
| LA-07 | monthly 집계 트리거 | POST /aggregation/monthly/trigger | {"status":"triggered"} |
| LA-08 | 집계 전체 상태 | GET /aggregation/status | WF6~WF11 각 상태 반환 |
| LA-09 | 컬렉션 초기화 (WF12) | POST /aggregation/collections/setup | 200 |
| LA-10 | 벡터 컬렉션 정보 | GET /aggregation/collections/info | 컬렉션 목록·건수 |

```bash
# LA-02~03: 분석 트리거 및 상태 확인
curl -s -X POST http://localhost:8000/analyze/trigger | python3 -m json.tool
sleep 10
curl -s http://localhost:8000/analyze/status | python3 -m json.tool

# LA-08: 집계 파이프라인 전체 상태
curl -s http://localhost:8000/aggregation/status | python3 -m json.tool
```

---

## 6. Loki 로그 주입 테스트

| ID | 테스트 케이스 | 명령 | 기대 결과 |
|---|---|---|---|
| LK-01 | 기본 로그 주입 | make push-logs | HTTP 204 ×3 |
| LK-02 | 시스템별 로그 주입 | curl POST /loki/api/v1/push | HTTP 204 |
| LK-03 | 분석 트리거 연동 | LK-02 후 make trigger-analysis | 분석 실행 (LLM 실패 허용) |

```bash
# LK-01
make push-logs

# LK-02: db-server 로그
TS=$(python3 -c "import time; print(int(time.time())*10**9)")
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3100/loki/api/v1/push \
  -H "Content-Type: application/json" \
  -d "{\"streams\":[{\"stream\":{\"system_name\":\"db-server\",
      \"level\":\"ERROR\"},\"values\":[[\"$TS\",\"ERROR: Connection timeout\"]]}]}"
```

---

## 7. Frontend E2E 테스트

> 브라우저에서 http://localhost:3001 (또는 :3002) 접속 후 수동 진행

### 7-1. 인증

| ID | 화면 | 테스트 항목 | 기대 결과 |
|---|---|---|---|
| FE-01 | 로그인 `/auth/login` | admin 계정 로그인 | 대시보드 이동 |
| FE-02 | 로그인 | 잘못된 비밀번호 | 에러 메시지 표시 |
| FE-03 | 로그아웃 | 로그아웃 버튼 클릭 | 로그인 화면 이동 |

### 7-2. 대시보드

| ID | 화면 | 테스트 항목 | 기대 결과 |
|---|---|---|---|
| FE-04 | 대시보드 `/dashboard` | 시스템 카드 표시 | 등록된 시스템 수만큼 카드 |
| FE-05 | 대시보드 | Critical 배너 | 미확인 critical 건수 배너 표시 |
| FE-06 | 대시보드 | 미확인 알림 피드 | 최근 알림 목록 |

### 7-3. 알림 이력

| ID | 화면 | 테스트 항목 | 기대 결과 |
|---|---|---|---|
| FE-07 | 알림이력 `/alerts` | 전체 목록 조회 | alert_history 전체 |
| FE-08 | 알림이력 | 메트릭/복구/로그분석 탭 필터 | 해당 type만 노출 |
| FE-09 | 알림이력 | severity 드롭다운 필터 | 선택 severity만 노출 |

### 7-4. 시스템 관리

| ID | 화면 | 테스트 항목 | 기대 결과 |
|---|---|---|---|
| FE-10 | 시스템목록 `/systems` | 목록 조회 | 등록 시스템 표시 |
| FE-11 | 시스템목록 | + 시스템 등록 버튼 | 폼 drawer 열림 |
| FE-12 | 시스템상세 `/dashboard/{id}` | 메트릭/알림/분석/담당자 탭 | 각 탭 데이터 로드 |
| FE-13 | 시스템상세 | 담당자 탭 | 연결된 담당자 목록 |

### 7-5. 분석 / 리포트

| ID | 화면 | 테스트 항목 | 기대 결과 |
|---|---|---|---|
| FE-14 | 안정성리포트 `/reports` | 일별 탭 | daily 집계 카드 |
| FE-15 | 안정성리포트 | 주별/월별/분기/반기/연간 탭 | 각 집계 카드 |
| FE-16 | 리포트이력 `/reports/history` | 발송 이력 목록 | report_history 표시 |
| FE-17 | 트렌드예측 `/trends` | prediction 있는 항목 | 경보 카드 또는 정상 메시지 |
| FE-18 | 유사장애검색 `/search` | 시간별/기간별 탭 | 건수 표시 |

### 7-6. 관리 화면

| ID | 화면 | 테스트 항목 | 기대 결과 |
|---|---|---|---|
| FE-19 | 수집기설정 `/collector-configs` | 목록 조회 | 등록된 설정 카드 |
| FE-20 | 수집기위자드 `/systems/{id}/wizard` | 단계 진행 | 5단계 UI |
| FE-21 | 벡터상태 `/vector-health` | 컬렉션 목록 | Qdrant 컬렉션 건수 |
| FE-22 | 사용자관리 `/admin/users` | 사용자 목록 | 전체 사용자 / 승인 관리 |
| FE-23 | 프로필 `/profile` | 내 정보 | 이메일·권한 표시 |
| FE-24 | 피드백 `/feedback` | 분석 이력 목록 | 피드백 가능 항목 |

---

## 8. 회귀 테스트 항목 (버그 수정 확인)

이전 테스트에서 발견·수정된 버그의 회귀 확인.

| ID | 버그 | 확인 방법 | 합격 기준 |
|---|---|---|---|
| REG-01 | `aggregations/hourly` timezone-aware datetime 500 에러 | `GET /aggregations/hourly?from_dt=...Z` | 200 반환, 500 미발생 |
| REG-02 | TrendAlertsPage React 렌더링 경고 | `/trends` 접속 후 브라우저 콘솔 | "Cannot update a component" 경고 없음 |

```bash
# REG-01 확인
curl -s "http://localhost:8080/api/v1/aggregations/hourly?\
system_id=1&from_dt=2026-04-04T00:00:00.000Z&to_dt=2026-04-05T23:59:59.999Z" \
| python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS' if isinstance(d, list) else 'FAIL')"
```

---

## 9. 파이프라인 종합 테스트 (Makefile)

전체 파이프라인을 순서대로 실행하는 합성 시나리오.

```bash
# 전체 순서 실행
make seed-db            # 1. DB 기초 데이터
make test-metric        # 2. 메트릭 알림 주입
make reset-cooldown     # 3. 쿨다운 초기화
make test-metric        # 4. 재주입 (cooldown 우회 확인)
make push-logs          # 5. Loki 로그 주입
make trigger-analysis   # 6. 분석 트리거 (LLM 실패 허용)
make inject-analysis    # 7. 분석 결과 직접 주입
```

### 확인 체크리스트

```bash
# 알림 이력 건수
curl -s "http://localhost:8080/api/v1/alerts?limit=50" \
  | python3 -c "import sys,json; print(f'alerts: {len(json.load(sys.stdin))}건')"

# 분석 이력 건수
curl -s "http://localhost:8080/api/v1/analysis?limit=50" \
  | python3 -c "import sys,json; print(f'analysis: {len(json.load(sys.stdin))}건')"

# 집계 데이터 건수
for t in hourly daily weekly monthly; do
  N=$(curl -s "http://localhost:8080/api/v1/aggregations/$t?limit=100" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
  echo "$t: ${N}건"
done
```

---

## 10. 테스트 결과 기록 양식

```
테스트 일시: YYYY-MM-DD HH:MM
테스트자:
환경: 개발(localhost) / 운영

## 단위 테스트
결과: ___ passed, ___ failed
특이사항:

## API 통합 테스트
| ID | 결과 | 비고 |
|---|---|---|
| A-01 | ✅/❌ | |
| AL-01 | ✅/❌ | |
...

## Frontend E2E
| ID | 결과 | 비고 |
|---|---|---|
| FE-01 | ✅/❌ | |
...

## 회귀 테스트
| ID | 결과 | 비고 |
|---|---|---|
| REG-01 | ✅/❌ | |
| REG-02 | ✅/❌ | |

## 총평
- 전체: N개 항목
- 성공: N개
- 실패: N개
- 미실시: N개 (사유:)

## 발견 이슈
| 심각도 | 내용 | 재현 방법 |
|---|---|---|
| Critical/Major/Minor | | |
```

---

## 11. 테스트 제외 항목 (현재 환경 제약)

| 항목 | 제외 사유 |
|---|---|
| Teams Webhook 실제 발송 | 내부망 Webhook URL 연결 시에만 검증 가능 |
| LLM API 분석 결과 | 내부망 `devx-mcp-api.shinsegae-inc.com` 연결 필요 |
| Ollama 임베딩 | localhost에서 bge-m3 모델 다운로드 필요 |
| Qdrant 벡터 유사도 (실제) | Ollama 임베딩 연동 필요 |
| Grafana Alloy 에이전트 | 실제 서버 배포 환경 필요 |
| n8n 자동 스케줄 | 수동 트리거로 대체 |
