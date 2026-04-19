import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import AlertHistory, LogAnalysisHistory, System
from routes.alerts import _get_system_and_contacts
from routes.websocket import notify_log_analysis
from schemas import LogAnalysisCreate, LogAnalysisOut
from services.notification import TeamsNotifier

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/analysis", tags=["analysis"])

DEFAULT_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")
notifier = TeamsNotifier(default_webhook_url=DEFAULT_WEBHOOK_URL)


@router.post("", response_model=LogAnalysisOut, status_code=status.HTTP_201_CREATED)
async def create_analysis(payload: LogAnalysisCreate, db: AsyncSession = Depends(get_db)):
    """log-analyzer 서비스로부터 LLM 분석 결과 수신 및 Teams 알림 발송"""
    system = await db.get(System, payload.system_id)
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    # similar_incidents는 DB에 저장하지 않음 (알림 전용 필드)
    record = LogAnalysisHistory(**payload.model_dump(exclude={"similar_incidents"}))
    db.add(record)

    is_failure = bool(payload.error_message)
    will_send_teams = not is_failure and (
        payload.anomaly_type == "duplicate" or payload.severity in ("warning", "critical")
    )
    # alert_history에도 기록 (피드백 관리 "로그분석" 탭 + Teams 피드백 버튼 연동)
    # - 성공 warning/critical: 알림 발송됨
    # - duplicate(info): 알림 발송됨 → 피드백 등록 가능하려면 alert_history 필요
    # - 분석 실패: error_message 필드로 "분석 실패" 뱃지 노출
    should_log_alert = is_failure or will_send_teams

    alert_record: AlertHistory | None = None
    if should_log_alert:
        alert_record = AlertHistory(
            system_id=system.id,
            alert_type="log_analysis",
            severity=payload.severity,
            alertname=f"LogAnalysis_{system.system_name}",
            title=(
                "LLM 분석 실패" if is_failure
                else (
                    (payload.root_cause or "").strip()
                    or (payload.recommendation or "").strip()
                    or f"로그 이상 감지 - {system.display_name}"
                )
            ),
            description=payload.analysis_result,
            instance_role=payload.instance_role,
            anomaly_type=payload.anomaly_type,
            similarity_score=payload.similarity_score,
            qdrant_point_id=payload.qdrant_point_id,
            error_message=payload.error_message,   # 실패 사유 전달 (성공 시 None)
        )
        db.add(alert_record)
        await db.flush()  # alert_record.id 발급 (Teams 카드 URL에 포함)

    if will_send_teams:
        _, contacts = await _get_system_and_contacts(db, system.system_name)
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
                )
                record.alert_sent = sent
            except Exception as exc:
                logger.warning("Teams 로그 분석 알림 발송 실패: %s", exc)

    await db.commit()
    await db.refresh(record)

    # WebSocket 브로드캐스트 — warning/critical 분석 결과만 실시간 전파 (분석 실패 제외)
    if not is_failure and payload.severity in ("warning", "critical"):
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
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{analysis_id}", response_model=LogAnalysisOut)
async def get_analysis(analysis_id: int, db: AsyncSession = Depends(get_db)):
    record = await db.get(LogAnalysisHistory, analysis_id)
    if not record:
        raise HTTPException(status_code=404, detail="Analysis record not found")
    return record
