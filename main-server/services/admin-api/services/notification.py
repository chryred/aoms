"""
TeamsNotifier — Microsoft Teams Incoming Webhook 발송 서비스

Adaptive Card JSON 빌드는 adaptive_card_builder.py에 분리되어 있다.
이 모듈은 Webhook POST 전송 + SSL CA 처리만 담당한다.
"""

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_FRONTEND_EXTERNAL_URL = os.getenv("FRONTEND_EXTERNAL_URL", "http://localhost:3001")

import httpx

from .adaptive_card_builder import (
    build_entities,
    build_log_analysis_card,
    build_mention_text,
    build_metric_alert_card,
    build_recovery_card,
)

# CA 번들 우선순위: 환경변수 SSL_CERT_FILE → RHEL/CentOS 시스템 CA → certifi 기본값
_SSL_CAFILE = os.getenv("SSL_CERT_FILE", None)
if _SSL_CAFILE is None:
    for _candidate in (
        "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",  # RHEL/CentOS
        "/etc/ssl/certs/ca-certificates.crt",                  # Debian/Ubuntu
        "/opt/homebrew/etc/openssl@3/cert.pem",                # macOS Homebrew
    ):
        if os.path.exists(_candidate):
            _SSL_CAFILE = _candidate
            break

# httpx verify= 파라미터: CA 파일 경로(str) 또는 True(certifi 기본값)
_SSL_CONTEXT = _SSL_CAFILE if _SSL_CAFILE else True


async def _post_webhook(webhook_url: str, body: dict) -> bool:
    """Teams Incoming Webhook POST 전송"""
    async with httpx.AsyncClient(timeout=10.0, verify=_SSL_CONTEXT) as client:
        resp = await client.post(webhook_url, json=body)
        return resp.status_code == 200


class TeamsNotifier:
    """Microsoft Teams Incoming Webhook 발송 서비스"""

    def __init__(self, default_webhook_url: str):
        self.default_webhook_url = default_webhook_url

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
        alert_history_id: Optional[int] = None,
        incident_id: Optional[int] = None,
    ) -> bool:
        """Adaptive Card 형식으로 메트릭 알림 발송"""
        body = build_metric_alert_card(
            alert=alert,
            system_display_name=system_display_name,
            contacts=contacts,
            anomaly_type=anomaly_type,
            similarity_score=similarity_score,
            has_solution=has_solution,
            similar_incidents=similar_incidents,
            point_id=point_id,
            alert_history_id=alert_history_id,
            incident_id=incident_id,
        )
        return await _post_webhook(webhook_url, body)

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
        alert_history_id: Optional[int] = None,
        incident_id: Optional[int] = None,
    ) -> bool:
        """LLM 분석 결과 알림 발송 (Phase 4b: 이상 분류 배지 + 유사 이력 포함)"""
        body = build_log_analysis_card(
            system_display_name=system_display_name,
            system_name=system_name,
            instance_role=instance_role,
            analysis=analysis,
            log_sample=log_sample,
            contacts=contacts,
            anomaly_type=anomaly_type,
            similarity_score=similarity_score,
            has_solution=has_solution,
            similar_incidents=similar_incidents,
            point_id=point_id,
            alert_history_id=alert_history_id,
            incident_id=incident_id,
        )
        return await _post_webhook(webhook_url, body)

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
        body = build_recovery_card(
            system_display_name=system_display_name,
            system_name=system_name,
            alertname=alertname,
            instance_role=instance_role,
            host=host,
            contacts=contacts,
        )
        return await _post_webhook(webhook_url, body)

    async def send_approval_request_card(
        self,
        *,
        webhook_url: str | None,
        feedback_id: int,
        system_display_name: str,
        alert_title: str,
        error_type: str,
        solution: str,
        resolver: str,
        attachment_count: int,
        revision_count: int = 0,
        revision_reason: str | None = None,
        approver_contact: dict | None = None,
    ) -> bool:
        """승인자에게 해결책 승인 요청 카드 발송 (승인자 @멘션 포함)

        approver_contact: {"name": str, "teams_upn": str | None} — teams_upn이 있으면 @멘션
        """
        url = webhook_url or self.default_webhook_url
        if not url:
            logger.warning("Teams 발송 스킵: webhook_url 없음 (feedback_id=%s)", feedback_id)
            return False

        title = "[Synapse] 해결책 승인 요청"
        if revision_count > 0:
            title += f" (재등록 {revision_count}회)"

        solution_text = solution[:300] + "..." if len(solution) > 300 else solution
        review_url = f"{_FRONTEND_EXTERNAL_URL}/feedback/review/{feedback_id}"

        approver_list = [approver_contact] if approver_contact else []
        mention_text = build_mention_text(approver_list)
        entities = build_entities(approver_list)

        card_body: list[dict] = [
            {
                "type": "TextBlock",
                "text": title,
                "weight": "Bolder",
                "size": "Medium",
                "wrap": True,
            },
            {
                "type": "FactSet",
                "facts": [
                    {"title": "시스템", "value": system_display_name},
                    {"title": "알림", "value": alert_title},
                    {"title": "원인", "value": error_type},
                    {"title": "해결책", "value": solution_text},
                    {"title": "등록자", "value": resolver},
                    {"title": "첨부", "value": f"{attachment_count}건"},
                ],
            },
        ]

        if mention_text:
            card_body.append({
                "type": "TextBlock",
                "text": f"승인자: {mention_text}",
                "wrap": True,
                "spacing": "Medium",
            })

        # 재등록 사유는 multi-line 가능성이 있어 FactSet 대신 별도 TextBlock으로 렌더 (wrap 적용)
        if revision_reason:
            reason_text = revision_reason.strip()
            if len(reason_text) > 500:
                reason_text = reason_text[:500] + "..."
            card_body.append({
                "type": "TextBlock",
                "text": "📝 재등록 사유",
                "weight": "Bolder",
                "spacing": "Medium",
                "wrap": True,
            })
            card_body.append({
                "type": "TextBlock",
                "text": reason_text,
                "wrap": True,
                "spacing": "Small",
            })

        body = {
            "type": "message",
            "attachments": [
                {
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "summary": f"{title} — {system_display_name}",
                    "content": {
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "type": "AdaptiveCard",
                        "version": "1.4",
                        "body": card_body,
                        "msteams": {"entities": entities},
                        "actions": [
                            {
                                "type": "Action.OpenUrl",
                                "title": "상세 보기 & 승인/반려 →",
                                "url": review_url,
                            }
                        ],
                    },
                }
            ],
        }
        return await _post_webhook(url, body)

    async def send_rejection_card(
        self,
        *,
        webhook_url: str | None,
        feedback_id: int,
        alert_title: str,
        rejection_reason: str,
        resolver_contact: dict | None = None,
    ) -> bool:
        """등록자에게 해결책 반려 알림 카드 발송 (등록자 @멘션 포함)

        resolver_contact: {"name": str, "teams_upn": str | None} — teams_upn이 있으면 @멘션
        """
        url = webhook_url or self.default_webhook_url
        if not url:
            logger.warning("Teams 발송 스킵: webhook_url 없음 (feedback_id=%s)", feedback_id)
            return False

        revise_url = f"{_FRONTEND_EXTERNAL_URL}/feedback/revise/{feedback_id}"

        resolver_list = [resolver_contact] if resolver_contact else []
        mention_text = build_mention_text(resolver_list)
        entities = build_entities(resolver_list)

        card_body: list[dict] = [
            {
                "type": "TextBlock",
                "text": "[Synapse] 해결책이 반려되었습니다",
                "weight": "Bolder",
                "size": "Medium",
                "wrap": True,
            },
            {
                "type": "TextBlock",
                "text": f"📋 알림: {alert_title}",
                "wrap": True,
            },
            {
                "type": "TextBlock",
                "text": f"🚫 반려 사유: {rejection_reason}",
                "wrap": True,
            },
        ]

        if mention_text:
            card_body.append({
                "type": "TextBlock",
                "text": f"등록자: {mention_text}",
                "wrap": True,
                "spacing": "Medium",
            })

        body = {
            "type": "message",
            "attachments": [
                {
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "summary": f"[Synapse] 해결책 반려 — {alert_title}",
                    "content": {
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "type": "AdaptiveCard",
                        "version": "1.4",
                        "body": card_body,
                        "msteams": {"entities": entities},
                        "actions": [
                            {
                                "type": "Action.OpenUrl",
                                "title": "내용 수정 후 재등록 →",
                                "url": revise_url,
                            }
                        ],
                    },
                }
            ],
        }
        return await _post_webhook(url, body)
