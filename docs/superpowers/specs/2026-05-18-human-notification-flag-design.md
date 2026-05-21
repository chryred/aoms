# 설계: 담당자 정보성 분류 → Qdrant notification 자동 skip 연동

## 배경 / 문제

현재 LLM이 `is_notification=true`로 판정한 로그만 Qdrant에 `is_notification=True`로 저장되어 추후 유사 로그를 자동 skip한다.
담당자가 UI에서 인시던트 severity를 `info`로 변경해도 Qdrant 포인트는 그대로 `is_notification=False`로 남아, 동일 로그가 다음 주기에 다시 warning 알림을 발송한다.

## 목표

인시던트 severity → `info` 변경 시, 해당 인시던트에 연결된 로그 분석 Qdrant 포인트의 `is_notification=True`로 갱신 → 기존 `notification_auto` skip 흐름이 즉시 적용됨.

## 설계 (접근법 A — 기존 포인트 payload 업데이트)

### 흐름

```
PATCH /api/v1/incidents/{id}  (payload.severity = "info", 이전 severity != "info")
  ① LogAnalysisHistory WHERE incident_id 조회 → qdrant_point_ids 수집
  ② asyncio.create_task(_mark_qdrant_notification(incident_id, point_ids, actor_name))
     (best-effort, incidents.py 기존 _link_qdrant_incident_points 패턴과 동일)
  ③ IncidentTimeline 기록: "담당자 {name} 정보성 분류 (Qdrant {n}건 갱신)"
```

### log-analyzer: 신규 엔드포인트

```
PATCH /incident/notification-flag
Body: { "point_ids": ["uuid1", "uuid2", ...] }
→ Qdrant PUT /collections/log_incidents/points/payload
     payload: { "is_notification": true, "notification_source": "human" }
     points: [...]
Response: { "updated": n }
```

`notification_source: "human"` 필드를 추가해 LLM 판정과 인간 판정을 구분 (감사 추적).

### admin-api: update_incident 변경

```python
# 기존 severity 처리 블록 아래에 추가
old_severity = incident.severity
if payload.severity is not None:
    ...
    incident.severity = payload.severity

# DB commit 후 비동기 실행
if payload.severity == "info" and old_severity != "info":
    asyncio.create_task(
        _mark_incident_logs_notification(incident_id, current_user.name)
    )
```

### 주의사항

- `LogAnalysisHistory.qdrant_point_id`가 NULL이거나 없으면 조용히 skip (0건 정상 처리)
- log-analyzer 호출 실패 시 `logger.warning`만 기록, incident 업데이트는 정상 반환
- `info → info` 재변경은 멱등 (Qdrant set payload는 덮어쓰기라 문제 없음)

## 수정 파일

| 파일 | 변경 내용 |
|---|---|
| `main-server/services/log-analyzer/main.py` | `PATCH /incident/notification-flag` 엔드포인트 추가 |
| `main-server/services/admin-api/routes/incidents.py` | `update_incident()` 에 severity→info 훅 + `_mark_incident_logs_notification()` 헬퍼 추가 |

## 검증

1. `make test-api` — 기존 단위 테스트 회귀 없음 확인
2. 인시던트 severity info 변경 → `log_analysis_history.qdrant_point_id` 기준 Qdrant 포인트 `is_notification=True` 확인
3. 다음 분석 주기(5분)에 동일 로그 → `notification_auto` skip 로그 확인
