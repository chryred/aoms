import json
import logging
import os
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlertHistory, Incident, IncidentTimeline, System, Contact, SystemContact, User
from schemas import AlertHistoryOut, AlertmanagerPayload, AcknowledgeRequest
from services.cooldown import is_in_cooldown, make_alert_key, record_sent
from services.notification import TeamsNotifier
from .websocket import notify_alert_fired, notify_alert_resolved

logger = logging.getLogger(__name__)
LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")
TEMPO_URL = os.getenv("TEMPO_URL", "http://tempo:3200")

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])

DEFAULT_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")
notifier = TeamsNotifier(default_webhook_url=DEFAULT_WEBHOOK_URL)


async def _get_or_create_incident(
    db: AsyncSession,
    system_id: int | None,
    title: str,
    severity: str,
) -> Incident:
    """30분 이내 같은 시스템의 열린 인시던트에 연결하거나 신규 생성."""
    if system_id:
        cutoff = datetime.utcnow() - timedelta(minutes=30)
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
        detected_at=datetime.utcnow(),
        alert_count=1,
    )
    db.add(incident)
    await db.flush()
    return incident


async def _get_system_and_contacts(db: AsyncSession, system_name: str):
    """system_name으로 시스템 + 담당자 목록 조회 (name은 User 테이블에서)"""
    result = await db.execute(
        select(System).where(System.system_name == system_name)
    )
    system = result.scalar_one_or_none()
    if not system:
        return None, []

    contacts_result = await db.execute(
        select(Contact, User.name.label("user_name"), User.email.label("user_email"))
        .join(SystemContact, SystemContact.contact_id == Contact.id)
        .join(User, Contact.user_id == User.id)
        .where(SystemContact.system_id == system.id)
    )
    # dict 형태로 변환해 notification.py의 c['name'] 패턴과 호환
    contacts = [
        {"id": c.id, "name": user_name, "email": user_email,
         "teams_upn": c.teams_upn, "webhook_url": c.webhook_url}
        for c, user_name, user_email in contacts_result.all()
    ]
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

            # 매칭 키는 쿨다운 키와 동일 정밀도 — (system_id, alertname, instance_role, severity)
            # host 차원은 제외해 같은 group 내 다중 host firing 행을 한 번에 복구 처리
            # → 그룹당 Teams 복구 카드 1장으로 수렴 (중복 resolve webhook 에도 중복 발송 방지)
            originals = await db.execute(
                select(AlertHistory)
                .where(AlertHistory.alertname == alertname)
                .where(AlertHistory.system_id == (system.id if system else None))
                .where(AlertHistory.instance_role == instance_role)
                .where(AlertHistory.severity == severity)
                .where(AlertHistory.alert_type == "metric")
                .where(AlertHistory.resolved_at.is_(None))
            )
            original_rows = originals.scalars().all()

            if not original_rows:
                # 이미 앞선 resolved 에서 처리된 그룹 — Teams/WebSocket 모두 스킵
                processed.append({"alertname": alertname, "status": "resolved_duplicate_skipped"})
                continue

            resolved_at = datetime.utcnow()
            for row in original_rows:
                row.resolved_at = resolved_at
                if row.qdrant_point_id:
                    try:
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            await client.post(
                                f"{LOG_ANALYZER_URL}/metric/resolve",
                                json={"point_id": row.qdrant_point_id},
                            )
                    except Exception as exc:
                        logger.warning("Qdrant 복구 상태 업데이트 실패: %s", exc)

            await db.commit()

            webhook_url = (
                system.teams_webhook_url
                if system and system.teams_webhook_url
                else DEFAULT_WEBHOOK_URL
            )
            contacts_data = [{"name": c["name"], "teams_upn": c["teams_upn"]} for c in contacts] if contacts else []

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
        # alert_history 먼저 생성 → flush로 id 확보 → Teams 카드 URL에 alert_history_id 포함
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
            anomaly_type=anomaly["type"],
            similarity_score=anomaly["score"],
            qdrant_point_id=anomaly["point_id"],
        )
        db.add(history)
        await db.flush()  # history.id 발급

        # 인시던트 자동 그루핑
        incident = await _get_or_create_incident(db, system_id, title=summary, severity=severity)
        history.incident_id = incident.id
        db.add(IncidentTimeline(
            incident_id=incident.id,
            event_type="alert_added",
            description=f"[{severity.upper()}] {summary}",
            actor_name="system",
        ))

        # OTel gating: running otel_javaagent가 있으면 ±60s 에러 trace 조회
        if system_id:
            try:
                otel_check = await db.execute(
                    text(
                        "SELECT EXISTS(SELECT 1 FROM agent_instances"
                        " WHERE system_id=:sid AND agent_type='otel_javaagent' AND status='running')"
                    ),
                    {"sid": system_id},
                )
                if otel_check.scalar():
                    alert_ts = datetime.now(timezone.utc)
                    start_ns = int((alert_ts.timestamp() - 60) * 1e9)
                    end_ns = int((alert_ts.timestamp() + 60) * 1e9)
                    system_name_for_trace = system_name
                    traceql = (
                        f'{{ resource.service.name="{system_name_for_trace}"'
                        f' && status=error }}'
                    )
                    async with httpx.AsyncClient(timeout=5.0) as tc:
                        tresp = await tc.get(
                            f"{TEMPO_URL}/api/search",
                            params={"q": traceql, "start": start_ns, "end": end_ns, "limit": 3},
                        )
                        tresp.raise_for_status()
                        trace_data = tresp.json()
                    trace_ids = [
                        t["traceID"]
                        for t in trace_data.get("traces", [])[:3]
                        if t.get("traceID")
                    ]
                    if trace_ids:
                        history.related_trace_ids = trace_ids
            except Exception as exc:
                logger.debug("Tempo error trace query failed (non-critical): %s", exc)

        sent = False
        if webhook_url:
            contacts_data = [
                {"name": c["name"], "teams_upn": c["teams_upn"]}
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
                    alert_history_id=history.id,
                    incident_id=history.incident_id,
                )
            except Exception as exc:
                logger.warning("Teams 메트릭 알림 발송 실패: %s", exc)

        # 쿨다운 기록
        if system_id:
            await record_sent(db, system_id, alert_key)

        if sent:
            history.notified_contacts = json.dumps(
                [c["name"] for c in contacts], ensure_ascii=False
            )
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


def _apply_alert_filters(stmt, *, system_id, severity, alert_type, resolved, acknowledged, date_from, date_to):
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
    if date_from:
        stmt = stmt.where(AlertHistory.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        stmt = stmt.where(AlertHistory.created_at <= datetime.fromisoformat(date_to))
    return stmt


@router.get("", response_model=list[AlertHistoryOut])
async def list_alerts(
    system_id: int | None = Query(None),
    severity: str | None = Query(None),
    alert_type: str | None = Query(None),
    resolved: bool | None = Query(None),
    acknowledged: bool | None = Query(None),
    date_from: str | None = Query(None, description="UTC ISO datetime (e.g. 2026-04-16T15:00:00)"),
    date_to: str | None = Query(None, description="UTC ISO datetime (e.g. 2026-04-17T14:59:59)"),
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AlertHistory).order_by(AlertHistory.created_at.desc()).offset(offset).limit(limit)
    stmt = _apply_alert_filters(
        stmt,
        system_id=system_id, severity=severity, alert_type=alert_type,
        resolved=resolved, acknowledged=acknowledged,
        date_from=date_from, date_to=date_to,
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/count")
async def count_alerts(
    system_id: int | None = Query(None),
    severity: str | None = Query(None),
    alert_type: str | None = Query(None),
    resolved: bool | None = Query(None),
    acknowledged: bool | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """필터 조건에 해당하는 alert 총 건수 (페이지네이션 없이 count만)."""
    stmt = select(func.count()).select_from(AlertHistory)
    stmt = _apply_alert_filters(
        stmt,
        system_id=system_id, severity=severity, alert_type=alert_type,
        resolved=resolved, acknowledged=acknowledged,
        date_from=date_from, date_to=date_to,
    )
    result = await db.execute(stmt)
    return {"count": result.scalar_one()}


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


# 장애보고서 자동 생성 엔드포인트는 routes/incidents.py::generate_incident_report 로 이관됨
# (연결된 모든 알림 + 해결책을 반영한 인시던트 레벨 리포트)
