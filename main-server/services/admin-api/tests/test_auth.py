import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_password_hash
from models import User


# ── 헬퍼 ────────────────────────────────────────────────────────────────────
async def _create_user(
    db: AsyncSession,
    email: str = "test@example.com",
    password: str = "password123",
    role: str = "operator",
    is_approved: bool = True,
    is_active: bool = True,
) -> User:
    user = User(
        email=email,
        password_hash=get_password_hash(password),
        name="테스트유저",
        role=role,
        is_active=is_active,
        is_approved=is_approved,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


# ── 로그인 테스트 ─────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, db_session: AsyncSession):
    await _create_user(db_session)
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "password123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "test@example.com"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient, db_session: AsyncSession):
    await _create_user(db_session)
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "wrongpassword"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_email(client: AsyncClient, db_session: AsyncSession):
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": "password123"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_not_approved(client: AsyncClient, db_session: AsyncSession):
    await _create_user(db_session, is_approved=False)
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "password123"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_login_inactive(client: AsyncClient, db_session: AsyncSession):
    await _create_user(db_session, is_active=False)
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "password123"},
    )
    assert resp.status_code == 403


# ── refresh 토큰 테스트 ────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_refresh_success(client: AsyncClient, db_session: AsyncSession):
    await _create_user(db_session)

    # 로그인 → refresh_token 쿠키 획득
    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "password123"},
    )
    assert login_resp.status_code == 200

    # refresh 요청 (쿠키 자동 전달)
    refresh_resp = await client.post("/api/v1/auth/refresh")
    assert refresh_resp.status_code == 200
    assert "access_token" in refresh_resp.json()


@pytest.mark.asyncio
async def test_refresh_without_cookie(client: AsyncClient, db_session: AsyncSession):
    resp = await client.post("/api/v1/auth/refresh")
    assert resp.status_code == 401


# ── 로그아웃 테스트 ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_logout(client: AsyncClient, db_session: AsyncSession):
    await _create_user(db_session)
    await client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "password123"},
    )
    resp = await client.post("/api/v1/auth/logout")
    assert resp.status_code == 204


# ── /me 엔드포인트 테스트 ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_me_with_valid_token(client: AsyncClient, db_session: AsyncSession):
    await _create_user(db_session)
    login_resp = await client.post(
        "/api/v1/auth/login",
        json={"email": "test@example.com", "password": "password123"},
    )
    token = login_resp.json()["access_token"]

    me_resp = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "test@example.com"


@pytest.mark.asyncio
async def test_me_without_token(client: AsyncClient, db_session: AsyncSession):
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401
