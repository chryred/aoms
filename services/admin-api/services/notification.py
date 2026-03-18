import httpx
from datetime import datetime


class TeamsNotifier:
    """Microsoft Teams Incoming Webhook 발송 서비스"""

    def __init__(self, default_webhook_url: str):
        self.default_webhook_url = default_webhook_url

    async def send_metric_alert(
        self,
        webhook_url: str,
        alert: dict,
        system_display_name: str,
        contacts: list[dict]
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
                        {
                            "type": "TextBlock",
                            "text": f"담당자: {mention_text}" if mention_text else "담당자 미지정",
                            "wrap": True
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

        async with httpx.AsyncClient(timeout=10.0) as client:
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
        contacts: list[dict]
    ) -> bool:
        """LLM 분석 결과 알림 발송"""

        severity = analysis.get("severity", "warning")
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
                    "body": [
                        {
                            "type": "TextBlock",
                            "text": f"{icon} [LLM 분석] {analysis.get('summary', '로그 이상 감지')}",
                            "weight": "Bolder",
                            "size": "Medium",
                            "color": "Attention" if severity == "critical" else "Warning"
                        },
                        {
                            "type": "FactSet",
                            "facts": [
                                {"title": "시스템", "value": f"{system_display_name} / {instance_role}"},
                                {"title": "심각도", "value": severity.upper()},
                                {"title": "원인 추정", "value": analysis.get("root_cause", "-")},
                                {"title": "권장 조치", "value": analysis.get("recommendation", "-")},
                                {"title": "분석 시각", "value": datetime.now().strftime("%Y-%m-%d %H:%M:%S")},
                            ]
                        },
                        {
                            "type": "TextBlock",
                            "text": f"**원본 로그 샘플:**\n```\n{log_sample[:400]}\n```",
                            "wrap": True,
                            "fontType": "Monospace"
                        },
                        {
                            "type": "TextBlock",
                            "text": f"담당자: {mention_text}" if mention_text else "",
                            "wrap": True
                        }
                    ],
                    "msteams": {
                        "entities": [
                            {
                                "type": "mention",
                                "text": f"<at>{c['name']}</at>",
                                "mentioned": {"id": c["teams_upn"], "name": c["name"]}
                            }
                            for c in contacts if c.get("teams_upn")
                        ]
                    }
                }
            }]
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(webhook_url, json=body)
            return resp.status_code == 200
