import json
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlertHistory, System, Contact, SystemContact
from schemas import AlertHistoryOut, AlertmanagerPayload, AcknowledgeRequest
from services.cooldown import is_in_cooldown, make_alert_key, record_sent
from services.notification import TeamsNotifier

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])

DEFAULT_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")
notifier = TeamsNotifier(default_webhook_url=DEFAULT_WEBHOOK_URL)


async def _get_system_and_contacts(db: AsyncSession, system_name: str):
    """system_name으로 시스템 + 담당자 목록 조회"""
    result = await db.execute(
        select(System).where(System.system_name == system_name)
    )
    system = result.scalar_one_or_none()
    if not system:
        return None, []

    contacts_result = await db.execute(
        select(Contact)
        .join(SystemContact, SystemContact.contact_id == Contact.id)
        .where(SystemContact.system_id == system.id)
    )
    contacts = contacts_result.scalars().all()
    return system, contacts


@router.post("/receive", status_code=status.HTTP_200_OK)
async def receive_alertmanager(
    payload: AlertmanagerPayload,
    db: AsyncSession = Depends(get_db)
):
    """Alertmanager webhook 수신 → 쿨다운 체크 → Teams 발송 → alert_history 저장"""
    processed = []

    for alert in payload.alerts:
        if alert.status != "firing":
            continue

        labels = alert.labels
        system_name = labels.get("system_name", "")
        instance_role = labels.get("instance_role", "")
        alertname = labels.get("alertname", "")
        severity = labels.get("severity", "warning")
        host = labels.get("host", "")

        system, contacts = await _get_system_and_contacts(db, system_name)

        # 쿨다운 체크 (시스템 없어도 글로벌 키로 체크)
        system_id = system.id if system else None
        alert_key = make_alert_key(system_name, instance_role, alertname, severity)

        if system_id and await is_in_cooldown(db, system_id, alert_key):
            processed.append({"alertname": alertname, "status": "cooldown_skipped"})
            continue

        # Teams 발송
        webhook_url = (
            system.teams_webhook_url
            if system and system.teams_webhook_url
            else DEFAULT_WEBHOOK_URL
        )
        sent = False
        if webhook_url:
            contacts_data = [
                {"name": c.name, "teams_upn": c.teams_upn}
                for c in contacts
            ]
            sent = await notifier.send_metric_alert(
                webhook_url=webhook_url,
                alert={"labels": labels, "annotations": alert.annotations},
                system_display_name=system.display_name if system else system_name,
                contacts=contacts_data,
            )

        # 쿨다운 기록
        if system_id:
            await record_sent(db, system_id, alert_key)

        # alert_history 저장
        summary = alert.annotations.get("summary", alertname)
        description = alert.annotations.get("description", "")
        history = AlertHistory(
            system_id=system_id,
            alert_type="metric",
            severity=severity,
            alertname=alertname,
            title=summary,
            description=description,
            instance_role=instance_role,
            host=host,
            notified_contacts=json.dumps(
                [c.name for c in contacts], ensure_ascii=False
            ) if sent else None,
        )
        db.add(history)
        await db.commit()

        processed.append({"alertname": alertname, "status": "sent" if sent else "no_webhook"})

    return {"processed": processed}


@router.get("", response_model=list[AlertHistoryOut])
async def list_alerts(
    system_id: int | None = Query(None),
    severity: str | None = Query(None),
    acknowledged: bool | None = Query(None),
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AlertHistory).order_by(AlertHistory.created_at.desc()).limit(limit)
    if system_id is not None:
        stmt = stmt.where(AlertHistory.system_id == system_id)
    if severity:
        stmt = stmt.where(AlertHistory.severity == severity)
    if acknowledged is not None:
        stmt = stmt.where(AlertHistory.acknowledged == acknowledged)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/{alert_id}/acknowledge", response_model=AlertHistoryOut)
async def acknowledge_alert(
    alert_id: int,
    payload: AcknowledgeRequest,
    db: AsyncSession = Depends(get_db),
):
    alert = await db.get(AlertHistory, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged = True
    alert.acknowledged_at = datetime.utcnow()
    alert.acknowledged_by = payload.acknowledged_by
    await db.commit()
    await db.refresh(alert)
    return alert
