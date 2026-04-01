import os
import ssl

import httpx
from datetime import datetime
from typing import Optional

# macOS/Linux 시스템 CA 번들 — httpx 기본 certifi 대신 사용
_SSL_CAFILE = os.getenv("SSL_CERT_FILE", None)
if _SSL_CAFILE is None:
    _homebrew_ca = "/opt/homebrew/etc/openssl@3/cert.pem"
    _SSL_CAFILE = _homebrew_ca if os.path.exists(_homebrew_ca) else None

# httpx verify= 파라미터: CA 파일 경로(str) 또는 True(기본값)
_SSL_CONTEXT = _SSL_CAFILE if _SSL_CAFILE else True

# 피드백 폼 URL — Teams 카드 버튼이 이 주소로 연결됨 (브라우저에서 열려야 하므로 외부 접근 가능한 주소)
_ADMIN_API_EXTERNAL_URL = os.getenv(
    "ADMIN_API_EXTERNAL_URL", "http://localhost:8080"
).rstrip("/")

# Phase 4b: 이상 분류별 스타일
_ANOMALY_STYLES = {
    "new":       {"label": "신규 이상",  "color": "Attention"},
    "recurring": {"label": "반복 이상",  "color": "Warning"},
    "related":   {"label": "유사 이상",  "color": "Warning"},
    "duplicate": {"label": "중복 이상",  "color": "Default"},
}


class TeamsNotifier:
    """Microsoft Teams Incoming Webhook 발송 서비스"""

    def __init__(self, default_webhook_url: str):
        self.default_webhook_url = default_webhook_url

    def _build_vector_context_block(
        self,
        anomaly_type: str,
        similarity_score: float,
        has_solution: bool,
        similar_incidents: list[dict],
    ) -> dict:
        """
        T4.15 — Teams Adaptive Card에 삽입할 유사 이력 블록 생성
        """
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

    async def send_metric_alert(
        self,
        webhook_url: str,
        alert: dict,
        system_display_name: str,
        contacts: list[dict],
        anomaly_type: Optional[str] = None,
        similarity_score: Optional[float] = None,
        has_solution: Optional[bool] = None,
        similar_incidents: Optional[list[dict]] = None,
        point_id: Optional[str] = None,
    ) -> bool:
        """Adaptive Card 형식으로 메트릭 알림 발송"""

        severity = alert["labels"].get("severity", "warning")
        system_name = alert["labels"].get("system_name", "unknown")
        instance_role = alert["labels"].get("instance_role", "")
        host = alert["labels"].get("host", "")
        alert_name = alert["labels"].get("alertname", "")

        theme_color = "FF0000" if severity == "critical" else "FF8C00"
        icon = "🔴" if severity == "critical" else "🟡"

        mention_text = " ".join([
            f"<at>{c['name']}</at>"
            for c in contacts if c.get("teams_upn")
        ])

        body = {
            "type": "message",
            "attachments": [{
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "msteams": {"width": "Full"},
                    "body": [
                        {
                            "type": "TextBlock",
                            "text": f"{icon} [{severity.upper()}] {alert['annotations'].get('summary', alert_name)}",
                            "weight": "Bolder",
                            "size": "Medium",
                            "color": "Attention" if severity == "critical" else "Warning"
                        },
                        {
                            "type": "FactSet",
                            "facts": [
                                {"title": "시스템", "value": f"{system_display_name} ({system_name})"},
                                {"title": "서버", "value": f"{instance_role} ({host})" if instance_role else host},
                                {"title": "심각도", "value": severity.upper()},
                                {"title": "내용", "value": alert["annotations"].get("description", "-")},
                                {"title": "발생 시각", "value": datetime.now().strftime("%Y-%m-%d %H:%M:%S")},
                            ]
                        },
                        *([self._build_vector_context_block(
                            anomaly_type=anomaly_type,
                            similarity_score=similarity_score or 0.0,
                            has_solution=bool(has_solution),
                            similar_incidents=[
                                {
                                    "score":      inc.get("score", 0.0),
                                    "log_pattern": (
                                        f"{inc.get('alertname','')} "
                                        f"{inc.get('metric_name','')} "
                                        f"{inc.get('severity','')}"
                                    ),
                                    "resolution": inc.get("resolution", ""),
                                }
                                for inc in (similar_incidents or [])
                            ],
                        )] if anomaly_type and similarity_score is not None else []),
                        {
                            "type": "TextBlock",
                            "text": f"담당자: {mention_text}" if mention_text else "담당자 미지정",
                            "wrap": True
                        }
                    ],
                    "actions": [
                        {
                            "type": "Action.OpenUrl",
                            "title": "해결책 등록",
                            "url": (
                                f"{_ADMIN_API_EXTERNAL_URL}/api/v1/feedback/form"
                                f"?system={system_name}&point_id={point_id or ''}"
                            ),
                        }
                    ],
                    "msteams": {
                        "entities": [
                            {
                                "type": "mention",
                                "text": f"<at>{c['name']}</at>",
                                "mentioned": {
                                    "id": c["teams_upn"],
                                    "name": c["name"]
                                }
                            }
                            for c in contacts if c.get("teams_upn")
                        ]
                    }
                }
            }]
        }

        async with httpx.AsyncClient(timeout=10.0, verify=_SSL_CONTEXT) as client:
            resp = await client.post(webhook_url, json=body)
            return resp.status_code == 200

    async def send_log_analysis_alert(
        self,
        webhook_url: str,
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
    ) -> bool:
        """LLM 분석 결과 알림 발송 (Phase 4b: 이상 분류 배지 + 유사 이력 포함)"""

        severity = analysis.get("severity", "warning")
        icon = "🔴" if severity == "critical" else ("🟡" if severity == "warning" else "🔵")

        mention_text = " ".join([
            f"<at>{c['name']}</at>"
            for c in contacts if c.get("teams_upn")
        ])

        card_body = [
            {
                "type": "TextBlock",
                "text": f"{icon} [LLM 분석] {analysis.get('summary', '로그 이상 감지')}",
                "weight": "Bolder",
                "size": "Medium",
                "color": "Attention" if severity == "critical" else ("Warning" if severity == "warning" else "Default"),
            },
            {
                "type": "FactSet",
                "facts": [
                    {"title": "시스템",   "value": f"{system_display_name} / {instance_role}"},
                    {"title": "심각도",   "value": severity.upper()},
                    {"title": "원인 추정", "value": analysis.get("root_cause", "-")},
                    {"title": "권장 조치", "value": analysis.get("recommendation", "-")},
                    {"title": "분석 시각", "value": datetime.now().strftime("%Y-%m-%d %H:%M:%S")},
                ],
            },
            {
                "type": "TextBlock",
                "text": f"**원본 로그 샘플:**\n```\n{log_sample[:400]}\n```",
                "wrap": True,
                "fontType": "Monospace",
            },
        ]

        # Phase 4b: 벡터 유사 이력 블록 삽입
        if anomaly_type and similarity_score is not None:
            card_body.append(
                self._build_vector_context_block(
                    anomaly_type=anomaly_type,
                    similarity_score=similarity_score,
                    has_solution=bool(has_solution),
                    similar_incidents=similar_incidents or [],
                )
            )

        if mention_text:
            card_body.append({"type": "TextBlock", "text": f"담당자: {mention_text}", "wrap": True})

        body = {
            "type": "message",
            "attachments": [{
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": card_body,
                    "actions": [
                        {
                            "type": "Action.OpenUrl",
                            "title": "해결책 등록",
                            "url": (
                                f"{_ADMIN_API_EXTERNAL_URL}/api/v1/feedback/form"
                                f"?system={system_name}&point_id={point_id or ''}"
                            ),
                        }
                    ],
                    "msteams": {
                        "entities": [
                            {
                                "type": "mention",
                                "text": f"<at>{c['name']}</at>",
                                "mentioned": {"id": c["teams_upn"], "name": c["name"]},
                            }
                            for c in contacts if c.get("teams_upn")
                        ]
                    },
                },
            }],
        }

        async with httpx.AsyncClient(timeout=10.0, verify=_SSL_CONTEXT) as client:
            resp = await client.post(webhook_url, json=body)
            return resp.status_code == 200

    async def send_recovery_alert(
        self,
        webhook_url: str,
        system_display_name: str,
        system_name: str,
        alertname: str,
        instance_role: str,
        host: str,
        contacts: list[dict],
    ) -> bool:
        """정상 복구 알림 — 녹색 Adaptive Card"""
        mention_text = " ".join([
            f"<at>{c['name']}</at>"
            for c in contacts if c.get("teams_upn")
        ])

        card_body = [
            {
                "type": "TextBlock",
                "text": f"✅ [정상 복구] {alertname}",
                "weight": "Bolder",
                "size": "Medium",
                "color": "Good",
            },
            {
                "type": "FactSet",
                "facts": [
                    {"title": "시스템",   "value": f"{system_display_name} ({system_name})"},
                    {"title": "서버",     "value": f"{instance_role} ({host})" if instance_role else host},
                    {"title": "복구 시각", "value": datetime.now().strftime("%Y-%m-%d %H:%M:%S")},
                ],
            },
        ]

        if mention_text:
            card_body.append({"type": "TextBlock", "text": f"담당자: {mention_text}", "wrap": True})

        body = {
            "type": "message",
            "attachments": [{
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": card_body,
                    "msteams": {
                        "entities": [
                            {
                                "type": "mention",
                                "text": f"<at>{c['name']}</at>",
                                "mentioned": {"id": c["teams_upn"], "name": c["name"]},
                            }
                            for c in contacts if c.get("teams_upn")
                        ]
                    },
                },
            }],
        }

        async with httpx.AsyncClient(timeout=10.0, verify=_SSL_CONTEXT) as client:
            resp = await client.post(webhook_url, json=body)
            return resp.status_code == 200
