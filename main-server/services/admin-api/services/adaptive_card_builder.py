"""
Teams Adaptive Card JSON 빌더

notification.py(TeamsNotifier)에서 분리된 순수 빌더 함수들.
Webhook 전송이나 IO를 수행하지 않으며 dict만 반환한다.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

_KST = timezone(timedelta(hours=9))

from .llm_client import LLM_TYPE as _LLM_TYPE

# 피드백 React 페이지 URL — Teams 카드 버튼이 이 주소로 연결됨
_FRONTEND_EXTERNAL_URL = os.getenv(
    "FRONTEND_EXTERNAL_URL", "http://localhost:3001"
).rstrip("/")

# Phase 4b: 이상 분류별 스타일
_ANOMALY_STYLES = {
    "new":       {"label": "신규 이상",  "color": "Attention"},
    "recurring": {"label": "반복 이상",  "color": "Warning"},
    "related":   {"label": "유사 이상",  "color": "Warning"},
    "duplicate": {"label": "중복 이상",  "color": "Default"},
}


def build_mention_text(contacts: list[dict]) -> str:
    """Teams @mention 텍스트 생성"""
    return " ".join(f"<at>{c['name']}</at>" for c in contacts if c.get("teams_upn"))


def build_entities(contacts: list[dict]) -> list[dict]:
    """Teams Adaptive Card msteams.entities 블록 생성"""
    return [
        {
            "type": "mention",
            "text": f"<at>{c['name']}</at>",
            "mentioned": {"id": c["teams_upn"], "name": c["name"]},
        }
        for c in contacts if c.get("teams_upn")
    ]


def build_vector_context_block(
    anomaly_type: str,
    similarity_score: float,
    has_solution: bool,
    similar_incidents: list[dict],
) -> dict:
    """T4.15 — Adaptive Card에 삽입할 유사 이력 블록 생성"""
    style = _ANOMALY_STYLES.get(anomaly_type, _ANOMALY_STYLES["new"])
    label = style["label"]
    color = style["color"]

    if not similar_incidents:
        body_text = "유사 이력 없음 (신규 패턴)"
    else:
        lines = []
        for i, inc in enumerate(similar_incidents[:3], 1):
            sol_mark = " (해결책 있음)" if inc.get("resolution") else ""
            lines.append(
                f"[이력{i}] {inc['score']:.0%} - "
                f"{inc.get('log_pattern', '')[:80]}...{sol_mark}"
            )
            if inc.get("resolution"):
                lines.append(f"  해결: {inc['resolution'][:150]}")
        body_text = "\n".join(lines)

    return {
        "type":  "TextBlock",
        "text":  f"**{label}** (유사도 {similarity_score:.0%})\n\n{body_text}",
        "wrap":  True,
        "color": color,
    }


def _build_base_card(
    alert_type_label: str,
    title: str,
    severity_color: str,
    facts: list[dict],
    body_extra: list[dict],
    actions: list[dict],
    entities: list[dict] | None = None,
    summary: str = "",
) -> dict:
    """모든 알림 카드의 공통 구조 빌더 — 알림 유형 행을 FactSet 첫 행에 자동 삽입"""
    full_facts = [{"title": "알림 유형", "value": alert_type_label}] + facts
    body: list[dict] = [
        {
            "type": "TextBlock",
            "text": title,
            "weight": "Bolder",
            "size": "Medium",
            "color": severity_color,
        },
        {"type": "FactSet", "facts": full_facts},
        *body_extra,
    ]
    content: dict = {
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "type": "AdaptiveCard",
        "version": "1.4",
        "body": body,
        "msteams": {"entities": entities or []},
    }
    if actions:
        content["actions"] = actions
    return {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "summary": summary,
            "content": content,
        }],
    }


def build_metric_alert_card(
    alert: dict,
    system_display_name: str,
    contacts: list[dict],
    anomaly_type: Optional[str] = None,
    similarity_score: Optional[float] = None,
    has_solution: Optional[bool] = None,
    similar_incidents: Optional[list[dict]] = None,
    point_id: Optional[str] = None,
    alert_history_id: Optional[int] = None,
    incident_id: Optional[int] = None,
) -> dict:
    """메트릭 알림 Adaptive Card body dict 생성"""
    severity = alert["labels"].get("severity", "warning")
    system_name = alert["labels"].get("system_name", "unknown")
    instance_role = alert["labels"].get("instance_role", "")
    host = alert["labels"].get("host", "")
    alert_name = alert["labels"].get("alertname", "")

    icon = "🔴" if severity == "critical" else "🟡"
    mention_text = build_mention_text(contacts)
    title = f"{icon} [{severity.upper()}] {alert['annotations'].get('summary', alert_name)}"

    facts = [
        {"title": "시스템", "value": f"{system_display_name} ({system_name})"},
        {"title": "서버", "value": f"{instance_role} ({host})" if instance_role else host},
        {"title": "심각도", "value": severity.upper()},
        {"title": "내용", "value": alert["annotations"].get("description", "-")},
        {"title": "발생 시각", "value": datetime.now(_KST).strftime("%Y-%m-%d %H:%M:%S")},
    ]

    body_extra: list[dict] = []
    if anomaly_type and similarity_score is not None:
        body_extra.append(build_vector_context_block(
            anomaly_type=anomaly_type,
            similarity_score=similarity_score or 0.0,
            has_solution=bool(has_solution),
            similar_incidents=[
                {
                    "score":       inc.get("score", 0.0),
                    "log_pattern": (
                        f"{inc.get('alertname', '')} "
                        f"{inc.get('metric_name', '')} "
                        f"{inc.get('severity', '')}"
                    ),
                    "resolution":  inc.get("resolution", ""),
                }
                for inc in (similar_incidents or [])
            ],
        ))
    body_extra.append({
        "type": "TextBlock",
        "text": f"담당자: {mention_text}" if mention_text else "담당자 미지정",
        "wrap": True,
    })

    actions: list[dict] = [
        *([{
            "type": "Action.OpenUrl",
            "title": "인시던트 보기",
            "url": f"{_FRONTEND_EXTERNAL_URL}/incidents/{incident_id}",
        }] if incident_id else []),
    ]

    return _build_base_card(
        alert_type_label="메트릭 이상 감지 · Alertmanager",
        title=title,
        severity_color="Attention" if severity == "critical" else "Warning",
        facts=facts,
        body_extra=body_extra,
        actions=actions,
        entities=build_entities(contacts),
        summary=title,
    )


def build_log_analysis_card(
    system_display_name: str,
    system_name: str,
    instance_role: str,
    analysis: dict,
    log_sample: str,
    contacts: list[dict],
    anomaly_type: Optional[str] = None,
    similarity_score: Optional[float] = None,
    has_solution: Optional[bool] = None,
    similar_incidents: Optional[list[dict]] = None,
    point_id: Optional[str] = None,
    alert_history_id: Optional[int] = None,
    incident_id: Optional[int] = None,
) -> dict:
    """LLM 로그 분석 알림 Adaptive Card body dict 생성"""
    severity = analysis.get("severity", "warning")
    icon = "🔴" if severity == "critical" else ("🟡" if severity == "warning" else "🔵")
    mention_text = build_mention_text(contacts)
    title = f"{icon} [{_LLM_TYPE} 분석] {analysis.get('summary', '로그 이상 감지')}"

    is_duplicate = anomaly_type == "duplicate"
    facts = [
        {"title": "시스템", "value": f"{system_display_name} / {instance_role}"},
        {"title": "심각도", "value": severity.upper()},
    ]
    if is_duplicate:
        facts.append({"title": "중복 여부", "value": "⚠️ 중복 알림 (기존 분석 결과 표시)"})
    facts.extend([
        {"title": "원인 추정", "value": analysis.get("root_cause") or "-"},
        {"title": "권장 조치", "value": analysis.get("recommendation") or "-"},
        {"title": "분석 시각", "value": datetime.now(_KST).strftime("%Y-%m-%d %H:%M:%S")},
    ])

    body_extra: list[dict] = [
        {
            "type": "TextBlock",
            "text": f"**원본 로그 샘플:**\n```\n{log_sample[:400]}\n```",
            "wrap": True,
            "fontType": "Monospace",
        },
    ]
    if anomaly_type and similarity_score is not None:
        body_extra.append(build_vector_context_block(
            anomaly_type=anomaly_type,
            similarity_score=similarity_score,
            has_solution=bool(has_solution),
            similar_incidents=similar_incidents or [],
        ))
    if mention_text:
        body_extra.append({"type": "TextBlock", "text": f"담당자: {mention_text}", "wrap": True})

    actions: list[dict] = [
        *([{
            "type": "Action.OpenUrl",
            "title": "인시던트 보기",
            "url": f"{_FRONTEND_EXTERNAL_URL}/incidents/{incident_id}",
        }] if incident_id else []),
    ]

    severity_color = (
        "Attention" if severity == "critical"
        else ("Warning" if severity == "warning" else "Default")
    )

    return _build_base_card(
        alert_type_label="로그 이상 분석 · 5분주기",
        title=title,
        severity_color=severity_color,
        facts=facts,
        body_extra=body_extra,
        actions=actions,
        entities=build_entities(contacts),
        summary=f"{title} — {system_display_name}",
    )


def build_recovery_card(
    system_display_name: str,
    system_name: str,
    alertname: str,
    instance_role: str,
    host: str,
    contacts: list[dict],
) -> dict:
    """정상 복구 알림 Adaptive Card body dict 생성"""
    mention_text = build_mention_text(contacts)
    title = f"✅ [정상 복구] {alertname}"

    facts = [
        {"title": "시스템",   "value": f"{system_display_name} ({system_name})"},
        {"title": "서버",     "value": f"{instance_role} ({host})" if instance_role else host},
        {"title": "복구 시각", "value": datetime.now(_KST).strftime("%Y-%m-%d %H:%M:%S")},
    ]

    body_extra: list[dict] = []
    if mention_text:
        body_extra.append({"type": "TextBlock", "text": f"담당자: {mention_text}", "wrap": True})

    return _build_base_card(
        alert_type_label="메트릭 복구 · Alertmanager",
        title=title,
        severity_color="Good",
        facts=facts,
        body_extra=body_extra,
        actions=[],
        entities=build_entities(contacts),
        summary=f"{title} — {system_display_name}",
    )


def build_notification_card(
    system_display_name: str,
    instance_role: str,
    log_sample: str,
    notification_reason: str,
    contacts: list[dict],
    force_real_url: str,
) -> dict:
    """알림성 로그 최초 감지 Teams 카드 (최초 1회만 발송)."""
    mention_text = build_mention_text(contacts)
    title = f"[알림성 로그 감지] {system_display_name}"

    facts = [
        {"title": "시스템",   "value": system_display_name},
        {"title": "서버 역할", "value": instance_role or "-"},
    ]

    body_extra = [
        {
            "type": "TextBlock",
            "text": "**로그 내용**",
            "weight": "Bolder",
            "spacing": "Medium",
        },
        {
            "type": "TextBlock",
            "text": (log_sample[:500] if log_sample else "-"),
            "wrap": True,
            "fontType": "Monospace",
            "size": "Small",
        },
        {
            "type": "TextBlock",
            "text": "**알림성 판단 근거**",
            "weight": "Bolder",
            "spacing": "Medium",
        },
        {
            "type": "TextBlock",
            "text": (notification_reason or "-"),
            "wrap": True,
        },
        {
            "type": "TextBlock",
            "text": "이후 동일 패턴은 알림이 발송되지 않습니다. 실제 에러라고 판단되면 아래 버튼을 클릭하세요.",
            "wrap": True,
            "spacing": "Medium",
            "color": "Warning",
        },
    ]

    if mention_text:
        body_extra.append({"type": "TextBlock", "text": f"담당자: {mention_text}", "wrap": True})

    actions = [
        {
            "type": "Action.OpenUrl",
            "title": "실제 에러로 분석 강제",
            "url": force_real_url,
        }
    ]

    return _build_base_card(
        alert_type_label="알림성 로그 감지",
        title=title,
        severity_color="Default",
        facts=facts,
        body_extra=body_extra,
        actions=actions,
        entities=build_entities(contacts),
        summary=f"{title} / {instance_role}",
    )
