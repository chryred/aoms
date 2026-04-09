"""초기 admin 계정 생성 스크립트.

사용법:
    ADMIN_EMAIL=admin@company.com ADMIN_PASSWORD=changeme python scripts/create_admin.py

Docker 환경:
    docker exec -it synapse-admin-api \\
      ADMIN_EMAIL=admin@company.com ADMIN_PASSWORD=changeme \\
      python scripts/create_admin.py
"""
import asyncio
import os
import sys

# 프로젝트 루트를 path에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from database import Base
from models import User
from auth import get_password_hash


async def main() -> None:
    email = os.getenv("ADMIN_EMAIL")
    password = os.getenv("ADMIN_PASSWORD")
    name = os.getenv("ADMIN_NAME", "관리자")
    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://synapse:synapse@localhost:5432/synapse",
    )

    if not email or not password:
        print("오류: ADMIN_EMAIL, ADMIN_PASSWORD 환경변수를 설정해주세요.")
        sys.exit(1)

    engine = create_async_engine(database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        result = await session.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()
        if existing:
            print(f"이미 존재하는 계정입니다: {email} (role={existing.role})")
            await engine.dispose()
            return

        user = User(
            email=email,
            password_hash=get_password_hash(password),
            name=name,
            role="admin",
            is_active=True,
            is_approved=True,
        )
        session.add(user)
        await session.commit()
        print(f"admin 계정 생성 완료: {email}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
