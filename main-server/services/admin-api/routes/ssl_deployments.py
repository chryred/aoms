"""
SSL 배포 실행 및 이력 조회 API
POST   /api/v1/ssl/servers/{id}/deploy     단일 서버 즉시 배포
POST   /api/v1/ssl/ha-groups/{id}/deploy   HA 그룹 순차 배포
GET    /api/v1/ssl/deployments             배포 이력 목록
GET    /api/v1/ssl/deployments/{id}        배포 상세 + 로그
"""
import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db, AsyncSessionLocal
from models import SslServer, SslHaGroup, SslDeployment
from schemas import SslDeploymentOut
from services import ssl_deployer
from routes.ssl_websocket import make_ws_callback, cleanup as ws_cleanup

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ssl", tags=["ssl-deployments"])


async def _run_deploy(server_id: int, trigger_type: str) -> SslDeployment:
    """배포를 실행하고 SslDeployment 레코드를 반환한다."""
    async with AsyncSessionLocal() as db:
        server = await db.get(SslServer, server_id)
        if not server:
            raise ValueError(f"server_id={server_id} 없음")

        deployment = SslDeployment(
            server_id=server_id,
            trigger_type=trigger_type,
            cert_type=server.cert_type,
            status="running",
        )
        db.add(deployment)
        await db.commit()
        await db.refresh(deployment)
        deploy_id = deployment.id

    ws_cb = make_ws_callback(deploy_id)

    async with AsyncSessionLocal() as db:
        server = await db.get(SslServer, server_id)
        result = await ssl_deployer.deploy(server, ws_cb=ws_cb)

        row = await db.get(SslDeployment, deploy_id)
        if row:
            row.status = result["status"]
            row.duration_sec = round(result.get("duration_sec", 0), 2)
            row.deploy_log = result.get("log", "")
            await db.commit()
            await db.refresh(row)

    ws_cleanup(deploy_id)
    return row


@router.post("/servers/{server_id}/deploy", response_model=SslDeploymentOut, status_code=202)
async def deploy_server(
    server_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    server = await db.get(SslServer, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="서버를 찾을 수 없습니다.")
    if server.status != "active":
        raise HTTPException(status_code=400, detail="활성 서버만 배포할 수 있습니다.")

    # 임시 레코드 생성 후 WebSocket id 반환
    deployment = SslDeployment(
        server_id=server_id,
        trigger_type="manual",
        cert_type=server.cert_type,
        status="pending",
    )
    db.add(deployment)
    await db.commit()
    await db.refresh(deployment)

    deploy_id = deployment.id
    background_tasks.add_task(_bg_deploy, deploy_id, server_id, "manual")
    return deployment


async def _bg_deploy(deploy_id: int, server_id: int, trigger_type: str):
    """BackgroundTask용 — 기존 deploy record를 업데이트한다."""
    ws_cb = make_ws_callback(deploy_id)
    try:
        async with AsyncSessionLocal() as db:
            server = await db.get(SslServer, server_id)
            if not server:
                return

            row = await db.get(SslDeployment, deploy_id)
            if row:
                row.status = "running"
                await db.commit()

        async with AsyncSessionLocal() as db:
            server = await db.get(SslServer, server_id)
            result = await ssl_deployer.deploy(server, ws_cb=ws_cb)

            row = await db.get(SslDeployment, deploy_id)
            if row:
                row.status = result["status"]
                row.duration_sec = round(result.get("duration_sec", 0), 2)
                row.deploy_log = result.get("log", "")
                await db.commit()
    except Exception as e:
        logger.exception("배포 오류 (deploy_id=%d): %s", deploy_id, e)
        async with AsyncSessionLocal() as db:
            row = await db.get(SslDeployment, deploy_id)
            if row:
                row.status = "failed"
                row.deploy_log = str(e)
                await db.commit()
    finally:
        ws_cleanup(deploy_id)


@router.post("/ha-groups/{group_id}/deploy")
async def deploy_ha_group(
    group_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    group = await db.get(SslHaGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="HA 그룹을 찾을 수 없습니다.")

    rows = (
        await db.execute(
            select(SslServer)
            .where(SslServer.ha_group_id == group_id)
            .where(SslServer.status == "active")
            .order_by(SslServer.serial_order)
        )
    ).scalars().all()

    if not rows:
        raise HTTPException(status_code=400, detail="활성 서버가 없습니다.")

    # 각 서버별 pending deployment 레코드 생성
    dep_ids = []
    for server in rows:
        dep = SslDeployment(
            server_id=server.id,
            trigger_type="manual",
            cert_type=server.cert_type,
            status="pending",
        )
        db.add(dep)
    await db.commit()

    # serial_order 순으로 백그라운드 실행
    server_ids = [s.id for s in rows]
    background_tasks.add_task(_bg_deploy_ha, server_ids)
    return {"message": f"HA 그룹 배포 시작 ({len(rows)}대)", "server_count": len(rows)}


async def _bg_deploy_ha(server_ids: list[int]):
    """HA 그룹 — serial 순차 배포"""
    for server_id in server_ids:
        try:
            await _run_deploy(server_id, "manual")
        except Exception as e:
            logger.error("HA 배포 실패 (server_id=%d): %s — 나머지 중단", server_id, e)
            break


@router.get("/deployments", response_model=list[SslDeploymentOut])
async def list_deployments(
    server_id: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    q = select(SslDeployment).order_by(SslDeployment.deployed_at.desc()).limit(limit)
    if server_id:
        q = q.where(SslDeployment.server_id == server_id)
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.get("/deployments/{deployment_id}", response_model=SslDeploymentOut)
async def get_deployment(
    deployment_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    row = await db.get(SslDeployment, deployment_id)
    if not row:
        raise HTTPException(status_code=404, detail="배포 이력을 찾을 수 없습니다.")
    return row
