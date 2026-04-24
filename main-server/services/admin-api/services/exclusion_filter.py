from datetime import datetime, timezone

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import AlertExclusion


async def is_excluded(
    db: AsyncSession,
    system_id: int,
    instance_role: str | None,
    template: str,
) -> AlertExclusion | None:
    """활성 예외 규칙 매칭 — instance_role=NULL 규칙은 모든 role에 적용."""
    stmt = (
        select(AlertExclusion)
        .where(AlertExclusion.system_id == system_id)
        .where(AlertExclusion.active == True)  # noqa: E712
        .where(AlertExclusion.template == template)
        .where(
            or_(
                AlertExclusion.instance_role.is_(None),
                AlertExclusion.instance_role == instance_role,
            )
        )
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def mark_skipped(db: AsyncSession, rule_id: int) -> None:
    """예외로 스킵된 횟수 증가 + 마지막 스킵 시각 갱신."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.execute(
        update(AlertExclusion)
        .where(AlertExclusion.id == rule_id)
        .values(
            skip_count=AlertExclusion.skip_count + 1,
            last_skipped_at=now,
        )
    )
