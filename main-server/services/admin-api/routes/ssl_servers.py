"""
SSL 서버 관리 API
POST   /api/v1/ssl/servers              서버 등록 (password → authorized_keys 자동 등록)
GET    /api/v1/ssl/servers              서버 목록
PATCH  /api/v1/ssl/servers/{id}         서버 수정
DELETE /api/v1/ssl/servers/{id}         서버 삭제 (soft)
POST   /api/v1/ssl/servers/{id}/test-ssh SSH 연결 테스트
GET    /api/v1/ssl/ha-groups            HA 그룹 목록
POST   /api/v1/ssl/ha-groups            HA 그룹 생성
DELETE /api/v1/ssl/ha-groups/{id}       HA 그룹 삭제
"""
import asyncio
import logging
import os
from typing import Optional

import paramiko
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import SslServer, SslHaGroup
from schemas import SslServerCreate, SslServerOut, SslServerUpdate, SslHaGroupCreate, SslHaGroupOut
from services.ssl_deployer import verify_key_auth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ssl", tags=["ssl-servers"])

DEPLOY_PUBKEY_PATH = os.getenv("SSL_DEPLOY_PUBKEY_PATH", "/app/secrets/ssl/deploy_key.pub")


# ── HA 그룹 ─────────────────────────────────────────────────────────────────

@router.get("/ha-groups", response_model=list[SslHaGroupOut])
async def list_ha_groups(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    rows = (await db.execute(select(SslHaGroup).order_by(SslHaGroup.id))).scalars().all()
    return rows


@router.post("/ha-groups", response_model=SslHaGroupOut, status_code=201)
async def create_ha_group(
    payload: SslHaGroupCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    group = SslHaGroup(**payload.model_dump())
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/ha-groups/{group_id}", status_code=204)
async def delete_ha_group(
    group_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    row = await db.get(SslHaGroup, group_id)
    if not row:
        raise HTTPException(status_code=404, detail="HA 그룹을 찾을 수 없습니다.")
    await db.delete(row)
    await db.commit()


# ── 서버 ─────────────────────────────────────────────────────────────────────

@router.get("/servers", response_model=list[SslServerOut])
async def list_servers(
    network_zone: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    q = select(SslServer)
    if network_zone:
        q = q.where(SslServer.network_zone == network_zone)
    if status_filter:
        q = q.where(SslServer.status == status_filter)
    else:
        q = q.where(SslServer.status == "active")
    q = q.order_by(SslServer.system_code, SslServer.host)
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.post("/servers", response_model=SslServerOut, status_code=201)
async def create_server(
    payload: SslServerCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """
    최초 등록 시 password로 1회 접속 → authorized_keys에 공개키 자동 등록.
    password 는 DB에 저장하지 않는다.
    """
    if payload.cert_type == "individual" and not payload.domain:
        raise HTTPException(status_code=422, detail="cert_type=individual 이면 domain 필수")

    # 공개키 로드
    try:
        pubkey = open(DEPLOY_PUBKEY_PATH).read().strip()
    except OSError:
        raise HTTPException(status_code=500, detail="공개키 파일을 읽을 수 없습니다. SSL_DEPLOY_PUBKEY_PATH를 확인하세요.")

    # password로 1회 접속하여 authorized_keys 등록
    def _register_pubkey():
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            ssh.connect(payload.host, port=payload.ssh_port, username=payload.account, password=payload.password, timeout=15)
            cmd = (
                f"mkdir -p ~/.ssh && chmod 700 ~/.ssh && "
                f"grep -qF '{pubkey}' ~/.ssh/authorized_keys 2>/dev/null || "
                f"echo '{pubkey}' >> ~/.ssh/authorized_keys && "
                f"chmod 600 ~/.ssh/authorized_keys"
            )
            _, stdout, stderr = ssh.exec_command(cmd)
            rc = stdout.channel.recv_exit_status()
            if rc != 0:
                err = stderr.read().decode(errors="replace")
                raise RuntimeError(f"authorized_keys 등록 실패 (rc={rc}): {err}")
        finally:
            try:
                ssh.close()
            except Exception:
                pass

    try:
        await asyncio.to_thread(_register_pubkey)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SSH 접속/키 등록 실패: {e}")

    # 키 기반 재접속 검증
    try:
        await verify_key_auth(payload.host, payload.account, port=payload.ssh_port)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"키 인증 검증 실패: {e}")

    # DB 저장 (password 제외)
    server = SslServer(**payload.model_dump(exclude={"password"}))
    db.add(server)
    await db.commit()
    await db.refresh(server)
    return server


@router.patch("/servers/{server_id}", response_model=SslServerOut)
async def update_server(
    server_id: int,
    payload: SslServerUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    server = await db.get(SslServer, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="서버를 찾을 수 없습니다.")
    for field, val in payload.model_dump(exclude_none=True).items():
        setattr(server, field, val)
    await db.commit()
    await db.refresh(server)
    return server


@router.delete("/servers/{server_id}", status_code=204)
async def delete_server(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    server = await db.get(SslServer, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="서버를 찾을 수 없습니다.")
    server.status = "deleted"
    await db.commit()


@router.post("/servers/{server_id}/test-ssh")
async def test_ssh(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    server = await db.get(SslServer, server_id)
    if not server:
        raise HTTPException(status_code=404, detail="서버를 찾을 수 없습니다.")
    try:
        await verify_key_auth(server.host, server.account, port=server.ssh_port or 22)
    except Exception as e:
        return {"success": False, "message": str(e)}
    return {"success": True, "message": "SSH 키 인증 성공"}
