"""OIDC IdP 엔드포인트 — ADR-014.

Synapse가 Identity Provider 역할을 하여 타시스템의 SSO를 지원한다.
Authorization Code Flow (RFC 6749 §4.1 + OpenID Connect Core 1.0).
"""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import (
    ALGORITHM,
    OAUTH_ISSUER,
    SECRET_KEY,
    create_id_token,
    create_oauth_access_token,
    get_jwks,
    get_password_hash,
    require_admin,
    verify_password,
)
from database import get_db
from models import OAuthAuthorizationCode, OAuthClient, User

router = APIRouter(tags=["OAuth / OIDC"])

_FRONTEND_URL = __import__("os").getenv("FRONTEND_EXTERNAL_URL", "http://localhost:3001")

# ── OIDC Discovery ──────────────────────────────────────────────────────────


@router.get("/.well-known/openid-configuration", include_in_schema=False)
async def openid_configuration():
    return {
        "issuer": OAUTH_ISSUER,
        "authorization_endpoint": f"{OAUTH_ISSUER}/oauth/authorize",
        "token_endpoint": f"{OAUTH_ISSUER}/oauth/token",
        "userinfo_endpoint": f"{OAUTH_ISSUER}/oauth/userinfo",
        "jwks_uri": f"{OAUTH_ISSUER}/oauth/jwks",
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "scopes_supported": ["openid", "profile", "email"],
        "token_endpoint_auth_methods_supported": ["client_secret_post"],
        "claims_supported": ["sub", "iss", "aud", "exp", "iat", "email", "name", "role"],
    }


@router.get("/oauth/jwks")
async def jwks():
    return get_jwks()


# ── Authorization Endpoint ──────────────────────────────────────────────────


@router.get("/oauth/authorize")
async def authorize_redirect(
    client_id: str,
    redirect_uri: str,
    response_type: str = "code",
    scope: str = "openid profile email",
    state: Optional[str] = None,
    nonce: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """타시스템이 Authorization Code Flow를 시작할 때 호출.
    클라이언트 검증 후 Synapse 로그인 페이지로 리다이렉트한다."""
    if response_type != "code":
        raise HTTPException(status_code=400, detail="response_type=code 만 지원합니다")

    client = await _get_active_client(db, client_id)
    if redirect_uri not in (client.redirect_uris or []):
        raise HTTPException(status_code=400, detail="redirect_uri가 등록된 값과 일치하지 않습니다")

    import urllib.parse

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "client_name": client.name,
    }
    if state:
        params["state"] = state
    if nonce:
        params["nonce"] = nonce

    login_url = f"{_FRONTEND_URL}/oauth/login?{urllib.parse.urlencode(params)}"
    return RedirectResponse(url=login_url, status_code=302)


class AuthorizeRequest(BaseModel):
    email: str
    password: str
    client_id: str
    redirect_uri: str
    scope: str = "openid profile email"
    state: Optional[str] = None
    nonce: Optional[str] = None


@router.post("/oauth/authorize")
async def authorize_login(body: AuthorizeRequest, db: AsyncSession = Depends(get_db)):
    """OAuthLoginPage 폼 제출 처리.
    로그인 성공 시 { redirect_url } 반환 — 프론트엔드가 window.location으로 이동."""
    client = await _get_active_client(db, body.client_id)
    if body.redirect_uri not in (client.redirect_uris or []):
        raise HTTPException(status_code=400, detail="redirect_uri가 등록된 값과 일치하지 않습니다")

    user = await _authenticate_user(db, body.email, body.password)

    code = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=10)
    db.add(OAuthAuthorizationCode(
        code=code,
        client_id=body.client_id,
        user_id=user.id,
        redirect_uri=body.redirect_uri,
        scope=body.scope,
        nonce=body.nonce,
        expires_at=expires_at,
    ))
    await db.commit()

    import urllib.parse
    params: dict[str, str] = {"code": code}
    if body.state:
        params["state"] = body.state
    redirect_url = f"{body.redirect_uri}?{urllib.parse.urlencode(params)}"
    return {"redirect_url": redirect_url}


# ── Token Endpoint ──────────────────────────────────────────────────────────


@router.post("/oauth/token")
async def token(
    grant_type: str = Form(...),
    code: str = Form(...),
    client_id: str = Form(...),
    client_secret: str = Form(...),
    redirect_uri: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    """Authorization Code → access_token + id_token 교환.
    타시스템 백엔드에서 서버-to-서버로 호출한다."""
    if grant_type != "authorization_code":
        raise HTTPException(status_code=400, detail="grant_type=authorization_code 만 지원합니다")

    client = await _get_active_client(db, client_id)
    if not verify_password(client_secret, client.client_secret):
        raise HTTPException(status_code=401, detail="client_secret이 올바르지 않습니다")

    auth_code = await db.get(OAuthAuthorizationCode, code)
    if not auth_code:
        raise HTTPException(status_code=400, detail="유효하지 않은 code입니다")
    if auth_code.used:
        raise HTTPException(status_code=400, detail="이미 사용된 code입니다")
    if auth_code.client_id != client_id:
        raise HTTPException(status_code=400, detail="code가 해당 client에 속하지 않습니다")
    if auth_code.redirect_uri != redirect_uri:
        raise HTTPException(status_code=400, detail="redirect_uri가 일치하지 않습니다")
    if datetime.now(timezone.utc).replace(tzinfo=None) > auth_code.expires_at:
        raise HTTPException(status_code=400, detail="code가 만료되었습니다")

    auth_code.used = True
    await db.commit()

    user = await db.get(User, auth_code.user_id)
    if not user or not user.is_active or not user.is_approved:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없거나 비활성 상태입니다")

    id_token = create_id_token(user, client_id, nonce=auth_code.nonce)
    access_token = create_oauth_access_token(user, client_id)

    return {
        "access_token": access_token,
        "id_token": id_token,
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": auth_code.scope,
    }


# ── Userinfo Endpoint ───────────────────────────────────────────────────────


@router.get("/oauth/userinfo")
async def userinfo(request: Request, db: AsyncSession = Depends(get_db)):
    """access_token으로 로그인한 사용자 정보 반환."""
    from jose import JWTError, jwt as jose_jwt

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer 토큰이 필요합니다")
    token = auth_header.removeprefix("Bearer ").strip()
    try:
        payload = jose_jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다")
    if payload.get("type") != "oauth_access":
        raise HTTPException(status_code=401, detail="oauth_access 토큰이 아닙니다")

    user = await db.get(User, int(payload["sub"]))
    if not user or not user.is_active or not user.is_approved:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다")

    return {
        "sub": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": user.role,
    }


# ── Admin: OAuth 클라이언트 관리 ─────────────────────────────────────────────


class OAuthClientCreate(BaseModel):
    name: str
    redirect_uris: list[str]


class OAuthClientOut(BaseModel):
    id: int
    client_id: str
    name: str
    redirect_uris: list[str]
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("/api/v1/oauth/clients", response_model=list[OAuthClientOut])
async def list_clients(
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(OAuthClient).order_by(OAuthClient.created_at.desc()))
    return result.scalars().all()


@router.post("/api/v1/oauth/clients", status_code=201)
async def create_client(
    body: OAuthClientCreate,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """클라이언트 등록. client_secret은 이 응답에서 단 1회만 평문으로 반환된다."""
    plain_secret = secrets.token_urlsafe(32)
    client_id = f"synapse_{secrets.token_hex(8)}"
    client = OAuthClient(
        client_id=client_id,
        client_secret=get_password_hash(plain_secret),
        name=body.name,
        redirect_uris=body.redirect_uris,
    )
    db.add(client)
    await db.commit()
    await db.refresh(client)
    return {
        "id": client.id,
        "client_id": client.client_id,
        "client_secret": plain_secret,
        "name": client.name,
        "redirect_uris": client.redirect_uris,
        "created_at": client.created_at,
        "warning": "client_secret은 이 응답에서만 확인 가능합니다. 반드시 저장하세요.",
    }


@router.delete("/api/v1/oauth/clients/{client_db_id}", status_code=204)
async def deactivate_client(
    client_db_id: int,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    client = await db.get(OAuthClient, client_db_id)
    if not client:
        raise HTTPException(status_code=404, detail="클라이언트를 찾을 수 없습니다")
    client.is_active = False
    await db.commit()


# ── 내부 헬퍼 ───────────────────────────────────────────────────────────────


async def _get_active_client(db: AsyncSession, client_id: str) -> OAuthClient:
    result = await db.execute(
        select(OAuthClient)
        .where(OAuthClient.client_id == client_id)
        .where(OAuthClient.is_active.is_(True))
    )
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=400, detail="등록되지 않았거나 비활성 client_id입니다")
    return client


async def _authenticate_user(db: AsyncSession, email: str, password: str) -> User:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다")
    if not user.is_active or not user.is_approved:
        raise HTTPException(status_code=403, detail="승인되지 않은 계정입니다")
    return user
