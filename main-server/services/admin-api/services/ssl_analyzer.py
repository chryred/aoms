"""
SSL 배포 이상 감지 룰 + LLM 요약 + Teams 알림
"""
import logging
import os
from typing import Optional

import httpx
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import SslServer, SslDeployment, SslCertSnapshot
from services.llm_client import call_llm_text

logger = logging.getLogger(__name__)

_TEAMS_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")

RULES = [
    ("cert_expiry_days_critical", "CRITICAL", "만료 {days}일 전 — 즉시 갱신 필요"),
    ("cert_expiry_days_warning",  "WARNING",  "만료 {days}일 전 — 갱신 권장"),
    ("ssl_verify_fail",           "CRITICAL", "SSL 응답 실패 — 인증서 미적용 가능성"),
    ("duration_critical",         "CRITICAL", "배포 시간 {ratio:.1f}배 — 서버 이상 의심"),
    ("duration_warning",          "WARNING",  "배포 시간 평균 {ratio:.1f}배 초과"),
    ("ha_partial_fail",           "CRITICAL", "HA 일부 배포 실패 — 순차 배포 중단됨"),
]


def _build_alert_card(title: str, summary: str, severity: str, host: str) -> dict:
    color = "attention" if severity == "CRITICAL" else "warning"
    return {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.3",
                    "body": [
                        {
                            "type": "TextBlock",
                            "text": f"🔐 SSL 인증서 이상 감지 [{severity}]",
                            "weight": "bolder",
                            "size": "medium",
                            "color": color,
                        },
                        {"type": "TextBlock", "text": f"**{title}**", "wrap": True},
                        {"type": "TextBlock", "text": f"서버: {host}", "wrap": True, "isSubtle": True},
                        {"type": "TextBlock", "text": summary, "wrap": True},
                    ],
                },
            }
        ],
    }


async def _post_teams(webhook_url: str, body: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(webhook_url, json=body)
    except Exception as e:
        logger.warning("Teams 알림 전송 실패: %s", e)


async def analyze_deployment(deployment: SslDeployment, server: SslServer) -> list[dict]:
    """단일 배포 건 이상 감지 룰 적용. 위반 항목 목록 반환."""
    findings = []

    # 배포 실패 시 SSL 검증 실패로 간주
    if deployment.status == "failed":
        log = deployment.deploy_log or ""
        if "SSL" in log or "ssl" in log or "검증" in log:
            findings.append({"rule": "ssl_verify_fail", "severity": "CRITICAL",
                              "msg": "SSL 응답 실패 — 인증서 미적용 가능성"})

    # 배포 시간 이상 (같은 서버 최근 5회 평균 대비)
    if deployment.duration_sec:
        pass  # 평균 계산은 스케줄러에서 처리

    return findings


async def analyze_and_notify(db: Optional[AsyncSession] = None) -> None:
    """전체 서버 현황 분석 + 임계치 위반 시 Teams 알림"""
    if not _TEAMS_WEBHOOK_URL:
        return

    close_db = db is None
    if db is None:
        db = AsyncSessionLocal()

    try:
        # 최신 스냅샷 조회 (서버당 1건)
        subq = (
            select(
                SslCertSnapshot.server_id,
                func.max(SslCertSnapshot.checked_at).label("latest_at"),
            ).group_by(SslCertSnapshot.server_id).subquery()
        )
        rows = (
            await db.execute(
                select(SslServer, SslCertSnapshot)
                .join(subq, SslServer.id == subq.c.server_id)
                .join(
                    SslCertSnapshot,
                    (SslCertSnapshot.server_id == subq.c.server_id)
                    & (SslCertSnapshot.checked_at == subq.c.latest_at),
                )
                .where(SslServer.status == "active")
            )
        ).all()

        alerts = []
        for server, snap in rows:
            days = snap.days_left

            if days is not None and days < 7:
                alerts.append({
                    "host": server.host,
                    "severity": "CRITICAL",
                    "msg": RULES[0][2].format(days=days),
                })
            elif days is not None and days < 30:
                alerts.append({
                    "host": server.host,
                    "severity": "WARNING",
                    "msg": RULES[1][2].format(days=days),
                })

            if snap.is_valid is False:
                alerts.append({
                    "host": server.host,
                    "severity": "CRITICAL",
                    "msg": RULES[2][2],
                })

        if not alerts:
            return

        # LLM 요약 (실패해도 룰 결과만 발송)
        llm_summary = ""
        try:
            prompt = (
                "다음은 SSL 인증서 이상 감지 결과입니다. "
                "운영자가 이해하기 쉽게 1~3문장으로 요약하세요.\n\n"
                + "\n".join(f"- [{a['severity']}] {a['host']}: {a['msg']}" for a in alerts)
            )
            llm_summary = await call_llm_text(prompt, area_code="ssl_analysis")
        except Exception as e:
            logger.warning("LLM 요약 실패 (룰 결과만 발송): %s", e)

        # Teams 알림
        critical_count = sum(1 for a in alerts if a["severity"] == "CRITICAL")
        warning_count  = sum(1 for a in alerts if a["severity"] == "WARNING")
        severity = "CRITICAL" if critical_count else "WARNING"

        detail = "\n".join(f"• [{a['severity']}] {a['host']}: {a['msg']}" for a in alerts)
        body_text = llm_summary if llm_summary else detail

        card = _build_alert_card(
            title=f"이상 감지 {len(alerts)}건 (CRITICAL {critical_count}, WARNING {warning_count})",
            summary=body_text,
            severity=severity,
            host=", ".join(set(a["host"] for a in alerts[:3])),
        )
        await _post_teams(_TEAMS_WEBHOOK_URL, card)
        logger.info("SSL 이상 감지 Teams 알림 발송: %d건", len(alerts))

    finally:
        if close_db:
            await db.close()
