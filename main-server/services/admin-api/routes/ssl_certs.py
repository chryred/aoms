"""
SSL 인증서 현황 D-day 대시보드
GET /api/v1/ssl/certs/status    전체 현황 (days_left 오름차순)
GET /api/v1/ssl/certs/{server_id}  서버별 최신 스냅샷
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import SslServer, SslCertSnapshot
from schemas import SslCertStatusOut, SslCertSnapshotOut

router = APIRouter(prefix="/api/v1/ssl", tags=["ssl-certs"])


@router.get("/certs/status", response_model=list[SslCertStatusOut])
async def cert_status(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    servers = (
        await db.execute(
            select(SslServer).where(SslServer.status == "active").order_by(SslServer.id)
        )
    ).scalars().all()

    result = []
    for server in servers:
        snap = (
            await db.execute(
                select(SslCertSnapshot)
                .where(SslCertSnapshot.server_id == server.id)
                .order_by(SslCertSnapshot.checked_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        result.append(SslCertStatusOut(server=server, snapshot=snap))

    # days_left 기준 정렬 (None은 맨 뒤)
    result.sort(key=lambda x: x.snapshot.days_left if x.snapshot and x.snapshot.days_left is not None else 9999)
    return result


@router.get("/certs/{server_id}", response_model=SslCertSnapshotOut)
async def cert_by_server(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    server = await db.get(SslServer, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="서버를 찾을 수 없습니다.")

    snap = (
        await db.execute(
            select(SslCertSnapshot)
            .where(SslCertSnapshot.server_id == server_id)
            .order_by(SslCertSnapshot.checked_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if not snap:
        raise HTTPException(status_code=404, detail="인증서 스냅샷이 없습니다.")
    return snap
