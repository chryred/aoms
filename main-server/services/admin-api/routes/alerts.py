import json
import logging
import os
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AlertHistory, LlmAgentConfig, System, Contact, SystemContact
from schemas import AlertHistoryOut, AlertmanagerPayload, AcknowledgeRequest, IncidentReportOut
from services.cooldown import is_in_cooldown, make_alert_key, record_sent
from services.llm_client import call_llm_text
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
                    alert_history_id=history.id,
                )
            except Exception as exc:
                logger.warning("Teams 메트릭 알림 발송 실패: %s", exc)

        # 쿨다운 기록
        if system_id:
            await record_sent(db, system_id, alert_key)

        if sent:
            history.notified_contacts = json.dumps(
                [c.name for c in contacts], ensure_ascii=False
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


@router.get("/count")
async def count_alerts(
    system_id: int | None = Query(None),
    severity: str | None = Query(None),
    alert_type: str | None = Query(None),
    resolved: bool | None = Query(None),
    acknowledged: bool | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """필터 조건에 해당하는 alert 총 건수 (페이지네이션 없이 count만)."""
    stmt = select(func.count()).select_from(AlertHistory)
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


_KST = timezone(timedelta(hours=9))


@router.post("/{alert_id}/incident-report", response_model=IncidentReportOut)
async def generate_incident_report(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """알림 데이터를 바탕으로 LLM이 한국어 장애보고서를 자동 생성한다."""
    alert = await db.get(AlertHistory, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    # 시스템 display_name 조회 + 업무영역별 agent_code 조회
    system_display_name = "알 수 없음"
    if alert.system_id:
        system = await db.get(System, alert.system_id)
        if system:
            system_display_name = system.display_name

    cfg_result = await db.execute(
        select(LlmAgentConfig.agent_code)
        .where(LlmAgentConfig.area_code == "incident_report", LlmAgentConfig.is_active == True)
    )
    agent_code = cfg_result.scalar_one_or_none() or ""

    # description JSON 파싱 (root_cause, recommendation 추출)
    root_cause = ""
    recommendation = ""
    description_text = alert.description or ""
    if description_text:
        try:
            desc_obj = json.loads(description_text)
            if isinstance(desc_obj, dict):
                root_cause = desc_obj.get("root_cause", "")
                recommendation = desc_obj.get("recommendation", "")
                description_text = desc_obj.get("summary", description_text)
        except (json.JSONDecodeError, TypeError):
            pass

    # 발생 시각 KST 변환
    created_at_kst = alert.created_at.replace(tzinfo=timezone.utc).astimezone(_KST)
    created_at_str = created_at_kst.strftime("%Y년 %m월 %d일 %H시 %M분")

    resolved_str = ""
    if alert.resolved_at:
        resolved_kst = alert.resolved_at.replace(tzinfo=timezone.utc).astimezone(_KST)
        resolved_str = resolved_kst.strftime("%H시 %M분")

    time_range = f"{created_at_str} ~ {resolved_str}" if resolved_str else f"{created_at_str} ~ 현재 진행 중"

    prompt = f"""다음 시스템 장애 알림 데이터를 바탕으로 아래 양식에 맞는 한국어 장애보고서를 작성하세요.

[알림 정보]
- 시스템명: {system_display_name}
- 심각도: {alert.severity}
- 제목: {alert.title or ''}
- 발생일시: {created_at_str}
- 인스턴스: {alert.instance_role or '알 수 없음'} / {alert.host or '알 수 없음'}
- 설명: {description_text}
- 원인 분석: {root_cause}
- 권고 조치: {recommendation}

다음 양식을 반드시 그대로 사용하고, 각 항목을 한국어로 구체적으로 작성하세요.
추측이 필요한 항목은 가능한 범위에서 합리적으로 추정하여 작성하고, 정보가 부족하면 "(확인 필요)"로 표시하세요.

<장애보고>
[백화점CX팀] (제목: 현상위주로 작성)
○ 장애발생일시 : {time_range}
○ 장애인지 : (모니터링 시스템 자동 감지 경위 및 인지 시각)
○ 영향범위 : (피해 서비스 및 사용자 영향 중심 서술)
○ 장애원인 : (IT 기술 용어를 비즈니스 관점으로 설명 포함)
○ 조치사항 : (현재까지 조치 내역 및 진행 중인 조치)
○ 고객반응 : (관계사·현업 인지 여부 및 VOC 등 반응)
○ 기타 : (그 외 추가 상황 및 진행 중인 내용)"""

    report = await call_llm_text(prompt, max_tokens=1500, agent_code=agent_code)
    if not report:
        raise HTTPException(status_code=503, detail="LLM 서비스 응답 없음. 잠시 후 다시 시도하세요.")

    return IncidentReportOut(report=report)
