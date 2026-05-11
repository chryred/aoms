"""메트릭 알림(prometheus_analyzer) 예외 처리 규칙 CRUD.

알림 모델 차이로 alert_exclusions 와 분리됨:
- alert_exclusions: 로그 알림. (system_id + instance_role + template) 매칭, max_count_per_window 동작
- metric_exclusions: 메트릭 알림. (system_id + host + metric_type) 매칭, override_threshold 동작
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import MetricExclusion
from schemas import (
    BulkExcludeResult,
    MetricExclusionCreate,
    MetricExclusionDeactivateRequest,
    MetricExclusionOut,
)

router = APIRouter(prefix="/api/v1/metric-exclusions", tags=["metric-exclusions"])


def _normalize_expires_at(dt: datetime | None) -> datetime | None:
    """입력 datetime을 UTC naive로 정규화."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


@router.post("", response_model=BulkExcludeResult, status_code=200)
async def create_exclusions(
    payload: MetricExclusionCreate,
    db: AsyncSession = Depends(get_db),
):
    """메트릭 예외 규칙 일괄 등록. 중복(활성+미만료) 시 skip."""
    succeeded: list[int] = []
    failed: list[dict] = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for item in payload.items:
        # 중복 체크: (system_id, host, metric_type, active=true, 미만료)
        host_filter = (
            MetricExclusion.host == item.host
            if item.host is not None
            else MetricExclusion.host.is_(None)
        )
        existing = await db.execute(
            select(MetricExclusion)
            .where(MetricExclusion.system_id == item.system_id)
            .where(MetricExclusion.active == True)  # noqa: E712
            .where(MetricExclusion.metric_type == item.metric_type)
            .where(host_filter)
            .where(or_(MetricExclusion.expires_at.is_(None), MetricExclusion.expires_at > now))
            .limit(1)
        )
        if existing.scalar_one_or_none():
            failed.append({
                "system_id": item.system_id,
                "host": item.host,
                "metric_type": item.metric_type,
                "reason": "이미 활성 메트릭 예외 규칙이 존재합니다",
            })
            continue

        rule = MetricExclusion(
            system_id=item.system_id,
            host=item.host,
            metric_type=item.metric_type,
            override_threshold=item.override_threshold,
            reason=item.reason,
            created_by=payload.created_by,
            created_at=now,
            active=True,
            expires_at=_normalize_expires_at(item.expires_at),
        )
        db.add(rule)
        await db.flush()
        succeeded.append(rule.id)

    await db.commit()
    return BulkExcludeResult(succeeded=succeeded, failed=failed)


@router.get("", response_model=list[MetricExclusionOut])
async def list_exclusions(
    system_id: int | None = Query(None),
    active: str | None = Query(None, description="true | false | all"),
    include_expired: bool = Query(False, description="active=true 조회 시 만료된 규칙 포함 여부"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """메트릭 예외 규칙 목록 조회."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    stmt = (
        select(MetricExclusion)
        .order_by(MetricExclusion.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if system_id is not None:
        stmt = stmt.where(MetricExclusion.system_id == system_id)
    if active == "true":
        stmt = stmt.where(MetricExclusion.active == True)  # noqa: E712
        if not include_expired:
            stmt = stmt.where(or_(MetricExclusion.expires_at.is_(None), MetricExclusion.expires_at > now))
    elif active == "false":
        stmt = stmt.where(MetricExclusion.active == False)  # noqa: E712

    result = await db.execute(stmt)
    return result.scalars().all()


@router.patch("/deactivate", response_model=BulkExcludeResult)
async def deactivate_exclusions(
    payload: MetricExclusionDeactivateRequest,
    db: AsyncSession = Depends(get_db),
):
    """메트릭 예외 규칙 일괄 해제 (active=false)."""
    succeeded: list[int] = []
    failed: list[dict] = []
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    for rule_id in payload.ids:
        rule = await db.get(MetricExclusion, rule_id)
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
