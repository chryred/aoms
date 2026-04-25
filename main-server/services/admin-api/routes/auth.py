import os
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List

from auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
    get_password_hash,
    get_current_user,
    require_admin,
)
from database import get_db
from models import User, Contact, System, SystemContact

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))


# ── 스키마 ──────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str

    model_config = {"from_attributes": True}


class PrimarySystemOut(BaseModel):
    system_id: int
    system_name: str
    display_name: str

    model_config = {"from_attributes": True}


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# Phase 3c 스키마
import re as _re


class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str

    @staticmethod
    def _check_password(v: str) -> str:
        if len(v) < 12:
            raise ValueError("비밀번호는 12자 이상이어야 합니다")
        if not _re.search(r'[A-Z]', v):
            raise ValueError("비밀번호에 대문자가 1개 이상 포함되어야 합니다")
        if not _re.search(r'[0-9]', v):
            raise ValueError("비밀번호에 숫자가 1개 이상 포함되어야 합니다")
        return v

    @field_validator('password')
    @classmethod
    def validate_password(cls, v):
        return cls._check_password(v)


class UserAdminOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    is_active: bool
    is_approved: bool
    is_linked: bool = False
    created_at: str

    model_config = {"from_attributes": True}


class UserStatusUpdate(BaseModel):
    is_approved: Optional[bool] = None
    is_active: Optional[bool] = None


class UserRoleUpdate(BaseModel):
    role: str


class UserUpdateMe(BaseModel):
    name: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class UserAdminUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


# ── 엔드포인트 ───────────────────────────────────────────────────────────────
class CliLoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


@router.post("/login")
async def login(request: Request, body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user: User | None = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 또는 비밀번호가 올바르지 않습니다",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="비활성화된 계정입니다")
    if not user.is_approved:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="승인 대기 중인 계정입니다")

    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user.id)

    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/api/v1/auth",
    )

    # CLI 클라이언트: refresh_token을 body에도 포함 (httpOnly 쿠키 대신 로컬 파일 관리)
    if request.headers.get("X-Client") == "cli":
        return CliLoginResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            user=UserOut.model_validate(user),
        )

    return LoginResponse(
        access_token=access_token,
        user=UserOut.model_validate(user),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: Request, db: AsyncSession = Depends(get_db)):
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token 없음")

    from jose import JWTError
    try:
        payload = decode_token(refresh_token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token 만료 또는 유효하지 않음")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="잘못된 토큰 타입")

    user = await db.get(User, int(payload["sub"]))
    if not user or not user.is_active or not user.is_approved:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없거나 비활성 상태")

    return TokenResponse(access_token=create_access_token(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    response.set_cookie(
        key="refresh_token",
        value="",
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=0,
        path="/api/v1/auth",
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user


@router.get("/me/primary-systems", response_model=List[PrimarySystemOut])
async def my_primary_systems(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """로그인 사용자가 primary 담당자로 등록된 시스템 목록.
    AgentFormModal 시스템 자동선택 용도.
    """
    result = await db.execute(
        select(System)
        .join(SystemContact, SystemContact.system_id == System.id)
        .join(Contact, Contact.id == SystemContact.contact_id)
        .where(Contact.user_id == user.id)
        .where(SystemContact.role == "primary")
        .order_by(System.id)
    )
    systems = result.scalars().all()
    return [
        PrimarySystemOut(
            system_id=s.id,
            system_name=s.system_name,
            display_name=s.display_name,
        )
        for s in systems
    ]


# ── Phase 3c ─────────────────────────────────────────────────────────────────

@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 이메일입니다")

    user = User(
        email=body.email,
        password_hash=get_password_hash(body.password),
        name=body.name,
        role="operator",
        is_active=True,
        is_approved=False,
    )
    db.add(user)
    await db.commit()
    return {"message": "등록 신청이 완료되었습니다. 관리자 승인 후 로그인 가능합니다."}


@router.get("/users/approved", response_model=List[UserOut])
async def get_approved_users(
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """담당자 등록 UI용: 승인된 사용자 목록 (operator 이상 접근 가능)"""
    result = await db.execute(
        select(User)
        .where(User.is_approved == True, User.is_active == True)  # noqa: E712
        .order_by(User.name)
    )
    return result.scalars().all()


@router.get("/users", response_model=List[UserAdminOut])
async def get_users(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()

    # 담당자 연결된 user_id 집합 조회
    linked_result = await db.execute(
        select(Contact.user_id).where(Contact.user_id.is_not(None))
    )
    linked_user_ids = {row[0] for row in linked_result.all()}

    return [
        UserAdminOut(
            id=u.id,
            email=u.email,
            name=u.name,
            role=u.role,
            is_active=u.is_active,
            is_approved=u.is_approved,
            is_linked=u.id in linked_user_ids,
            created_at=u.created_at.isoformat(),
        )
        for u in users
    ]


@router.patch("/users/{user_id}/status", response_model=UserAdminOut)
async def update_user_status(
    user_id: int,
    body: UserStatusUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")

    if body.is_approved is not None:
        user.is_approved = body.is_approved
    if body.is_active is not None:
        user.is_active = body.is_active

    await db.commit()
    await db.refresh(user)
    linked_check = await db.execute(select(Contact.id).where(Contact.user_id == user.id))
    return UserAdminOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        is_approved=user.is_approved,
        is_linked=linked_check.scalar_one_or_none() is not None,
        created_at=user.created_at.isoformat(),
    )


@router.patch("/users/{user_id}/role", response_model=UserAdminOut)
async def update_user_role(
    user_id: int,
    body: UserRoleUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if body.role not in ("admin", "operator"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="role은 admin 또는 operator여야 합니다")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")

    user.role = body.role
    await db.commit()
    await db.refresh(user)
    linked_check = await db.execute(select(Contact.id).where(Contact.user_id == user.id))
    return UserAdminOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        is_approved=user.is_approved,
        is_linked=linked_check.scalar_one_or_none() is not None,
        created_at=user.created_at.isoformat(),
    )


@router.patch("/users/{user_id}", response_model=UserAdminOut)
async def update_user(
    user_id: int,
    body: UserAdminUpdate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")

    if body.email is not None:
        dup = await db.execute(select(User).where(User.email == body.email, User.id != user_id))
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 사용 중인 이메일입니다")
        user.email = body.email

    if body.name is not None:
        user.name = body.name

    await db.commit()
    await db.refresh(user)
    linked_check = await db.execute(select(Contact.id).where(Contact.user_id == user.id))
    return UserAdminOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        is_active=user.is_active,
        is_approved=user.is_approved,
        is_linked=linked_check.scalar_one_or_none() is not None,
        created_at=user.created_at.isoformat(),
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_admin: User = Depends(require_admin),
):
    if current_admin.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="자기 자신은 삭제할 수 없습니다")

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="사용자를 찾을 수 없습니다")

    linked = await db.execute(select(Contact.id).where(Contact.user_id == user_id))
    if linked.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="담당자로 연결된 사용자입니다. 먼저 담당자 연결을 해제해 주세요",
        )

    await db.delete(user)
    await db.commit()


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: UserUpdateMe,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.new_password:
        if not body.current_password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="현재 비밀번호를 입력하세요")
        if not verify_password(body.current_password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="현재 비밀번호가 올바르지 않습니다")
        user.password_hash = get_password_hash(body.new_password)

    if body.name is not None:
        user.name = body.name

    await db.commit()
    await db.refresh(user)
    return user
