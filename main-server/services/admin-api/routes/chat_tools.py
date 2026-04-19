"""챗봇 도구 on/off 관리 API."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user, require_admin
from database import get_db
from models import ChatTool
from schemas import ChatToolOut, ChatToolUpdate
from services.chat_tools.executor_config import has_required_credentials

router = APIRouter(prefix="/api/v1/chat-tools", tags=["chat-tools"])


@router.get("", response_model=list[ChatToolOut])
async def list_tools(
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    rows = (await db.execute(select(ChatTool).order_by(ChatTool.executor, ChatTool.name))).scalars().all()
    return list(rows)


@router.patch("/{name}", response_model=ChatToolOut)
async def update_tool(
    name: str,
    payload: ChatToolUpdate,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_admin),
):
    row = (
        await db.execute(select(ChatTool).where(ChatTool.name == name))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"도구 없음: {name}")
    if payload.is_enabled and not await has_required_credentials(db, row.executor):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="자격증명을 먼저 저장해야 도구를 활성화할 수 있습니다.",
        )
    row.is_enabled = payload.is_enabled
    await db.commit()
    await db.refresh(row)
    return row
