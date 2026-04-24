from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Incident


async def get_or_create_incident(
    db: AsyncSession,
    system_id: int | None,
    title: str,
    severity: str,
) -> Incident:
    """30분 이내 같은 시스템의 열린 인시던트에 연결하거나 신규 생성."""
    if system_id:
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=30)
        result = await db.execute(
            select(Incident)
            .where(Incident.system_id == system_id)
            .where(Incident.status.in_(["open", "acknowledged", "investigating"]))
            .where(Incident.detected_at >= cutoff)
            .order_by(Incident.detected_at.desc())
            .limit(1)
        )
        existing = result.scalar_one_or_none()
        if existing:
            if severity == "critical" and existing.severity != "critical":
                existing.severity = "critical"
            existing.alert_count = (existing.alert_count or 0) + 1
            return existing

    incident = Incident(
        system_id=system_id,
        title=title,
        severity=severity,
        status="open",
        detected_at=datetime.now(timezone.utc).replace(tzinfo=None),
        alert_count=1,
    )
    db.add(incident)
    await db.flush()
    return incident
