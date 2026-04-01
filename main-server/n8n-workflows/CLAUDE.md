# n8n 워크플로우 — 개발 주의사항 (CLAUDE.md)

이 파일은 n8n 워크플로우 작업 시 반복 실수를 방지하기 위한 실전 가이드입니다.

---

## n8n 버전 호환성 (현재: 1.44.0)

### Postgres 노드 typeVersion
- **지원 버전**: 2, 2.1, 2.2, 2.3, 2.4
- **2.5는 존재하지 않음** — JSON에 `"typeVersion": 2.5`가 있으면 워크플로우 활성화 시 `TypeError: Cannot read properties of undefined (reading 'description')` 오류 발생
- **수정**: `"typeVersion": 2.4`로 변경

### IF 노드 operator 형식
- `operator`에 `name`, `description` 필드가 **반드시** 포함되어야 함
- 누락 시 워크플로우 활성화 실패 (같은 `description` TypeError)

```json
// ❌ 틀림
"operator": { "type": "string", "operation": "notEmpty" }

// ✅ 맞음
"operator": {
  "type": "string",
  "operation": "notEmpty",
  "name": "filter.operator.isNotEmpty",
  "description": "is not empty"
}
```

### Webhook 노드 responseMode
- `"responseMode": "lastNode"` → **사용 금지** (n8n 1.44에서 동작 안 함)
- `respondToWebhook` 노드와 함께 쓸 때는 반드시 `"responseMode": "responseNode"` 사용

```json
// ❌ 틀림
"responseMode": "lastNode"

// ✅ 맞음
"responseMode": "responseNode"
```

### respondToWebhook 노드 responseBody 표현식
- `=` 접두사는 구버전 문법, n8n 1.44에서 실행 실패 유발
- 표현식은 반드시 `={{ }}` 형식 사용

```json
// ❌ 틀림
"responseBody": "={ \"status\": \"ok\" }"

// ✅ 맞음
"responseBody": "={{ JSON.stringify({status: 'ok', message: '완료'}) }}"
```

### HTTP Request 노드 v4.2 — jsonBody 반드시 specifyBody 명시
- `contentType: "json"` + `jsonBody` 설정해도 **`specifyBody: "json"` 없으면 body가 전송되지 않음**
- 기본값이 `"keypair"`이라 bodyParameters가 없으면 빈 body 전송됨

```json
// ❌ jsonBody가 무시됨
{
  "contentType": "json",
  "jsonBody": "={{ JSON.stringify({...}) }}"
}

// ✅ specifyBody 명시 필수
{
  "contentType": "json",
  "specifyBody": "json",
  "jsonBody": "={{ JSON.stringify({...}) }}"
}
```
→ Ollama, Qdrant, Teams HTTP Request 노드 모두 해당

---

## 워크플로우 임포트 방법 (CLI 권장)

UI 임포트보다 **n8n CLI**가 안정적입니다.

```bash
# 1. JSON 배열 형식으로 변환 (active 필드 포함 필수)
python3 -c "
import json
with open('WF3-feedback-processing.json') as f:
    wf = json.load(f)
wf['active'] = False
with open('/tmp/wf_import.json', 'w') as f:
    json.dump([wf], f, ensure_ascii=False)
"

# 2. 컨테이너에 복사 후 임포트
docker cp /tmp/wf_import.json dev-n8n:/tmp/wf_import.json
docker exec dev-n8n n8n import:workflow --input=/tmp/wf_import.json

# 3. API로 활성화
curl -s -X POST "http://localhost:5678/api/v1/workflows/{WF_ID}/activate" \
  -H "X-N8N-API-KEY: {API_KEY}"
```

> CLI 임포트 시 단일 객체가 아닌 **배열(`[{...}]`)** 형식이어야 합니다.
> `active` 필드가 없으면 `null value in column "active"` 오류 발생.

---

## n8n 초기 계정 설정 (DB 직접 설정)

n8n 첫 실행 시 UI 셋업이 필요한데, 폐쇄망 등에서 UI 접근이 어려울 경우 DB 직접 조작:

```bash
# bcrypt 해시 생성
HASH=$(docker exec dev-n8n node -e "
const bcrypt = require('/usr/local/lib/node_modules/n8n/node_modules/bcryptjs');
bcrypt.hash('Admin1234!', 10, (err, hash) => { console.log(hash); });
")

# user 테이블 업데이트
docker exec dev-postgres psql -U aoms -d aoms -c "
UPDATE n8n.\"user\" SET
  email = 'admin@aoms.local',
  \"firstName\" = 'Admin',
  \"lastName\" = 'AOMS',
  password = '$HASH',
  settings = '{\"userActivated\": true}'
WHERE role = 'global:owner';"
```

---

## API 키 발급

```bash
# 로그인 후 쿠키 획득
curl -s -c /tmp/n8n_cookies.txt -X POST "http://localhost:5678/rest/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@aoms.local","password":"Admin1234!"}'

# API 키 생성
curl -s -b /tmp/n8n_cookies.txt -X POST "http://localhost:5678/rest/me/api-key"
```

---

## PostgreSQL 크리덴셜 등록 (내부 REST API)

```bash
curl -s -b /tmp/n8n_cookies.txt -X POST "http://localhost:5678/rest/credentials" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AOMS PostgreSQL",
    "type": "postgres",
    "data": {
      "host": "postgres",
      "port": 5432,
      "database": "aoms",
      "user": "aoms",
      "password": "aoms",
      "ssl": "disable"
    },
    "nodesAccess": []
  }'
```

> 공개 API(`/api/v1/credentials`)는 스키마 검증이 복잡하므로 내부 REST API 사용.

---

## Qdrant 컬렉션 분기 (WF3 핵심 로직)

메트릭 알림과 로그 분석 알림이 서로 다른 Qdrant 컬렉션을 사용합니다:

| alert_type | Qdrant 컬렉션 |
|---|---|
| `metric`, `metric_resolved` | `metric_baselines` |
| `log_analysis` | `log_incidents` |

WF3의 "알림 이력 조회" SQL에서 컬렉션명을 동적으로 결정:

```sql
SELECT ah.id, ah.system_id, ah.qdrant_point_id,
  CASE WHEN ah.alert_type IN ('metric', 'metric_resolved')
       THEN 'metric_baselines' ELSE 'log_incidents' END as qdrant_collection
FROM alert_history ah
WHERE ah.id = {{ $json.alertId }}
LIMIT 1;
```

Qdrant 업데이트 URL:
```
={{ $env.QDRANT_URL }}/collections/{{ $('알림 이력 조회').first().json.qdrant_collection || 'log_incidents' }}/points/payload
```

---

## TEAMS_WEBHOOK_URL이 n8n에서 비어있는 경우

n8n은 `docker-compose.dev.yml` 실행 시점의 환경변수를 읽습니다.
`.env.local`을 수정한 뒤에는 n8n 컨테이너를 **재시작**해야 반영됩니다.

```bash
cd main-server
TEAMS_WEBHOOK_URL="$(grep TEAMS_WEBHOOK_URL .env.local | cut -d= -f2-)" \
  docker compose -f docker-compose.dev.yml up -d n8n
```

---

## 워크플로우 임포트 전 JSON 검증 체크리스트

새 워크플로우 JSON 작성 시 확인:

- [ ] Postgres 노드: `typeVersion` ≤ 2.4
- [ ] IF 노드 operator: `name`, `description` 필드 포함
- [ ] Webhook 노드: `responseMode: "responseNode"` (respondToWebhook 사용 시)
- [ ] respondToWebhook 노드: `responseBody` 표현식이 `={{ }}` 형식
- [ ] HTTP Request 노드 (body 전송 시): `"specifyBody": "json"` 명시
- [ ] 임포트용 배열: `[{ ..., "active": false }]` 형식
- [ ] 크리덴셜 ID: 실제 n8n 인스턴스의 크리덴셜 ID로 교체 필요
