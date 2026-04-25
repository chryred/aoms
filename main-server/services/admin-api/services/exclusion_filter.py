from datetime import datetime, timezone

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import AlertExclusion


async def is_excluded(
    db: AsyncSession,
    system_id: int,
    instance_role: str | None,
    template: str,
    count: int | None = None,
) -> AlertExclusion | None:
    """활성 예외 규칙 매칭.

    매칭 조건:
      - system_id 일치
      - active = True
      - template 정확 일치
      - instance_role 매칭 (rule.instance_role=NULL이면 모든 role에 적용)
      - expires_at 미래거나 NULL (Lazy 만료 검증)
      - max_count_per_window 임계값 이내 (count 인자 제공 시)

    count=None이면 임계값 검사 생략 (admin-api 2차 게이트에서 template_counts 미전달 케이스).
    count=int이면 max_count_per_window 초과 시 None 반환 → 정상 분석 경로 fallback.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    stmt = (
        select(AlertExclusion)
        .where(AlertExclusion.system_id == system_id)
        .where(AlertExclusion.active == True)  # noqa: E712
        .where(AlertExclusion.template == template)
        .where(or_(AlertExclusion.expires_at.is_(None), AlertExclusion.expires_at > now))
        .where(
            or_(
                AlertExclusion.instance_role.is_(None),
                AlertExclusion.instance_role == instance_role,
            )
        )
        .limit(1)
    )
    result = await db.execute(stmt)
    rule = result.scalar_one_or_none()
    if rule is None:
        return None

    # count 임계값 체크 — count 제공되고 임계값 설정된 경우에만 적용
    if count is not None and rule.max_count_per_window is not None:
        if count > rule.max_count_per_window:
            return None  # 임계값 초과 → 예외 미적용, 정상 분석 진행

    return rule


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
