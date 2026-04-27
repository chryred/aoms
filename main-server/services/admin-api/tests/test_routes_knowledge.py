"""Knowledge 라우터 단위 테스트 (V1).

log-analyzer 호출은 AsyncMock으로 패치.
DB: SQLite in-memory (conftest.py 공통 fixture 사용).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient


# ── 인증 없이 접근 차단 ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_knowledge_requires_auth_upload(client: AsyncClient):
    resp = await client.post(
        "/api/v1/knowledge/upload",
        files={"file": ("test.pdf", b"PDF", "application/pdf")},
        data={"system_id": "1"},
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_knowledge_requires_auth_operator_note(client: AsyncClient):
    resp = await client.post(
        "/api/v1/knowledge/operator-note",
        json={"question": "Q", "answer": "A", "system_id": 1},
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_knowledge_requires_auth_feedback(client: AsyncClient):
    resp = await client.post(
        "/api/v1/knowledge/feedback",
        json={
            "source_point_id": "abc",
            "source_collection": "log_incidents",
            "correct_answer": "올바른 답",
        },
    )
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_knowledge_requires_auth_sync_status(client: AsyncClient):
    resp = await client.get("/api/v1/knowledge/sync-status")
    assert resp.status_code in (401, 403)


# ── 파일 업로드 ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_unsupported_type_rejected(authed_client: AsyncClient):
    resp = await authed_client.post(
        "/api/v1/knowledge/upload",
        files={"file": ("test.txt", b"hello", "text/plain")},
        data={"system_id": "1"},
    )
    assert resp.status_code == 415


@pytest.mark.asyncio
async def test_upload_pdf_accepted(authed_client: AsyncClient, tmp_path):
    """PDF 업로드 → 202 + job_id 반환. log-analyzer 호출은 mock."""
    with patch(
        "services.knowledge_service.call_embed_document",
        new=AsyncMock(return_value={"point_id": "mock-point"}),
    ):
        with patch("routes.knowledge._DOCS_ROOT", str(tmp_path)):
            resp = await authed_client.post(
                "/api/v1/knowledge/upload",
                files={"file": ("manual.pdf", b"%PDF-1.4 content", "application/pdf")},
                data={"system_id": "1", "tags": "manual,ops"},
            )
    assert resp.status_code == 202
    data = resp.json()
    assert "job_id" in data
    assert data["status"] == "queued"


@pytest.mark.asyncio
async def test_upload_status_not_found(authed_client: AsyncClient):
    resp = await authed_client.get("/api/v1/knowledge/upload/nonexistent-job/status")
    assert resp.status_code == 404


# ── 운영자 노트 ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_operator_note_success(authed_client: AsyncClient):
    """log-analyzer가 point_id 반환하는 경우."""
    with patch(
        "routes.knowledge.knowledge_service.call_operator_note",
        new=AsyncMock(return_value="point-uuid-123"),
    ):
        resp = await authed_client.post(
            "/api/v1/knowledge/operator-note",
            json={
                "question": "배포 절차가 어떻게 되나요?",
                "answer": "Jenkins → staging → prod 순서로 배포합니다.",
                "system_id": 1,
                "tags": ["배포", "운영"],
            },
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["point_id"] == "point-uuid-123"
    assert data["stored"] is True


@pytest.mark.asyncio
async def test_create_operator_note_log_analyzer_unavailable(authed_client: AsyncClient):
    """log-analyzer 미구현(T2 미완) 시 point_id=null이지만 200 계열 반환."""
    with patch(
        "routes.knowledge.knowledge_service.call_operator_note",
        new=AsyncMock(return_value=None),
    ):
        resp = await authed_client.post(
            "/api/v1/knowledge/operator-note",
            json={"question": "Q", "answer": "A", "system_id": 1},
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["point_id"] is None
    assert data["stored"] is False


@pytest.mark.asyncio
async def test_update_operator_note_success(authed_client: AsyncClient):
    with patch(
        "routes.knowledge.knowledge_service.call_update_operator_note",
        new=AsyncMock(return_value=True),
    ):
        resp = await authed_client.patch(
            "/api/v1/knowledge/operator-note/point-uuid-123",
            json={"question": "Q updated", "answer": "A updated"},
        )
    assert resp.status_code == 200
    assert resp.json()["updated"] is True


@pytest.mark.asyncio
async def test_update_operator_note_log_analyzer_fail(authed_client: AsyncClient):
    with patch(
        "routes.knowledge.knowledge_service.call_update_operator_note",
        new=AsyncMock(return_value=False),
    ):
        resp = await authed_client.patch(
            "/api/v1/knowledge/operator-note/bad-point",
            json={"question": "Q", "answer": "A"},
        )
    assert resp.status_code == 502


@pytest.mark.asyncio
async def test_delete_operator_note_success(authed_client: AsyncClient):
    with patch(
        "routes.knowledge.knowledge_service.call_delete_operator_note",
        new=AsyncMock(return_value=True),
    ):
        resp = await authed_client.delete("/api/v1/knowledge/operator-note/point-uuid-123")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_delete_operator_note_fail(authed_client: AsyncClient):
    with patch(
        "routes.knowledge.knowledge_service.call_delete_operator_note",
        new=AsyncMock(return_value=False),
    ):
        resp = await authed_client.delete("/api/v1/knowledge/operator-note/bad-point")
    assert resp.status_code == 502


# ── 피드백 (오답 교정) ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_feedback_success(authed_client: AsyncClient):
    """knowledge_corrections DB insert + log-analyzer 전파 (mock)."""
    with patch(
        "routes.knowledge.knowledge_service.call_correction",
        new=AsyncMock(return_value=True),
    ):
        resp = await authed_client.post(
            "/api/v1/knowledge/feedback",
            json={
                "source_point_id": "qdrant-uuid-abc",
                "source_collection": "log_incidents",
                "question": "OOM 이슈 원인이 뭔가요?",
                "wrong_answer": "CPU 과부하",
                "correct_answer": "힙 메모리 부족으로 인한 OOM",
            },
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["source_point_id"] == "qdrant-uuid-abc"
    assert data["stored"] is True
    assert "id" in data


@pytest.mark.asyncio
async def test_create_feedback_minimal(authed_client: AsyncClient):
    """question/wrong_answer 생략해도 correct_answer만으로 등록 가능."""
    with patch(
        "routes.knowledge.knowledge_service.call_correction",
        new=AsyncMock(return_value=True),
    ):
        resp = await authed_client.post(
            "/api/v1/knowledge/feedback",
            json={
                "source_point_id": "point-xyz",
                "source_collection": "metric_baselines",
                "correct_answer": "올바른 정보",
            },
        )
    assert resp.status_code == 201


# ── 질문 분석 ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_frequent_questions_empty(authed_client: AsyncClient):
    """chat_messages가 비어있을 때 빈 clusters 반환."""
    with patch(
        "routes.knowledge.knowledge_service.call_embed_text",
        new=AsyncMock(return_value=None),
    ):
        resp = await authed_client.get("/api/v1/knowledge/questions/frequent?days=7&limit=10")
    assert resp.status_code == 200
    data = resp.json()
    assert "clusters" in data
    assert isinstance(data["clusters"], list)
    assert data["total_questions"] == 0


# ── 동기화 상태 ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_sync_status_empty(authed_client: AsyncClient):
    """초기 상태 — 빈 목록 반환."""
    resp = await authed_client.get("/api/v1/knowledge/sync-status")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_sync_status_upsert(authed_client: AsyncClient):
    """동기화 상태 upsert 후 조회."""
    # 최초 생성
    resp = await authed_client.post(
        "/api/v1/knowledge/sync-status",
        json={"source": "jira", "total_synced": 42, "last_error": None},
    )
    assert resp.status_code == 200
    assert resp.json()["updated"] is True

    # 조회
    resp = await authed_client.get("/api/v1/knowledge/sync-status?source=jira")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["source"] == "jira"
    assert items[0]["total_synced"] == 42

    # 업데이트 (total_synced 변경)
    resp = await authed_client.post(
        "/api/v1/knowledge/sync-status",
        json={"source": "jira", "total_synced": 100},
    )
    assert resp.status_code == 200

    resp = await authed_client.get("/api/v1/knowledge/sync-status?source=jira")
    items = resp.json()
    assert items[0]["total_synced"] == 100
