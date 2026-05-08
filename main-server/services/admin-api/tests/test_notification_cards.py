"""
notification.py — Teams 카드 summary 필드 검증

모바일 푸시 알림 제목은 attachments[0].summary 필드에서 옵니다.
이 필드가 없으면 모바일에서 "Card" 로만 표시됩니다.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from services.notification import TeamsNotifier


@pytest.fixture
def notifier():
    return TeamsNotifier(default_webhook_url="https://dummy.webhook")


# ── 승인 요청 카드 ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_approval_request_card_has_summary(notifier):
    """send_approval_request_card — attachment 레벨에 summary 필드 포함 여부"""
    captured = {}

    async def fake_post(url, body):
        captured["body"] = body
        return True

    with patch("services.notification._post_webhook", side_effect=fake_post):
        await notifier.send_approval_request_card(
            webhook_url="https://dummy.webhook",
            feedback_id=1,
            system_display_name="고객경험시스템",
            alert_title="CPU 급등",
            error_type="CPU 과부하",
            solution="재시작 후 캐시 플러시",
            resolver="홍길동",
            attachment_count=2,
        )

    attachment = captured["body"]["attachments"][0]
    assert "summary" in attachment, "attachment 레벨에 summary 필드가 없음"
    assert attachment["summary"], "summary 값이 비어 있음"
    assert "Synapse" in attachment["summary"] or "고객경험시스템" in attachment["summary"]


@pytest.mark.asyncio
async def test_approval_request_card_revision_summary(notifier):
    """재등록 카드도 summary 포함 여부"""
    captured = {}

    async def fake_post(url, body):
        captured["body"] = body
        return True

    with patch("services.notification._post_webhook", side_effect=fake_post):
        await notifier.send_approval_request_card(
            webhook_url="https://dummy.webhook",
            feedback_id=2,
            system_display_name="ERP시스템",
            alert_title="메모리 누수",
            error_type="JVM 메모리",
            solution="힙 설정 증가",
            resolver="이순신",
            attachment_count=0,
            revision_count=2,
            revision_reason="오타 수정",
        )

    attachment = captured["body"]["attachments"][0]
    assert "summary" in attachment
    # 재등록 횟수가 summary에 반영되거나 최소한 시스템명이 포함돼야 함
    assert "ERP시스템" in attachment["summary"] or "재등록" in attachment["summary"]


# ── 반려 카드 ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_rejection_card_has_summary(notifier):
    """send_rejection_card — attachment 레벨에 summary 필드 포함 여부"""
    captured = {}

    async def fake_post(url, body):
        captured["body"] = body
        return True

    with patch("services.notification._post_webhook", side_effect=fake_post):
        await notifier.send_rejection_card(
            webhook_url="https://dummy.webhook",
            feedback_id=3,
            alert_title="CPU 급등",
            rejection_reason="해결책이 불완전합니다",
            resolver_contact={"name": "홍길동", "teams_upn": "hong@company.com"},
        )

    attachment = captured["body"]["attachments"][0]
    assert "summary" in attachment, "attachment 레벨에 summary 필드가 없음"
    assert attachment["summary"], "summary 값이 비어 있음"
    assert "CPU 급등" in attachment["summary"] or "반려" in attachment["summary"]


@pytest.mark.asyncio
async def test_rejection_card_no_resolver_contact(notifier):
    """등록자 연락처 없어도 summary는 존재해야 함"""
    captured = {}

    async def fake_post(url, body):
        captured["body"] = body
        return True

    with patch("services.notification._post_webhook", side_effect=fake_post):
        await notifier.send_rejection_card(
            webhook_url="https://dummy.webhook",
            feedback_id=4,
            alert_title="DB 커넥션 부족",
            rejection_reason="임시 조치일 뿐, 근본 원인 미포함",
            resolver_contact=None,
        )

    attachment = captured["body"]["attachments"][0]
    assert "summary" in attachment
    assert "DB 커넥션 부족" in attachment["summary"] or "반려" in attachment["summary"]


# ── 기존 카드(빌더 경유) 비교 ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_metric_alert_card_has_summary(notifier):
    """build_metric_alert_card(_build_base_card 경유)도 summary 포함 확인"""
    captured = {}

    async def fake_post(url, body):
        captured["body"] = body
        return True

    alert = {
        "labels": {"severity": "critical", "system_name": "sys", "alertname": "CPUHigh",
                   "instance_role": "was1", "host": "10.0.0.1"},
        "annotations": {"summary": "CPU 90% 초과", "description": "서버 CPU 과부하"},
    }

    with patch("services.notification._post_webhook", side_effect=fake_post):
        await notifier.send_metric_alert(
            webhook_url="https://dummy.webhook",
            alert=alert,
            system_display_name="고객경험시스템",
            contacts=[{"name": "홍길동", "teams_upn": "hong@company.com"}],
        )

    attachment = captured["body"]["attachments"][0]
    assert "summary" in attachment
    assert attachment["summary"]
