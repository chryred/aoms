"""admin-api 내부 도구 executor — systems/alert_history/contacts 조회."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models import (
    AlertFeedback,
    AlertHistory,
    ChatMessage,
    Contact,
    Incident,
    IncidentTimeline,
    KnowledgeGuide,
    LogAnalysisHistory,
    System,
    SystemContact,
    SystemHost,
    User,
)
from services.incident_status_meta import (
    INCIDENT_NEXT_ACTION,
    INCIDENT_PROGRESS,
    INCIDENT_STATUS_KO,
    status_meta,
)


async def _list_systems(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    stmt = select(System)
    if args.get("status"):
        stmt = stmt.where(System.status == args["status"])
    if args.get("display_name"):
        stmt = stmt.where(System.display_name.ilike(f"%{args['display_name']}%"))
    rows = (await db.execute(stmt.order_by(System.id))).scalars().all()

    system_ids = [s.id for s in rows]
    if system_ids:
        host_rows = (
            await db.execute(
                select(SystemHost)
                .where(SystemHost.system_id.in_(system_ids))
                .order_by(SystemHost.system_id, SystemHost.id)
            )
        ).scalars().all()
    else:
        host_rows = []
    hosts_by_system: dict[int, list[dict]] = {}
    for h in host_rows:
        hosts_by_system.setdefault(h.system_id, []).append(
            {"id": h.id, "host_ip": h.host_ip, "role_label": h.role_label}
        )

    return {
        "systems": [
            {
                "id": s.id,
                "system_name": s.system_name,
                "display_name": s.display_name,
                "status": s.status,
                "hosts": hosts_by_system.get(s.id, []),
            }
            for s in rows
        ],
        "count": len(rows),
    }


async def _search_alert_history(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    since_hours = int(args.get("since_hours", 24))
    limit = min(int(args.get("limit", 20)), 100)
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=since_hours)

    conds = [AlertHistory.created_at >= since]
    if args.get("system_id"):
        conds.append(AlertHistory.system_id == int(args["system_id"]))
    if args.get("severity"):
        conds.append(AlertHistory.severity == args["severity"])

    stmt = (
        select(AlertHistory)
        .where(and_(*conds))
        .order_by(AlertHistory.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "alerts": [
            {
                "id": a.id,
                "system_id": a.system_id,
                "alertname": a.alertname,
                "title": a.title,
                "severity": a.severity,
                "instance_role": a.instance_role,
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
                "alert_type": a.alert_type,
                "acknowledged": a.acknowledged,
            }
            for a in rows
        ],
        "count": len(rows),
        "since_hours": since_hours,
    }


async def _list_contacts(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    if args.get("system_id"):
        sid = int(args["system_id"])
        stmt = (
            select(Contact)
            .join(SystemContact, SystemContact.contact_id == Contact.id)
            .where(SystemContact.system_id == sid)
            .order_by(Contact.id)
        )
    else:
        stmt = select(Contact).order_by(Contact.id)
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "contacts": [
            {
                "id": c.id,
                "name": c.name,
                "email": c.email,
                "teams_upn": c.teams_upn,
            }
            for c in rows
        ],
        "count": len(rows),
    }


def _sanitize_slug(raw: str | None) -> str:
    """LLM이 전달한 영문 슬러그를 안전한 파일명 조각으로 변환.

    - 영문/숫자/하이픈만 유지
    - 한글·특수문자·공백은 하이픈으로
    - 연속 하이픈 압축, 양끝 하이픈 제거
    - 최대 50자
    - 빈 결과면 빈 문자열 반환
    """
    if not raw or not isinstance(raw, str):
        return ""
    # 소문자로 통일
    s = raw.strip().lower()
    # 영문/숫자/하이픈/언더스코어 외에는 모두 하이픈으로
    s = re.sub(r"[^a-z0-9\-_]+", "-", s)
    # 언더스코어를 하이픈으로 통일
    s = s.replace("_", "-")
    # 연속 하이픈 압축
    s = re.sub(r"-{2,}", "-", s)
    # 양끝 하이픈 제거
    s = s.strip("-")
    # 최대 50자
    if len(s) > 50:
        s = s[:50].rstrip("-")
    return s


async def _export_chat_markdown(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    """현재 챗봇 세션의 user/assistant 메시지를 Markdown으로 내보냅니다."""
    session_id = args.pop("_session_id", None)
    if not session_id:
        return {"error": "session_id가 필요합니다."}

    rows = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .where(ChatMessage.role.in_(["user", "assistant"]))
            .order_by(ChatMessage.created_at)
        )
    ).scalars().all()

    if not rows:
        return {"error": "내보낼 대화가 없습니다."}

    _KST = timezone(timedelta(hours=9))
    now_kst = datetime.now(_KST)

    lines = [
        "# Synapse-V 대화 기록",
        "",
        f"- 생성 시각 (KST): {now_kst.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 메시지 수: {len(rows)}",
        "",
        "---",
        "",
    ]
    for m in rows:
        label = "사용자" if m.role == "user" else "Synapse-V"
        ts_kst = ""
        if m.created_at:
            ts_kst = m.created_at.replace(tzinfo=timezone.utc).astimezone(_KST).strftime("%H:%M")
        lines.append(f"## {label}" + (f" ({ts_kst})" if ts_kst else ""))
        lines.append("")
        lines.append((m.content or "").strip() or "(빈 메시지)")
        lines.append("")
        lines.append("---")
        lines.append("")

    raw_slug = args.get("slug") or args.get("topic_slug")
    slug = _sanitize_slug(raw_slug)
    timestamp = now_kst.strftime("%Y%m%d-%H%M%S")
    if slug:
        filename = f"synapse-chat-{slug}-{timestamp}.md"
    else:
        filename = f"synapse-chat-{timestamp}.md"
    return {
        "markdown": "\n".join(lines),
        "filename": filename,
        "message_count": len(rows),
        "slug": slug or None,
        "export": True,
    }


# 교대 시간 정의 (KST)
_SHIFT_RANGES = {
    "morning": (6, 14),      # 06:00 ~ 14:00
    "afternoon": (14, 22),   # 14:00 ~ 22:00
    "night": (22, 30),       # 22:00 ~ 익일 06:00 (30 = 24+6)
}


def _detect_current_shift(now_kst: datetime) -> str:
    """현재 KST 시각 기준 교대 자동 판정."""
    h = now_kst.hour
    if 6 <= h < 14:
        return "morning"
    if 14 <= h < 22:
        return "afternoon"
    return "night"


def _shift_window_kst(target_date, shift: str) -> tuple[datetime, datetime]:
    """교대 타입 + 대상 날짜로 KST 시간 범위 반환 (start, end). night은 익일 06:00까지."""
    _KST = timezone(timedelta(hours=9))
    start_h, end_h = _SHIFT_RANGES[shift]
    start = datetime.combine(target_date, datetime.min.time(), tzinfo=_KST).replace(hour=start_h)
    if end_h <= 24:
        end = datetime.combine(target_date, datetime.min.time(), tzinfo=_KST).replace(hour=end_h)
    else:
        # night: end_h = 30 → 다음 날 06:00
        end = datetime.combine(target_date + timedelta(days=1), datetime.min.time(), tzinfo=_KST).replace(hour=end_h - 24)
    return start, end


_SHIFT_LABEL_KO = {"morning": "오전", "afternoon": "오후", "night": "야간"}
_SEVERITY_LABEL_KO = {"critical": "심각", "warning": "경고", "info": "정보"}


async def _generate_shift_handoff(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    """인수인계 보고서 생성 — 지정된 교대 시간대의 알림·LLM 분석을 markdown으로 정리."""
    from datetime import date as _date

    _KST = timezone(timedelta(hours=9))
    now_kst = datetime.now(_KST)

    # 입력 파싱
    raw_shift = args.get("shift")
    shift = raw_shift if raw_shift in _SHIFT_RANGES else _detect_current_shift(now_kst)

    raw_date = args.get("target_date")
    if raw_date:
        try:
            target_date = _date.fromisoformat(str(raw_date))
        except (ValueError, TypeError):
            return {"error": f"target_date 형식 오류 (YYYY-MM-DD 필요): {raw_date}"}
    else:
        # night 교대인데 현재 시각이 새벽(0~6시)이면 전날 night 교대로 간주
        if shift == "night" and now_kst.hour < 6:
            target_date = (now_kst - timedelta(days=1)).date()
        else:
            target_date = now_kst.date()

    start_kst, end_kst = _shift_window_kst(target_date, shift)
    # DB는 naive UTC 저장 → UTC로 변환
    start_utc = start_kst.astimezone(timezone.utc).replace(tzinfo=None)
    end_utc = end_kst.astimezone(timezone.utc).replace(tzinfo=None)

    # 1) 발생 알림 (해당 기간 내 created)
    alert_rows = (
        await db.execute(
            select(AlertHistory, System)
            .outerjoin(System, AlertHistory.system_id == System.id)
            .where(AlertHistory.created_at >= start_utc)
            .where(AlertHistory.created_at < end_utc)
            .order_by(AlertHistory.created_at.desc())
            .limit(200)
        )
    ).all()

    # 2) 진행 중 이상 (resolved_at IS NULL, 최근 24시간)
    last_24h_utc = now_kst.astimezone(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
    open_rows = (
        await db.execute(
            select(AlertHistory, System)
            .outerjoin(System, AlertHistory.system_id == System.id)
            .where(AlertHistory.resolved_at.is_(None))
            .where(AlertHistory.created_at >= last_24h_utc)
            .order_by(AlertHistory.created_at.desc())
            .limit(50)
        )
    ).all()

    # 3) LLM 로그 분석 (해당 기간, warning/critical만, 제외되지 않은 것)
    log_rows = (
        await db.execute(
            select(LogAnalysisHistory, System)
            .outerjoin(System, LogAnalysisHistory.system_id == System.id)
            .where(LogAnalysisHistory.created_at >= start_utc)
            .where(LogAnalysisHistory.created_at < end_utc)
            .where(LogAnalysisHistory.severity.in_(["warning", "critical"]))
            .where(LogAnalysisHistory.excluded.is_(False))
            .order_by(LogAnalysisHistory.created_at.desc())
            .limit(50)
        )
    ).all()

    # 통계
    metric_critical = sum(1 for a, _ in alert_rows if a.severity == "critical" and a.alert_type == "metric")
    metric_warning = sum(1 for a, _ in alert_rows if a.severity == "warning" and a.alert_type == "metric")
    log_critical = sum(1 for la, _ in log_rows if la.severity == "critical")
    log_warning = sum(1 for la, _ in log_rows if la.severity == "warning")

    # ── markdown 빌드 ──
    shift_label = _SHIFT_LABEL_KO[shift]
    lines: list[str] = [
        f"# 인수인계 보고서 — {target_date.isoformat()} ({shift_label})",
        "",
        f"- 교대 구간 (KST): {start_kst.strftime('%H:%M')} ~ {end_kst.strftime('%m-%d %H:%M')}",
        f"- 생성 시각 (KST): {now_kst.strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## 요약",
        "",
        f"- 메트릭 알림: 심각 {metric_critical}건 / 경고 {metric_warning}건",
        f"- LLM 분석: 심각 {log_critical}건 / 경고 {log_warning}건",
        f"- 현재 진행 중 (미해결): {len(open_rows)}건",
        "",
    ]

    # 발생 알림 표
    lines.append("## 발생 알림 (해당 교대)")
    lines.append("")
    if alert_rows:
        lines.append("| 시각(KST) | 시스템 | 알림 | 심각도 | 인스턴스 | 상태 |")
        lines.append("|---|---|---|---|---|---|")
        for a, s in alert_rows:
            ts = a.created_at.replace(tzinfo=timezone.utc).astimezone(_KST).strftime("%H:%M") if a.created_at else "-"
            sys_name = (s.display_name if s else None) or (s.system_name if s else None) or "-"
            sev_ko = _SEVERITY_LABEL_KO.get(a.severity, a.severity)
            inst = a.instance_role or "-"
            status = "복구" if a.resolved_at else ("확인" if a.acknowledged else "미처리")
            title = (a.title or a.alertname or "-").replace("|", "·")[:60]
            lines.append(f"| {ts} | {sys_name} | {title} | {sev_ko} | {inst} | {status} |")
    else:
        lines.append("- 해당 교대 발생 알림 없음")
    lines.append("")

    # 현재 진행 중
    lines.append("## 현재 진행 중 이상 (미해결, 최근 24h)")
    lines.append("")
    if open_rows:
        for a, s in open_rows:
            ts = a.created_at.replace(tzinfo=timezone.utc).astimezone(_KST).strftime("%m-%d %H:%M") if a.created_at else "-"
            sys_name = (s.display_name if s else None) or (s.system_name if s else None) or "-"
            sev_ko = _SEVERITY_LABEL_KO.get(a.severity, a.severity)
            title = (a.title or a.alertname or "-")[:80]
            inst = a.instance_role or "-"
            lines.append(f"- **[{sev_ko}]** `{sys_name}` ({inst}) — {title} _(발생 {ts})_")
    else:
        lines.append("- 진행 중인 미해결 이상 없음")
    lines.append("")

    # LLM 분석 요약
    lines.append("## LLM 로그 분석 (warning/critical)")
    lines.append("")
    if log_rows:
        for la, s in log_rows:
            ts = la.created_at.replace(tzinfo=timezone.utc).astimezone(_KST).strftime("%H:%M") if la.created_at else "-"
            sys_name = (s.display_name if s else None) or (s.system_name if s else None) or "-"
            sev_ko = _SEVERITY_LABEL_KO.get(la.severity, la.severity)
            inst = la.instance_role or "-"
            lines.append(f"### [{sev_ko}] {sys_name} ({inst}) _{ts}_")
            lines.append("")
            if la.root_cause:
                lines.append(f"- **추정 원인**: {la.root_cause.strip()[:300]}")
            if la.recommendation:
                lines.append(f"- **즉시 조치**: {la.recommendation.strip()[:300]}")
            lines.append("")
    else:
        lines.append("- 해당 교대 LLM 경고/심각 분석 없음")
    lines.append("")

    # 인수인계 메모 (LLM/사용자가 추가 작성할 자리)
    lines.append("## 특이사항 / 권고사항")
    lines.append("")
    lines.append("- (담당자 추가 작성)")
    lines.append("")

    # 파일명 — slug 우선, 없으면 shift+date
    raw_slug = args.get("slug")
    slug = _sanitize_slug(raw_slug)
    timestamp = now_kst.strftime("%Y%m%d-%H%M%S")
    if slug:
        filename = f"shift-handoff-{slug}-{timestamp}.md"
    else:
        filename = f"shift-handoff-{shift}-{target_date.isoformat()}.md"

    return {
        "markdown": "\n".join(lines),
        "filename": filename,
        "shift": shift,
        "target_date": target_date.isoformat(),
        "alert_count": len(alert_rows),
        "open_count": len(open_rows),
        "log_analysis_count": len(log_rows),
        "slug": slug or None,
        "export": True,
    }


async def _save_guide(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    """대화에서 추출한 운영 가이드/해결책을 knowledge_guides에 저장.

    LLM이 대화 컨텍스트에서 title/content/system_id/category/tags를 추출하여 전달.
    저장 후 log-analyzer를 통해 Qdrant에 Hybrid 임베딩.
    """
    title = (args.get("title") or "").strip()
    content = (args.get("content") or "").strip()

    if not title:
        return {"error": "title이 필요합니다."}
    if not content:
        return {"error": "content가 필요합니다."}
    if len(title) > 255:
        return {"error": f"title이 너무 깁니다 ({len(title)}/255)"}
    if len(content) < 30:
        return {"error": "content가 너무 짧습니다 (최소 30자). 가이드 본문을 더 풍부하게 작성하세요."}
    if len(content) > 50000:
        return {"error": f"content가 너무 깁니다 ({len(content):,}/50,000자). 50,000자 이내로 줄여주세요."}

    # system_id 검증 (선택값)
    raw_system_id = args.get("system_id")
    system_id: int | None = None
    if raw_system_id is not None and raw_system_id != "":
        try:
            system_id = int(raw_system_id)
        except (ValueError, TypeError):
            return {"error": f"system_id가 정수가 아닙니다: {raw_system_id!r}"}
        # 존재 검증
        sys_row = (await db.execute(select(System).where(System.id == system_id))).scalar_one_or_none()
        if sys_row is None:
            return {"error": f"system_id={system_id} 에 해당하는 시스템이 없습니다."}

    # category 정리 (선택)
    category = args.get("category")
    if category is not None:
        category = str(category).strip()[:50] or None

    # tags 정리 (선택, 배열)
    raw_tags = args.get("tags") or []
    if isinstance(raw_tags, str):
        raw_tags = [t.strip() for t in raw_tags.split(",") if t.strip()]
    if not isinstance(raw_tags, list):
        raw_tags = []
    tags: list[str] = []
    for t in raw_tags:
        s = str(t).strip()[:50]
        if s and s not in tags:
            tags.append(s)
        if len(tags) >= 10:
            break

    # INSERT (flush로 guide.id 확보, 아직 commit 전)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    guide = KnowledgeGuide(
        system_id=system_id,
        title=title,
        content=content,
        category=category,
        tags=tags,
        created_by=None,  # 챗봇 자동 등록 (사용자 매핑은 향후 확장)
        is_active=True,
        created_at=now_utc,
        updated_at=now_utc,
    )
    db.add(guide)
    await db.flush()  # guide.id 확보
    guide_id = str(guide.id)

    # Qdrant 인덱싱 (best-effort — 실패해도 DB 저장은 진행. 명시적 try/except로 부정합 방지)
    indexing_dispatched = False
    indexing_error: str | None = None
    try:
        from services.qdrant_guides import index_guide
        await index_guide(
            guide_id=guide_id,
            title=title,
            content=content,
            system_id=system_id,
            category=category,
            tags=tags,
            image_count=0,
        )
        indexing_dispatched = True
    except Exception as exc:  # noqa: BLE001
        # log-analyzer 호출 자체는 내부에서 예외 swallow하지만, 방어적으로 처리
        # (import 실패, 네트워크 즉시 차단, 타입 에러 등 예외 케이스 보호)
        indexing_error = str(exc)[:200]

    # DB 커밋 — Qdrant 호출 성공/실패 무관하게 진행 (indexing_error로 사용자에게 알림)
    await db.commit()

    # 시스템명 조회 (응답용)
    system_display: str | None = None
    if system_id is not None:
        sys_row = (await db.execute(select(System).where(System.id == system_id))).scalar_one_or_none()
        if sys_row is not None:
            system_display = sys_row.display_name or sys_row.system_name

    message_parts = [f"가이드 '{title}'을 등록했습니다."]
    if system_display:
        message_parts.append(f"(시스템: {system_display})")
    else:
        message_parts.append("(전체 공용)")
    if not indexing_dispatched:
        message_parts.append(f"— 단, Qdrant 인덱싱 호출 실패: {indexing_error}. log-analyzer 상태를 확인하세요.")

    return {
        "guide_id": guide_id,
        "title": title,
        "system_id": system_id,
        "system_display": system_display,
        "category": category,
        "tags": tags,
        "content_length": len(content),
        # indexing_dispatched: log-analyzer로 호출이 성공적으로 완료되었는지 (예외 없이 반환됨)
        # 실제 임베딩이 Qdrant에 저장되었는지는 log-analyzer 응답을 받지 않으므로 알 수 없음
        # — best-effort 의미를 분명히 하기 위해 'attempted'가 아닌 'dispatched' 사용
        "indexing_dispatched": indexing_dispatched,
        "indexing_error": indexing_error,
        "message": " ".join(message_parts),
    }


def _format_kst(dt: datetime | None) -> str | None:
    """naive UTC → KST 'YYYY-MM-DD HH:MM' 포맷."""
    if dt is None:
        return None
    _KST = timezone(timedelta(hours=9))
    return dt.replace(tzinfo=timezone.utc).astimezone(_KST).strftime("%Y-%m-%d %H:%M")


async def _get_incident_context(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    """인시던트 종합 컨텍스트 반환.

    - 기본 정보 (title/severity/status/detected_at 등)
    - 시스템 정보 (system_name/display_name)
    - 연결 알림 최근 20건
    - 연결 LLM 분석 최근 10건 (severity warning/critical)
    - 타임라인 이벤트 최근 30건
    - MTTA/MTTR (분 단위)
    - 진행률 (%)
    - 다음 권장 액션 (status에 따른 가이드)
    """
    raw_id = args.get("incident_id")
    if raw_id is None or raw_id == "":
        return {"error": "incident_id가 필요합니다."}
    try:
        incident_id = int(raw_id)
    except (ValueError, TypeError):
        return {"error": f"incident_id가 정수가 아닙니다: {raw_id!r}"}

    # 인시던트 + 시스템 join
    row = (
        await db.execute(
            select(Incident, System)
            .outerjoin(System, Incident.system_id == System.id)
            .where(Incident.id == incident_id)
        )
    ).first()
    if row is None:
        return {"error": f"인시던트 #{incident_id}를 찾을 수 없습니다."}

    inc, sys_obj = row

    # MTTA/MTTR 계산
    def _minutes_diff(later: datetime | None, earlier: datetime | None) -> int | None:
        if not later or not earlier:
            return None
        return int((later - earlier).total_seconds() / 60)

    mtta = _minutes_diff(inc.acknowledged_at, inc.detected_at)
    mttr = _minutes_diff(inc.resolved_at, inc.detected_at)

    # 연결된 알림 (최근 20건)
    alert_rows = (
        await db.execute(
            select(AlertHistory)
            .where(AlertHistory.incident_id == incident_id)
            .order_by(AlertHistory.created_at.desc())
            .limit(20)
        )
    ).scalars().all()

    # 연결된 LLM 분석 (warning/critical만, 최근 10건)
    log_rows = (
        await db.execute(
            select(LogAnalysisHistory)
            .where(LogAnalysisHistory.incident_id == incident_id)
            .where(LogAnalysisHistory.severity.in_(["warning", "critical"]))
            .order_by(LogAnalysisHistory.created_at.desc())
            .limit(10)
        )
    ).scalars().all()

    # 타임라인 (최근 30건, 시간순 desc — LLM이 최신부터 읽기 좋게)
    tl_rows = (
        await db.execute(
            select(IncidentTimeline)
            .where(IncidentTimeline.incident_id == incident_id)
            .order_by(IncidentTimeline.created_at.desc())
            .limit(30)
        )
    ).scalars().all()

    # 다음 권장 액션 — 진행 단계별 가이드
    status = inc.status or "open"
    next_action = INCIDENT_NEXT_ACTION.get(status, "상태를 확인 후 다음 단계 진행.")

    return {
        "incident": {
            "id": inc.id,
            "title": inc.title,
            "severity": inc.severity,
            "status": status,
            "status_ko": INCIDENT_STATUS_KO.get(status, status),
            "progress_pct": INCIDENT_PROGRESS.get(status, 0),
            "system_id": inc.system_id,
            "system_name": sys_obj.system_name if sys_obj else None,
            "system_display": (sys_obj.display_name or sys_obj.system_name) if sys_obj else None,
            "detected_at_kst": _format_kst(inc.detected_at),
            "acknowledged_at_kst": _format_kst(inc.acknowledged_at),
            "resolved_at_kst": _format_kst(inc.resolved_at),
            "closed_at_kst": _format_kst(inc.closed_at),
            "mtta_minutes": mtta,
            "mttr_minutes": mttr,
            "alert_count": inc.alert_count,
            "root_cause": inc.root_cause,
            "resolution": inc.resolution,
            "postmortem_exists": bool(inc.postmortem),
            "source": inc.source,
        },
        "next_action": next_action,
        "alerts": [
            {
                "id": a.id,
                "alertname": a.alertname,
                "title": a.title,
                "severity": a.severity,
                "alert_type": a.alert_type,
                "instance_role": a.instance_role,
                "created_at_kst": _format_kst(a.created_at),
                "resolved_at_kst": _format_kst(a.resolved_at),
                "acknowledged": a.acknowledged,
            }
            for a in alert_rows
        ],
        "log_analyses": [
            {
                "id": la.id,
                "severity": la.severity,
                "instance_role": la.instance_role,
                "root_cause": (la.root_cause or "")[:200],
                "recommendation": (la.recommendation or "")[:200],
                "created_at_kst": _format_kst(la.created_at),
            }
            for la in log_rows
        ],
        "timeline": [
            {
                "event_type": t.event_type,
                "description": (t.description or "")[:200],
                "actor": t.actor_name,
                "at_kst": _format_kst(t.created_at),
            }
            for t in tl_rows
        ],
        "stats": {
            "alert_count": len(alert_rows),
            "log_analysis_count": len(log_rows),
            "timeline_count": len(tl_rows),
        },
    }


async def _create_feedback(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    """인시던트 피드백 등록 — 챗봇 경유 alert_feedback INSERT.

    핸들러(POST /api/v1/incidents/{id}/feedback)와 동일한 비즈니스 규칙 적용:
    - incident가 resolved/closed 상태여야 함
    - approver는 활성 User에 매핑된 Contact여야 함
    - 첨부파일은 처리하지 않음 (텍스트만)
    """
    # incident_id 검증
    raw_id = args.get("incident_id")
    if raw_id is None or raw_id == "":
        return {"error": "incident_id가 필요합니다."}
    try:
        incident_id = int(raw_id)
    except (ValueError, TypeError):
        return {"error": f"incident_id가 정수가 아닙니다: {raw_id!r}"}

    # 필수 텍스트
    error_type = (args.get("error_type") or "").strip()
    solution = (args.get("solution") or "").strip()
    if not error_type:
        return {"error": "error_type이 필요합니다 (예: '메모리 누수', 'DB 연결 풀 고갈')."}
    if len(error_type) > 100:
        return {"error": f"error_type이 너무 깁니다 ({len(error_type)}/100자)."}
    if not solution:
        return {"error": "solution이 필요합니다 (해결 방법 본문)."}
    if len(solution) < 30:
        return {"error": "solution이 너무 짧습니다 (최소 30자). 해결 절차를 더 구체적으로 작성하세요."}
    if len(solution) > 10000:
        return {"error": f"solution이 너무 깁니다 ({len(solution):,}/10,000자)."}

    # resolver: 미지정 시 default
    resolver = (args.get("resolver") or "").strip() or "챗봇 자동 등록"
    if len(resolver) > 200:
        return {"error": f"resolver가 너무 깁니다 ({len(resolver)}/200자)."}

    # 인시던트 + status 검증
    incident = await db.get(Incident, incident_id)
    if not incident:
        return {"error": f"인시던트 #{incident_id}를 찾을 수 없습니다."}
    if incident.status not in ("resolved", "closed"):
        return {
            "error": (
                f"인시던트 #{incident_id}의 상태가 '{incident.status}'입니다. "
                f"'resolved' 또는 'closed' 상태에서만 피드백을 등록할 수 있습니다."
            )
        }

    # approver 결정 — Contact + User 조인으로 name 확보
    approver_id_raw = args.get("approver_contact_id")
    approver_contact: Contact | None = None
    approver_user: User | None = None

    if approver_id_raw is not None and approver_id_raw != "":
        try:
            approver_id = int(approver_id_raw)
        except (ValueError, TypeError):
            return {"error": f"approver_contact_id가 정수가 아닙니다: {approver_id_raw!r}"}
        row = (
            await db.execute(
                select(Contact, User)
                .join(User, Contact.user_id == User.id)
                .where(Contact.id == approver_id)
            )
        ).first()
        if not row:
            return {"error": f"approver_contact_id={approver_id} 에 해당하는 담당자가 없습니다."}
        approver_contact, approver_user = row
    else:
        # 미지정 — 시스템의 primary contact 자동 선택
        if incident.system_id is None:
            return {
                "error": (
                    "approver_contact_id가 필요합니다. 인시던트가 시스템에 연결되어 있지 않아 "
                    "primary contact를 자동 선택할 수 없습니다. 명시적으로 승인자를 지정하세요."
                )
            }
        row = (
            await db.execute(
                select(Contact, User)
                .join(User, Contact.user_id == User.id)
                .join(SystemContact, SystemContact.contact_id == Contact.id)
                .where(SystemContact.system_id == incident.system_id)
                .where(SystemContact.role == "primary")
                .where(User.is_active.is_(True))
                .order_by(Contact.id)
                .limit(1)
            )
        ).first()
        if not row:
            return {
                "error": (
                    f"시스템 #{incident.system_id}에 primary 담당자가 없어 자동 선택 실패. "
                    f"approver_contact_id를 명시하거나 admin_list_contacts 도구로 담당자를 먼저 조회하세요."
                )
            }
        approver_contact, approver_user = row

    # 활성 User 검증
    if not approver_user.is_active:
        return {"error": f"승인자 '{approver_user.name}'(contact_id={approver_contact.id})의 사용자 계정이 비활성 상태입니다."}

    # INSERT
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    feedback = AlertFeedback(
        incident_id=incident_id,
        error_type=error_type,
        solution=solution,
        resolver=resolver,
        status="pending",
        approver_id=approver_contact.id,
        created_at=now_utc,
    )
    db.add(feedback)
    await db.flush()
    feedback_id = feedback.id
    await db.commit()

    return {
        "feedback_id": feedback_id,
        "incident_id": incident_id,
        "incident_title": incident.title,
        "incident_status": incident.status,
        "error_type": error_type,
        "solution_length": len(solution),
        "resolver": resolver,
        "approver_id": approver_contact.id,
        "approver_name": approver_user.name,
        "status": "pending",
        "message": (
            f"피드백 #{feedback_id}이 인시던트 #{incident_id} '{incident.title}'에 등록되었습니다. "
            f"승인자: {approver_user.name}. 승인 후 Qdrant 임베딩되어 RAG 검색에 활용됩니다."
        ),
    }


async def execute(db: AsyncSession, name: str, args: dict[str, Any]) -> dict[str, Any]:
    try:
        if name == "admin_list_systems":
            return await _list_systems(db, args)
        if name == "admin_search_alert_history":
            return await _search_alert_history(db, args)
        if name == "admin_list_contacts":
            return await _list_contacts(db, args)
        if name == "export_chat_markdown":
            return await _export_chat_markdown(db, args)
        if name == "generate_shift_handoff":
            return await _generate_shift_handoff(db, args)
        if name == "admin_save_guide":
            return await _save_guide(db, args)
        if name == "admin_get_incident_context":
            return await _get_incident_context(db, args)
        if name == "admin_create_feedback":
            return await _create_feedback(db, args)
        return {"error": f"unknown admin tool: {name}"}
    except Exception as e:  # noqa: BLE001
        return {"error": f"admin 도구 실패: {str(e)[:200]}"}
