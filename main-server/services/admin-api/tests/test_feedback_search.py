"""
피드백 검색 엔드포인트 — Wave 2A 410 Gone 검증.

GET /api/v1/feedback/search 는 Wave 2A에서 410으로 이전됨.
새 엔드포인트: GET /api/v1/incidents/feedback/search (log-analyzer 프록시)
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


async def test_search_endpoint_gone(authed_client: AsyncClient):
    """GET /api/v1/feedback/search 는 410 Gone 반환."""
    resp = await authed_client.get("/api/v1/feedback/search")
    assert resp.status_code == 410
    body = resp.json()
    assert "incidents/feedback/search" in body["detail"]


async def test_search_with_params_gone(authed_client: AsyncClient):
    """파라미터가 있어도 410 Gone 반환."""
    resp = await authed_client.get(
        "/api/v1/feedback/search", params={"q": "CPU", "limit": 10}
    )
    assert resp.status_code == 410
