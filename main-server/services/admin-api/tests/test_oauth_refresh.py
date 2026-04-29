"""OIDC Refresh Token + Rotation 테스트"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import OAuthAuthorizationCode, OAuthClient, OAuthRefreshToken, User
from auth import get_password_hash, create_oauth_refresh_token, OAUTH_REFRESH_TOKEN_EXPIRE_DAYS


# ── 픽스처 헬퍼 ─────────────────────────────────────────────────────────────


async def _create_user(db: AsyncSession) -> User:
    user = User(
        email="sso@test.com",
        password_hash=get_password_hash("pass1234"),
        name="SSO유저",
        role="operator",
        is_active=True,
        is_approved=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _create_client(db: AsyncSession) -> tuple[OAuthClient, str]:
    plain = "test-secret-xyz"
    client = OAuthClient(
        client_id="synapse_testclient",
        client_secret=get_password_hash(plain),
        name="테스트앱",
        redirect_uris=["http://localhost:9999/callback"],
        is_active=True,
    )
    db.add(client)
    await db.flush()
    return client, plain


async def _create_code(db: AsyncSession, user: User, client: OAuthClient) -> OAuthAuthorizationCode:
    code = OAuthAuthorizationCode(
        code="testcode123",
        client_id=client.client_id,
        user_id=user.id,
        redirect_uri="http://localhost:9999/callback",
        scope="openid profile email",
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=10),
    )
    db.add(code)
    await db.flush()
    return code


async def _create_refresh_token(
    db: AsyncSession,
    client: OAuthClient,
    user: User,
    *,
    revoked: bool = False,
    expired: bool = False,
) -> OAuthRefreshToken:
    expires_at = (
        datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
        if expired
        else datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)
    )
    rt = OAuthRefreshToken(
        token=create_oauth_refresh_token(),
        client_id=client.client_id,
        user_id=user.id,
        scope="openid profile email",
        expires_at=expires_at,
        revoked=revoked,
    )
    db.add(rt)
    await db.flush()
    return rt


# ── 테스트: authorization_code 발급 시 refresh_token 포함 ───────────────────


async def test_authorization_code_includes_refresh_token(
    client: AsyncClient, db_session: AsyncSession
):
    """grant_type=authorization_code 응답에 refresh_token이 포함되어야 한다."""
    user = await _create_user(db_session)
    oauth_client, plain_secret = await _create_client(db_session)
    await _create_code(db_session, user, oauth_client)
    await db_session.commit()

    # 테스트 환경에 RSA 키가 없으므로 create_id_token을 모킹
    with patch("routes.oauth.create_id_token", return_value="mocked.id.token"):
        resp = await client.post(
            "/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": "testcode123",
                "client_id": oauth_client.client_id,
                "client_secret": plain_secret,
                "redirect_uri": "http://localhost:9999/callback",
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert "id_token" in body
    assert "refresh_token" in body
    assert body["refresh_token_expires_in"] == OAUTH_REFRESH_TOKEN_EXPIRE_DAYS * 86400


# ── 테스트: refresh_token으로 갱신 ──────────────────────────────────────────


async def test_refresh_token_grant_returns_new_tokens(
    client: AsyncClient, db_session: AsyncSession
):
    """유효한 refresh_token → 새 access_token + 새 refresh_token 반환."""
    user = await _create_user(db_session)
    oauth_client, plain_secret = await _create_client(db_session)
    rt = await _create_refresh_token(db_session, oauth_client, user)
    await db_session.commit()

    resp = await client.post(
        "/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": rt.token,
            "client_id": oauth_client.client_id,
            "client_secret": plain_secret,
        },
    )

    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert "refresh_token" in body
    assert body["refresh_token"] != rt.token  # 새 토큰이어야 함
    assert "id_token" not in body             # 갱신 시 id_token 미발급


# ── 테스트: Rotation — 기존 토큰 폐기 확인 ──────────────────────────────────


async def test_refresh_token_rotation_revokes_old_token(
    client: AsyncClient, db_session: AsyncSession
):
    """갱신 후 기존 refresh_token은 revoked=True가 되어야 한다."""
    user = await _create_user(db_session)
    oauth_client, plain_secret = await _create_client(db_session)
    rt = await _create_refresh_token(db_session, oauth_client, user)
    old_token_value = rt.token
    await db_session.commit()

    await client.post(
        "/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": old_token_value,
            "client_id": oauth_client.client_id,
            "client_secret": plain_secret,
        },
    )

    await db_session.refresh(rt)
    assert rt.revoked is True
    assert rt.replaced_by is not None


# ── 테스트: 만료된 refresh_token → 401 ──────────────────────────────────────


async def test_refresh_token_expired_returns_401(
    client: AsyncClient, db_session: AsyncSession
):
    user = await _create_user(db_session)
    oauth_client, plain_secret = await _create_client(db_session)
    rt = await _create_refresh_token(db_session, oauth_client, user, expired=True)
    await db_session.commit()

    resp = await client.post(
        "/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": rt.token,
            "client_id": oauth_client.client_id,
            "client_secret": plain_secret,
        },
    )

    assert resp.status_code == 401
    assert "만료" in resp.json()["detail"]


# ── 테스트: Reuse Detection — 폐기된 토큰 재사용 ────────────────────────────


async def test_refresh_token_reuse_detection_revokes_all(
    client: AsyncClient, db_session: AsyncSession
):
    """이미 revoked된 토큰 사용 시 해당 user+client의 모든 활성 토큰을 폐기한다."""
    user = await _create_user(db_session)
    oauth_client, plain_secret = await _create_client(db_session)

    revoked_rt = await _create_refresh_token(db_session, oauth_client, user, revoked=True)
    active_rt = await _create_refresh_token(db_session, oauth_client, user)
    await db_session.commit()

    resp = await client.post(
        "/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": revoked_rt.token,
            "client_id": oauth_client.client_id,
            "client_secret": plain_secret,
        },
    )

    assert resp.status_code == 401
    assert "재사용" in resp.json()["detail"]

    await db_session.refresh(active_rt)
    assert active_rt.revoked is True  # 활성 토큰도 전체 폐기


# ── 테스트: Rotation 후 기존 토큰 재시도 → Reuse Detection ──────────────────


async def test_rotation_then_reuse_triggers_detection(
    client: AsyncClient, db_session: AsyncSession
):
    """갱신 성공 후 기존 토큰으로 재시도하면 Reuse Detection이 발동한다."""
    user = await _create_user(db_session)
    oauth_client, plain_secret = await _create_client(db_session)
    rt = await _create_refresh_token(db_session, oauth_client, user)
    original_token = rt.token
    await db_session.commit()

    # 1회 정상 갱신
    resp1 = await client.post(
        "/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": original_token,
            "client_id": oauth_client.client_id,
            "client_secret": plain_secret,
        },
    )
    assert resp1.status_code == 200

    # 기존 토큰으로 재시도 → Reuse Detection
    resp2 = await client.post(
        "/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": original_token,
            "client_id": oauth_client.client_id,
            "client_secret": plain_secret,
        },
    )
    assert resp2.status_code == 401
    assert "재사용" in resp2.json()["detail"]
