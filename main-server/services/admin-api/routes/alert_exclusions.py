from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlertExclusion
from schemas import (
    AlertExclusionCreate,
    AlertExclusionDeactivateRequest,
    AlertExclusionOut,
    BulkExcludeResult,
)

router = APIRouter(prefix="/api/v1/alert-exclusions", tags=["alert-exclusions"])


@router.post("", response_model=BulkExcludeResult, status_code=200)
async def create_exclusions(
    payload: AlertExclusionCreate,
    db: AsyncSession = Depends(get_db),
):
    """예외 규칙 일괄 등록 (1건~다건). 이미 활성 규칙이 있으면 skip."""
    succeeded: list[int] = []
    failed: list[dict] = []

    for item in payload.items:
        # 중복 체크 (same system_id + instance_role + template + active=true)
        existing = await db.execute(
            select(AlertExclusion)
            .where(AlertExclusion.system_id == item.system_id)
            .where(AlertExclusion.active == True)  # noqa: E712
            .where(AlertExclusion.template == item.template)
            .where(
                AlertExclusion.instance_role == item.instance_role
                if item.instance_role is not None
                else AlertExclusion.instance_role.is_(None)
            )
            .limit(1)
        )
        if existing.scalar_one_or_none():
            failed.append({
                "system_id": item.system_id,
                "instance_role": item.instance_role,
                "template": item.template[:80],
                "reason": "이미 활성 예외 규칙이 존재합니다",
            })
            continue

        rule = AlertExclusion(
            system_id=item.system_id,
            instance_role=item.instance_role,
            template=item.template,
            reason=item.reason,
            created_by=payload.created_by,
            created_at=datetime.now(timezone.utc).replace(tzinfo=None),
            active=True,
        )
        db.add(rule)
        await db.flush()
        succeeded.append(rule.id)

    await db.commit()
    return BulkExcludeResult(succeeded=succeeded, failed=failed)


@router.get("", response_model=list[AlertExclusionOut])
async def list_exclusions(
    system_id: int | None = Query(None),
    active: str | None = Query(None, description="true | false | all"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """예외 규칙 목록 조회."""
    stmt = (
        select(AlertExclusion)
        .order_by(AlertExclusion.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if system_id is not None:
        stmt = stmt.where(AlertExclusion.system_id == system_id)
    if active == "true":
        stmt = stmt.where(AlertExclusion.active == True)  # noqa: E712
    elif active == "false":
        stmt = stmt.where(AlertExclusion.active == False)  # noqa: E712
    # active == "all" 또는 None이면 필터 없음

    result = await db.execute(stmt)
    return result.scalars().all()


@router.patch("/deactivate", response_model=BulkExcludeResult)
async def deactivate_exclusions(
    payload: AlertExclusionDeactivateRequest,
    db: AsyncSession = Depends(get_db),
):
    """예외 규칙 일괄 해제 (active=false). 이미 비활성이면 skip."""
    succeeded: list[int] = []
    failed: list[dict] = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for rule_id in payload.ids:
        rule = await db.get(AlertExclusion, rule_id)
        if not rule:
            failed.append({"id": rule_id, "reason": "규칙을 찾을 수 없습니다"})
            continue
        if not rule.active:
            failed.append({"id": rule_id, "reason": "이미 비활성 상태입니다"})
            continue
        rule.active = False
        rule.deactivated_by = payload.deactivated_by
        rule.deactivated_at = now
        succeeded.append(rule_id)

    await db.commit()
    return BulkExcludeResult(succeeded=succeeded, failed=failed)
