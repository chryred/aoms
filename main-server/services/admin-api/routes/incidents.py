import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from auth import get_current_user, require_admin
from database import AsyncSessionLocal, get_db
from services.incident_status_meta import status_meta
from models import AlertFeedback, AlertFeedbackAttachment, AlertHistory, Contact, Incident, IncidentTimeline, LlmAgentConfig, LogAnalysisHistory, System, User
from schemas import (
    AlertHistoryOut,
    FeedbackCreateRequest,
    FeedbackOut,
    FeedbackRejectRequest,
    FeedbackResubmitRequest,
    IncidentAiAnalyzeOut,
    IncidentCommentCreate,
    IncidentDetailOut,
    IncidentCreate,
    IncidentFeedbackPendingOut,
    IncidentOut,
    IncidentReportOut,
    IncidentStatsOut,
    IncidentTimelineItemOut,
    IncidentUpdate,
    ResubmitWarning,
)
from services.llm_client import call_llm_text
from services import incident_postmortem_client as postmortem_client
from services.notification import TeamsNotifier
import httpx
import os
import uuid
from pathlib import Path
from sqlalchemy import delete as sa_delete

logger = logging.getLogger(__name__)
_LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")
_KST = timezone(timedelta(hours=9))

router = APIRouter(prefix="/api/v1/incidents", tags=["incidents"])

_VALID_STATUSES = {"open", "acknowledged", "investigating", "resolved", "closed"}
_STATUS_ORDER = ["open", "acknowledged", "investigating", "resolved", "closed"]

# ── 피드백 첨부파일 헬퍼 (feedback.py와 동일 경로 규칙) ──────────────────────────
_DEFAULT_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")
_notifier = TeamsNotifier(default_webhook_url=_DEFAULT_WEBHOOK_URL)
_KNOWLEDGE_DOCS_DIR = Path(os.getenv("KNOWLEDGE_DOCS_DIR", "/attaches/knowledge-docs"))
_FEEDBACK_ATTACH_DIR = _KNOWLEDGE_DOCS_DIR / "feedback"
_MAX_ATTACHMENTS_PER_FEEDBACK = 10
_RESUBMIT_SOFT_LIMIT = 3   # 이상 시 warning 동봉
_RESUBMIT_HARD_LIMIT = 5   # 이상 시 409 거부 → 신규 피드백 등록 강제


async def _link_qdrant_incident_points(incident_id: int) -> None:
    """피드백 승인 후 관련 Qdrant 포인트에 incident_id를 역방향 주입 (best-effort).

    log_analysis_history.qdrant_point_id → log_incidents 포인트
    alert_history.qdrant_point_id (metric) → metric_baselines 포인트
    이후 유사도 검색 → incident_id → incident_postmortems.solution 경로 활성화.
    """
    try:
        async with AsyncSessionLocal() as db:
            log_result = await db.execute(
                select(LogAnalysisHistory.qdrant_point_id)
                .where(LogAnalysisHistory.incident_id == incident_id)
                .where(LogAnalysisHistory.qdrant_point_id.isnot(None))
            )
            log_point_ids = list(log_result.scalars().all())

            metric_result = await db.execute(
                select(AlertHistory.qdrant_point_id)
                .where(AlertHistory.incident_id == incident_id)
                .where(AlertHistory.alert_type.in_(["metric", "metric_resolved"]))
                .where(AlertHistory.qdrant_point_id.isnot(None))
            )
            metric_point_ids = list(metric_result.scalars().all())

        if not log_point_ids and not metric_point_ids:
            return

        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.patch(
                f"{_LOG_ANALYZER_URL}/incidents/points/link-incident",
                json={
                    "incident_id":      incident_id,
                    "log_point_ids":    log_point_ids,
                    "metric_point_ids": metric_point_ids,
                },
            )
        logger.info(
            "Qdrant incident_id 역방향 업데이트 완료 — incident_id=%s log=%d metric=%d",
            incident_id, len(log_point_ids), len(metric_point_ids),
        )
    except Exception as exc:
        logger.warning("Qdrant incident_id 역방향 업데이트 실패 (best-effort): %s", exc)


def _staging_dir() -> Path:
    d = _FEEDBACK_ATTACH_DIR / "staging"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _feedback_dir(feedback_id: int) -> Path:
    d = _FEEDBACK_ATTACH_DIR / str(feedback_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _validate_staging_path(file_path: str) -> Path:
    staging = _staging_dir().resolve()
    try:
        resolved = (_KNOWLEDGE_DOCS_DIR / file_path).resolve()
    except Exception:
        raise HTTPException(status_code=400, detail=f"유효하지 않은 파일 경로: {file_path}")
    if not str(resolved).startswith(str(staging)):
        raise HTTPException(status_code=400, detail=f"허용되지 않은 파일 경로: {file_path}")
    if not resolved.exists():
        raise HTTPException(status_code=400, detail=f"파일을 찾을 수 없습니다: {file_path}")
    return resolved


def _move_staging_to_feedback(staging_rel_path: str, feedback_id: int) -> str:
    """staging → feedback/{id}/{uuid}.{ext} 이동. 새 상대경로 반환."""
    src = _validate_staging_path(staging_rel_path)
    ext = src.suffix
    dest_filename = f"{uuid.uuid4()}{ext}"
    dest_dir = _feedback_dir(feedback_id)
    dest = dest_dir / dest_filename
    try:
        src.rename(dest)
    except Exception as exc:
        logger.warning("첨부파일 이동 실패 (%s → %s): %s", src, dest, exc)
        return staging_rel_path
    return f"feedback/{feedback_id}/{dest_filename}"


def _delete_file_best_effort(file_path: str) -> None:
    try:
        full = _KNOWLEDGE_DOCS_DIR / file_path
        if full.exists():
            full.unlink()
    except Exception as exc:
        logger.warning("파일 삭제 실패 (%s): %s", file_path, exc)


# ── OCR 백그라운드 태스크 ──────────────────────────────────────────────────────

async def _run_ocr_for_attachment(attachment_id: int, file_path: str, mime_type: str) -> None:
    """SSE 스트리밍 OCR 백그라운드 처리 — 독립 DB 세션 사용.

    log-analyzer에서 SSE로 진행률(ocr_progress 0~100)을 수신하며 DB에 즉시 갱신.
    BaseException(특히 asyncio.CancelledError) 까지 catch하여 ocr_status 가
    "processing" 으로 영구 잠기는 현상 방지. CancelledError 는 status 확정 후 re-raise.
    """
    async with AsyncSessionLocal() as session:
        try:
            async def _on_progress(progress: int) -> None:
                attach = await session.get(AlertFeedbackAttachment, attachment_id)
                if attach and attach.ocr_status == "processing":
                    attach.ocr_progress = progress
                    await session.commit()

            result = await postmortem_client.trigger_ocr_streaming(
                file_path, mime_type, on_progress=_on_progress
            )
            attach = await session.get(AlertFeedbackAttachment, attachment_id)
            if attach:
                text = result.get("text") or ""
                attach.ocr_text = text or None
                attach.ocr_status = result.get("ocr_status") or ("done" if text else "failed")
                attach.ocr_progress = 100 if attach.ocr_status == "done" else attach.ocr_progress
                await session.commit()
        except BaseException as exc:
            is_cancel = isinstance(exc, asyncio.CancelledError)
            logger.warning(
                "OCR 처리 실패 (attachment_id=%s, cancel=%s): %s",
                attachment_id, is_cancel, exc,
            )
            try:
                async with AsyncSessionLocal() as fail_session:
                    attach = await fail_session.get(AlertFeedbackAttachment, attachment_id)
                    if attach and attach.ocr_status == "processing":
                        attach.ocr_status = "failed"
                        await fail_session.commit()
            except Exception:
                pass
            if is_cancel:
                raise


_MIME_MAP: dict[str, str] = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
}


async def _run_ocr_remaining_detached(feedback_id: int) -> None:
    """processing 상태인 모든 첨부를 detached 백그라운드 OCR 처리.

    `asyncio.create_task` 로 분리되어 client disconnect 와 무관하게 완료까지 실행.
    실패해도 `_run_ocr_for_attachment` 가 status 를 done/failed 로 확정함.
    """
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AlertFeedbackAttachment).where(
                AlertFeedbackAttachment.feedback_id == feedback_id,
                AlertFeedbackAttachment.ocr_status == "processing",
            )
        )
        pending = result.scalars().all()
    for attach in pending:
        ext = Path(attach.file_path).suffix.lower()
        mime = _MIME_MAP.get(ext, "application/octet-stream")
        try:
            await _run_ocr_for_attachment(attach.id, attach.file_path, mime)
        except Exception as exc:
            logger.warning(
                "detached OCR 실패 (attachment_id=%s): %s", attach.id, exc
            )


def _to_out(
    incident: Incident,
    system_display_name: str | None = None,
    has_approved_feedback: bool = False,
    latest_feedback_status: str | None = None,
) -> IncidentOut:
    mtta = mttr = None
    if incident.acknowledged_at:
        mtta = int((incident.acknowledged_at - incident.detected_at).total_seconds() // 60)
    if incident.resolved_at:
        mttr = int((incident.resolved_at - incident.detected_at).total_seconds() // 60)
    return IncidentOut(
        id=incident.id,
        system_id=incident.system_id,
        title=incident.title,
        severity=incident.severity,
        status=incident.status,
        detected_at=incident.detected_at,
        acknowledged_at=incident.acknowledged_at,
        resolved_at=incident.resolved_at,
        closed_at=incident.closed_at,
        root_cause=incident.root_cause,
        resolution=incident.resolution,
        postmortem=incident.postmortem,
        alert_count=incident.alert_count or 0,
        recurrence_of=incident.recurrence_of,
        mtta_minutes=mtta,
        mttr_minutes=mttr,
        system_display_name=system_display_name,
        has_approved_feedback=has_approved_feedback,
        latest_feedback_status=latest_feedback_status,
        created_at=incident.created_at,
        updated_at=incident.updated_at,
    )


@router.get("", response_model=list[IncidentOut])
async def list_incidents(
    system_id: int | None = Query(None),
    status: str | None = Query(None),
    severity: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    has_approved = (
        select(1).select_from(AlertFeedback)
        .where(AlertFeedback.incident_id == Incident.id)
        .where(AlertFeedback.status == "approved")
        .exists()
        .label("has_approved_feedback")
    )
    # 가장 최근 피드백 status (latest by created_at)
    latest_status = (
        select(AlertFeedback.status)
        .where(AlertFeedback.incident_id == Incident.id)
        .order_by(AlertFeedback.created_at.desc())
        .limit(1)
        .scalar_subquery()
        .label("latest_feedback_status")
    )
    stmt = select(
        Incident,
        System.display_name.label("system_display_name"),
        has_approved,
        latest_status,
    ).outerjoin(
        System, System.id == Incident.system_id
    ).order_by(Incident.detected_at.desc()).offset(offset).limit(limit)

    if system_id is not None:
        stmt = stmt.where(Incident.system_id == system_id)
    if status:
        stmt = stmt.where(Incident.status == status)
    if severity:
        stmt = stmt.where(Incident.severity == severity)

    rows = (await db.execute(stmt)).all()
    return [
        _to_out(
            row.Incident,
            row.system_display_name,
            bool(row.has_approved_feedback),
            row.latest_feedback_status,
        )
        for row in rows
    ]


@router.post("", response_model=IncidentOut, status_code=201)
async def create_incident(
    payload: IncidentCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """수동 인시던트 등록 — 자동 알림 없이 운영자가 직접 생성."""
    _VALID_SEVERITIES = {"critical", "warning", "info"}
    if payload.severity not in _VALID_SEVERITIES:
        raise HTTPException(status_code=422, detail=f"유효하지 않은 심각도: {payload.severity}")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    incident = Incident(
        system_id=payload.system_id,
        title=payload.title,
        severity=payload.severity,
        status="open",
        detected_at=now,
        root_cause=payload.notes,
        alert_count=0,
        source="manual",
    )
    db.add(incident)
    await db.flush()

    db.add(IncidentTimeline(
        incident_id=incident.id,
        event_type="created",
        description=f"수동 등록",
        actor_name=current_user.name,
    ))

    await db.commit()
    await db.refresh(incident)

    system_display_name = None
    if incident.system_id:
        system = await db.get(System, incident.system_id)
        if system:
            system_display_name = system.display_name

    return _to_out(incident, system_display_name)


# ═══════════════════════════════════════════════════════════════════════════
# Wave 2A: 인시던트 피드백 엔드포인트 (literal-path 라우트 먼저 등록)
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/stats", response_model=IncidentStatsOut)
async def get_incident_stats(
    period_from: datetime | None = Query(None),
    period_to: datetime | None = Query(None),
    db: AsyncSession = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """인시던트 3카드 통계: {total, registrable, completed}."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if period_from is None:
        period_from = datetime(now.year, now.month, now.day) - timedelta(days=30)
    if period_to is None:
        period_to = now

    # total
    total = (await db.execute(
        select(func.count()).select_from(Incident)
        .where(Incident.detected_at >= period_from)
        .where(Incident.detected_at <= period_to)
    )).scalar_one()

    # registrable: resolved/closed인데 approved 피드백이 없는 것
    from sqlalchemy.orm import aliased
    fb_alias = aliased(AlertFeedback)
    registrable = (await db.execute(
        select(func.count()).select_from(Incident)
        .outerjoin(fb_alias, (fb_alias.incident_id == Incident.id) & (fb_alias.status == "approved"))
        .where(Incident.status.in_(["resolved", "closed"]))
        .where(fb_alias.id.is_(None))
        .where(Incident.detected_at >= period_from)
        .where(Incident.detected_at <= period_to)
    )).scalar_one()

    # completed: approved 피드백이 있는 인시던트 수
    completed = (await db.execute(
        select(func.count(Incident.id.distinct())).select_from(Incident)
        .join(AlertFeedback, (AlertFeedback.incident_id == Incident.id) & (AlertFeedback.status == "approved"))
        .where(Incident.detected_at >= period_from)
        .where(Incident.detected_at <= period_to)
    )).scalar_one()

    return IncidentStatsOut(total=total, registrable=registrable, completed=completed)


@router.get("/feedback/pending", response_model=list[IncidentFeedbackPendingOut])
async def list_pending_feedbacks(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """admin 전용 — 모든 인시던트 중 pending/rejected 피드백 목록."""
    rows = (await db.execute(
        select(
            AlertFeedback,
            Incident.title,
            Incident.alert_count,
            System.display_name.label("system_display_name"),
            Contact.id.label("approver_contact_id"),
        )
        .select_from(AlertFeedback)
        .join(Incident, AlertFeedback.incident_id == Incident.id)
        .outerjoin(System, Incident.system_id == System.id)
        .outerjoin(Contact, AlertFeedback.approver_id == Contact.id)
        .where(AlertFeedback.status.in_(["pending", "rejected"]))
        .order_by(AlertFeedback.created_at.desc())
        .limit(limit)
        .offset(offset)
    )).all()

    # 현재 사용자의 contact 조회 (한 번만)
    is_admin = current_user.role == "admin"
    current_contact_result = await db.execute(
        select(Contact).where(Contact.user_id == current_user.id)
    )
    current_contact = current_contact_result.scalar_one_or_none()

    result = []
    for fb, incident_title, alert_count, system_display_name, approver_contact_id in rows:
        # 승인자 이름 조회
        approver_name = None
        if fb.approver_id:
            approver_contact = await db.get(Contact, fb.approver_id)
            if approver_contact:
                approver_user = await db.get(User, approver_contact.user_id)
                if approver_user:
                    approver_name = approver_user.name

        is_designated = current_contact is not None and current_contact.id == fb.approver_id
        result.append(IncidentFeedbackPendingOut(
            feedback_id=fb.id,
            incident_id=fb.incident_id,
            incident_title=incident_title or "Unknown",
            system_display_name=system_display_name,
            alert_count=alert_count or 0,
            resolver=fb.resolver,
            approver_name=approver_name,
            created_at=fb.created_at,
            revision_count=fb.revision_count or 0,
            status=fb.status,
            can_approve=is_admin or is_designated,
        ))
    return result


@router.get("/feedback/search")
async def search_incident_feedback(
    query: str | None = Query(None),
    system_id: int | None = Query(None),
    severity: str | None = Query(None),
    limit: int = Query(20, le=50),
    _current_user=Depends(get_current_user),
):
    """Qdrant Hybrid 검색 — log-analyzer /incident-postmortem/search 프록시.
    query 미지정/빈 문자열이면 전체 목록(scroll) 반환."""
    try:
        results = await postmortem_client.search_postmortem(
            query=query or "",
            system_id=system_id,
            severity=severity,
            limit=limit,
        )
        return {"results": results}
    except Exception as exc:
        logger.warning("incident postmortem search 실패: %s", exc)
        raise HTTPException(status_code=502, detail="검색 서비스 응답 없음")


# ── 인시던트 피드백 등록 ───────────────────────────────────────────────────────

@router.post("/{incident_id}/feedback", response_model=FeedbackOut)
async def create_incident_feedback(
    incident_id: int,
    payload: FeedbackCreateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """인시던트 피드백 등록 (pending). 인시던트 resolved/closed 상태에서만 허용."""
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    if incident.status not in ("resolved", "closed"):
        raise HTTPException(status_code=400, detail="사건 종료(resolved/closed) 후 등록 가능합니다")

    approver_result = await db.execute(select(Contact).where(Contact.id == payload.approver_contact_id))
    approver = approver_result.scalar_one_or_none()
    if not approver:
        raise HTTPException(status_code=404, detail="Approver contact not found")

    # 승인자가 활성 사용자인지 확인
    approver_user = await db.get(User, approver.user_id)
    if not approver_user or not approver_user.is_active:
        raise HTTPException(status_code=400, detail="지정 승인자가 유효한 사용자가 아닙니다")

    system = await db.get(System, incident.system_id) if incident.system_id else None
    system_display_name = system.display_name if system else str(incident.system_id or "Unknown")

    attachment_paths = payload.attachment_paths or []
    if len(attachment_paths) > _MAX_ATTACHMENTS_PER_FEEDBACK:
        raise HTTPException(status_code=400, detail=f"첨부파일은 최대 {_MAX_ATTACHMENTS_PER_FEEDBACK}개까지 가능합니다")

    feedback = AlertFeedback(
        incident_id=incident_id,
        error_type=payload.error_type,
        solution=payload.solution,
        resolver=payload.resolver,
        status="pending",
        approver_id=approver.id,
    )
    db.add(feedback)
    await db.flush()

    # 첨부파일: staging → 정식 위치 (원본 파일명은 payload.attachment_filenames에서)
    attachment_filenames = payload.attachment_filenames or []
    attach_records = []
    for idx, staging_rel in enumerate(attachment_paths):
        original_filename = (
            attachment_filenames[idx] if idx < len(attachment_filenames) else Path(staging_rel).name
        )
        new_rel = _move_staging_to_feedback(staging_rel, feedback.id)
        attach = AlertFeedbackAttachment(
            feedback_id=feedback.id,
            file_path=new_rel,
            original_filename=original_filename,
            sort_order=idx,
            ocr_status="processing",
        )
        db.add(attach)
        attach_records.append((attach, new_rel))

    await db.commit()

    # OCR 백그라운드 처리 — detached task 로 분리하여 즉시 응답 반환
    # (프론트엔드가 ocr_status="processing"을 폴링하며 진행률 표시)
    result_fb = await db.execute(
        select(AlertFeedback).where(AlertFeedback.id == feedback.id)
        .options(selectinload(AlertFeedback.attachments))
    )
    feedback = result_fb.scalar_one()
    if attachment_paths:
        asyncio.create_task(_run_ocr_remaining_detached(feedback.id))

    # 승인자 Teams 카드 발송 (approver_user는 위에서 로드됨 — @멘션용)
    approver_contact_dict = {"name": approver_user.name, "teams_upn": approver.teams_upn}

    background_tasks.add_task(
        _notifier.send_approval_request_card,
        webhook_url=approver.webhook_url,
        feedback_id=feedback.id,
        system_display_name=system_display_name,
        alert_title=incident.title or "Unknown",
        error_type=payload.error_type,
        solution=payload.solution,
        resolver=payload.resolver,
        attachment_count=len(attachment_paths),
        revision_count=0,
        approver_contact=approver_contact_dict,
    )

    return feedback


# ── 피드백 승인 ───────────────────────────────────────────────────────────────

@router.post("/{incident_id}/feedback/{feedback_id}/approve", response_model=FeedbackOut)
async def approve_incident_feedback(
    incident_id: int,
    feedback_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """피드백 승인 — 지정 승인자 OR admin 모두 처리 가능."""
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    result = await db.execute(
        select(AlertFeedback).where(AlertFeedback.id == feedback_id)
        .options(selectinload(AlertFeedback.attachments))
    )
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if feedback.incident_id != incident_id:
        raise HTTPException(status_code=400, detail="해당 인시던트의 피드백이 아닙니다")
    if feedback.status == "approved":
        raise HTTPException(status_code=400, detail="이미 승인된 피드백입니다")

    # 권한: 지정 승인자 OR admin
    current_contact_result = await db.execute(select(Contact).where(Contact.user_id == user.id))
    current_contact = current_contact_result.scalar_one_or_none()
    is_admin = user.role == "admin"
    is_designated = current_contact is not None and current_contact.id == feedback.approver_id
    if not (is_admin or is_designated):
        raise HTTPException(status_code=403, detail="관리자 또는 지정 승인자만 처리할 수 있습니다")

    # OCR 완료 확인 (425 — 처리 중이면 재시도)
    processing_count = sum(
        1 for a in feedback.attachments if a.ocr_status == "processing"
    )
    if processing_count > 0:
        raise HTTPException(status_code=425, detail="OCR 처리 중입니다. 잠시 후 재시도해 주세요.")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    feedback.status = "approved"
    feedback.approved_by = current_contact.id if current_contact else None
    feedback.approved_at = now
    feedback.rejection_reason = None
    feedback.rejected_at = None
    await db.flush()

    # 임베딩 payload 구성
    system = await db.get(System, incident.system_id) if incident.system_id else None
    alerts = (await db.execute(
        select(AlertHistory).where(AlertHistory.incident_id == incident_id)
        .order_by(AlertHistory.created_at.asc()).limit(10)
    )).scalars().all()

    # 승인자 이름 — lazy-load 방지를 위해 명시적 async 조회
    approver_user = (
        await db.get(User, current_contact.user_id) if current_contact else None
    )

    alert_types = list({a.alert_type for a in alerts if a.alert_type})
    alert_excerpts_list = [f"{a.severity}: {a.title}" for a in alerts[:5]]
    attachment_text = "\n".join(
        a.ocr_text for a in feedback.attachments if a.ocr_text
    )

    embed_payload = {
        "incident_id": incident_id,
        "system_id": incident.system_id,
        "system_name": system.system_name if system else "",
        "title": incident.title or "",
        "severity": incident.severity or "",
        "alert_excerpts": "\n".join(alert_excerpts_list),
        "root_cause": feedback.error_type or "",
        "solution": feedback.solution or "",
        "ocr_text": attachment_text or "",
        "tags": alert_types,
    }

    # 같은 인시던트의 기존 approved feedback이 보유한 qdrant_point_id를 우선 재사용 →
    # 한 인시던트당 1 incident_postmortems point 유지 (재등록 시 중복 방지)
    if not feedback.qdrant_point_id:
        existing_q = await db.execute(
            select(AlertFeedback.qdrant_point_id)
            .where(AlertFeedback.incident_id == incident_id)
            .where(AlertFeedback.id != feedback_id)
            .where(AlertFeedback.qdrant_point_id.isnot(None))
            .order_by(AlertFeedback.approved_at.desc().nullslast())
            .limit(1)
        )
        existing_qdrant_id = existing_q.scalar_one_or_none()
        if existing_qdrant_id:
            feedback.qdrant_point_id = existing_qdrant_id

    try:
        returned_point_id = await postmortem_client.embed_postmortem(
            payload=embed_payload,
            qdrant_point_id=feedback.qdrant_point_id,
        )
        feedback.qdrant_point_id = returned_point_id
    except Exception as exc:
        logger.warning("incident postmortem embed 실패 (feedback_id=%s): %s", feedback_id, exc)

    await db.commit()
    background_tasks.add_task(_link_qdrant_incident_points, incident_id)
    await db.refresh(feedback)
    result2 = await db.execute(
        select(AlertFeedback).where(AlertFeedback.id == feedback_id)
        .options(selectinload(AlertFeedback.attachments))
    )
    return result2.scalar_one()


# ── 피드백 반려 ───────────────────────────────────────────────────────────────

@router.post("/{incident_id}/feedback/{feedback_id}/reject", response_model=FeedbackOut)
async def reject_incident_feedback(
    incident_id: int,
    feedback_id: int,
    payload: FeedbackRejectRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """피드백 반려 — 지정 승인자 OR admin."""
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    result = await db.execute(
        select(AlertFeedback).where(AlertFeedback.id == feedback_id)
        .options(selectinload(AlertFeedback.attachments))
    )
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if feedback.incident_id != incident_id:
        raise HTTPException(status_code=400, detail="해당 인시던트의 피드백이 아닙니다")
    if feedback.status not in ("pending", "rejected"):
        raise HTTPException(status_code=400, detail=f"pending/rejected 상태인 피드백만 반려할 수 있습니다 (현재: {feedback.status})")

    # 권한: 지정 승인자 OR admin
    current_contact_result = await db.execute(select(Contact).where(Contact.user_id == user.id))
    current_contact = current_contact_result.scalar_one_or_none()
    is_admin = user.role == "admin"
    is_designated = current_contact is not None and current_contact.id == feedback.approver_id
    if not (is_admin or is_designated):
        raise HTTPException(status_code=403, detail="관리자 또는 지정 승인자만 처리할 수 있습니다")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    feedback.status = "rejected"
    feedback.rejection_reason = payload.rejection_reason
    feedback.rejected_at = now
    await db.commit()
    await db.refresh(feedback)
    result2 = await db.execute(
        select(AlertFeedback).where(AlertFeedback.id == feedback_id)
        .options(selectinload(AlertFeedback.attachments))
    )
    feedback = result2.scalar_one()

    # 등록자 Teams 반려 알림 (best-effort) — Contact + User join으로 teams_upn까지 확보 (@멘션용)
    resolver_webhook: str | None = None
    resolver_contact_dict: dict | None = None
    try:
        resolver_join_result = await db.execute(
            select(Contact, User).join(User, Contact.user_id == User.id)
            .where(User.name == feedback.resolver)
        )
        row = resolver_join_result.first()
        if row:
            resolver_contact, resolver_user = row
            resolver_webhook = resolver_contact.webhook_url
            resolver_contact_dict = {
                "name": resolver_user.name,
                "teams_upn": resolver_contact.teams_upn,
            }
    except Exception as exc:
        logger.warning("반려 알림 contact 조회 실패 (feedback_id=%s): %s", feedback_id, exc)

    background_tasks.add_task(
        _notifier.send_rejection_card,
        webhook_url=resolver_webhook,
        feedback_id=feedback.id,
        alert_title=incident.title or "Unknown",
        rejection_reason=payload.rejection_reason,
        resolver_contact=resolver_contact_dict,
    )

    return feedback


# ── 피드백 재등록 ─────────────────────────────────────────────────────────────

@router.post("/{incident_id}/feedback/{feedback_id}/resubmit", response_model=FeedbackOut)
async def resubmit_incident_feedback(
    incident_id: int,
    feedback_id: int,
    payload: FeedbackResubmitRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """피드백 재등록/수정 — pending/rejected/approved 모두 허용. 등록자(resolver) 또는 admin.

    pending 상태: 승인 대기 중인 본인 피드백 보강·수정 (status는 그대로 pending 유지, revision_count+1, 승인자 재알림).
    rejected 상태: 반려된 피드백을 수정 후 다시 승인 요청.
    approved 상태: 이미 승인된 피드백을 수정 → status=pending 복귀 → 재승인 필요.
    재승인되면 같은 qdrant_point_id로 incident_postmortems upsert (RAG 자산 갱신).
    """
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    result = await db.execute(
        select(AlertFeedback).where(AlertFeedback.id == feedback_id)
        .options(selectinload(AlertFeedback.attachments))
    )
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if feedback.incident_id != incident_id:
        raise HTTPException(status_code=400, detail="해당 인시던트의 피드백이 아닙니다")
    if feedback.status not in ("pending", "rejected", "approved"):
        raise HTTPException(status_code=400, detail=f"pending/rejected/approved 상태인 피드백만 수정할 수 있습니다 (현재: {feedback.status})")

    # 권한: resolver 이름 일치(best-effort) 또는 admin
    is_admin = user.role == "admin"
    is_resolver = user.name == feedback.resolver
    if not (is_admin or is_resolver):
        raise HTTPException(status_code=403, detail="등록자 또는 관리자만 재등록할 수 있습니다")

    # 하드 리밋 — 재등록 횟수가 상한에 도달하면 신규 피드백 등록을 강제
    if (feedback.revision_count or 0) >= _RESUBMIT_HARD_LIMIT:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "resubmit_limit_exceeded",
                "message": f"이 피드백은 {feedback.revision_count}회 재등록되었습니다. 새 피드백을 등록해 주세요.",
                "revision_count": feedback.revision_count,
                "soft_limit": _RESUBMIT_SOFT_LIMIT,
                "hard_limit": _RESUBMIT_HARD_LIMIT,
            },
        )

    attachment_paths = payload.attachment_paths or []
    kept_ids = payload.kept_attachment_ids  # None / [] / [ids]

    # 기존 첨부 처리 (보존 정책):
    #  - kept_ids is None  → 모든 기존 보존 (텍스트만 수정 케이스, 호환성)
    #  - kept_ids == []    → 모든 기존 제거
    #  - kept_ids == [...] → 지정 ID만 보존, 그 외 제거
    existing_attachments = (await db.execute(
        select(AlertFeedbackAttachment).where(AlertFeedbackAttachment.feedback_id == feedback_id)
    )).scalars().all()

    if kept_ids is not None:
        kept_set = set(kept_ids)
        for att in existing_attachments:
            if att.id not in kept_set:
                _delete_file_best_effort(att.file_path)
                await db.execute(
                    sa_delete(AlertFeedbackAttachment).where(AlertFeedbackAttachment.id == att.id)
                )
        kept_count = sum(1 for att in existing_attachments if att.id in kept_set)
    else:
        kept_count = len(existing_attachments)

    # 합산 10건 제한 검증
    total_count = kept_count + len(attachment_paths)
    if total_count > _MAX_ATTACHMENTS_PER_FEEDBACK:
        raise HTTPException(
            status_code=400,
            detail=f"첨부파일은 최대 {_MAX_ATTACHMENTS_PER_FEEDBACK}개까지 가능합니다 (보존 {kept_count}건 + 신규 {len(attachment_paths)}건 = {total_count}건)",
        )

    # approved→pending 전환 시 Qdrant 포인트를 정리해야 하므로 변경 전 상태를 보관
    original_status = feedback.status
    captured_point_id = feedback.qdrant_point_id

    # 피드백 내용 갱신 (rejected → pending 또는 approved → pending 복귀)
    feedback.error_type = payload.error_type
    feedback.solution = payload.solution
    feedback.status = "pending"
    feedback.revision_count = (feedback.revision_count or 0) + 1
    feedback.rejection_reason = None
    feedback.rejected_at = None
    # 재등록 사유 — None / 공백 입력 시 NULL 저장. 매 재등록마다 덮어씀(이력 미보관).
    revision_reason_text = (payload.revision_reason or "").strip() or None
    feedback.revision_reason = revision_reason_text
    # approved에서 수정한 경우 — approved_at 등도 초기화하여 재승인 절차 강제.
    # qdrant_point_id도 NULL로 초기화 — 재승인 시 새 포인트를 생성하게 됨.
    feedback.approved_at = None
    feedback.approved_by = None
    if original_status == "approved":
        feedback.qdrant_point_id = None
    await db.flush()

    # 신규 첨부 누적 (sort_order는 보존된 기존 뒤에 이어짐)
    attachment_filenames = payload.attachment_filenames or []
    base_sort = kept_count
    for idx, staging_rel in enumerate(attachment_paths):
        original_filename = (
            attachment_filenames[idx] if idx < len(attachment_filenames) else Path(staging_rel).name
        )
        new_rel = _move_staging_to_feedback(staging_rel, feedback_id)
        attach = AlertFeedbackAttachment(
            feedback_id=feedback_id,
            file_path=new_rel,
            original_filename=original_filename,
            sort_order=base_sort + idx,
            ocr_status="processing",
        )
        db.add(attach)

    await db.commit()
    result2 = await db.execute(
        select(AlertFeedback).where(AlertFeedback.id == feedback_id)
        .options(selectinload(AlertFeedback.attachments))
    )
    feedback = result2.scalar_one()

    # approved → pending 전환 시 Qdrant point 삭제 (best-effort, DB commit 이후)
    if original_status == "approved" and captured_point_id:
        try:
            await postmortem_client.delete_postmortem(captured_point_id)
        except Exception as exc:
            logger.warning(
                "postmortem Qdrant point 삭제 실패 (point_id=%s, feedback_id=%s): %s",
                captured_point_id, feedback_id, exc,
            )

    # OCR 백그라운드 처리 — detached task 로 즉시 응답 반환
    if attachment_paths:
        asyncio.create_task(_run_ocr_remaining_detached(feedback.id))

    # 승인자 재발송 — User join으로 teams_upn까지 확보 (@멘션용)
    approver_webhook: str | None = None
    approver_contact_dict: dict | None = None
    if feedback.approver_id:
        approver = await db.get(Contact, feedback.approver_id)
        if approver:
            approver_webhook = approver.webhook_url
            approver_user = await db.get(User, approver.user_id)
            if approver_user:
                approver_contact_dict = {
                    "name": approver_user.name,
                    "teams_upn": approver.teams_upn,
                }

    system = await db.get(System, incident.system_id) if incident.system_id else None
    system_display_name = system.display_name if system else str(incident.system_id or "Unknown")

    background_tasks.add_task(
        _notifier.send_approval_request_card,
        webhook_url=approver_webhook,
        feedback_id=feedback_id,
        system_display_name=system_display_name,
        alert_title=incident.title or "Unknown",
        error_type=feedback.error_type,
        solution=feedback.solution,
        resolver=feedback.resolver,
        attachment_count=len(attachment_paths),
        revision_count=feedback.revision_count,
        revision_reason=revision_reason_text,
        approver_contact=approver_contact_dict,
    )

    # 소프트 리밋 — 재등록 횟수가 soft_limit 이상이면 경고를 동봉하여 반환
    out = FeedbackOut.model_validate(feedback)
    if feedback.revision_count >= _RESUBMIT_SOFT_LIMIT:
        out.warning = ResubmitWarning(
            code="approaching_resubmit_limit",
            message=(
                f"이 피드백은 이미 {feedback.revision_count}회 재등록되었습니다. "
                "본질이 다른 솔루션이라면 새 피드백 등록을 권장합니다."
            ),
            revision_count=feedback.revision_count,
            soft_limit=_RESUBMIT_SOFT_LIMIT,
            hard_limit=_RESUBMIT_HARD_LIMIT,
        )
    return out


# ── 첨부 OCR 재시도 ───────────────────────────────────────────────────────────

@router.post("/{incident_id}/feedback/{feedback_id}/retry-ocr")
async def retry_feedback_ocr(
    incident_id: int,
    feedback_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """피드백 첨부의 OCR 재시도 — processing(잠김) / failed 첨부 모두 대상.

    detached task 로 OCR 을 시작하고 즉시 응답 반환. 클라이언트 disconnect 와 무관하게
    완료까지 진행되며 _run_ocr_for_attachment 가 status 를 done/failed 로 확정함.

    권한: admin 또는 등록자(resolver) 본인.
    """
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    feedback = await db.get(AlertFeedback, feedback_id)
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if feedback.incident_id != incident_id:
        raise HTTPException(status_code=400, detail="해당 인시던트의 피드백이 아닙니다")

    if user.role != "admin" and user.name != feedback.resolver:
        raise HTTPException(status_code=403, detail="등록자 또는 관리자만 OCR 재시도할 수 있습니다")

    # 대상 첨부 조회 + processing 으로 reset (failed 였던 항목 포함)
    targets_result = await db.execute(
        select(AlertFeedbackAttachment).where(
            AlertFeedbackAttachment.feedback_id == feedback_id,
            AlertFeedbackAttachment.ocr_status.in_(("processing", "failed")),
        )
    )
    targets = targets_result.scalars().all()
    if not targets:
        return {"retried": 0, "message": "재시도할 첨부가 없습니다 (모두 done 상태)."}

    for att in targets:
        att.ocr_status = "processing"
        att.ocr_progress = 0
    await db.commit()

    asyncio.create_task(_run_ocr_remaining_detached(feedback_id))
    return {"retried": len(targets), "message": "OCR 재처리를 시작했습니다."}


# ── 인시던트 피드백 목록 ───────────────────────────────────────────────────────

@router.get("/{incident_id}/feedback", response_model=list[FeedbackOut])
async def list_incident_feedbacks(
    incident_id: int,
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """인시던트에 등록된 피드백 목록 (기본: approved만)."""
    if status and status != "approved":
        if current_user.role != "admin":
            raise HTTPException(status_code=403, detail="관리자 권한이 필요합니다")

    stmt = (
        select(AlertFeedback)
        .where(AlertFeedback.incident_id == incident_id)
        .options(selectinload(AlertFeedback.attachments))
    )
    if not status or status == "approved":
        stmt = stmt.where(AlertFeedback.status == "approved")
    elif status != "all":
        stmt = stmt.where(AlertFeedback.status == status)
    stmt = stmt.order_by(AlertFeedback.created_at.desc())

    return (await db.execute(stmt)).scalars().all()


# ── 피드백 단건 조회 (review/revise 페이지용) ─────────────────────────────────

@router.get("/feedback/{feedback_id}", response_model=FeedbackOut)
async def get_feedback_by_id(
    feedback_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """피드백 단건 조회. FeedbackOut.incident_id를 포함하여 반환."""
    result = await db.execute(
        select(AlertFeedback)
        .where(AlertFeedback.id == feedback_id)
        .options(selectinload(AlertFeedback.attachments))
    )
    feedback = result.scalar_one_or_none()
    if not feedback:
        raise HTTPException(status_code=404, detail="피드백을 찾을 수 없습니다")
    # 본인(resolver)이거나 admin이거나 지정 승인자만 조회 가능
    # — 최소한 current_user 인증이 완료된 경우 허용 (read-only)
    return feedback


# ── 피드백 vector asset (incident_postmortems) 조회 ───────────────────────────

@router.get("/feedback/{feedback_id}/postmortem")
async def get_feedback_postmortem(
    feedback_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """피드백의 incident_postmortems Qdrant payload 조회.
    승인된 피드백의 vector 자산을 운영자/admin이 직접 확인 가능."""
    feedback = await db.get(AlertFeedback, feedback_id)
    if not feedback:
        raise HTTPException(status_code=404, detail="피드백을 찾을 수 없습니다")
    if not feedback.qdrant_point_id:
        raise HTTPException(
            status_code=404,
            detail="아직 승인되지 않은 피드백이거나 Qdrant 자산이 생성되지 않았습니다",
        )

    payload = await postmortem_client.get_by_incident(feedback.incident_id)
    if payload is None:
        raise HTTPException(
            status_code=404,
            detail=f"incident_postmortems 컬렉션에서 incident_id={feedback.incident_id} point를 찾을 수 없습니다",
        )

    return {
        "collection": "incident_postmortems",
        "point_id": feedback.qdrant_point_id,
        "incident_id": feedback.incident_id,
        "payload": payload,
    }


# ── 기존 /{incident_id} 라우트 (이 아래에 위치해야 함) ────────────────────────

@router.get("/{incident_id}", response_model=IncidentDetailOut)
async def get_incident(incident_id: int, db: AsyncSession = Depends(get_db)):
    has_approved = (
        select(1).select_from(AlertFeedback)
        .where(AlertFeedback.incident_id == Incident.id)
        .where(AlertFeedback.status == "approved")
        .exists()
        .label("has_approved_feedback")
    )
    latest_status = (
        select(AlertFeedback.status)
        .where(AlertFeedback.incident_id == Incident.id)
        .order_by(AlertFeedback.created_at.desc())
        .limit(1)
        .scalar_subquery()
        .label("latest_feedback_status")
    )
    row = (await db.execute(
        select(
            Incident,
            System.display_name.label("system_display_name"),
            has_approved,
            latest_status,
        )
        .outerjoin(System, System.id == Incident.system_id)
        .where(Incident.id == incident_id)
    )).first()

    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")

    incident, system_display_name = row.Incident, row.system_display_name
    base = _to_out(
        incident,
        system_display_name,
        bool(row.has_approved_feedback),
        row.latest_feedback_status,
    )

    # 타임라인
    timeline_rows = (await db.execute(
        select(IncidentTimeline)
        .where(IncidentTimeline.incident_id == incident_id)
        .order_by(IncidentTimeline.created_at.asc())
    )).scalars().all()

    # 연결된 알림 이력 (최근 20건)
    alert_rows = (await db.execute(
        select(AlertHistory)
        .where(AlertHistory.incident_id == incident_id)
        .order_by(AlertHistory.created_at.desc())
        .limit(20)
    )).scalars().all()

    return IncidentDetailOut(
        **base.model_dump(),
        timeline=[IncidentTimelineItemOut.model_validate(t) for t in timeline_rows],
        alert_history=[AlertHistoryOut.model_validate(a) for a in alert_rows],
        next_action_meta=status_meta(incident.status),
    )


@router.patch("/{incident_id}", response_model=IncidentOut)
async def update_incident(
    incident_id: int,
    payload: IncidentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    timeline_desc = None

    if payload.status and payload.status != incident.status:
        if payload.status not in _VALID_STATUSES:
            raise HTTPException(status_code=422, detail=f"유효하지 않은 상태값: {payload.status}")

        old_status = incident.status
        incident.status = payload.status
        timeline_desc = f"상태 변경: {old_status} → {payload.status}"

        old_idx = _STATUS_ORDER.index(old_status) if old_status in _STATUS_ORDER else -1
        new_idx = _STATUS_ORDER.index(payload.status) if payload.status in _STATUS_ORDER else -1

        if new_idx < old_idx:
            # 이전 상태로 전환 시 이후 타임스탬프 초기화
            if new_idx < _STATUS_ORDER.index("acknowledged"):
                incident.acknowledged_at = None
                incident.acknowledged_by = None
            if new_idx < _STATUS_ORDER.index("resolved"):
                incident.resolved_at = None
                incident.resolved_by = None
            if new_idx < _STATUS_ORDER.index("closed"):
                incident.closed_at = None
        else:
            if payload.status == "acknowledged" and not incident.acknowledged_at:
                incident.acknowledged_at = now
                incident.acknowledged_by = current_user.id
            elif payload.status == "resolved" and not incident.resolved_at:
                incident.resolved_at = now
                incident.resolved_by = current_user.id
            elif payload.status == "closed" and not incident.closed_at:
                incident.closed_at = now

    if payload.title is not None:
        incident.title = payload.title
    if payload.severity is not None:
        _VALID_SEVERITIES = {"critical", "warning", "info"}
        if payload.severity not in _VALID_SEVERITIES:
            raise HTTPException(status_code=422, detail=f"유효하지 않은 심각도: {payload.severity}")
        incident.severity = payload.severity
    if payload.root_cause is not None:
        incident.root_cause = payload.root_cause
    if payload.resolution is not None:
        incident.resolution = payload.resolution
    if payload.postmortem is not None:
        incident.postmortem = payload.postmortem

    if timeline_desc:
        db.add(IncidentTimeline(
            incident_id=incident_id,
            event_type="status_changed",
            description=timeline_desc,
            actor_name=current_user.name,
        ))

    await db.commit()
    await db.refresh(incident)

    system_display_name = None
    if incident.system_id:
        system = await db.get(System, incident.system_id)
        if system:
            system_display_name = system.display_name

    return _to_out(incident, system_display_name)


@router.post("/{incident_id}/comments", response_model=IncidentTimelineItemOut)
async def add_comment(
    incident_id: int,
    payload: IncidentCommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    entry = IncidentTimeline(
        incident_id=incident_id,
        event_type="comment",
        description=payload.comment,
        actor_name=current_user.name,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def _collect_incident_context(db: AsyncSession, incident: Incident) -> dict:
    """LLM 프롬프트용 컨텍스트 수집: 시스템 + 연결 알림 + 알림별 피드백."""
    system_display_name = "알 수 없음"
    if incident.system_id:
        system = await db.get(System, incident.system_id)
        if system:
            system_display_name = system.display_name

    alerts = (await db.execute(
        select(AlertHistory)
        .where(AlertHistory.incident_id == incident.id)
        .order_by(AlertHistory.created_at.asc())
    )).scalars().all()

    feedbacks = (await db.execute(
        select(AlertFeedback)
        .where(AlertFeedback.incident_id == incident.id)
        .order_by(AlertFeedback.created_at.asc())
    )).scalars().all()

    return {
        "system_display_name": system_display_name,
        "alerts": alerts,
        "feedbacks": feedbacks,
    }


def _format_alert_lines(alerts: list[AlertHistory], feedbacks: list) -> str:
    """알림 + 피드백을 사람이 읽을 수 있는 텍스트 블록으로 정리."""
    if not alerts:
        return "(연결된 알림 없음)"

    lines = []
    for idx, alert in enumerate(alerts, 1):
        created_at_kst = alert.created_at.replace(tzinfo=timezone.utc).astimezone(_KST)
        timestamp = created_at_kst.strftime("%m-%d %H:%M")
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

        lines.append(
            f"[{idx}] {timestamp} · {alert.severity.upper()} · "
            f"{alert.instance_role or '-'} · {alert.alert_type} · {alert.title or ''}"
        )
        if description_text:
            lines.append(f"    - 내용: {description_text[:300]}")
        if root_cause:
            lines.append(f"    - 추정 원인: {root_cause}")
        if recommendation:
            lines.append(f"    - 권장 조치: {recommendation}")

    # 인시던트 단위 해결책은 알림 목록 아래에 일괄 표시
    if feedbacks:
        lines.append("")
        lines.append("[등록된 해결책]")
        for fb in feedbacks:
            lines.append(
                f"  - 운영자 해결책({fb.resolver}, {fb.error_type}): "
                f"{(fb.solution or '')[:300]}"
            )

    return "\n".join(lines)


async def _get_agent_code(db: AsyncSession, area_code: str) -> str:
    result = await db.execute(
        select(LlmAgentConfig.agent_code)
        .where(LlmAgentConfig.area_code == area_code)
        .where(LlmAgentConfig.is_active.is_(True))
    )
    return result.scalar_one_or_none() or ""


@router.post("/{incident_id}/incident-report", response_model=IncidentReportOut)
async def generate_incident_report(
    incident_id: int,
    db: AsyncSession = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """인시던트 연결 알림 + 해결책을 모두 반영한 한국어 장애 보고서 자동 생성."""
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    ctx = await _collect_incident_context(db, incident)
    agent_code = await _get_agent_code(db, "incident_report")

    detected_kst = incident.detected_at.replace(tzinfo=timezone.utc).astimezone(_KST)
    detected_str = detected_kst.strftime("%Y년 %m월 %d일 %H시 %M분")
    resolved_str = "현재 진행 중"
    if incident.resolved_at:
        resolved_kst = incident.resolved_at.replace(tzinfo=timezone.utc).astimezone(_KST)
        resolved_str = resolved_kst.strftime("%H시 %M분")
    time_range = f"{detected_str} ~ {resolved_str}"

    alert_block = _format_alert_lines(ctx["alerts"], ctx["feedbacks"])

    prompt = f"""다음 인시던트(사건) 정보를 바탕으로 한국어 장애보고서를 작성하세요.

[인시던트 요약]
- 시스템: {ctx['system_display_name']}
- 제목: {incident.title}
- 심각도: {incident.severity}
- 상태: {incident.status}
- 발생~복구: {time_range}
- 연결 알림 수: {len(ctx['alerts'])}건

[운영자가 분석·입력한 핵심 내용 — 반드시 보고서에 반영]
- 근본 원인: {incident.root_cause or '(미입력)'}
- 조치 내용: {incident.resolution or '(미입력)'}
- 사후 분석(재발 방지): {incident.postmortem or '(미입력)'}

[연결된 알림 및 해결책 이력]
{alert_block}

작성 규칙:
1. 위 "운영자가 분석·입력한 핵심 내용"을 **장애원인·조치사항·기타** 섹션에 우선 반영한다.
2. 연결된 알림·해결책 이력에서 추가 맥락을 보강한다.
3. 임원·관계사 보고용이므로 기술 용어는 괄호로 쉬운 표현을 덧붙인다. 예: "DB 커넥션 풀 고갈(동시 접속 허용량 소진)".
4. 각 항목은 필요 시 줄바꿈으로 분리해 가독성을 확보한다.
5. 정보가 부족한 항목은 "(확인 필요)"로 표시한다.

아래 양식을 그대로 사용해 출력하세요:

<장애보고>
[백화점CX팀] (제목: 현상 위주로 작성)
○ 장애발생일시 : {time_range}
○ 장애인지 : (모니터링 시스템 자동 감지 경위 및 인지 시각)
○ 영향범위 : (피해 서비스 및 사용자 영향 중심 서술)
○ 장애원인 : (운영자 입력 근본 원인을 중심으로, 비즈니스 관점으로 풀어 설명)
○ 조치사항 : (운영자 입력 조치 내용 + 추가 진행 조치)
○ 고객반응 : (관계사·현업 인지 여부 및 VOC 등 반응)
○ 기타 : (운영자 입력 사후 분석 내용 + 재발 방지 개선 계획)"""

    report = await call_llm_text(prompt, max_tokens=1500, agent_code=agent_code)
    if not report:
        raise HTTPException(status_code=503, detail="LLM 서비스 응답 없음. 잠시 후 다시 시도하세요.")

    return IncidentReportOut(report=report)


@router.post("/{incident_id}/ai-analyze", response_model=IncidentAiAnalyzeOut)
async def ai_analyze_incident(
    incident_id: int,
    db: AsyncSession = Depends(get_db),
    _current_user=Depends(get_current_user),
):
    """LLM이 연결 알림 + 해결책을 심층 분석해 근본원인·조치·사후분석을 JSON으로 반환."""
    incident = await db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    ctx = await _collect_incident_context(db, incident)
    agent_code = await _get_agent_code(db, "incident_ai_analysis")

    alert_block = _format_alert_lines(ctx["alerts"], ctx["feedbacks"])

    prompt = f"""다음 인시던트(사건)를 심층 분석하여 임원·관계사 보고용 요약을 작성하세요.
설명이나 주석 없이 유효한 JSON만 반환해야 합니다.

[인시던트]
- 시스템: {ctx['system_display_name']}
- 제목: {incident.title}
- 심각도: {incident.severity}

[연결된 알림 및 운영자 해결책]
{alert_block}

작성 원칙 (매우 중요):
1. **임원 보고용**: 비전문가도 한번에 이해할 수 있게 쉬운 표현으로 작성.
2. **기술 용어 풀이**: 전문 용어가 나오면 괄호로 쉬운 말을 덧붙인다. 예: "GC overhead(자바 메모리 청소 과부하)".
3. **가독성 최우선**: 각 필드는 반드시 줄바꿈(\\n)과 글머리 기호(`- `, `1.` 등)로 구조화한다. 한 줄로 몰아쓰기 금지.
4. **섹션 구조**: 각 필드 내부에 소제목을 붙여 여러 블록으로 나눈다.
5. 항목당 4~8줄 분량.

각 필드의 권장 구조:

root_cause (근본 원인) — 다음 3개 소제목으로 구분:
- 핵심 원인 한 줄 요약(비전문가용)
- 상세 설명 (2~3줄, 쉬운 표현)
- 기술 요소: 리스트로 3~5개 (기술 용어는 괄호 풀이 포함)

resolution (조치 내용) — 다음 2개 소제목으로 구분:
- 즉시 수행한 조치 (bullet list 3~5개)
- 추가 권장 조치 (bullet list 2~3개)

postmortem (사후 분석) — 다음 2개 소제목으로 구분:
- 단기 개선안 (1~2주 내, bullet list 3개 내외)
- 중장기 개선안 (1~3개월, bullet list 3개 내외)

출력 예시 (실제 내용은 다르게 작성):
{{
  "root_cause": "◆ 핵심 원인\\n결제 처리 서버가 순간적으로 폭주해 고객 요청을 처리하지 못함.\\n\\n◆ 상세 설명\\n이벤트 트래픽이 평상시의 3배로 급증했으며, 서버가 처리 한계에 도달하여 응답 지연과 일부 실패가 발생함.\\n\\n◆ 기술 요소\\n- DB 커넥션 풀 고갈(동시 접속 허용량 소진)\\n- JVM Heap 90% 초과(프로그램 메모리 부족)\\n- Deadlock 발생(트랜잭션 충돌로 쿼리 멈춤)",
  "resolution": "◆ 즉시 수행한 조치\\n- WAS(서비스 서버) 순차 재기동으로 고착된 세션 정리\\n- DB 커넥션 풀 크기 확대\\n- 배치 작업 일시 중단\\n\\n◆ 추가 권장 조치\\n- 트래픽 피크 대비 오토스케일 설정 검토\\n- 슬로우 쿼리 상위 10건 튜닝",
  "postmortem": "◆ 단기 개선안 (1~2주)\\n- 커넥션 풀 모니터링 알람 임계치 조정\\n- 이벤트 트래픽 대응 런북 작성\\n\\n◆ 중장기 개선안 (1~3개월)\\n- 결제 서비스 MSA 전환으로 격벽화\\n- 캐시 레이어 도입으로 DB 부하 분산"
}}

최종 출력: 위 예시 구조를 따르되 이 인시던트의 실제 내용으로 채워 JSON으로만 반환."""

    raw = await call_llm_text(prompt, max_tokens=2000, agent_code=agent_code)
    if not raw:
        raise HTTPException(status_code=503, detail="LLM 서비스 응답 없음. 잠시 후 다시 시도하세요.")

    # 응답에서 JSON 블록 추출 (코드펜스/설명 혼입 대비)
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        logger.warning("AI analyze 응답에서 JSON을 찾지 못함: %s", raw[:300])
        raise HTTPException(status_code=502, detail="LLM 응답 파싱 실패")

    try:
        parsed = json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        logger.warning("AI analyze JSON 파싱 실패: %s / raw=%s", exc, raw[:300])
        raise HTTPException(status_code=502, detail="LLM 응답 파싱 실패")

    return IncidentAiAnalyzeOut(
        root_cause=str(parsed.get("root_cause", "")).strip(),
        resolution=str(parsed.get("resolution", "")).strip(),
        postmortem=str(parsed.get("postmortem", "")).strip(),
    )
