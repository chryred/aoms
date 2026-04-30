"""Knowledge 문서 목록 조회 / 삭제 단위 테스트.

외부 HTTP(log-analyzer): AsyncMock으로 패치.
DB: SQLite in-memory (conftest.py 공통 fixture 사용).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from database import Base, get_db
from main import app
from auth import get_current_user
from models import Contact, System, SystemContact, User


# ── 공통 픽스처 ──────────────────────────────────────────────────────────────────

def _mock_httpx_response(data: dict, status_code: int = 200) -> MagicMock:
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = data
    mock_resp.text = str(data)
    return mock_resp


_DOCUMENTS_RESPONSE = {
    "items": [
        {
            "file_hash": "hash-abc",
            "file_name": "manual.pdf",
            "system_id": 1,
            "chunk_count": 10,
            "uploaded_at": "2026-01-01T00:00:00",
        },
        {
            "file_hash": "hash-xyz",
            "file_name": "guide.docx",
            "system_id": 2,
            "chunk_count": 5,
            "uploaded_at": "2026-01-02T00:00:00",
        },
    ]
}

_DELETE_RESPONSE = {"deleted_points": 10, "deleted_file": True}


async def _make_operator_client(system_id: int | None = 1):
    """operator 유저 + Contact + SystemContact 매핑이 있는 테스트 클라이언트 생성."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    db_sess = session_factory()

    # 시스템 생성
    sys1 = System(system_name="cxm", display_name="고객경험시스템", status="active")
    db_sess.add(sys1)
    await db_sess.flush()

    # operator 유저
    op_user = User(
        email="op@test.com",
        password_hash="hashed",
        name="운영자",
        role="operator",
        is_active=True,
        is_approved=True,
    )
    db_sess.add(op_user)
    await db_sess.flush()

    if system_id is not None:
        # Contact 생성
        contact = Contact(user_id=op_user.id, teams_upn="op@company.com")
        db_sess.add(contact)
        await db_sess.flush()

        # SystemContact 매핑 (system_id=1에만 매핑)
        sc = SystemContact(
            system_id=sys1.id,
            contact_id=contact.id,
            role="primary",
            notify_channels="teams",
        )
        db_sess.add(sc)
        await db_sess.flush()

    return db_sess, op_user, sys1


# ── 비로그인 차단 ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_documents_requires_auth(client: AsyncClient):
    """비로그인 시 401."""
    resp = await client.get("/api/v1/knowledge/documents")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_delete_document_requires_auth(client: AsyncClient):
    """비로그인 시 401."""
    resp = await client.delete("/api/v1/knowledge/documents/hash-abc")
    assert resp.status_code == 401


# ── GET 문서 목록 ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_documents_admin_success(authed_client: AsyncClient):
    """admin → 200 + items."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.get = AsyncMock(return_value=_mock_httpx_response(_DOCUMENTS_RESPONSE))

        resp = await authed_client.get("/api/v1/knowledge/documents")

    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert len(data["items"]) == 2


@pytest.mark.asyncio
async def test_list_documents_with_system_id_filter(authed_client: AsyncClient):
    """system_id 쿼리파라미터가 log-analyzer로 전달된다."""
    filtered = {"items": [_DOCUMENTS_RESPONSE["items"][0]]}

    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.get = AsyncMock(return_value=_mock_httpx_response(filtered))

        resp = await authed_client.get("/api/v1/knowledge/documents?system_id=1")

    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 1


@pytest.mark.asyncio
async def test_list_documents_log_analyzer_error_returns_502(authed_client: AsyncClient):
    """log-analyzer 502 응답 시 502 반환."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.get = AsyncMock(return_value=_mock_httpx_response({}, 500))

        resp = await authed_client.get("/api/v1/knowledge/documents")

    assert resp.status_code == 502


# ── DELETE 문서 삭제 — admin ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_document_admin_success(authed_client: AsyncClient):
    """admin → 권한 체크 없이 바로 DELETE 호출 → 200."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        # admin이므로 GET(목록) 호출 없이 바로 DELETE
        mock_instance.delete = AsyncMock(return_value=_mock_httpx_response(_DELETE_RESPONSE))

        resp = await authed_client.delete("/api/v1/knowledge/documents/hash-abc")

    assert resp.status_code == 200
    data = resp.json()
    assert data["deleted_points"] == 10


# ── DELETE 문서 삭제 — operator 권한 분기 ──────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_document_operator_own_system_allowed():
    """operator가 자신이 담당하는 system_id(1) 문서 삭제 → 200."""
    db_sess, op_user, sys1 = await _make_operator_client(system_id=1)

    app.dependency_overrides[get_db] = lambda: (yield db_sess)
    app.dependency_overrides[get_current_user] = lambda: op_user

    try:
        with patch("httpx.AsyncClient") as mock_cls:
            mock_instance = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
            # 1차 GET 목록 (file_hash → system_id 매핑)
            mock_instance.get = AsyncMock(return_value=_mock_httpx_response(_DOCUMENTS_RESPONSE))
            # 2차 DELETE
            mock_instance.delete = AsyncMock(return_value=_mock_httpx_response(_DELETE_RESPONSE))

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                # hash-abc 는 system_id=1 (sys1.id와 동일한지 확인 필요)
                # 픽스처에서 sys1.id는 auto-increment이므로 1임을 가정
                resp = await ac.delete("/api/v1/knowledge/documents/hash-abc")
    finally:
        app.dependency_overrides.clear()
        await db_sess.close()

    # system_id=1 의 담당자이므로 200
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_delete_document_operator_other_system_forbidden():
    """operator가 담당하지 않는 system_id(2) 문서 삭제 → 403."""
    db_sess, op_user, sys1 = await _make_operator_client(system_id=1)

    app.dependency_overrides[get_db] = lambda: (yield db_sess)
    app.dependency_overrides[get_current_user] = lambda: op_user

    try:
        with patch("httpx.AsyncClient") as mock_cls:
            mock_instance = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
            # hash-xyz 는 system_id=2 (operator는 system_id=1만 담당)
            mock_instance.get = AsyncMock(return_value=_mock_httpx_response(_DOCUMENTS_RESPONSE))

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/v1/knowledge/documents/hash-xyz")
    finally:
        app.dependency_overrides.clear()
        await db_sess.close()

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_document_operator_no_contact_forbidden():
    """Contact 매핑이 없는 operator → 403."""
    db_sess, op_user, sys1 = await _make_operator_client(system_id=None)

    app.dependency_overrides[get_db] = lambda: (yield db_sess)
    app.dependency_overrides[get_current_user] = lambda: op_user

    try:
        with patch("httpx.AsyncClient") as mock_cls:
            mock_instance = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
            mock_instance.get = AsyncMock(return_value=_mock_httpx_response(_DOCUMENTS_RESPONSE))

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/v1/knowledge/documents/hash-abc")
    finally:
        app.dependency_overrides.clear()
        await db_sess.close()

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_document_not_found_in_list():
    """file_hash가 목록에 없으면 404."""
    db_sess, op_user, sys1 = await _make_operator_client(system_id=1)

    app.dependency_overrides[get_db] = lambda: (yield db_sess)
    app.dependency_overrides[get_current_user] = lambda: op_user

    try:
        with patch("httpx.AsyncClient") as mock_cls:
            mock_instance = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
            # 빈 목록 반환
            mock_instance.get = AsyncMock(return_value=_mock_httpx_response({"items": []}))

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/v1/knowledge/documents/hash-nonexistent")
    finally:
        app.dependency_overrides.clear()
        await db_sess.close()

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_document_log_analyzer_404():
    """log-analyzer DELETE가 404 응답 시 404 반환 (admin)."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    db_sess = session_factory()

    admin_user = User(
        email="admin@test.com",
        password_hash="hashed",
        name="관리자",
        role="admin",
        is_active=True,
        is_approved=True,
    )
    db_sess.add(admin_user)
    await db_sess.flush()

    app.dependency_overrides[get_db] = lambda: (yield db_sess)
    app.dependency_overrides[get_current_user] = lambda: admin_user

    try:
        with patch("httpx.AsyncClient") as mock_cls:
            mock_instance = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
            mock_instance.delete = AsyncMock(
                return_value=_mock_httpx_response({"detail": "Not found"}, 404)
            )

            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/v1/knowledge/documents/hash-missing")
    finally:
        app.dependency_overrides.clear()
        await db_sess.close()

    assert resp.status_code == 404
