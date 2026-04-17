from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user, require_admin
from database import get_db
from models import LlmAgentConfig
from schemas import LlmAgentConfigCreate, LlmAgentConfigUpdate, LlmAgentConfigOut

router = APIRouter(prefix="/api/v1/llm-agent-configs", tags=["llm-config"])


@router.get("", response_model=list[LlmAgentConfigOut])
async def list_configs(
    is_active: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(LlmAgentConfig).order_by(LlmAgentConfig.area_code)
    if is_active is not None:
        stmt = stmt.where(LlmAgentConfig.is_active == is_active)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{area_code}", response_model=LlmAgentConfigOut)
async def get_config_by_area(area_code: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(LlmAgentConfig).where(LlmAgentConfig.area_code == area_code)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail=f"area_code '{area_code}' not found")
    return config


@router.post("", response_model=LlmAgentConfigOut, status_code=status.HTTP_201_CREATED)
async def create_config(
    payload: LlmAgentConfigCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin),
):
    existing = await db.execute(
        select(LlmAgentConfig).where(LlmAgentConfig.area_code == payload.area_code)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"area_code '{payload.area_code}' already exists")
    config = LlmAgentConfig(**payload.model_dump())
    db.add(config)
    await db.commit()
    await db.refresh(config)
    return config


@router.patch("/{config_id}", response_model=LlmAgentConfigOut)
async def update_config(
    config_id: int,
    payload: LlmAgentConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin),
):
    config = await db.get(LlmAgentConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Config not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(config, field, value)
    await db.commit()
    await db.refresh(config)
    return config


@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_config(
    config_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin),
):
    config = await db.get(LlmAgentConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="Config not found")
    await db.delete(config)
    await db.commit()
