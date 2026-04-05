# Synapse-V n8n 워크플로우 가이드

## 워크플로우 목록

| 파일 | 이름 | 트리거 | 역할 |
|---|---|---|---|
| `WF1-log-analysis-trigger.json` | 로그 분석 트리거 | 5분 주기 | log-analyzer 실행 → 오류 시 Teams 알림 |
| `WF2-metric-vector-search.json` | 메트릭 벡터 검색 | Alertmanager Webhook | 유사 이력 검색 → Teams 분석 결과 알림 |
| `WF3-feedback-processing.json`  | 피드백 등록 처리 | 피드백 폼 Webhook | DB 저장 → Qdrant 해결책 업데이트 → Teams 알림 |
| `WF4-daily-report.json`         | 일일 이상 리포트 | 매일 08:00 | 통계 집계 → LLM 요약 → Teams 리포트 |
| `WF5-escalation.json`           | 에스컬레이션     | 30분 주기 | 2시간+ 미처리 Critical → Teams 알림 |

---

## 로컬 환경 설정

### 1. 인프라 시작

```bash
# 프로젝트 루트에서
make dev-up
# → postgres, loki, prometheus, alertmanager, qdrant, n8n 시작
# → n8n: http://localhost:5678  (admin / admin123)
```

### 2. n8n 초기 설정

**① n8n 접속**
```
http://localhost:5678
ID: admin / PW: admin123
```

**② PostgreSQL 크리덴셜 등록**

Settings → Credentials → New Credential → PostgreSQL 선택

| 항목 | 로컬 값 |
|---|---|
| Credential Name | `Synapse-V PostgreSQL` |
| Host | `postgres` |
| Port | `5432` |
| Database | `aoms` |
| User | `aoms` |
| Password | `aoms` |

> n8n이 Docker 안에서 실행되므로 postgres 컨테이너명(`postgres`)으로 접근 가능.

### 3. 워크플로우 임포트

n8n UI → Workflows → Import from file → 각 JSON 파일 순서대로 임포트

```
1. WF1-log-analysis-trigger.json
2. WF2-metric-vector-search.json
3. WF3-feedback-processing.json
4. WF4-daily-report.json
5. WF5-escalation.json
```

### 4. 환경변수 확인

임포트된 워크플로우가 `$env.LOG_ANALYZER_URL` 등을 참조합니다.
`docker-compose.dev.yml`의 n8n 서비스에 아래 값이 이미 설정되어 있습니다.

| 변수 | 로컬 값 |
|---|---|
| `LOG_ANALYZER_URL` | `http://host.docker.internal:8000` |
| `ADMIN_API_URL` | `http://host.docker.internal:8080` |
| `TEAMS_WEBHOOK_URL` | `.env.local`의 `TEAMS_WEBHOOK_URL` 참조 |
| `OLLAMA_URL` | `http://host.docker.internal:11434` |
| `QDRANT_URL` | `http://host.docker.internal:6333` |

> `TEAMS_WEBHOOK_URL` 로컬 테스트: [webhook.site](https://webhook.site) 에서 임시 URL 발급

---

## 각 워크플로우 테스트 방법

### WF1 — 로그 분석 트리거

n8n UI에서 워크플로우 열기 → "Test workflow" 버튼 클릭
또는 `make run-analyzer` 실행 후 자동 트리거 대기

```bash
# 수동 트리거 확인
curl -X POST http://localhost:8000/analyze/trigger
```

### WF2 — 메트릭 벡터 검색

Alertmanager UI에서 테스트 알림 발송 또는 curl 직접 호출:

```bash
curl -X POST http://localhost:5678/webhook/metric-alert \
  -H "Content-Type: application/json" \
  -d '{
    "alerts": [{
      "status": "firing",
      "labels": {
        "alertname": "HighMemoryUsage",
        "system_name": "shop-web",
        "instance_role": "was1",
        "severity": "warning"
      },
      "annotations": {"summary": "메모리 사용률 90% 초과"}
    }]
  }'
```

### WF3 — 피드백 등록

피드백 폼 접속 (admin-api가 실행 중이어야 함):

```
http://localhost:8080/api/v1/feedback/form?alert_id=1&system=shop-web&point_id=
```

또는 curl로 직접 webhook 호출:

```bash
curl -X POST http://localhost:5678/webhook/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "alert_id": 1,
    "system": "shop-web",
    "point_id": "",
    "error_type": "메모리 부족",
    "solution": "JVM 힙 메모리를 4GB로 증설하고 GC 설정 최적화",
    "resolver": "홍길동"
  }'
```

### WF4 — 일일 리포트

n8n UI에서 워크플로우 열기 → "Test workflow"
(DB에 log_analysis_history 데이터가 있어야 의미있는 결과 출력)

### WF5 — 에스컬레이션

테스트용 미처리 Critical 알림 데이터 삽입 후 실행:

```bash
# DB에 테스트 데이터 삽입 (make db-shell)
INSERT INTO alert_history (system_id, alert_type, severity, alertname, title, created_at)
SELECT id, 'metric', 'critical', 'TestAlert', '테스트 Critical 알림',
       NOW() - INTERVAL '3 hours'
FROM systems LIMIT 1;
```

---

## 운영 배포 시 차이점

| 항목 | 로컬 | 운영 |
|---|---|---|
| log-analyzer URL | `host.docker.internal:8000` | `log-analyzer:8000` |
| admin-api URL | `host.docker.internal:8080` | `admin-api:8080` |
| Qdrant URL | `host.docker.internal:6333` | `${QDRANT_URL}` (Server B) |
| Ollama URL | `host.docker.internal:11434` | `${OLLAMA_URL}` (Server B) |
| n8n 인증 | admin / admin123 | `${N8N_USER}` / `${N8N_PASSWORD}` |

운영 서버의 `docker-compose.yml` n8n 서비스에 위 변수들이 `.env` 파일을 통해 주입됩니다.
