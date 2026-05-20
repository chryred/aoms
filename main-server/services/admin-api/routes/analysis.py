import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlertHistory, IncidentTimeline, LogAnalysisHistory, System
from services.alert_utils import get_system_and_contacts
from services.incident_service import get_or_create_incident
from routes.websocket import notify_log_analysis
from schemas import LogAnalysisCreate, LogAnalysisOut
from services.notification import TeamsNotifier

LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/analysis", tags=["analysis"])

DEFAULT_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")
notifier = TeamsNotifier(default_webhook_url=DEFAULT_WEBHOOK_URL)


@router.post("", response_model=LogAnalysisOut, status_code=status.HTTP_201_CREATED)
async def create_analysis(payload: LogAnalysisCreate, db: AsyncSession = Depends(get_db)):
    """log-analyzer 서비스로부터 LLM 분析 결과 수신 및 Teams 알림 발송"""
    system = await db.get(System, payload.system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    # similar_incidents, templates(→templates_json으로 매핑), template_counts(로컬 사용만)는 model_dump에서 제외
    record = LogAnalysisHistory(
        **payload.model_dump(
            exclude={"similar_incidents", "templates", "template_counts"}
        )
    )
    if payload.templates:
        record.templates_json = payload.templates
    db.add(record)
    await db.flush()  # record.id 확보 (alert_record.log_analysis_id 연결용)

    is_failure = bool(payload.error_message)
    is_notification_first = (payload.anomaly_type == "notification")
    # 분析 실패(severity="warning")도 포함 — LLM 연결 장애를 Teams로 알림
    will_send_teams = (
        payload.anomaly_type == "duplicate" or payload.severity in ("warning", "critical")
    )
    # alert_history에도 기록 (피드백 관리 "로그분析" 탭 + Teams 피드백 버튼 연동)
    # 알림성 그룹도 1:1 Qdrant point 대응을 위해 alert_history row 필요
    should_log_alert = will_send_teams or is_notification_first
    # 인시던트 자동 생성은 실에러 그룹(warning/critical)만
    should_create_incident = will_send_teams and not is_notification_first

    # 성공 케이스 description: analysis_result JSON에 log_content 병합
    if not is_failure:
        try:
            success_desc = json.dumps(
                {**json.loads(payload.analysis_result), "log_content": (payload.log_content or "")[:3000]},
                ensure_ascii=False,
            )
        except (json.JSONDecodeError, ValueError):
            success_desc = payload.analysis_result

    alert_record: AlertHistory | None = None
    if should_log_alert:
        alert_record = AlertHistory(
            system_id=system.id,
            alert_type="log_analysis",
            severity=payload.severity,
            alertname=f"LogAnalysis_{system.system_name}",
            title=(
                f"로그 이상 감지 - {system.display_name}" if is_failure
                else (
                    (payload.root_cause or "").strip()
                    or (payload.recommendation or "").strip()
                    or f"로그 이상 감지 - {system.display_name}"
                )
            ),
            description=(
                json.dumps({"log_content": (payload.log_content or "")[:2500]}, ensure_ascii=False)
                if is_failure
                else success_desc
            ),
            instance_role=payload.instance_role,
            anomaly_type=payload.anomaly_type,
            similarity_score=payload.similarity_score,
            qdrant_point_id=payload.qdrant_point_id,
            error_message=payload.error_message,
            log_analysis_id=record.id,
        )
        db.add(alert_record)
        await db.flush()

        # 인시던트 자동 그루핑 (실에러 그룹만 — is_notification=False 이고 warning/critical)
        if should_create_incident:
            incident = await get_or_create_incident(
                db, system.id, title=alert_record.title, severity=payload.severity
            )
            alert_record.incident_id = incident.id
            record.incident_id = incident.id
            db.add(IncidentTimeline(
                incident_id=incident.id,
                event_type="analysis_added",
                description=f"[{payload.severity.upper()}] {alert_record.title[:200]}",
                actor_name="system",
            ))

    if is_notification_first:
        # 알림성 로그 최초 감지 — 1회 알림성 Teams 카드 발송
        _, contacts = await get_system_and_contacts(db, system.system_name)
        contacts_data = [{"name": c["name"], "teams_upn": c["teams_upn"]} for c in contacts]
        webhook_url = system.teams_webhook_url or DEFAULT_WEBHOOK_URL
        if webhook_url:
            try:
                await notifier.send_notification_alert(
                    webhook_url=webhook_url,
                    system_display_name=system.display_name,
                    instance_role=payload.instance_role or "",
                    log_sample=(payload.log_content or "")[:500],
                    notification_reason=payload.root_cause or "",
                    contacts=contacts_data,
                    force_real_url="",
                )
            except Exception as exc:
                logger.warning("알림성 로그 Teams 카드 발송 실패: %s", exc)

    if will_send_teams:
        _, contacts = await get_system_and_contacts(db, system.system_name)
        contacts_data = [{"name": c["name"], "teams_upn": c["teams_upn"]} for c in contacts]

        webhook_url = system.teams_webhook_url or DEFAULT_WEBHOOK_URL
        if webhook_url:
            try:
                sent = await notifier.send_log_analysis_alert(
                    webhook_url=webhook_url,
                    system_display_name=system.display_name,
                    system_name=system.system_name,
                    instance_role=payload.instance_role or "",
                    analysis={
                        "severity":       payload.severity,
                        "summary":        f"로그 이상 감지 - {system.display_name}",
                        "root_cause":     payload.root_cause,
                        "recommendation": payload.recommendation,
                    },
                    log_sample=payload.log_content,
                    contacts=contacts_data,
                    anomaly_type=payload.anomaly_type,
                    similarity_score=payload.similarity_score,
                    has_solution=payload.has_solution,
                    similar_incidents=payload.similar_incidents,
                    point_id=payload.qdrant_point_id,
                    alert_history_id=alert_record.id if alert_record else None,
                    incident_id=alert_record.incident_id if alert_record else None,
                )
                record.alert_sent = sent
            except Exception as exc:
                logger.warning("Teams 로그 분析 알림 발송 실패: %s", exc)

    await db.commit()
    await db.refresh(record)

    # WebSocket 브로드캐스트 — warning/critical 실시간 전파 (분析 실패 포함)
    if payload.severity in ("warning", "critical"):
        await notify_log_analysis({
            "system_id": str(system.id),
            "system_name": system.system_name,
            "display_name": system.display_name,
            "severity": payload.severity,
            "anomaly_type": payload.anomaly_type,
            "similarity_score": payload.similarity_score,
            "analysis_id": str(record.id),
        })

    return record


@router.get("", response_model=list[LogAnalysisOut])
async def list_analysis(
    system_id: int | None = Query(None),
    severity: str | None = Query(None),
    from_dt: str | None = Query(None, description="ISO UTC 시작 시각"),
    to_dt: str | None = Query(None, description="ISO UTC 종료 시각"),
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(LogAnalysisHistory)
        .order_by(LogAnalysisHistory.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if system_id is not None:
        stmt = stmt.where(LogAnalysisHistory.system_id == system_id)
    if severity:
        stmt = stmt.where(LogAnalysisHistory.severity == severity)
    if from_dt:
        try:
            stmt = stmt.where(LogAnalysisHistory.created_at >= datetime.fromisoformat(from_dt))
        except ValueError:
            pass
    if to_dt:
        try:
            stmt = stmt.where(LogAnalysisHistory.created_at <= datetime.fromisoformat(to_dt))
        except ValueError:
            pass
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/real-error-series")
async def get_real_error_series(
    system_id: int = Query(...),
    hours: int = Query(24, ge=1, le=168),
    step_minutes: int = Query(5, ge=1, le=60),
    db: AsyncSession = Depends(get_db),
):
    """실에러/알림성 시계열 조회 — MetricChartGrid 로그 차트용 (Prometheus 대체)

    step_minutes 단위 버킷으로 real_error_count, notification_count 합산.
    응답: [{"timestamp": "ISO", "real_error": N, "notification": N}]
    """
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    cutoff = now_utc - timedelta(hours=hours)

    result = await db.execute(
        select(LogAnalysisHistory)
        .where(
            LogAnalysisHistory.system_id == system_id,
            LogAnalysisHistory.created_at >= cutoff,
        )
        .order_by(LogAnalysisHistory.created_at.asc())
    )
    rows = result.scalars().all()

    # step_minutes 단위 버킷 집계
    step = timedelta(minutes=step_minutes)
    buckets: dict[datetime, dict] = {}
    for row in rows:
        ts = row.created_at
        # 버킷 경계: floor to step_minutes
        minutes_since_epoch = int(ts.timestamp() // 60)
        bucket_minutes = (minutes_since_epoch // step_minutes) * step_minutes
        bucket_ts = datetime.utcfromtimestamp(bucket_minutes * 60)
        if bucket_ts not in buckets:
            buckets[bucket_ts] = {"real_error": 0, "notification": 0}
        buckets[bucket_ts]["real_error"] += row.real_error_count or 0
        buckets[bucket_ts]["notification"] += row.notification_count or 0

    series = [
        {
            "timestamp": ts.isoformat() + "Z",
            "real_error": v["real_error"],
            "notification": v["notification"],
        }
        for ts, v in sorted(buckets.items())
    ]
    return series


@router.get("/{analysis_id}", response_model=LogAnalysisOut)
async def get_analysis(analysis_id: int, db: AsyncSession = Depends(get_db)):
    record = await db.get(LogAnalysisHistory, analysis_id)
    if not record:
        raise HTTPException(status_code=404, detail="Analysis record not found")
    return record


# ── 재분류(Reclassify) ──────────────────────────────────────────────────────

class TemplateChange(BaseModel):
    template: str
    new_severity: str  # "info" | "warning" | "critical"


class ReclassifyRequest(BaseModel):
    template_changes: list[TemplateChange]
    reclassified_by: Optional[str] = "system"


@router.patch("/reclassify/{alert_history_id}")
async def reclassify_alert_history(
    alert_history_id: int,
    payload: ReclassifyRequest,
    db: AsyncSession = Depends(get_db),
):
    """알림성/실에러 수동 재분류

    1. 재분류 대상 템플릿을 원본 log_analysis_history에서 제거
    2. 잔여 템플릿이 있으면 원본 Qdrant 포인트 재생성 (잔여분만), alert_history는 유지
    3. 잔여 템플릿이 없으면 원본 alert_history.anomaly_type = "reclassified" 마킹
    4. template_changes를 info/warning-critical 그룹으로 분리
    5. 각 그룹: 새 Qdrant 포인트 + LogAnalysisHistory + AlertHistory row 생성
    6. warning/critical 그룹: 인시던트 자동 생성

    Returns: {"reclassified_from": id, "new_alert_history_ids": [id, ...]}
    """
    if not payload.template_changes:
        raise HTTPException(status_code=422, detail="재분류할 템플릿을 지정해야 합니다")

    alert = await db.get(AlertHistory, alert_history_id)
    if not alert or alert.alert_type != "log_analysis":
        raise HTTPException(status_code=404, detail="log_analysis 타입 알림을 찾을 수 없습니다")

    log_rec: LogAnalysisHistory | None = None
    if alert.log_analysis_id:
        log_rec = await db.get(LogAnalysisHistory, alert.log_analysis_id)

    system = await db.get(System, alert.system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    # 재분류 대상 템플릿 집합
    submitted_templates = {tc.template for tc in payload.template_changes}

    # 원본 log_rec의 전체 템플릿 목록 추출
    all_tc_list: list[dict] = []
    all_templates: list[str] = []
    if log_rec:
        if log_rec.template_classifications_json:
            try:
                all_tc_list = json.loads(log_rec.template_classifications_json)
                all_templates = [tc["template"] for tc in all_tc_list if tc.get("template")]
            except (json.JSONDecodeError, KeyError):
                pass
        if not all_templates and log_rec.templates_json:
            all_templates = list(log_rec.templates_json or [])

    # 잔여 템플릿 (재분류 대상에서 제외된 것)
    remaining_templates = [t for t in all_templates if t not in submitted_templates]
    remaining_tc_list = [tc for tc in all_tc_list if tc.get("template") not in submitted_templates]

    # 기존 Qdrant 포인트 삭제 (best-effort)
    if alert.qdrant_point_id:
        try:
            async with httpx.AsyncClient(timeout=10.0) as hc:
                await hc.request(
                    "DELETE",
                    f"{LOG_ANALYZER_URL}/log-incidents/delete-point",
                    json={"point_id": alert.qdrant_point_id},
                )
        except Exception as exc:
            logger.warning("기존 Qdrant 포인트 삭제 실패 (계속): %s", exc)
    alert.qdrant_point_id = None

    if remaining_templates:
        # 잔여 템플릿으로 Qdrant 포인트 재생성 (best-effort)
        remaining_is_notification = alert.anomaly_type == "notification"
        new_remaining_point_id: str | None = None
        try:
            async with httpx.AsyncClient(timeout=15.0) as hc:
                resp = await hc.post(
                    f"{LOG_ANALYZER_URL}/log-incidents/submit-group",
                    json={
                        "system_name":     system.system_name,
                        "system_id":       system.id,
                        "instance_role":   alert.instance_role or "",
                        "templates":       remaining_templates,
                        "template_counts": {},
                        "is_notification": remaining_is_notification,
                        "severity":        alert.severity,
                    },
                )
                if resp.status_code == 200:
                    new_remaining_point_id = resp.json().get("qdrant_point_id")
        except Exception as exc:
            logger.warning("잔여 템플릿 Qdrant 재생성 실패 (계속): %s", exc)

        # 원본 log_rec에서 재분류된 템플릿 제거 후 업데이트
        if log_rec:
            log_rec.templates_json = remaining_templates
            log_rec.template_classifications_json = (
                json.dumps(remaining_tc_list, ensure_ascii=False) if remaining_tc_list else None
            )
            log_rec.qdrant_point_id = new_remaining_point_id
            log_rec.notification_count = sum(
                1 for tc in remaining_tc_list if tc.get("is_notification")
            )
            log_rec.real_error_count = sum(
                1 for tc in remaining_tc_list if not tc.get("is_notification")
            )
            db.add(log_rec)
        alert.qdrant_point_id = new_remaining_point_id
        # alert_history는 유지 (anomaly_type 변경 안 함)
    else:
        # 모든 템플릿이 재분류됨 → 원본 alert 마킹
        alert.anomaly_type = "reclassified"

    db.add(alert)

    # template_changes 그룹 분리
    notif_templates = [tc.template for tc in payload.template_changes if tc.new_severity == "info"]
    real_changes = [(tc.template, tc.new_severity) for tc in payload.template_changes
                    if tc.new_severity in ("warning", "critical")]
    real_templates = [t for t, _ in real_changes]
    real_severity = "critical" if any(s == "critical" for _, s in real_changes) else "warning" if real_changes else "info"

    orig_log_content = (log_rec.log_content if log_rec else "")[:5000]
    instance_role = alert.instance_role or ""
    new_alert_ids: list[int] = []

    async def _create_group(templates: list[str], is_notification: bool, severity: str) -> None:
        if not templates:
            return

        # log-analyzer에 새 Qdrant 포인트 요청
        new_point_id: str | None = None
        try:
            async with httpx.AsyncClient(timeout=15.0) as hc:
                resp = await hc.post(
                    f"{LOG_ANALYZER_URL}/log-incidents/submit-group",
                    json={
                        "system_name":    system.system_name,
                        "system_id":      system.id,
                        "instance_role":  instance_role,
                        "templates":      templates,
                        "template_counts": {},
                        "is_notification": is_notification,
                        "severity":       severity,
                    },
                )
                if resp.status_code == 200:
                    new_point_id = resp.json().get("qdrant_point_id")
        except Exception as exc:
            logger.warning("submit-group 호출 실패 (Qdrant 없이 계속): %s", exc)

        # 새 LogAnalysisHistory
        synth_tc = [{"template": t, "is_notification": is_notification} for t in templates]
        new_log = LogAnalysisHistory(
            system_id=system.id,
            instance_role=instance_role,
            log_content=orig_log_content,
            analysis_result=json.dumps(
                {"reclassified": True, "templates": templates, "is_notification": is_notification},
                ensure_ascii=False,
            ),
            severity=severity,
            root_cause="수동 재분류",
            recommendation="",
            model_used="manual_reclassify",
            anomaly_type="notification" if is_notification else "new",
            qdrant_point_id=new_point_id,
            templates_json=templates,
            template_classifications_json=json.dumps(synth_tc, ensure_ascii=False),
            real_error_count=0 if is_notification else len(templates),
            notification_count=len(templates) if is_notification else 0,
        )
        db.add(new_log)
        await db.flush()

        # 새 AlertHistory
        group_label = "알림성" if is_notification else "실에러"
        new_alert = AlertHistory(
            system_id=system.id,
            alert_type="log_analysis",
            severity=severity,
            alertname=f"LogAnalysis_{system.system_name}",
            title=f"{group_label} 재분류 - {system.display_name}",
            description=json.dumps({"reclassified_templates": templates}, ensure_ascii=False),
            instance_role=instance_role,
            anomaly_type="notification" if is_notification else "new",
            qdrant_point_id=new_point_id,
            log_analysis_id=new_log.id,
        )
        db.add(new_alert)
        await db.flush()

        # 실에러 그룹 → 인시던트 자동 생성
        if not is_notification and severity in ("warning", "critical"):
            incident = await get_or_create_incident(
                db, system.id, title=new_alert.title, severity=severity
            )
            new_alert.incident_id = incident.id
            new_log.incident_id = incident.id
            db.add(IncidentTimeline(
                incident_id=incident.id,
                event_type="analysis_added",
                description=f"[재분류][{severity.upper()}] {new_alert.title[:200]}",
                actor_name=payload.reclassified_by or "system",
            ))

        new_alert_ids.append(new_alert.id)

    await _create_group(notif_templates, is_notification=True, severity="info")
    await _create_group(real_templates, is_notification=False, severity=real_severity)

    await db.commit()
    return {"reclassified_from": alert_history_id, "new_alert_history_ids": new_alert_ids}


# ── 단순 재분류 (Simple Reclassify) ────────────────────────────────────────

class SimpleReclassifyRequest(BaseModel):
    target_severity: str  # "info" | "warning" | "critical"
    reclassified_by: Optional[str] = "system"


@router.patch("/reclassify/{alert_history_id}/simple")
async def simple_reclassify_alert_history(
    alert_history_id: int,
    payload: SimpleReclassifyRequest,
    db: AsyncSession = Depends(get_db),
):
    """전체 알림 그룹을 알림성 또는 실에러로 단순 재분류.

    template_classifications_json에서 템플릿 목록을 자동 추출하여
    모두 동일한 target_severity로 재분류한다.

    Returns: {"reclassified_from": id, "new_alert_history_id": id}
    """
    if payload.target_severity not in ("info", "warning", "critical"):
        raise HTTPException(status_code=422, detail="target_severity는 info/warning/critical 중 하나여야 합니다")

    alert = await db.get(AlertHistory, alert_history_id)
    if not alert or alert.alert_type != "log_analysis":
        raise HTTPException(status_code=404, detail="log_analysis 타입 알림을 찾을 수 없습니다")

    log_rec: LogAnalysisHistory | None = None
    if alert.log_analysis_id:
        log_rec = await db.get(LogAnalysisHistory, alert.log_analysis_id)

    system = await db.get(System, alert.system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    # 템플릿 목록 추출 (template_classifications_json → templates_json 순 fallback)
    templates: list[str] = []
    if log_rec and log_rec.template_classifications_json:
        try:
            tc_list = json.loads(log_rec.template_classifications_json)
            templates = [tc["template"] for tc in tc_list if tc.get("template")]
        except (json.JSONDecodeError, KeyError):
            pass
    if not templates and log_rec and log_rec.templates_json:
        templates = [t for t in (log_rec.templates_json or []) if t]
    if not templates:
        templates = ["(전체 로그)"]

    is_notification = payload.target_severity == "info"
    severity = payload.target_severity
    instance_role = alert.instance_role or ""
    orig_log_content = (log_rec.log_content if log_rec else "")[:5000]

    # 기존 Qdrant 포인트 삭제 (best-effort)
    if alert.qdrant_point_id:
        try:
            async with httpx.AsyncClient(timeout=10.0) as hc:
                await hc.request(
                    "DELETE",
                    f"{LOG_ANALYZER_URL}/log-incidents/delete-point",
                    json={"point_id": alert.qdrant_point_id},
                )
        except Exception as exc:
            logger.warning("기존 Qdrant 포인트 삭제 실패 (계속): %s", exc)

    # 기존 alert_history 마킹
    alert.anomaly_type = "reclassified"
    alert.qdrant_point_id = None
    db.add(alert)

    # 새 Qdrant 포인트 생성 (best-effort)
    new_point_id: str | None = None
    try:
        async with httpx.AsyncClient(timeout=15.0) as hc:
            resp = await hc.post(
                f"{LOG_ANALYZER_URL}/log-incidents/submit-group",
                json={
                    "system_name":     system.system_name,
                    "system_id":       system.id,
                    "instance_role":   instance_role,
                    "templates":       templates,
                    "template_counts": {},
                    "is_notification": is_notification,
                    "severity":        severity,
                },
            )
            if resp.status_code == 200:
                new_point_id = resp.json().get("qdrant_point_id")
    except Exception as exc:
        logger.warning("submit-group 호출 실패 (Qdrant 없이 계속): %s", exc)

    # 새 LogAnalysisHistory
    group_label = "알림성" if is_notification else "실에러"
    synth_tc = [{"template": t, "is_notification": is_notification} for t in templates]
    new_log = LogAnalysisHistory(
        system_id=system.id,
        instance_role=instance_role,
        log_content=orig_log_content,
        analysis_result=json.dumps(
            {"reclassified": True, "templates": templates, "is_notification": is_notification},
            ensure_ascii=False,
        ),
        severity=severity,
        root_cause="수동 재분류",
        recommendation="",
        model_used="manual_reclassify",
        anomaly_type="notification" if is_notification else "new",
        qdrant_point_id=new_point_id,
        templates_json=templates,
        template_classifications_json=json.dumps(synth_tc, ensure_ascii=False),
        real_error_count=0 if is_notification else len(templates),
        notification_count=len(templates) if is_notification else 0,
    )
    db.add(new_log)
    await db.flush()

    # 새 AlertHistory
    new_alert = AlertHistory(
        system_id=system.id,
        alert_type="log_analysis",
        severity=severity,
        alertname=f"LogAnalysis_{system.system_name}",
        title=f"{group_label} 재분류 - {system.display_name}",
        description=json.dumps({"reclassified_templates": templates}, ensure_ascii=False),
        instance_role=instance_role,
        anomaly_type="notification" if is_notification else "new",
        qdrant_point_id=new_point_id,
        log_analysis_id=new_log.id,
    )
    db.add(new_alert)
    await db.flush()

    # 실에러 그룹 → 인시던트 자동 생성
    if not is_notification and severity in ("warning", "critical"):
        incident = await get_or_create_incident(
            db, system.id, title=new_alert.title, severity=severity
        )
        new_alert.incident_id = incident.id
        new_log.incident_id = incident.id
        db.add(IncidentTimeline(
            incident_id=incident.id,
            event_type="analysis_added",
            description=f"[재분류][{severity.upper()}] {new_alert.title[:200]}",
            actor_name=payload.reclassified_by or "system",
        ))

    await db.commit()
    return {"reclassified_from": alert_history_id, "new_alert_history_id": new_alert.id}
