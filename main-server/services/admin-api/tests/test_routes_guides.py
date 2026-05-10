"""knowledge_guides draft/publish 워크플로우 단위 테스트.

검증 항목:
1. 운영자 직접 등록 (POST /guides) → status='published', Qdrant 인덱싱 시도
2. admin_save_guide 챗봇 도구 → status='draft', Qdrant 인덱싱 없음
3. 게시 (POST /guides/{id}/publish) → draft→published, 이미 published이면 400
4. 게시취소 (POST /guides/{id}/unpublish) → published→draft, 이미 draft이면 400
5. _HELP_ALLOWED_TOOLS에 admin_save_guide 미포함 검증 (불변 invariant)
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


# ── 1. 운영자 직접 등록 → status='published' ──────────────────────────────────

@pytest.mark.anyio
async def test_create_guide_sets_published(authed_client: AsyncClient):
    """운영자가 POST /api/v1/guides로 직접 생성 시 status='published'."""
    form_data = {
        "title": "테스트 가이드",
        "content": "A" * 50,  # 최소 30자 이상
    }
    resp = await authed_client.post("/api/v1/guides", data=form_data)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "published"


# ── 2. 챗봇 admin_save_guide → status='draft', Qdrant 호출 없음 ──────────────

@pytest.mark.anyio
async def test_admin_save_guide_creates_draft(db_session):
    """admin_save_guide 실행기: DB에 draft 저장, indexing_dispatched 응답 없음."""
    from services.chat_tools.executors.admin import _save_guide

    result = await _save_guide(
        db=db_session,
        args={
            "title": "챗봇 자동 가이드",
            "content": "B" * 50,
            "category": "incident",
            "tags": ["태그1"],
        },
    )

    assert result["status"] == "draft"
    assert "초안" in result["message"] or "draft" in result["message"].lower()
    # Qdrant 관련 키가 응답에 없어야 함 (indexing_dispatched 제거됨)
    assert "indexing_dispatched" not in result


@pytest.mark.anyio
async def test_admin_save_guide_no_qdrant_call(db_session):
    """admin_save_guide는 Qdrant index_guide를 호출하지 않아야 함."""
    from unittest.mock import AsyncMock, patch
    from services.chat_tools.executors.admin import _save_guide

    mock_index = AsyncMock()
    # qdrant_guides.index_guide를 patch해도 호출되지 않아야 함 (draft 저장이므로)
    with patch("services.qdrant_guides.index_guide", mock_index):
        await _save_guide(
            db=db_session,
            args={
                "title": "Qdrant 호출 없어야 함",
                "content": "C" * 50,
            },
        )

    mock_index.assert_not_called()


# ── 3. 게시 (publish) ─────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_publish_guide_draft_to_published(authed_client: AsyncClient, db_session):
    """draft 가이드를 게시하면 status='published'가 됨."""
    from models import KnowledgeGuide
    from datetime import datetime, timezone

    # draft 가이드 직접 DB 삽입
    guide = KnowledgeGuide(
        title="게시 테스트 가이드",
        content="D" * 50,
        status="draft",
        is_active=True,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(guide)
    await db_session.commit()
    await db_session.refresh(guide)

    resp = await authed_client.post(f"/api/v1/guides/{guide.id}/publish")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "published"


@pytest.mark.anyio
async def test_publish_already_published_returns_400(authed_client: AsyncClient, db_session):
    """이미 published 가이드에 게시 요청하면 400."""
    from models import KnowledgeGuide
    from datetime import datetime, timezone

    guide = KnowledgeGuide(
        title="이미 게시된 가이드",
        content="E" * 50,
        status="published",
        is_active=True,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(guide)
    await db_session.commit()
    await db_session.refresh(guide)

    resp = await authed_client.post(f"/api/v1/guides/{guide.id}/publish")
    assert resp.status_code == 400


# ── 4. 게시취소 (unpublish) ───────────────────────────────────────────────────

@pytest.mark.anyio
async def test_unpublish_guide_published_to_draft(authed_client: AsyncClient, db_session):
    """published 가이드를 게시취소하면 status='draft'가 됨, DB row 보존."""
    from models import KnowledgeGuide
    from datetime import datetime, timezone

    guide = KnowledgeGuide(
        title="게시취소 테스트",
        content="F" * 50,
        status="published",
        is_active=True,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(guide)
    await db_session.commit()
    await db_session.refresh(guide)
    guide_id = str(guide.id)

    resp = await authed_client.post(f"/api/v1/guides/{guide_id}/unpublish")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "draft"

    # DB row 보존 확인
    await db_session.refresh(guide)
    assert guide.is_active is True
    assert guide.status == "draft"


@pytest.mark.anyio
async def test_unpublish_already_draft_returns_400(authed_client: AsyncClient, db_session):
    """이미 draft 가이드에 게시취소 요청하면 400."""
    from models import KnowledgeGuide
    from datetime import datetime, timezone

    guide = KnowledgeGuide(
        title="이미 초안 가이드",
        content="G" * 50,
        status="draft",
        is_active=True,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(guide)
    await db_session.commit()
    await db_session.refresh(guide)

    resp = await authed_client.post(f"/api/v1/guides/{guide.id}/unpublish")
    assert resp.status_code == 400


# ── 5. list_guides status 필터 ────────────────────────────────────────────────

@pytest.mark.anyio
async def test_list_guides_status_filter(authed_client: AsyncClient, db_session):
    """GET /guides?status=draft 필터 동작 검증."""
    from models import KnowledgeGuide
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(KnowledgeGuide(
        title="draft 가이드", content="H" * 50, status="draft", is_active=True,
        created_at=now, updated_at=now,
    ))
    db_session.add(KnowledgeGuide(
        title="published 가이드", content="I" * 50, status="published", is_active=True,
        created_at=now, updated_at=now,
    ))
    await db_session.commit()

    resp_draft = await authed_client.get("/api/v1/guides?status=draft")
    assert resp_draft.status_code == 200
    items_draft = resp_draft.json()["items"]
    assert all(g["status"] == "draft" for g in items_draft)
    assert any(g["title"] == "draft 가이드" for g in items_draft)

    resp_pub = await authed_client.get("/api/v1/guides?status=published")
    assert resp_pub.status_code == 200
    items_pub = resp_pub.json()["items"]
    assert all(g["status"] == "published" for g in items_pub)
    assert any(g["title"] == "published 가이드" for g in items_pub)


# ── 6. _HELP_ALLOWED_TOOLS 불변 invariant ────────────────────────────────────

def test_admin_save_guide_not_in_help_allowed_tools():
    """admin_save_guide는 게스트 채팅(help_inquiry) 허용 도구 목록에 없어야 함."""
    from services.chat_agent import _HELP_ALLOWED_TOOLS
    assert "admin_save_guide" not in _HELP_ALLOWED_TOOLS
