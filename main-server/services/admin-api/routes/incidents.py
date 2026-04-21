import json
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AlertFeedback, AlertHistory, Incident, IncidentTimeline, LlmAgentConfig, System
from schemas import (
    AlertHistoryOut,
    IncidentAiAnalyzeOut,
    IncidentCommentCreate,
    IncidentDetailOut,
    IncidentOut,
    IncidentReportOut,
    IncidentTimelineItemOut,
    IncidentUpdate,
)
from services.llm_client import call_llm_text

logger = logging.getLogger(__name__)
_KST = timezone(timedelta(hours=9))

router = APIRouter(prefix="/api/v1/incidents", tags=["incidents"])

_VALID_STATUSES = {"open", "acknowledged", "investigating", "resolved", "closed"}


def _to_out(incident: Incident, system_display_name: str | None = None) -> IncidentOut:
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
    stmt = select(Incident, System.display_name.label("system_display_name")).outerjoin(
        System, System.id == Incident.system_id
    ).order_by(Incident.detected_at.desc()).offset(offset).limit(limit)

    if system_id is not None:
        stmt = stmt.where(Incident.system_id == system_id)
    if status:
        stmt = stmt.where(Incident.status == status)
    if severity:
        stmt = stmt.where(Incident.severity == severity)

    rows = (await db.execute(stmt)).all()
    return [_to_out(row.Incident, row.system_display_name) for row in rows]


@router.get("/{incident_id}", response_model=IncidentDetailOut)
async def get_incident(incident_id: int, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(
        select(Incident, System.display_name.label("system_display_name"))
        .outerjoin(System, System.id == Incident.system_id)
        .where(Incident.id == incident_id)
    )).first()

    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")

    incident, system_display_name = row.Incident, row.system_display_name
    base = _to_out(incident, system_display_name)

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

        if payload.status == "acknowledged" and not incident.acknowledged_at:
            incident.acknowledged_at = now
            incident.acknowledged_by = current_user.id
        elif payload.status == "resolved" and not incident.resolved_at:
            incident.resolved_at = now
            incident.resolved_by = current_user.id
        elif payload.status == "closed" and not incident.closed_at:
            incident.closed_at = now

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

    alert_ids = [a.id for a in alerts]
    feedbacks = []
    if alert_ids:
        feedbacks = (await db.execute(
            select(AlertFeedback)
            .where(AlertFeedback.alert_history_id.in_(alert_ids))
            .order_by(AlertFeedback.created_at.asc())
        )).scalars().all()

    feedbacks_by_alert: dict[int, list[AlertFeedback]] = {}
    for fb in feedbacks:
        feedbacks_by_alert.setdefault(fb.alert_history_id, []).append(fb)

    return {
        "system_display_name": system_display_name,
        "alerts": alerts,
        "feedbacks_by_alert": feedbacks_by_alert,
    }


def _format_alert_lines(alerts: list[AlertHistory], feedbacks_by_alert: dict) -> str:
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

        fbs = feedbacks_by_alert.get(alert.id, [])
        for fb in fbs:
            lines.append(
                f"    - 운영자 해결책({fb.resolver}, {fb.error_type}): "
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

    alert_block = _format_alert_lines(ctx["alerts"], ctx["feedbacks_by_alert"])

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

    alert_block = _format_alert_lines(ctx["alerts"], ctx["feedbacks_by_alert"])

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
