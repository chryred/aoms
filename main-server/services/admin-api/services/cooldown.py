from datetime import datetime, timedelta, timezone
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from models import AlertCooldown

COOLDOWN_MINUTES = 5


def make_alert_key(system_name: str, instance_role: str, alertname: str, severity: str) -> str:
    return f"{system_name}:{instance_role}:{alertname}:{severity}"


async def is_in_cooldown(db: AsyncSession, system_id: int, alert_key: str) -> bool:
    """쿨다운 기간(5분) 내 동일 알림이 발송된 적 있으면 True"""
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=COOLDOWN_MINUTES)
    result = await db.execute(
        select(AlertCooldown).where(
            AlertCooldown.system_id == system_id,
            AlertCooldown.alert_key == alert_key,
            AlertCooldown.last_sent_at >= cutoff,
        )
    )
    return result.scalar_one_or_none() is not None


async def record_sent(db: AsyncSession, system_id: int, alert_key: str) -> None:
    """쿨다운 레코드를 upsert"""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    result = await db.execute(
        select(AlertCooldown).where(
            AlertCooldown.system_id == system_id,
            AlertCooldown.alert_key == alert_key,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.last_sent_at = now
    else:
        db.add(AlertCooldown(system_id=system_id, alert_key=alert_key, last_sent_at=now))
    await db.commit()


async def cleanup_expired(db: AsyncSession) -> int:
    """만료된 쿨다운 레코드 삭제 (선택적 유지보수 호출)"""
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=COOLDOWN_MINUTES)
    result = await db.execute(
        delete(AlertCooldown).where(AlertCooldown.last_sent_at < cutoff)
    )
    await db.commit()
    return result.rowcount
