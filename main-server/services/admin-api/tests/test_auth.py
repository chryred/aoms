import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_password_hash
from models import User, System, Contact, SystemContact


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


# ── /me/primary-systems 엔드포인트 테스트 ────────────────────────────────────
async def _login_and_token(client: AsyncClient, email: str, password: str) -> str:
    resp = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert resp.status_code == 200
    return resp.json()["access_token"]


@pytest.mark.asyncio
async def test_my_primary_systems_returns_primary(
    client: AsyncClient, db_session: AsyncSession
):
    user = await _create_user(db_session)
    sys1 = System(system_name="cxm", display_name="고객경험")
    sys2 = System(system_name="oms", display_name="주문관리")
    sys3 = System(system_name="wms", display_name="창고관리")
    db_session.add_all([sys1, sys2, sys3])
    await db_session.flush()

    contact = Contact(user_id=user.id, teams_upn=user.email)
    db_session.add(contact)
    await db_session.flush()

    # sys1=primary, sys2=secondary, sys3=primary
    db_session.add_all([
        SystemContact(system_id=sys1.id, contact_id=contact.id, role="primary",
                      notify_channels="teams"),
        SystemContact(system_id=sys2.id, contact_id=contact.id, role="secondary",
                      notify_channels="teams"),
        SystemContact(system_id=sys3.id, contact_id=contact.id, role="primary",
                      notify_channels="teams"),
    ])
    await db_session.commit()

    token = await _login_and_token(client, user.email, "password123")
    resp = await client.get(
        "/api/v1/auth/me/primary-systems",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    items = resp.json()
    # primary 역할만 반환, id 오름차순
    assert [i["system_name"] for i in items] == ["cxm", "wms"]
    assert items[0] == {"system_id": sys1.id, "system_name": "cxm", "display_name": "고객경험"}


@pytest.mark.asyncio
async def test_my_primary_systems_empty_when_no_contact(
    client: AsyncClient, db_session: AsyncSession
):
    await _create_user(db_session)
    token = await _login_and_token(client, "test@example.com", "password123")
    resp = await client.get(
        "/api/v1/auth/me/primary-systems",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_my_primary_systems_empty_when_only_secondary(
    client: AsyncClient, db_session: AsyncSession
):
    user = await _create_user(db_session)
    system = System(system_name="sec-only", display_name="부담당만")
    db_session.add(system)
    await db_session.flush()
    contact = Contact(user_id=user.id, teams_upn=user.email)
    db_session.add(contact)
    await db_session.flush()
    db_session.add(SystemContact(
        system_id=system.id, contact_id=contact.id,
        role="secondary", notify_channels="teams",
    ))
    await db_session.commit()

    token = await _login_and_token(client, user.email, "password123")
    resp = await client.get(
        "/api/v1/auth/me/primary-systems",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_my_primary_systems_without_token(
    client: AsyncClient, db_session: AsyncSession
):
    resp = await client.get("/api/v1/auth/me/primary-systems")
    assert resp.status_code == 401
