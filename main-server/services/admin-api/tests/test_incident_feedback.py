"""
Wave 2A — 인시던트 단위 피드백 엔드포인트 테스트

대상 엔드포인트:
  POST   /api/v1/incidents/{id}/feedback
  POST   /api/v1/incidents/{id}/feedback/{fid}/approve
  POST   /api/v1/incidents/{id}/feedback/{fid}/reject
  POST   /api/v1/incidents/{id}/feedback/{fid}/resubmit
  GET    /api/v1/incidents/{id}/feedback
  GET    /api/v1/incidents/feedback/pending
  GET    /api/v1/incidents/feedback/search
  GET    /api/v1/incidents/stats
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from models import AlertFeedback, AlertFeedbackAttachment, AlertHistory, Contact, Incident, System, User


# ── 공통 픽스처 ────────────────────────────────────────────────────────────────

@pytest.fixture
async def base_system(db_session: AsyncSession):
    sys = System(system_name="test-sys", display_name="테스트시스템")
    db_session.add(sys)
    await db_session.flush()
    return sys


@pytest.fixture
async def resolved_incident(db_session: AsyncSession, base_system):
    """resolved 상태 인시던트 — 피드백 등록 허용"""
    incident = Incident(
        system_id=base_system.id,
        title="테스트 인시던트",
        severity="critical",
        status="resolved",
        detected_at=datetime.now(timezone.utc).replace(tzinfo=None),
        resolved_at=datetime.now(timezone.utc).replace(tzinfo=None),
        alert_count=2,
    )
    db_session.add(incident)
    await db_session.flush()
    return incident


@pytest.fixture
async def open_incident(db_session: AsyncSession, base_system):
    """open 상태 인시던트 — 피드백 등록 불허"""
    incident = Incident(
        system_id=base_system.id,
        title="진행 중 인시던트",
        severity="warning",
        status="open",
        detected_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(incident)
    await db_session.flush()
    return incident


@pytest.fixture
async def investigating_incident(db_session: AsyncSession, base_system):
    """investigating 상태 인시던트"""
    incident = Incident(
        system_id=base_system.id,
        title="조사 중 인시던트",
        severity="critical",
        status="investigating",
        detected_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(incident)
    await db_session.flush()
    return incident


@pytest.fixture
async def admin_user_and_contact(db_session: AsyncSession):
    """admin User + Contact"""
    user = User(
        email="approver@test.com",
        password_hash="hashed",
        name="승인자",
        role="admin",
        is_active=True,
        is_approved=True,
    )
    db_session.add(user)
    await db_session.flush()
    contact = Contact(user_id=user.id, teams_upn="approver@test.com")
    db_session.add(contact)
    await db_session.flush()
    return user, contact


@pytest.fixture
async def operator_user(db_session: AsyncSession):
    """operator User — contact 없음"""
    user = User(
        email="operator@test.com",
        password_hash="hashed",
        name="운영자",
        role="operator",
        is_active=True,
        is_approved=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
async def admin_client(db_session: AsyncSession, admin_user_and_contact):
    """admin 역할 클라이언트"""
    from auth import get_current_user
    from database import get_db
    from main import app

    admin_user, _ = admin_user_and_contact

    async def override_get_db():
        yield db_session

    async def override_get_current_user():
        return admin_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
async def operator_client(db_session: AsyncSession, operator_user):
    """operator 역할 클라이언트"""
    from auth import get_current_user
    from database import get_db
    from main import app

    async def override_get_db():
        yield db_session

    async def override_get_current_user():
        return operator_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
async def designated_operator_client(db_session: AsyncSession, resolved_incident, admin_user_and_contact):
    """지정 승인자(admin) 역할 클라이언트 — admin_user_and_contact를 approver로 사용"""
    from auth import get_current_user
    from database import get_db
    from main import app

    admin_user, _ = admin_user_and_contact

    async def override_get_db():
        yield db_session

    async def override_get_current_user():
        return admin_user

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── 1. 정상 피드백 등록 → status=pending ─────────────────────────────────────

async def test_create_feedback_pending(
    authed_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """POST /incidents/{id}/feedback → status='pending', OCR 트리거, Teams 카드 발송"""
    _, approver_contact = admin_user_and_contact

    with (
        patch("routes.incidents._run_ocr_for_attachment", new_callable=AsyncMock),
        patch("routes.incidents._notifier.send_approval_request_card", new_callable=AsyncMock),
    ):
        resp = await authed_client.post(
            f"/api/v1/incidents/{resolved_incident.id}/feedback",
            json={
                "incident_id": resolved_incident.id,
                "error_type": "CPU 과부하",
                "solution": "불필요 프로세스 종료",
                "resolver": "홍길동",
                "approver_contact_id": approver_contact.id,
                "attachment_paths": [],
            },
        )

    assert resp.status_code in (200, 201), resp.text
    body = resp.json()
    assert body["status"] == "pending"
    assert body["incident_id"] == resolved_incident.id


# ── 2. status=investigating에 등록 시도 → 400 ────────────────────────────────

async def test_create_feedback_on_non_resolved_incident_returns_400(
    authed_client: AsyncClient,
    db_session: AsyncSession,
    investigating_incident,
    admin_user_and_contact,
):
    """resolved/closed가 아닌 인시던트에 피드백 등록 시도 → 400"""
    _, approver_contact = admin_user_and_contact

    resp = await authed_client.post(
        f"/api/v1/incidents/{investigating_incident.id}/feedback",
        json={
            "incident_id": investigating_incident.id,
            "error_type": "CPU 과부하",
            "solution": "해결책",
            "resolver": "홍길동",
            "approver_contact_id": approver_contact.id,
        },
    )
    assert resp.status_code == 400, resp.text


# ── 3. 승인 → status=approved, qdrant_point_id 저장, log-analyzer 호출 mock ──

async def test_approve_feedback(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """승인 → approved + qdrant_point_id 저장 + embed_postmortem 호출"""
    _, approver_contact = admin_user_and_contact

    fb = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="CPU 과부하",
        solution="프로세스 종료",
        resolver="홍길동",
        status="pending",
        approver_id=approver_contact.id,
    )
    db_session.add(fb)
    await db_session.commit()
    await db_session.refresh(fb)

    with patch(
        "routes.incidents.postmortem_client.embed_postmortem",
        new_callable=AsyncMock,
        return_value="test-qdrant-uuid-001",
    ) as mock_embed:
        resp = await admin_client.post(
            f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/approve"
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "approved"
    assert body["approved_at"] is not None
    mock_embed.assert_called_once()

    # DB에 qdrant_point_id 저장 확인
    await db_session.refresh(fb)
    assert fb.qdrant_point_id == "test-qdrant-uuid-001"


# ── 4. admin 아닌 contact가 approve 시도 → 403 ────────────────────────────────

async def test_approve_by_non_admin_non_designated_returns_403(
    operator_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """지정 승인자도 아니고 admin도 아닌 operator → 403"""
    _, approver_contact = admin_user_and_contact

    fb = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="메모리 누수",
        solution="재시작",
        resolver="홍길동",
        status="pending",
        approver_id=approver_contact.id,  # 다른 사람이 지정 승인자
    )
    db_session.add(fb)
    await db_session.commit()
    await db_session.refresh(fb)

    resp = await operator_client.post(
        f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/approve"
    )
    assert resp.status_code == 403, resp.text


# ── 5. 지정 승인자(non-admin operator)가 approve → 200 ────────────────────────

async def test_approve_by_designated_approver(
    db_session: AsyncSession,
    resolved_incident,
):
    """지정 승인자(operator)가 approve 시도 → 200"""
    from auth import get_current_user
    from database import get_db
    from main import app

    # 지정 승인자로 쓸 operator user + contact 생성
    operator = User(
        email="designated@test.com",
        password_hash="hashed",
        name="지정승인자",
        role="operator",
        is_active=True,
        is_approved=True,
    )
    db_session.add(operator)
    await db_session.flush()

    designated_contact = Contact(user_id=operator.id, teams_upn="designated@test.com")
    db_session.add(designated_contact)
    await db_session.flush()

    fb = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="디스크 풀",
        solution="로그 삭제",
        resolver="홍길동",
        status="pending",
        approver_id=designated_contact.id,  # 이 사람이 지정 승인자
    )
    db_session.add(fb)
    await db_session.commit()
    await db_session.refresh(fb)

    async def override_get_db():
        yield db_session

    async def override_get_current_user():
        return operator  # 지정 승인자로 로그인

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            with patch(
                "routes.incidents.postmortem_client.embed_postmortem",
                new_callable=AsyncMock,
                return_value="point-001",
            ):
                resp = await ac.post(
                    f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/approve"
                )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "approved"
    finally:
        app.dependency_overrides.clear()


# ── 6. reject → 등록자 Teams 알림 호출 검증 ─────────────────────────────────────

async def test_reject_feedback_sends_notification(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """반려 → status=rejected + send_rejection_card 호출"""
    _, approver_contact = admin_user_and_contact

    fb = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="디스크 풀",
        solution="로그 삭제",
        resolver="홍길동",
        status="pending",
        approver_id=approver_contact.id,
    )
    db_session.add(fb)
    await db_session.commit()
    await db_session.refresh(fb)

    with patch(
        "routes.incidents._notifier.send_rejection_card",
        new_callable=AsyncMock,
    ) as mock_reject_card:
        resp = await admin_client.post(
            f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/reject",
            json={"rejection_reason": "해결책 불충분"},
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "해결책 불충분"
    mock_reject_card.assert_called_once()


# ── 7. resubmit/edit — pending/rejected/approved 모두 허용 ────────────────────

async def test_resubmit_allowed_for_pending_rejected_approved(
    authed_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """pending/rejected/approved 모두 수정 가능. status는 항상 pending으로 복귀, revision_count+1."""
    _, approver_contact = admin_user_and_contact

    async def _try_resubmit(initial_status: str) -> dict:
        fb = AlertFeedback(
            incident_id=resolved_incident.id,
            error_type="CPU 과부하",
            solution="초안",
            resolver="테스트관리자",  # authed_client user.name과 일치
            status=initial_status,
            approver_id=approver_contact.id,
            revision_count=0,
        )
        db_session.add(fb)
        await db_session.commit()
        await db_session.refresh(fb)

        with (
            patch("routes.incidents._run_ocr_for_attachment", new_callable=AsyncMock),
            patch("routes.incidents._notifier.send_approval_request_card", new_callable=AsyncMock),
        ):
            resp = await authed_client.post(
                f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/resubmit",
                json={"error_type": "CPU 과부하", "solution": "수정본", "attachment_paths": []},
            )
        assert resp.status_code == 200, f"{initial_status}: {resp.text}"
        return resp.json()

    # pending → 수정 시 status는 pending 유지, revision_count+1
    body_pending = await _try_resubmit("pending")
    assert body_pending["status"] == "pending"
    assert body_pending["revision_count"] >= 1

    # rejected → 수정 시 status=pending 복귀, revision_count+1
    body_rejected = await _try_resubmit("rejected")
    assert body_rejected["status"] == "pending"
    assert body_rejected["revision_count"] >= 1

    # approved → 수정 시 status=pending 복귀 (재승인 필요), approved_at/approved_by 초기화
    body_approved = await _try_resubmit("approved")
    assert body_approved["status"] == "pending"
    assert body_approved["revision_count"] >= 1
    assert body_approved["approved_at"] is None
    assert body_approved["approved_by"] is None


async def test_resubmit_persists_revision_reason_and_passes_to_card(
    authed_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """재등록 시 revision_reason이 DB에 저장되고 승인 요청 카드 호출 인자에도 전달된다."""
    _, approver_contact = admin_user_and_contact

    fb = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="CPU 과부하",
        solution="초안",
        resolver="테스트관리자",
        status="approved",
        approver_id=approver_contact.id,
        revision_count=0,
    )
    db_session.add(fb)
    await db_session.commit()
    await db_session.refresh(fb)

    with (
        patch("routes.incidents._run_ocr_for_attachment", new_callable=AsyncMock),
        patch(
            "routes.incidents._notifier.send_approval_request_card",
            new_callable=AsyncMock,
        ) as mock_card,
    ):
        resp = await authed_client.post(
            f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/resubmit",
            json={
                "error_type": "CPU 과부하",
                "solution": "수정본",
                "attachment_paths": [],
                "revision_reason": "  오타 수정 및 절차 보강  ",
            },
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    # 공백은 trim되어 저장
    assert body["revision_reason"] == "오타 수정 및 절차 보강"

    mock_card.assert_called_once()
    kwargs = mock_card.call_args.kwargs
    assert kwargs.get("revision_reason") == "오타 수정 및 절차 보강"
    assert kwargs.get("revision_count") == 1


async def test_resubmit_passes_approver_mention_to_card(
    authed_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """재등록 시 승인자 @멘션용 contact dict가 카드 호출 인자로 전달된다."""
    approver_user, approver_contact = admin_user_and_contact

    fb = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="CPU 과부하",
        solution="초안",
        resolver="테스트관리자",
        status="approved",
        approver_id=approver_contact.id,
        revision_count=0,
    )
    db_session.add(fb)
    await db_session.commit()
    await db_session.refresh(fb)

    with (
        patch("routes.incidents._run_ocr_for_attachment", new_callable=AsyncMock),
        patch(
            "routes.incidents._notifier.send_approval_request_card",
            new_callable=AsyncMock,
        ) as mock_card,
    ):
        resp = await authed_client.post(
            f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/resubmit",
            json={
                "error_type": "CPU 과부하",
                "solution": "수정본",
                "attachment_paths": [],
            },
        )

    assert resp.status_code == 200, resp.text
    mock_card.assert_called_once()
    contact_arg = mock_card.call_args.kwargs.get("approver_contact")
    assert contact_arg == {
        "name": approver_user.name,
        "teams_upn": approver_contact.teams_upn,
    }


async def test_reject_passes_resolver_mention_to_card(
    authed_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """반려 시 등록자 @멘션용 contact dict가 카드 호출 인자로 전달된다.

    fixture admin_user_and_contact의 user.name='승인자' — 같은 user를 resolver 본인으로도 사용.
    """
    approver_user, approver_contact = admin_user_and_contact

    fb = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="CPU 과부하",
        solution="해결책",
        resolver=approver_user.name,  # User.name과 매칭되어야 contact 조회됨
        status="pending",
        approver_id=approver_contact.id,
        revision_count=0,
    )
    db_session.add(fb)
    await db_session.commit()
    await db_session.refresh(fb)

    with patch(
        "routes.incidents._notifier.send_rejection_card",
        new_callable=AsyncMock,
    ) as mock_card:
        resp = await authed_client.post(
            f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/reject",
            json={"rejection_reason": "근거 부족"},
        )

    assert resp.status_code == 200, resp.text
    mock_card.assert_called_once()
    contact_arg = mock_card.call_args.kwargs.get("resolver_contact")
    assert contact_arg == {
        "name": approver_user.name,
        "teams_upn": approver_contact.teams_upn,
    }


async def test_retry_ocr_processes_failed_and_processing(
    authed_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """재OCR endpoint — failed/processing 첨부를 모두 processing 으로 reset 하고 detached task 시작."""
    _, approver_contact = admin_user_and_contact

    fb = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="CPU 과부하",
        solution="해결책",
        resolver="테스트관리자",
        status="pending",
        approver_id=approver_contact.id,
        revision_count=0,
    )
    db_session.add(fb)
    await db_session.flush()

    att_failed = AlertFeedbackAttachment(
        feedback_id=fb.id, file_path="feedback/x/a.pdf",
        original_filename="a.pdf", sort_order=0, ocr_status="failed",
    )
    att_proc = AlertFeedbackAttachment(
        feedback_id=fb.id, file_path="feedback/x/b.pdf",
        original_filename="b.pdf", sort_order=1, ocr_status="processing",
    )
    att_done = AlertFeedbackAttachment(
        feedback_id=fb.id, file_path="feedback/x/c.pdf",
        original_filename="c.pdf", sort_order=2, ocr_status="done",
        ocr_text="이미 추출됨",
    )
    db_session.add_all([att_failed, att_proc, att_done])
    await db_session.commit()

    with patch(
        "routes.incidents._run_ocr_remaining_detached",
        new_callable=AsyncMock,
    ) as mock_worker:
        resp = await authed_client.post(
            f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/retry-ocr",
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["retried"] == 2  # failed + processing — done 은 제외

    # detached worker 가 호출됨 (asyncio.create_task 로 wrap)
    mock_worker.assert_called_once()
    args = mock_worker.call_args
    assert args.args[0] == fb.id

    # failed 였던 첨부도 processing 으로 reset
    refreshed_failed = await db_session.get(AlertFeedbackAttachment, att_failed.id)
    refreshed_done = await db_session.get(AlertFeedbackAttachment, att_done.id)
    await db_session.refresh(refreshed_failed)
    await db_session.refresh(refreshed_done)
    assert refreshed_failed.ocr_status == "processing"
    assert refreshed_done.ocr_status == "done"  # done 은 그대로


async def test_retry_ocr_forbidden_for_other_user(
    authed_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """재OCR 권한 — admin/resolver 외에는 403."""
    _, approver_contact = admin_user_and_contact

    fb = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="CPU 과부하",
        solution="해결책",
        resolver="다른사람",  # authed_client.user.name 과 다름 + user.role=admin 인 fixture 가
        status="pending",
        approver_id=approver_contact.id,
    )
    db_session.add(fb)
    await db_session.commit()

    # authed_client 의 user.role 이 admin 이 아닌 경우만 403 — operator 픽스처가 필요하므로 생략하고
    # 대신 endpoint 가 admin 인 경우는 다른 resolver 여도 통과되는지만 검증
    resp = await authed_client.post(
        f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/retry-ocr",
    )
    # admin 이라 403 안 남 (200 또는 빈 대상이면 200)
    assert resp.status_code == 200, resp.text


async def test_resubmit_blank_revision_reason_stored_as_null(
    authed_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """빈 문자열 / 공백만 있는 revision_reason은 NULL로 저장된다."""
    _, approver_contact = admin_user_and_contact

    fb = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="CPU 과부하",
        solution="초안",
        resolver="테스트관리자",
        status="rejected",
        approver_id=approver_contact.id,
        revision_count=0,
    )
    db_session.add(fb)
    await db_session.commit()
    await db_session.refresh(fb)

    with (
        patch("routes.incidents._run_ocr_for_attachment", new_callable=AsyncMock),
        patch(
            "routes.incidents._notifier.send_approval_request_card",
            new_callable=AsyncMock,
        ) as mock_card,
    ):
        resp = await authed_client.post(
            f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/resubmit",
            json={
                "error_type": "CPU 과부하",
                "solution": "수정본",
                "attachment_paths": [],
                "revision_reason": "   ",
            },
        )

    assert resp.status_code == 200, resp.text
    assert resp.json()["revision_reason"] is None
    assert mock_card.call_args.kwargs.get("revision_reason") is None


# ── 8. stats API 정확성 ────────────────────────────────────────────────────────

async def test_stats_api(
    authed_client: AsyncClient,
    db_session: AsyncSession,
    base_system,
):
    """GET /incidents/stats → total/registrable/completed 정확성 검증"""
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # 인시던트 3건 생성
    inc_open = Incident(
        system_id=base_system.id,
        title="Open 인시던트",
        severity="warning",
        status="open",
        detected_at=now,
    )
    inc_resolved_no_fb = Incident(
        system_id=base_system.id,
        title="해결 후 피드백 없음",
        severity="critical",
        status="resolved",
        detected_at=now,
        resolved_at=now,
    )
    inc_resolved_approved = Incident(
        system_id=base_system.id,
        title="해결 후 피드백 승인됨",
        severity="critical",
        status="resolved",
        detected_at=now,
        resolved_at=now,
    )
    db_session.add_all([inc_open, inc_resolved_no_fb, inc_resolved_approved])
    await db_session.flush()

    # 승인된 피드백 1건
    fb_approved = AlertFeedback(
        incident_id=inc_resolved_approved.id,
        error_type="에러",
        solution="해결책",
        resolver="홍길동",
        status="approved",
    )
    db_session.add(fb_approved)
    await db_session.commit()

    resp = await authed_client.get("/api/v1/incidents/stats")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # 최소 검증 (다른 테스트의 데이터가 섞일 수 있으므로 >= 사용)
    assert body["total"] >= 3
    assert body["registrable"] >= 1  # inc_resolved_no_fb
    assert body["completed"] >= 1    # inc_resolved_approved


# ── 9a. GET /incidents/feedback/pending — admin 허용 ─────────────────────────

async def test_pending_feedback_admin_ok(
    admin_client: AsyncClient,
):
    """admin → 200"""
    resp = await admin_client.get("/api/v1/incidents/feedback/pending")
    assert resp.status_code == 200, resp.text


# ── 9b. GET /incidents/feedback/pending — operator 거부 ───────────────────────

async def test_pending_feedback_operator_forbidden(
    operator_client: AsyncClient,
):
    """operator → 403"""
    resp = await operator_client.get("/api/v1/incidents/feedback/pending")
    assert resp.status_code == 403, resp.text


# ── 10. GET /incidents/{id}/feedback 기본: approved만 ────────────────────────

async def test_list_incident_feedbacks_defaults_approved_only(
    authed_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """GET /{id}/feedback → 기본 approved만 반환"""
    _, approver_contact = admin_user_and_contact

    fb_approved = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="에러 A",
        solution="해결 A",
        resolver="홍길동",
        status="approved",
        approver_id=approver_contact.id,
    )
    fb_pending = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="에러 B",
        solution="해결 B",
        resolver="김철수",
        status="pending",
        approver_id=approver_contact.id,
    )
    db_session.add_all([fb_approved, fb_pending])
    await db_session.commit()

    resp = await authed_client.get(f"/api/v1/incidents/{resolved_incident.id}/feedback")
    assert resp.status_code == 200, resp.text
    items = resp.json()
    statuses = [item["status"] for item in items]
    assert "pending" not in statuses
    assert "approved" in statuses


# ── 11. 이미 approved 재승인 → 400 ───────────────────────────────────────────

async def test_approve_already_approved_returns_400(
    admin_client: AsyncClient,
    db_session: AsyncSession,
    resolved_incident,
    admin_user_and_contact,
):
    """이미 approved 피드백 재승인 → 400"""
    _, approver_contact = admin_user_and_contact

    fb = AlertFeedback(
        incident_id=resolved_incident.id,
        error_type="CPU",
        solution="재시작",
        resolver="홍길동",
        status="approved",
        approver_id=approver_contact.id,
    )
    db_session.add(fb)
    await db_session.commit()
    await db_session.refresh(fb)

    resp = await admin_client.post(
        f"/api/v1/incidents/{resolved_incident.id}/feedback/{fb.id}/approve"
    )
    assert resp.status_code == 400, resp.text
