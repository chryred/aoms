# Human Notification Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 담당자가 인시던트 severity를 `info`로 변경할 때 연결된 Qdrant 로그 포인트의 `is_notification=True`로 갱신하여 추후 유사 로그가 자동 skip되도록 한다.

**Architecture:** `PATCH /api/v1/incidents/{id}` (severity→info 변경) → admin-api가 `LogAnalysisHistory.qdrant_point_id` 수집 → log-analyzer `PATCH /incident/notification-flag` 호출(best-effort) → Qdrant `log_incidents` 포인트 payload 갱신. 기존 `_link_qdrant_incident_points` 패턴과 동일한 best-effort asyncio.create_task 방식.

**Tech Stack:** Python 3.11 / FastAPI / httpx / Qdrant REST API / SQLAlchemy AsyncSession

---

## 파일 맵

| 파일 | 역할 |
|---|---|
| `main-server/services/log-analyzer/main.py` | `PATCH /incident/notification-flag` 엔드포인트 추가 |
| `main-server/services/admin-api/routes/incidents.py` | `_mark_incident_logs_notification()` 헬퍼 + `update_incident()` 훅 추가 |
| `main-server/services/admin-api/tests/test_incidents.py` | severity→info 시 log-analyzer 호출 검증 테스트 추가 |

---

## Task 1: log-analyzer — notification-flag 엔드포인트

**Files:**
- Modify: `main-server/services/log-analyzer/main.py`

- [ ] **Step 1: 엔드포인트 추가**

`main.py`에서 기존 `/incidents/points/link-incident` PATCH 엔드포인트 바로 아래에 추가한다.

`grep -n "link-incident" main-server/services/log-analyzer/main.py` 로 위치를 먼저 확인 후 삽입.

추가할 코드:

```python
class NotificationFlagRequest(BaseModel):
    point_ids: list[str]

@app.patch("/incident/notification-flag")
async def mark_notification_flag(body: NotificationFlagRequest):
    """담당자 정보성 분류 → log_incidents Qdrant 포인트 is_notification=True 갱신."""
    if not body.point_ids:
        return {"updated": 0}
    resp = await vector_client._qdrant_http.put(
        f"{vector_client.QDRANT_URL}/collections/{vector_client.COLLECTION}/points/payload",
        json={
            "payload": {"is_notification": True, "notification_source": "human"},
            "points": body.point_ids,
        },
    )
    resp.raise_for_status()
    return {"updated": len(body.point_ids)}
```

`NotificationFlagRequest`는 이미 `pydantic.BaseModel`이 import되어 있으므로 바로 사용 가능 (`from pydantic import BaseModel` 라인 25).

- [ ] **Step 2: 로컬에서 구문 검증**

```bash
cd /Users/company/workspaces/aoms && ./venv/bin/python -c "
import ast, sys
with open('main-server/services/log-analyzer/main.py') as f:
    src = f.read()
ast.parse(src)
print('OK')
"
```

기대 출력: `OK`

- [ ] **Step 3: 커밋**

```bash
git add main-server/services/log-analyzer/main.py
git commit -m "feat(log-analyzer): PATCH /incident/notification-flag — 담당자 정보성 분류 Qdrant 갱신"
```

---

## Task 2: admin-api — 헬퍼 함수 + update_incident 훅

**Files:**
- Modify: `main-server/services/admin-api/routes/incidents.py`

- [ ] **Step 1: `_mark_incident_logs_notification` 헬퍼 추가**

`_link_qdrant_incident_points` 함수(라인 61) 바로 아래에 추가한다.

```python
async def _mark_incident_logs_notification(incident_id: int, actor_name: str) -> None:
    """인시던트 severity→info 변경 시 log_incidents Qdrant 포인트 is_notification=True 갱신 (best-effort)."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(LogAnalysisHistory.qdrant_point_id)
                .where(LogAnalysisHistory.incident_id == incident_id)
                .where(LogAnalysisHistory.qdrant_point_id.isnot(None))
            )
            point_ids = list(result.scalars().all())

        if not point_ids:
            logger.info("incident %s: 연결된 log Qdrant 포인트 없음 (정보성 갱신 skip)", incident_id)
            return

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.patch(
                f"{_LOG_ANALYZER_URL}/incident/notification-flag",
                json={"point_ids": point_ids},
            )
            resp.raise_for_status()

        logger.info(
            "incident %s: Qdrant 정보성 갱신 완료 — %d건 (by %s)",
            incident_id, len(point_ids), actor_name,
        )
    except Exception as exc:
        logger.warning("incident %s: Qdrant 정보성 갱신 실패 (best-effort): %s", incident_id, exc)
```

모든 import(`asyncio`, `httpx`, `AsyncSessionLocal`, `LogAnalysisHistory`, `_LOG_ANALYZER_URL`)는 이미 파일 상단에 존재한다.

- [ ] **Step 2: `update_incident` 함수에 훅 추가**

`update_incident` 함수의 severity 처리 블록(라인 1228)을 아래와 같이 변경한다.

**변경 전:**
```python
    if payload.severity is not None:
        _VALID_SEVERITIES = {"critical", "warning", "info"}
        if payload.severity not in _VALID_SEVERITIES:
            raise HTTPException(status_code=422, detail=f"유효하지 않은 심각도: {payload.severity}")
        incident.severity = payload.severity
```

**변경 후:**
```python
    severity_to_info = False
    if payload.severity is not None:
        _VALID_SEVERITIES = {"critical", "warning", "info"}
        if payload.severity not in _VALID_SEVERITIES:
            raise HTTPException(status_code=422, detail=f"유효하지 않은 심각도: {payload.severity}")
        if payload.severity == "info" and incident.severity != "info":
            severity_to_info = True
        incident.severity = payload.severity
```

그리고 `timeline_desc` 기록 블록(라인 1240) 바로 아래, `await db.commit()` 전에 추가:

```python
    if severity_to_info:
        db.add(IncidentTimeline(
            incident_id=incident_id,
            event_type="status_changed",
            description=f"담당자 {current_user.name}이 정보성 로그로 분류 — 유사 로그 자동 skip 등록",
            actor_name=current_user.name,
        ))
```

그리고 `await db.commit()` 이후, `return` 전에 추가:

```python
    if severity_to_info:
        asyncio.create_task(
            _mark_incident_logs_notification(incident_id, current_user.name)
        )
```

최종 함수 말미는 다음과 같다:

```python
    if timeline_desc:
        db.add(IncidentTimeline(
            incident_id=incident_id,
            event_type="status_changed",
            description=timeline_desc,
            actor_name=current_user.name,
        ))

    if severity_to_info:
        db.add(IncidentTimeline(
            incident_id=incident_id,
            event_type="status_changed",
            description=f"담당자 {current_user.name}이 정보성 로그로 분류 — 유사 로그 자동 skip 등록",
            actor_name=current_user.name,
        ))

    await db.commit()
    await db.refresh(incident)

    if severity_to_info:
        asyncio.create_task(
            _mark_incident_logs_notification(incident_id, current_user.name)
        )

    system_display_name = None
    if incident.system_id:
        system = await db.get(System, incident.system_id)
        if system:
            system_display_name = system.display_name

    return _to_out(incident, system_display_name)
```

- [ ] **Step 3: 구문 검증**

```bash
cd /Users/company/workspaces/aoms && ./venv/bin/python -c "
import ast
with open('main-server/services/admin-api/routes/incidents.py') as f:
    src = f.read()
ast.parse(src)
print('OK')
"
```

기대 출력: `OK`

- [ ] **Step 4: 커밋**

```bash
git add main-server/services/admin-api/routes/incidents.py
git commit -m "feat(admin-api): 인시던트 severity→info 시 Qdrant 정보성 플래그 갱신"
```

---

## Task 3: 단위 테스트 추가

**Files:**
- Modify: `main-server/services/admin-api/tests/test_incidents.py`

- [ ] **Step 1: 실패할 테스트 작성**

`test_incidents.py` 파일 끝에 추가한다:

```python
@pytest.mark.asyncio
async def test_severity_to_info_calls_notification_flag(authed_client: AsyncClient):
    """인시던트 severity→info 변경 시 log-analyzer notification-flag 호출 검증."""
    from unittest.mock import AsyncMock, patch

    # 인시던트 생성
    system = await _create_system(authed_client)
    incident_resp = await authed_client.post("/api/v1/incidents", json={
        "system_id": system["id"],
        "title": "테스트 인시던트",
        "severity": "warning",
    })
    assert incident_resp.status_code == 201
    incident_id = incident_resp.json()["id"]

    # log_analysis_history에 qdrant_point_id가 있는 레코드 직접 삽입
    from database import AsyncSessionLocal
    from models import LogAnalysisHistory
    async with AsyncSessionLocal() as db:
        record = LogAnalysisHistory(
            system_id=system["id"],
            instance_role="was1",
            log_content="test log",
            analysis_result="{}",
            severity="warning",
            anomaly_type="new",
            qdrant_point_id="test-point-uuid-001",
            incident_id=incident_id,
        )
        db.add(record)
        await db.commit()

    # log-analyzer 호출 mock
    with patch(
        "routes.incidents._mark_incident_logs_notification",
        new_callable=AsyncMock,
    ) as mock_mark:
        resp = await authed_client.patch(
            f"/api/v1/incidents/{incident_id}",
            json={"severity": "info"},
        )
        assert resp.status_code == 200
        assert resp.json()["severity"] == "info"

        # asyncio.create_task 내부에서 호출되므로 잠깐 대기
        import asyncio
        await asyncio.sleep(0.05)

        mock_mark.assert_awaited_once_with(incident_id, mock_mark.call_args[0][1])


@pytest.mark.asyncio
async def test_severity_info_to_info_does_not_call_notification_flag(authed_client: AsyncClient):
    """이미 info인 인시던트를 다시 info로 변경해도 notification-flag 미호출."""
    from unittest.mock import AsyncMock, patch

    system = await _create_system(authed_client)
    incident_resp = await authed_client.post("/api/v1/incidents", json={
        "system_id": system["id"],
        "title": "이미 info",
        "severity": "info",
    })
    assert incident_resp.status_code == 201
    incident_id = incident_resp.json()["id"]

    with patch(
        "routes.incidents._mark_incident_logs_notification",
        new_callable=AsyncMock,
    ) as mock_mark:
        resp = await authed_client.patch(
            f"/api/v1/incidents/{incident_id}",
            json={"severity": "info"},
        )
        assert resp.status_code == 200
        import asyncio
        await asyncio.sleep(0.05)
        mock_mark.assert_not_awaited()
```

`_create_system` 헬퍼가 `test_incidents.py`에 이미 있는지 확인:
```bash
grep -n "_create_system\|async def _create" main-server/services/admin-api/tests/test_incidents.py | head -5
```

없으면 아래 헬퍼를 테스트 파일 상단(첫 번째 `@pytest.mark.asyncio` 위)에 추가:
```python
async def _create_system(client: AsyncClient) -> dict:
    resp = await client.post("/api/v1/systems", json={
        "system_name": f"test_{uuid.uuid4().hex[:6]}",
        "display_name": "테스트시스템",
        "status": "active",
    })
    assert resp.status_code == 201
    return resp.json()
```

- [ ] **Step 2: 테스트 실행 (실패 확인)**

```bash
cd /Users/company/workspaces/aoms && make test-api 2>&1 | grep -E "PASSED|FAILED|ERROR|test_severity"
```

기대: `test_severity_to_info_calls_notification_flag FAILED` (함수가 아직 없으므로)

- [ ] **Step 3: Task 2 구현 후 테스트 재실행 (통과 확인)**

```bash
cd /Users/company/workspaces/aoms && make test-api 2>&1 | grep -E "PASSED|FAILED|ERROR|test_severity"
```

기대:
```
test_severity_to_info_calls_notification_flag PASSED
test_severity_info_to_info_does_not_call_notification_flag PASSED
```

- [ ] **Step 4: 전체 테스트 회귀 확인**

```bash
cd /Users/company/workspaces/aoms && make test-api 2>&1 | tail -5
```

기대: `X passed, 0 failed`

- [ ] **Step 5: 커밋**

```bash
git add main-server/services/admin-api/tests/test_incidents.py
git commit -m "test(incidents): severity→info 정보성 Qdrant 갱신 단위 테스트 추가"
```

---

## 자체 검토 결과

- **스펙 커버리지**: 3가지 요구사항 모두 반영 — ① Qdrant 포인트 갱신, ② best-effort 패턴, ③ 타임라인 기록
- **Placeholder 없음**: 모든 코드 블록 완성
- **타입 일관성**: `_mark_incident_logs_notification(incident_id: int, actor_name: str)` 시그니처가 Task 2·3 모두 동일
- **멱등성**: info→info 재변경은 조건 `incident.severity != "info"` 로 차단됨 (Task 2 Step 2)
