import base64
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
import jwt
from jwt.exceptions import PyJWTError as JWTError
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import User

# ── 설정 ───────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "")
if not SECRET_KEY or SECRET_KEY == "change-me-in-production":
    import warnings
    warnings.warn(
        "SECRET_KEY 환경변수가 설정되지 않았거나 기본값입니다. "
        "운영 환경에서는 반드시 강력한 랜덤 값을 설정하세요.",
        stacklevel=1,
    )
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "1"))

# ── OIDC IdP 설정 (ADR-014) ─────────────────────────────────────────────────
OAUTH_ISSUER = os.getenv("OAUTH_ISSUER", "http://localhost:8080")
OAUTH_ID_TOKEN_EXPIRE_MINUTES = 60
OAUTH_REFRESH_TOKEN_EXPIRE_DAYS = 1

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── 비밀번호 ────────────────────────────────────────────────────────────────
def get_password_hash(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


# ── JWT ─────────────────────────────────────────────────────────────────────
def create_access_token(user: User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "type": "access",
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """토큰 디코드. 만료/서명 오류 시 JWTError 발생."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# ── FastAPI Dependency ───────────────────────────────────────────────────────
async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증 정보가 없거나 유효하지 않습니다",
        headers={"WWW-Authenticate": "Bearer"},
    )
    auth_header: Optional[str] = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise credentials_exception

    token = auth_header.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(token)
    except JWTError:
        raise credentials_exception

    if payload.get("type") != "access":
        raise credentials_exception

    user_id: Optional[str] = payload.get("sub")
    if not user_id:
        raise credentials_exception

    user = await db.get(User, int(user_id))
    if not user or not user.is_active or not user.is_approved:
        raise credentials_exception

    return user


require_auth = Depends(get_current_user)


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 권한이 필요합니다",
        )
    return user


# ── OIDC RSA 키 관리 (ADR-014) ──────────────────────────────────────────────

def _load_rsa_private_key() -> Optional[str]:
    """OAUTH_PRIVATE_KEY_PATH 파일에서 RSA private key PEM 로드."""
    path = os.getenv("OAUTH_PRIVATE_KEY_PATH", "")
    if not path:
        return None
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return None


def _load_rsa_public_key() -> Optional[str]:
    """OAUTH_PUBLIC_KEY_PATH 파일에서 RSA public key PEM 로드."""
    path = os.getenv("OAUTH_PUBLIC_KEY_PATH", "")
    if not path:
        return None
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return None


def get_jwks() -> dict:
    """OIDC JWKS 엔드포인트용 공개키 딕셔너리 반환."""
    public_pem = _load_rsa_public_key()
    if not public_pem:
        return {"keys": []}
    try:
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        pub_key = load_pem_public_key(public_pem.encode())
        pub_numbers = pub_key.public_numbers()

        def _int_to_b64url(n: int) -> str:
            length = (n.bit_length() + 7) // 8
            return base64.urlsafe_b64encode(n.to_bytes(length, "big")).rstrip(b"=").decode()

        return {
            "keys": [{
                "kty": "RSA",
                "use": "sig",
                "alg": "RS256",
                "kid": "default",
                "n": _int_to_b64url(pub_numbers.n),
                "e": _int_to_b64url(pub_numbers.e),
            }]
        }
    except Exception:
        return {"keys": []}


def create_id_token(user: User, client_id: str, nonce: Optional[str] = None) -> str:
    """OIDC ID Token (RS256) 발급."""
    private_key = _load_rsa_private_key()
    if not private_key:
        raise ValueError("OAUTH_PRIVATE_KEY 환경변수가 설정되지 않았습니다")
    expire = datetime.now(timezone.utc) + timedelta(minutes=OAUTH_ID_TOKEN_EXPIRE_MINUTES)
    payload: dict = {
        "iss": OAUTH_ISSUER,
        "sub": str(user.id),
        "aud": client_id,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "email": user.email,
        "name": user.name,
        "role": user.role,
    }
    if nonce:
        payload["nonce"] = nonce
    return jwt.encode(payload, private_key, algorithm="RS256")


def create_oauth_refresh_token() -> str:
    """opaque 랜덤 Refresh Token (JWT 아님 — DB 조회로 검증)."""
    return secrets.token_urlsafe(48)


def create_oauth_access_token(user: User, client_id: str) -> str:
    """OAuth userinfo 조회용 access_token (HS256, 1시간)."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=OAUTH_ID_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "type": "oauth_access",
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
