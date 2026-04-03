"""
Phase 5 — /api/v1/reports 단위 테스트
리포트 이력 저장·조회 + 중복 방지 upsert
"""

import pytest
from httpx import AsyncClient


# ── 저장 ─────────────────────────────────────────────────────────────────────

DAILY_PAYLOAD = {
    "report_type": "daily",
    "period_start": "2026-04-03T00:00:00",
    "period_end": "2026-04-03T23:59:59",
    "teams_status": "sent",
    "llm_summary": "일별 CPU 평균 65%, 이상 없음",
    "system_count": 3,
}


async def test_create_report(client: AsyncClient):
    resp = await client.post("/api/v1/reports", json=DAILY_PAYLOAD)
    assert resp.status_code == 201
    data = resp.json()
    assert data["report_type"] == "daily"
    assert data["teams_status"] == "sent"
    assert data["system_count"] == 3


async def test_create_report_upsert(client: AsyncClient):
    """동일 report_type + period_start 재전송 시 업데이트"""
    payload = {
        "report_type": "weekly",
        "period_start": "2026-03-30T00:00:00",
        "period_end": "2026-04-05T23:59:59",
        "teams_status": "failed",
    }
    await client.post("/api/v1/reports", json=payload)

    payload["teams_status"] = "sent"
    resp = await client.post("/api/v1/reports", json=payload)
    assert resp.status_code == 201
    assert resp.json()["teams_status"] == "sent"

    list_resp = await client.get("/api/v1/reports", params={"report_type": "weekly"})
    assert len(list_resp.json()) == 1


# ── 조회 ─────────────────────────────────────────────────────────────────────

async def test_list_reports(client: AsyncClient):
    for report_type, period_start, period_end in [
        ("daily",  "2026-04-01T00:00:00", "2026-04-01T23:59:59"),
        ("daily",  "2026-04-02T00:00:00", "2026-04-02T23:59:59"),
        ("weekly", "2026-03-30T00:00:00", "2026-04-05T23:59:59"),
    ]:
        await client.post("/api/v1/reports", json={
            "report_type": report_type,
            "period_start": period_start,
            "period_end": period_end,
            "teams_status": "sent",
        })

    resp = await client.get("/api/v1/reports")
    assert resp.status_code == 200
    assert len(resp.json()) == 3


async def test_list_reports_filter_type(client: AsyncClient):
    for report_type, period_start, period_end in [
        ("daily",   "2026-04-01T00:00:00", "2026-04-01T23:59:59"),
        ("monthly", "2026-04-01T00:00:00", "2026-04-30T23:59:59"),
    ]:
        await client.post("/api/v1/reports", json={
            "report_type": report_type,
            "period_start": period_start,
            "period_end": period_end,
            "teams_status": "sent",
        })

    resp = await client.get("/api/v1/reports", params={"report_type": "monthly"})
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["report_type"] == "monthly"


async def test_get_report(client: AsyncClient):
    create_resp = await client.post("/api/v1/reports", json={
        "report_type": "quarterly",
        "period_start": "2026-01-01T00:00:00",
        "period_end": "2026-03-31T23:59:59",
        "teams_status": "sent",
        "llm_summary": "1분기 요약",
    })
    assert create_resp.status_code == 201
    report_id = create_resp.json()["id"]

    resp = await client.get(f"/api/v1/reports/{report_id}")
    assert resp.status_code == 200
    assert resp.json()["llm_summary"] == "1분기 요약"


async def test_get_report_not_found(client: AsyncClient):
    resp = await client.get("/api/v1/reports/9999")
    assert resp.status_code == 404
