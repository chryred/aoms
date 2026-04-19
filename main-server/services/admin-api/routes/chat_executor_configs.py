"""Executor별 자격증명/설정 관리 API (admin 전용)."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_admin
from database import get_db
from models import ChatExecutorConfig
from schemas import ChatExecutorConfigOut, ChatExecutorConfigUpdate, ChatExecutorTestRequest, ChatExecutorTestResult
from services.chat_tools import (
    invalidate,
    load_executor_config,
    masked_config,
    save_executor_config,
)

router = APIRouter(
    prefix="/api/v1/chat-executor-configs",
    tags=["chat-executor-configs"],
    dependencies=[Depends(require_admin)],
)


@router.get("", response_model=list[ChatExecutorConfigOut])
async def list_configs(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(ChatExecutorConfig).order_by(ChatExecutorConfig.executor))).scalars().all()
    return [
        ChatExecutorConfigOut(
            executor=r.executor,
            config=masked_config(r),
            config_schema=r.config_schema or [],
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.put("/{executor}", response_model=ChatExecutorConfigOut)
async def update_config(
    executor: str,
    payload: ChatExecutorConfigUpdate,
    db: AsyncSession = Depends(get_db),
    admin=Depends(require_admin),
):
    try:
        row = await save_executor_config(db, executor, payload.config or {}, admin.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    await db.commit()
    await db.refresh(row)
    return ChatExecutorConfigOut(
        executor=row.executor,
        config=masked_config(row),
        config_schema=row.config_schema or [],
        updated_at=row.updated_at,
    )


@router.post("/{executor}/test", response_model=ChatExecutorTestResult)
async def test_config(
    executor: str,
    body: ChatExecutorTestRequest = ChatExecutorTestRequest(),
    db: AsyncSession = Depends(get_db),
):
    # 폼 값이 있으면 우선 사용. secret 필드 "***"/빈값은 DB 저장값으로 폴백.
    if body.config is not None:
        db_config = await load_executor_config(db, executor)
        config: dict = {}
        for k, v in body.config.items():
            if v == "***" or v == "":
                config[k] = db_config.get(k, "")
            else:
                config[k] = v
        # 폼에 없는 DB 키도 유지 (기존 secret 등)
        for k, v in db_config.items():
            if k not in config:
                config[k] = v
    else:
        invalidate(executor)
        config = await load_executor_config(db, executor)
    if executor == "ems":
        base_url = config.get("base_url")
        username = config.get("username")
        password = config.get("password")
        if not (base_url and username and password):
            return ChatExecutorTestResult(ok=False, message="자격증명이 완전하지 않습니다.")
        from services.chat_tools.executors.ems import _EMSSession
        try:
            session = _EMSSession(base_url, username, password)
            result = await session.login()
            if result.get("success"):
                return ChatExecutorTestResult(ok=True, message=result.get("message") or "로그인 성공")
            return ChatExecutorTestResult(ok=False, message=result.get("message") or "로그인 실패")
        except Exception as e:  # noqa: BLE001
            return ChatExecutorTestResult(ok=False, message=f"연결 실패: {str(e)[:150]}")
    if executor == "log_analyzer":
        base_url = (config.get("base_url") or "").rstrip("/")
        if not base_url:
            return ChatExecutorTestResult(ok=False, message="base_url 미설정")
        import httpx
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{base_url}/health")
                if resp.status_code < 400:
                    return ChatExecutorTestResult(ok=True, message=f"health {resp.status_code}")
                return ChatExecutorTestResult(ok=False, message=f"health {resp.status_code}")
        except Exception as e:  # noqa: BLE001
            return ChatExecutorTestResult(ok=False, message=f"연결 실패: {str(e)[:150]}")
    return ChatExecutorTestResult(ok=True, message="테스트 불필요 (admin executor)")
