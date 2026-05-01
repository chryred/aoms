"""
TeamsNotifier — Microsoft Teams Incoming Webhook 발송 서비스

Adaptive Card JSON 빌드는 adaptive_card_builder.py에 분리되어 있다.
이 모듈은 Webhook POST 전송 + SSL CA 처리만 담당한다.
"""

import os
from typing import Optional

import httpx

from .adaptive_card_builder import (
    build_log_analysis_card,
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
