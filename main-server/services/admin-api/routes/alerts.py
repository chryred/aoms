import json
import logging
import os
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlertHistory, System, Contact, SystemContact
from schemas import AlertHistoryOut, AlertmanagerPayload, AcknowledgeRequest
from services.cooldown import is_in_cooldown, make_alert_key, record_sent
from services.notification import TeamsNotifier
from .websocket import notify_alert_fired, notify_alert_resolved

logger = logging.getLogger(__name__)
LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")

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
        if alert.status not in ("firing", "resolved"):
            continue

        labels = alert.labels
        system_name = labels.get("system_name", "")
        instance_role = labels.get("instance_role", "")
        alertname = labels.get("alertname", "")
        severity = labels.get("severity", "warning")
        host = labels.get("host", "")

        # ── 정상 복구 처리 ────────────────────────────────────────────────
        if alert.status == "resolved":
            system, contacts = await _get_system_and_contacts(db, system_name)
            webhook_url = (
                system.teams_webhook_url
                if system and system.teams_webhook_url
                else DEFAULT_WEBHOOK_URL
            )
            contacts_data = [{"name": c.name, "teams_upn": c.teams_upn} for c in contacts] if contacts else []

            if webhook_url:
                try:
                    await notifier.send_recovery_alert(
                        webhook_url=webhook_url,
                        system_display_name=system.display_name if system else system_name,
                        system_name=system_name,
                        alertname=alertname,
                        instance_role=instance_role,
                        host=host,
                        contacts=contacts_data,
                    )
                except Exception as exc:
                    logger.warning("Teams 복구 알림 발송 실패: %s", exc)

            # 원본 firing alert 조회 → resolved_at 업데이트 (별도 row 생성 안 함)
            original = await db.execute(
                select(AlertHistory)
                .where(AlertHistory.alertname == alertname)
                .where(AlertHistory.system_id == (system.id if system else None))
                .where(AlertHistory.alert_type == "metric")
                .where(AlertHistory.resolved_at.is_(None))
                .order_by(AlertHistory.created_at.desc())
                .limit(1)
            )
            original_alert = original.scalar_one_or_none()
            if original_alert:
                original_alert.resolved_at = datetime.utcnow()
                # Qdrant resolved 업데이트
                if original_alert.qdrant_point_id:
                    try:
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            await client.post(
                                f"{LOG_ANALYZER_URL}/metric/resolve",
                                json={"point_id": original_alert.qdrant_point_id},
                            )
                    except Exception as exc:
                        logger.warning("Qdrant 복구 상태 업데이트 실패: %s", exc)

            await db.commit()

            # WebSocket 브로드캐스트 (클라이언트 실시간 업데이트)
            await notify_alert_resolved({
                "system_id": str(system.id) if system else None,
                "system_name": system_name,
                "alertname": alertname,
                "severity": severity,
                "status": "resolved",
            })

            processed.append({"alertname": alertname, "status": "resolved"})
            continue

        system, contacts = await _get_system_and_contacts(db, system_name)

        # 쿨다운 체크 (시스템 없어도 글로벌 키로 체크)
        system_id = system.id if system else None
        alert_key = make_alert_key(system_name, instance_role, alertname, severity)

        if system_id and await is_in_cooldown(db, system_id, alert_key):
            processed.append({"alertname": alertname, "status": "cooldown_skipped"})
            continue

        # 메트릭 벡터 유사도 분석 — log-analyzer 호출 (장애 시 new로 폴백)
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"{LOG_ANALYZER_URL}/metric/similarity",
                    json={
                        "system_name":   system_name,
                        "instance_role": instance_role,
                        "alertname":     alertname,
                        "labels":        labels,
                        "annotations":   alert.annotations,
                    },
                )
                resp.raise_for_status()
                anomaly = resp.json()
        except Exception as exc:
            logger.warning("log-analyzer 메트릭 유사도 분석 실패: %s → new로 처리", exc)
            anomaly = {"type": "new", "score": 0.0, "has_solution": False,
                       "top_results": [], "point_id": None}

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
            try:
                sent = await notifier.send_metric_alert(
                    webhook_url=webhook_url,
                    alert={"labels": labels, "annotations": alert.annotations},
                    system_display_name=system.display_name if system else system_name,
                    contacts=contacts_data,
                    anomaly_type=anomaly["type"],
                    similarity_score=anomaly["score"],
                    has_solution=anomaly["has_solution"],
                    similar_incidents=[
                        {
                            "score":       r["score"],
                            "metric_name": r["payload"].get("metric_name", ""),
                            "alertname":   r["payload"].get("alertname", ""),
                            "severity":    r["payload"].get("severity", ""),
                            "resolution":  r["payload"].get("resolution", ""),
                        }
                        for r in anomaly["top_results"]
                    ],
                    point_id=anomaly.get("point_id"),
                )
            except Exception as exc:
                logger.warning("Teams 메트릭 알림 발송 실패: %s", exc)

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
            anomaly_type=anomaly["type"],
            similarity_score=anomaly["score"],
            qdrant_point_id=anomaly["point_id"],
        )
        db.add(history)
        await db.commit()

        # WebSocket 브로드캐스트 (클라이언트 실시간 업데이트)
        await notify_alert_fired({
            "system_id": str(system.id) if system else None,
            "system_name": system_name,
            "alertname": alertname,
            "severity": severity,
            "anomaly_type": anomaly["type"],
            "similarity_score": anomaly["score"],
        })

        processed.append({"alertname": alertname, "status": "sent" if sent else "no_webhook"})

    return {"processed": processed}


@router.get("", response_model=list[AlertHistoryOut])
async def list_alerts(
    system_id: int | None = Query(None),
    severity: str | None = Query(None),
    alert_type: str | None = Query(None),
    resolved: bool | None = Query(None),
    acknowledged: bool | None = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AlertHistory).order_by(AlertHistory.created_at.desc()).offset(offset).limit(limit)
    if system_id is not None:
        stmt = stmt.where(AlertHistory.system_id == system_id)
    if severity:
        stmt = stmt.where(AlertHistory.severity == severity)
    if alert_type:
        stmt = stmt.where(AlertHistory.alert_type == alert_type)
    if resolved is True:
        stmt = stmt.where(AlertHistory.resolved_at.isnot(None))
    elif resolved is False:
        stmt = stmt.where(AlertHistory.resolved_at.is_(None))
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
