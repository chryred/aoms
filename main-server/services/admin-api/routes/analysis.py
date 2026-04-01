import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import LogAnalysisHistory, System, Contact, SystemContact
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

    # warning/critical 또는 duplicate 분류 시 Teams 발송
    if payload.anomaly_type == "duplicate" or payload.severity in ("warning", "critical"):
        contacts_result = await db.execute(
            select(Contact)
            .join(SystemContact, SystemContact.contact_id == Contact.id)
            .where(SystemContact.system_id == system.id)
        )
        contacts = contacts_result.scalars().all()
        contacts_data = [{"name": c.name, "teams_upn": c.teams_upn} for c in contacts]

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
                )
                record.alert_sent = sent
            except Exception as exc:
                logger.warning("Teams 로그 분석 알림 발송 실패: %s", exc)

    await db.commit()
    await db.refresh(record)
    return record


@router.get("", response_model=list[LogAnalysisOut])
async def list_analysis(
    system_id: int | None = Query(None),
    severity: str | None = Query(None),
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(LogAnalysisHistory)
        .order_by(LogAnalysisHistory.created_at.desc())
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
