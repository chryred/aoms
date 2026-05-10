"""4개 신규 챗봇 도구 통합 테스트.

대상 도구:
1. export_chat_markdown   — 대화 기록 markdown 내보내기
2. generate_shift_handoff — 인수인계 보고서 생성
3. admin_save_guide       — knowledge_guides 저장
4. admin_get_incident_context — 인시던트 종합 컨텍스트 조회

LLM을 우회하고 registry.run_tool() 을 직접 호출하여 executor 로직을 검증한다.
Qdrant/log-analyzer 외부 네트워크 호출은 AsyncMock으로 패치한다.
"""

from __future__ import annotations

import uuid
from datetime import datetime, date, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from database import Base, get_db
from models import (
    AlertFeedback,
    AlertHistory,
    ChatMessage,
    ChatSession,
    ChatTool,
    Contact,
    Incident,
    IncidentTimeline,
    KnowledgeGuide,
    LogAnalysisHistory,
    System,
    SystemContact,
    User,
)
from services.chat_tools import registry

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

_KST = timezone(timedelta(hours=9))
_UTC = timezone.utc


# ─────────────────────────── fixtures ────────────────────────────────────────

@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    await engine.dispose()


async def _seed_tool(db, name: str, executor: str = "admin"):
    """chat_tools 에 도구 row 를 삽입한다. input_schema={} 로 세팅해 검증을 우회."""
    tool = ChatTool(
        name=name,
        display_name=name,
        description=name,
        input_schema={},          # 빈 schema → jsonschema.validate가 모든 인자 허용
        executor=executor,
        is_enabled=True,
    )
    db.add(tool)
    await db.flush()


async def _seed_system(db, system_name: str = "cxm", display_name: str = "CXM시스템") -> System:
    sys = System(system_name=system_name, display_name=display_name, status="active")
    db.add(sys)
    await db.flush()
    return sys


def _utcnow():
    return datetime.now(_UTC).replace(tzinfo=None)


def _kst_to_utcnative(dt_kst: datetime) -> datetime:
    """KST aware datetime → naive UTC datetime (DB 저장용)."""
    return dt_kst.astimezone(_UTC).replace(tzinfo=None)


# ══════════════════════════════════════════════════════════════════════════════
# A) export_chat_markdown
# ══════════════════════════════════════════════════════════════════════════════

class TestExportChatMarkdown:

    @pytest.mark.asyncio
    async def test_normal_export_with_slug(self, db_session):
        """정상: 세션 + 5개 메시지 시드 → export=True, 파일명 slug 포함, 내용 포함."""
        await _seed_tool(db_session, "export_chat_markdown")

        # ChatSession 생성
        session_id = str(uuid.uuid4())
        session = ChatSession(
            id=session_id,
            user_id=None,
            title="CPU 급증 테스트",
            area_code="chat_assistant",
            system_ids=[],
        )
        db_session.add(session)
        await db_session.flush()

        # 메시지 5개 삽입 (user/assistant 번갈아)
        roles = ["user", "assistant", "user", "assistant", "user"]
        contents = [
            "CPU가 급증했습니다.",
            "CPU 급증 원인을 분석하겠습니다.",
            "어떤 조치를 취해야 하나요?",
            "해당 프로세스를 재시작하십시오.",
            "감사합니다.",
        ]
        now_utc = _utcnow()
        for i, (r, c) in enumerate(zip(roles, contents)):
            msg = ChatMessage(
                id=str(uuid.uuid4()),
                session_id=session_id,
                role=r,
                content=c,
                created_at=now_utc + timedelta(minutes=i),
            )
            db_session.add(msg)
        await db_session.flush()

        result = await registry.run_tool(
            db_session,
            "export_chat_markdown",
            {"_session_id": session_id, "slug": "cpu-spike"},
        )

        assert "error" not in result, f"예상치 못한 error: {result.get('error')}"
        assert result["export"] is True
        assert result["message_count"] == 5
        assert result["filename"].startswith("synapse-chat-cpu-spike-")
        assert result["filename"].endswith(".md")
        # markdown 안에 메시지 내용 포함 확인
        md = result["markdown"]
        assert "CPU가 급증했습니다." in md
        assert "해당 프로세스를 재시작하십시오." in md

    @pytest.mark.asyncio
    async def test_slug_korean_sanitized_to_empty(self, db_session):
        """한글 슬러그: 영문/숫자 없으므로 sanitize 후 빈 문자열 → 파일명에 슬러그 없이 timestamp만."""
        await _seed_tool(db_session, "export_chat_markdown")

        session_id = str(uuid.uuid4())
        session = ChatSession(
            id=session_id, user_id=None, title="한글 대화",
            area_code="chat_assistant", system_ids=[],
        )
        db_session.add(session)

        msg = ChatMessage(
            id=str(uuid.uuid4()),
            session_id=session_id,
            role="user",
            content="안녕하세요",
            created_at=_utcnow(),
        )
        db_session.add(msg)
        await db_session.flush()

        result = await registry.run_tool(
            db_session,
            "export_chat_markdown",
            {"_session_id": session_id, "slug": "한글주제"},
        )

        assert "error" not in result
        assert result["export"] is True
        # slug가 sanitize되어 None이 됨
        assert result["slug"] is None
        # 파일명에 "synapse-chat-" 직후 timestamp (슬러그 없음)
        assert result["filename"].startswith("synapse-chat-")
        assert "한글" not in result["filename"]

    @pytest.mark.asyncio
    async def test_empty_session_returns_error(self, db_session):
        """빈 세션(메시지 0개) → error 반환."""
        await _seed_tool(db_session, "export_chat_markdown")

        session_id = str(uuid.uuid4())
        session = ChatSession(
            id=session_id, user_id=None, title="빈 세션",
            area_code="chat_assistant", system_ids=[],
        )
        db_session.add(session)
        await db_session.flush()

        result = await registry.run_tool(
            db_session,
            "export_chat_markdown",
            {"_session_id": session_id},
        )

        assert "error" in result
        assert "없습니다" in result["error"]

    @pytest.mark.asyncio
    async def test_missing_session_id_returns_error(self, db_session):
        """_session_id 누락 → error 반환."""
        await _seed_tool(db_session, "export_chat_markdown")

        result = await registry.run_tool(
            db_session,
            "export_chat_markdown",
            {},  # _session_id 없음
        )

        assert "error" in result
        assert "session_id" in result["error"]


# ══════════════════════════════════════════════════════════════════════════════
# B) generate_shift_handoff
# ══════════════════════════════════════════════════════════════════════════════

class TestGenerateShiftHandoff:
    """
    shift window 계산:
      morning 2026-05-10:
        KST 06:00~14:00 → UTC 2026-05-09 21:00:00 ~ 2026-05-10 05:00:00
    """

    # UTC 창 경계 (naive)
    # KST 08:30 = UTC 2026-05-09 23:30
    _MORNING_UTC_INSIDE = datetime(2026, 5, 9, 23, 30, 0)  # within window

    @pytest.mark.asyncio
    async def test_morning_shift_normal(self, db_session):
        """정상 morning: 알림 5개 + LLM 분석 2개 시드 → 집계 일치."""
        await _seed_tool(db_session, "generate_shift_handoff")
        sys = await _seed_system(db_session)

        # AlertHistory 5개 — morning UTC 창 안
        for i in range(5):
            sev = "critical" if i < 2 else "warning"
            ah = AlertHistory(
                system_id=sys.id,
                alert_type="metric",
                severity=sev,
                alertname=f"CPUAlert{i}",
                title=f"CPU 알림 {i}",
                created_at=self._MORNING_UTC_INSIDE + timedelta(minutes=i),
            )
            db_session.add(ah)

        # LogAnalysisHistory 2개 — morning UTC 창 안, warning, excluded=False
        for j in range(2):
            la = LogAnalysisHistory(
                system_id=sys.id,
                instance_role="was1",
                log_content="에러 로그",
                analysis_result="분석 결과",
                severity="warning",
                root_cause="원인 분석",
                recommendation="즉시 재시작",
                excluded=False,
                created_at=self._MORNING_UTC_INSIDE + timedelta(hours=1, minutes=j),
            )
            db_session.add(la)
        await db_session.flush()

        result = await registry.run_tool(
            db_session,
            "generate_shift_handoff",
            {"shift": "morning", "target_date": "2026-05-10"},
        )

        assert "error" not in result, f"예상치 못한 error: {result.get('error')}"
        assert result["export"] is True
        assert result["alert_count"] == 5
        assert result["log_analysis_count"] == 2
        assert result["filename"].startswith("shift-handoff-morning-2026-05-10")
        md = result["markdown"]
        assert "# 인수인계 보고서" in md

    @pytest.mark.asyncio
    async def test_auto_shift_detection(self, db_session):
        """shift/target_date 미지정 → 현재 시각 기반 자동 판정 (에러 없이 정상 동작)."""
        await _seed_tool(db_session, "generate_shift_handoff")

        result = await registry.run_tool(
            db_session,
            "generate_shift_handoff",
            {},
        )

        assert "error" not in result
        assert result["export"] is True
        assert result["shift"] in ("morning", "afternoon", "night")

    @pytest.mark.asyncio
    async def test_empty_db_no_error(self, db_session):
        """알림/분석 0개인 빈 DB → 에러 아님, '해당 교대 발생 알림 없음' 포함."""
        await _seed_tool(db_session, "generate_shift_handoff")

        result = await registry.run_tool(
            db_session,
            "generate_shift_handoff",
            {"shift": "morning", "target_date": "2026-05-10"},
        )

        assert "error" not in result
        assert result["export"] is True
        assert result["alert_count"] == 0
        assert result["log_analysis_count"] == 0
        md = result["markdown"]
        assert "해당 교대 발생 알림 없음" in md

    @pytest.mark.asyncio
    async def test_invalid_target_date_returns_error(self, db_session):
        """잘못된 target_date → error 반환."""
        await _seed_tool(db_session, "generate_shift_handoff")

        result = await registry.run_tool(
            db_session,
            "generate_shift_handoff",
            {"shift": "morning", "target_date": "invalid-date"},
        )

        assert "error" in result
        assert "target_date" in result["error"]


# ══════════════════════════════════════════════════════════════════════════════
# C) admin_save_guide
# ══════════════════════════════════════════════════════════════════════════════

class TestAdminSaveGuide:
    """qdrant_guides.index_guide 를 AsyncMock 으로 패치하여 외부 호출 차단."""

    LONG_CONTENT = "A" * 100  # 최소 30자 이상

    @pytest.mark.asyncio
    async def test_normal_with_system_specified(self, db_session):
        """정상 (system 지정): guide_id UUID, system_display, tags, indexing_dispatched 검증."""
        await _seed_tool(db_session, "admin_save_guide")
        sys = await _seed_system(db_session, "cxm", "CXM시스템")

        with patch("services.qdrant_guides.index_guide", new_callable=AsyncMock):
            result = await registry.run_tool(
                db_session,
                "admin_save_guide",
                {
                    "title": "CPU 급증 대응 가이드",
                    "content": self.LONG_CONTENT,
                    "system_id": sys.id,
                    "category": "incident",
                    "tags": ["cpu", "high-load"],
                },
            )

        assert "error" not in result, f"예상치 못한 error: {result.get('error')}"
        assert len(result["guide_id"]) == 36   # UUID 형식
        assert result["system_display"] == "CXM시스템"
        assert result["tags"] == ["cpu", "high-load"]
        assert result["indexing_dispatched"] is True
        assert result["indexing_error"] is None

        # DB에 실제로 삽입됐는지 확인
        from sqlalchemy import select
        row = (
            await db_session.execute(
                select(KnowledgeGuide).where(KnowledgeGuide.id == result["guide_id"])
            )
        ).scalar_one_or_none()
        assert row is not None
        assert row.title == "CPU 급증 대응 가이드"
        assert row.system_id == sys.id

    @pytest.mark.asyncio
    async def test_index_failure_does_not_orphan_db(self, db_session):
        """index_guide가 예외 raise해도 DB commit 진행 + indexing_dispatched=False 명시."""
        await _seed_tool(db_session, "admin_save_guide")
        sys = await _seed_system(db_session, "cxm", "고객경험시스템")

        with patch("services.qdrant_guides.index_guide", new_callable=AsyncMock) as m:
            m.side_effect = Exception("Qdrant 연결 실패 (테스트)")
            result = await registry.run_tool(
                db_session,
                "admin_save_guide",
                {
                    "title": "테스트 가이드",
                    "content": self.LONG_CONTENT,
                    "system_id": sys.id,
                },
            )

        # 응답 검증
        assert "error" not in result, f"예상치 못한 error: {result.get('error')}"
        assert result.get("guide_id"), "가이드 ID 반환되어야 함"
        assert len(result["guide_id"]) == 36
        assert result["indexing_dispatched"] is False
        assert "Qdrant 연결 실패" in (result.get("indexing_error") or "")
        assert "Qdrant 인덱싱" in result.get("message", "")

        # DB 검증 — guide_id로 row 조회 가능 (commit 진행됨)
        from sqlalchemy import select
        g = (
            await db_session.execute(
                select(KnowledgeGuide).where(KnowledgeGuide.id == result["guide_id"])
            )
        ).scalar_one_or_none()
        assert g is not None
        assert g.title == "테스트 가이드"

    @pytest.mark.asyncio
    async def test_common_guide_no_system_id(self, db_session):
        """공용 가이드 (system_id 미지정) → system_id None, message에 '전체 공용' 포함."""
        await _seed_tool(db_session, "admin_save_guide")

        with patch("services.qdrant_guides.index_guide", new_callable=AsyncMock):
            result = await registry.run_tool(
                db_session,
                "admin_save_guide",
                {
                    "title": "공용 운영 가이드",
                    "content": self.LONG_CONTENT,
                },
            )

        assert "error" not in result
        assert result["system_id"] is None
        assert "전체 공용" in result["message"]

    @pytest.mark.asyncio
    async def test_missing_title_returns_error(self, db_session):
        """title 누락 → error 반환."""
        await _seed_tool(db_session, "admin_save_guide")

        with patch("services.qdrant_guides.index_guide", new_callable=AsyncMock):
            result = await registry.run_tool(
                db_session,
                "admin_save_guide",
                {"title": "", "content": self.LONG_CONTENT},
            )

        assert "error" in result
        assert "title" in result["error"]

    @pytest.mark.asyncio
    async def test_content_too_short_returns_error(self, db_session):
        """content 30자 미만 → error 반환."""
        await _seed_tool(db_session, "admin_save_guide")

        with patch("services.qdrant_guides.index_guide", new_callable=AsyncMock):
            result = await registry.run_tool(
                db_session,
                "admin_save_guide",
                {"title": "짧은 가이드", "content": "짧음"},
            )

        assert "error" in result
        assert "content" in result["error"]

    @pytest.mark.asyncio
    async def test_nonexistent_system_id_returns_error(self, db_session):
        """없는 system_id → error 반환."""
        await _seed_tool(db_session, "admin_save_guide")

        with patch("services.qdrant_guides.index_guide", new_callable=AsyncMock):
            result = await registry.run_tool(
                db_session,
                "admin_save_guide",
                {
                    "title": "시스템 없는 가이드",
                    "content": self.LONG_CONTENT,
                    "system_id": 99999,
                },
            )

        assert "error" in result
        assert "99999" in result["error"]

    @pytest.mark.asyncio
    async def test_tags_string_split_normalization(self, db_session):
        """tags를 콤마 구분 문자열로 전달 → 리스트로 분할됨."""
        await _seed_tool(db_session, "admin_save_guide")

        with patch("services.qdrant_guides.index_guide", new_callable=AsyncMock):
            result = await registry.run_tool(
                db_session,
                "admin_save_guide",
                {
                    "title": "태그 테스트 가이드",
                    "content": self.LONG_CONTENT,
                    "tags": "cpu,high-load,db",
                },
            )

        assert "error" not in result
        assert isinstance(result["tags"], list)
        assert "cpu" in result["tags"]
        assert "high-load" in result["tags"]
        assert "db" in result["tags"]

    @pytest.mark.asyncio
    async def test_tags_capped_at_10(self, db_session):
        """11개 이상 태그 → 최대 10개로 잘림, 에러 없음."""
        await _seed_tool(db_session, "admin_save_guide")

        with patch("services.qdrant_guides.index_guide", new_callable=AsyncMock):
            result = await registry.run_tool(
                db_session,
                "admin_save_guide",
                {
                    "title": "많은 태그 가이드",
                    "content": self.LONG_CONTENT,
                    "tags": [f"tag{i}" for i in range(11)],
                },
            )

        assert "error" not in result
        assert len(result["tags"]) == 10

    @pytest.mark.asyncio
    async def test_content_too_long_returns_error(self, db_session):
        """content가 50000자를 초과하면 에러 반환."""
        await _seed_tool(db_session, "admin_save_guide")

        with patch("services.qdrant_guides.index_guide", new_callable=AsyncMock):
            result = await registry.run_tool(
                db_session,
                "admin_save_guide",
                {
                    "title": "긴 가이드",
                    "content": "x" * 50001,  # 50001자
                },
            )

        assert "error" in result
        assert "너무 깁니다" in result["error"]
        assert "50,000자" in result["error"]


# ══════════════════════════════════════════════════════════════════════════════
# D) admin_get_incident_context
# ══════════════════════════════════════════════════════════════════════════════

class TestAdminGetIncidentContext:

    async def _make_incident(
        self,
        db_session,
        sys: System,
        status: str = "investigating",
        *,
        detected_offset_hours: int = 2,
        acknowledged_offset_hours: int | None = 1,
        resolved_offset_hours: int | None = None,
        closed_offset_hours: int | None = None,
    ) -> Incident:
        now_utc = _utcnow()
        inc = Incident(
            system_id=sys.id,
            title="서버 과부하 인시던트",
            severity="critical",
            status=status,
            detected_at=now_utc - timedelta(hours=detected_offset_hours),
            acknowledged_at=(now_utc - timedelta(hours=acknowledged_offset_hours)) if acknowledged_offset_hours is not None else None,
            resolved_at=(now_utc - timedelta(hours=resolved_offset_hours)) if resolved_offset_hours is not None else None,
            closed_at=(now_utc - timedelta(hours=closed_offset_hours)) if closed_offset_hours is not None else None,
            alert_count=1,
        )
        db_session.add(inc)
        await db_session.flush()
        return inc

    @pytest.mark.asyncio
    async def test_investigating_status(self, db_session):
        """investigating 상태: progress_pct=60, mtta≈60분, mttr=None, 알림/분석/타임라인 개수 검증."""
        await _seed_tool(db_session, "admin_get_incident_context")
        sys = await _seed_system(db_session)

        inc = await self._make_incident(
            db_session, sys,
            status="investigating",
            detected_offset_hours=2,
            acknowledged_offset_hours=1,
        )

        # AlertHistory 3개 연결
        for i in range(3):
            ah = AlertHistory(
                system_id=sys.id,
                incident_id=inc.id,
                alert_type="metric",
                severity="critical",
                alertname=f"Alert{i}",
                title=f"알림 {i}",
                created_at=_utcnow() - timedelta(hours=2, minutes=i),
            )
            db_session.add(ah)

        # LogAnalysisHistory 1개 연결 (warning)
        la = LogAnalysisHistory(
            system_id=sys.id,
            incident_id=inc.id,
            instance_role="was1",
            log_content="에러 로그",
            analysis_result="분석 결과",
            severity="warning",
            root_cause="원인",
            recommendation="조치",
            excluded=False,
            created_at=_utcnow() - timedelta(hours=1, minutes=30),
        )
        db_session.add(la)

        # IncidentTimeline 2개
        for k, et in enumerate(["status_changed", "comment"]):
            tl = IncidentTimeline(
                incident_id=inc.id,
                event_type=et,
                description=f"이벤트 {k}",
                actor_name="system",
                created_at=_utcnow() - timedelta(hours=1, minutes=k),
            )
            db_session.add(tl)
        await db_session.flush()

        result = await registry.run_tool(
            db_session,
            "admin_get_incident_context",
            {"incident_id": inc.id},
        )

        assert "error" not in result, f"예상치 못한 error: {result.get('error')}"
        inc_data = result["incident"]
        assert inc_data["status"] == "investigating"
        assert inc_data["status_ko"] == "조사중"
        assert inc_data["progress_pct"] == 60
        # mtta ≈ 60분 (acknowledged_offset=1h, detected_offset=2h → 2h-1h=1h=60m)
        assert inc_data["mtta_minutes"] == pytest.approx(60, abs=2)
        assert inc_data["mttr_minutes"] is None
        assert len(result["alerts"]) == 3
        assert len(result["log_analyses"]) == 1
        assert len(result["timeline"]) == 2
        assert len(result["next_action"]) > 10

    @pytest.mark.asyncio
    async def test_resolved_status(self, db_session):
        """resolved 상태: progress_pct=80, mttr_minutes가 정수, next_action에 '사후분석' 포함."""
        await _seed_tool(db_session, "admin_get_incident_context")
        sys = await _seed_system(db_session)

        # detected=3h ago, acknowledged=2h ago, resolved=1h ago → mttr≈120분
        inc = await self._make_incident(
            db_session, sys,
            status="resolved",
            detected_offset_hours=3,
            acknowledged_offset_hours=2,
            resolved_offset_hours=1,
        )
        await db_session.flush()

        result = await registry.run_tool(
            db_session,
            "admin_get_incident_context",
            {"incident_id": inc.id},
        )

        assert "error" not in result
        inc_data = result["incident"]
        assert inc_data["status"] == "resolved"
        assert inc_data["progress_pct"] == 80
        assert inc_data["mttr_minutes"] is not None
        assert isinstance(inc_data["mttr_minutes"], int)
        # mttr ≈ 120분 (3h - 1h = 2h = 120m)
        assert inc_data["mttr_minutes"] == pytest.approx(120, abs=2)
        assert "사후 분석" in result["next_action"]

    @pytest.mark.asyncio
    async def test_closed_status(self, db_session):
        """closed 상태: progress_pct=100, next_action에 '추가 액션 불필요' 포함."""
        await _seed_tool(db_session, "admin_get_incident_context")
        sys = await _seed_system(db_session)

        inc = await self._make_incident(
            db_session, sys,
            status="closed",
            detected_offset_hours=5,
            acknowledged_offset_hours=4,
            resolved_offset_hours=2,
            closed_offset_hours=1,
        )
        await db_session.flush()

        result = await registry.run_tool(
            db_session,
            "admin_get_incident_context",
            {"incident_id": inc.id},
        )

        assert "error" not in result
        assert result["incident"]["progress_pct"] == 100
        assert "추가 액션 불필요" in result["next_action"]

    @pytest.mark.asyncio
    async def test_nonexistent_incident_returns_error(self, db_session):
        """없는 incident_id → error 반환."""
        await _seed_tool(db_session, "admin_get_incident_context")

        result = await registry.run_tool(
            db_session,
            "admin_get_incident_context",
            {"incident_id": 99999},
        )

        assert "error" in result
        assert "99999" in result["error"]

    @pytest.mark.asyncio
    async def test_invalid_incident_id_format_returns_error(self, db_session):
        """incident_id='abc' (정수가 아닌 문자열) → error 반환."""
        await _seed_tool(db_session, "admin_get_incident_context")

        result = await registry.run_tool(
            db_session,
            "admin_get_incident_context",
            {"incident_id": "abc"},
        )

        assert "error" in result
        assert "정수" in result["error"]


# ══════════════════════════════════════════════════════════════════════════════
# E) admin_create_feedback
# ══════════════════════════════════════════════════════════════════════════════

class TestAdminCreateFeedback:
    """admin_create_feedback 도구 — 인시던트 피드백 등록"""

    async def _make_user(self, db, email: str, name: str, is_active: bool = True) -> User:
        user = User(
            email=email,
            name=name,
            password_hash="x",
            is_active=is_active,
            is_approved=True,
        )
        db.add(user)
        await db.flush()
        return user

    async def _make_contact(self, db, user: User) -> Contact:
        contact = Contact(user_id=user.id)
        db.add(contact)
        await db.flush()
        return contact

    async def _make_system(self, db, system_name: str = "cxm") -> System:
        sys_obj = System(system_name=system_name, display_name=system_name.upper(), status="active")
        db.add(sys_obj)
        await db.flush()
        return sys_obj

    async def _make_incident(self, db, sys_obj: System, status: str = "resolved") -> Incident:
        now = _utcnow()
        inc = Incident(
            system_id=sys_obj.id,
            title="테스트 인시던트",
            severity="critical",
            status=status,
            detected_at=now - timedelta(hours=2),
            acknowledged_at=now - timedelta(hours=1),
            resolved_at=now if status in ("resolved", "closed") else None,
        )
        db.add(inc)
        await db.flush()
        return inc

    @pytest.mark.asyncio
    async def test_normal_with_explicit_approver(self, db_session):
        """정상: resolved 인시던트 + 명시적 approver_contact_id → feedback_id 반환, DB 검증."""
        await _seed_tool(db_session, "admin_create_feedback")

        user = await self._make_user(db_session, "approver@test.com", "김승인")
        approver = await self._make_contact(db_session, user)
        sys_obj = await self._make_system(db_session, "cxm")
        inc = await self._make_incident(db_session, sys_obj, status="resolved")
        await db_session.flush()

        result = await registry.run_tool(
            db_session,
            "admin_create_feedback",
            {
                "incident_id": inc.id,
                "error_type": "메모리 누수",
                "solution": "## 조치\n1. heap dump\n2. JVM 옵션 -Xmx 증가\n3. 재시작\n4. 모니터링 강화",
                "approver_contact_id": approver.id,
            },
        )

        assert "error" not in result, f"예상치 못한 error: {result.get('error')}"
        assert "feedback_id" in result
        assert result["incident_id"] == inc.id
        assert result["approver_id"] == approver.id
        assert result["approver_name"] == "김승인"
        assert result["status"] == "pending"

        # DB 검증
        from sqlalchemy import select as _select
        fb = (await db_session.execute(
            _select(AlertFeedback).where(AlertFeedback.id == result["feedback_id"])
        )).scalar_one()
        assert fb.solution.startswith("## 조치")
        assert fb.status == "pending"
        assert fb.approver_id == approver.id

    @pytest.mark.asyncio
    async def test_auto_select_primary_approver(self, db_session):
        """approver_contact_id 미지정 → 시스템 primary contact 자동 선택."""
        await _seed_tool(db_session, "admin_create_feedback")

        user = await self._make_user(db_session, "primary@test.com", "Primary담당자")
        primary_contact = await self._make_contact(db_session, user)
        sys_obj = await self._make_system(db_session, "oms")

        sc = SystemContact(system_id=sys_obj.id, contact_id=primary_contact.id, role="primary", notify_channels="teams")
        db_session.add(sc)

        inc = await self._make_incident(db_session, sys_obj, status="closed")
        await db_session.flush()

        result = await registry.run_tool(
            db_session,
            "admin_create_feedback",
            {
                "incident_id": inc.id,
                "error_type": "연결 풀 고갈",
                "solution": "a" * 50,
                # approver_contact_id 미지정 → 자동 선택
            },
        )

        assert "error" not in result, f"예상치 못한 error: {result.get('error')}"
        assert result.get("approver_id") == primary_contact.id

    @pytest.mark.asyncio
    async def test_incident_not_resolved_returns_error(self, db_session):
        """investigating 상태 인시던트 → resolved/closed 아님 에러."""
        await _seed_tool(db_session, "admin_create_feedback")

        sys_obj = await self._make_system(db_session, "inv")
        inc = await self._make_incident(db_session, sys_obj, status="investigating")
        await db_session.flush()

        result = await registry.run_tool(
            db_session,
            "admin_create_feedback",
            {
                "incident_id": inc.id,
                "error_type": "X",
                "solution": "a" * 50,
            },
        )

        assert "error" in result
        assert "resolved" in result["error"] or "closed" in result["error"]

    @pytest.mark.asyncio
    async def test_no_primary_contact_returns_error(self, db_session):
        """primary contact 없는 시스템 + approver 미지정 → 에러."""
        await _seed_tool(db_session, "admin_create_feedback")

        sys_obj = await self._make_system(db_session, "npc")
        inc = await self._make_incident(db_session, sys_obj, status="closed")
        await db_session.flush()

        result = await registry.run_tool(
            db_session,
            "admin_create_feedback",
            {
                "incident_id": inc.id,
                "error_type": "X",
                "solution": "a" * 50,
            },
        )

        assert "error" in result
        assert "primary" in result["error"]

    @pytest.mark.asyncio
    async def test_solution_too_short(self, db_session):
        """solution이 30자 미만 → 길이 에러."""
        await _seed_tool(db_session, "admin_create_feedback")

        result = await registry.run_tool(
            db_session,
            "admin_create_feedback",
            {"incident_id": 1, "error_type": "X", "solution": "짧음"},
        )

        assert "error" in result
        assert "짧" in result["error"] or "30" in result["error"]

    @pytest.mark.asyncio
    async def test_missing_incident_id(self, db_session):
        """incident_id 누락 → 에러."""
        await _seed_tool(db_session, "admin_create_feedback")

        result = await registry.run_tool(
            db_session,
            "admin_create_feedback",
            {"error_type": "X", "solution": "a" * 50},
        )

        assert "error" in result
        assert "incident_id" in result["error"]


# ─────────────────────────── TestAutoInsightSeed ─────────────────────────────

class TestAutoInsightSeed:
    """build_auto_insight_seed — 자동 통찰 prompt 생성기."""

    def test_basic_format(self):
        from services.prompts import build_auto_insight_seed

        seed = build_auto_insight_seed(42)
        assert "인시던트 #42" in seed
        assert "admin_get_incident_context(incident_id=42)" in seed
        assert (
            "qdrant_search_incident_postmortem" in seed
            or "qdrant_search_incident_knowledge" in seed
        )
        assert "🔮" in seed
        assert "한국어" in seed

    def test_with_screen_context(self):
        from services.prompts import build_auto_insight_seed
        from schemas import ScreenContext

        ctx = ScreenContext(
            screen="incidents",
            screen_label="인시던트 상세",
            incident_id="42",
        )
        seed = build_auto_insight_seed(42, ctx)
        assert "인시던트 상세" in seed
        assert "인시던트 #42" in seed

    def test_screen_context_none(self):
        from services.prompts import build_auto_insight_seed

        seed = build_auto_insight_seed(7, None)
        assert "인시던트 #7" in seed
        # screen_label 없으면 빈 괄호 없어야 함
        assert "()" not in seed

    def test_response_length_hint(self):
        from services.prompts import build_auto_insight_seed

        seed = build_auto_insight_seed(1)
        assert "800자" in seed

    def test_numbered_steps_included(self):
        from services.prompts import build_auto_insight_seed

        seed = build_auto_insight_seed(100)
        assert "1." in seed
        assert "2." in seed
        assert "3." in seed


# ─────────────────────────── TestAutoInsightEndpoint ─────────────────────────

class TestAutoInsightEndpoint:
    """POST /chat/sessions/{id}/auto-insight — 라우터 등록 + 스키마 검증."""

    @pytest.mark.asyncio
    async def test_auto_insight_schema_validation_missing_incident_id(self, authed_client):
        """incident_id 미전달 시 422 Unprocessable Entity."""
        resp = await authed_client.post(
            "/api/v1/chat/sessions/any-session-id/auto-insight",
            json={},  # incident_id 없음
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_auto_insight_schema_validation_wrong_type(self, authed_client):
        """incident_id가 문자열이면 422."""
        resp = await authed_client.post(
            "/api/v1/chat/sessions/any-session-id/auto-insight",
            json={"incident_id": "not-an-int"},
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_auto_insight_requires_auth(self, client):
        """인증 없이 요청 시 401."""
        resp = await client.post(
            "/api/v1/chat/sessions/any-session-id/auto-insight",
            json={"incident_id": 1},
        )
        assert resp.status_code == 401


# ══════════════════════════════════════════════════════════════════════════════
# F) _shift_window_kst / _detect_current_shift — night wrap-around 자동 테스트
# ══════════════════════════════════════════════════════════════════════════════

class TestShiftWindowNightWrapAround:
    """_shift_window_kst night 케이스 — 22:00 → 익일 06:00 spanning 검증."""

    def test_night_window_spans_next_day(self):
        """night 창은 target_date 22:00 KST 에서 시작해 target_date+1 06:00 KST 에 끝남 (8시간)."""
        from datetime import date, timedelta, timezone
        from services.chat_tools.executors.admin import _shift_window_kst

        target = date(2026, 5, 10)
        start, end = _shift_window_kst(target, "night")

        kst = timezone(timedelta(hours=9))

        # 시작은 target_date 22:00 KST
        assert start.date() == target
        assert start.hour == 22
        # 끝은 target_date+1 06:00 KST
        assert end.date() == target + timedelta(days=1)
        assert end.hour == 6
        # 총 8시간
        assert (end - start).total_seconds() == 8 * 3600
        # 양쪽 모두 KST tz
        assert start.tzinfo == kst
        assert end.tzinfo == kst

    def test_morning_window_same_day(self):
        """morning 창: target_date 06:00 ~ 14:00 KST, 8시간, 같은 날."""
        from datetime import date
        from services.chat_tools.executors.admin import _shift_window_kst

        target = date(2026, 5, 10)
        start, end = _shift_window_kst(target, "morning")

        assert start.date() == target and end.date() == target
        assert start.hour == 6 and end.hour == 14
        assert (end - start).total_seconds() == 8 * 3600

    def test_afternoon_window_same_day(self):
        """afternoon 창: target_date 14:00 ~ 22:00 KST, 8시간, 같은 날."""
        from datetime import date
        from services.chat_tools.executors.admin import _shift_window_kst

        target = date(2026, 5, 10)
        start, end = _shift_window_kst(target, "afternoon")

        assert start.date() == target and end.date() == target
        assert start.hour == 14 and end.hour == 22
        assert (end - start).total_seconds() == 8 * 3600

    def test_detect_current_shift_at_dawn(self):
        """_detect_current_shift — 각 경계 시각별 교대 판정 검증."""
        from datetime import datetime, timedelta, timezone
        from services.chat_tools.executors.admin import _detect_current_shift

        kst = timezone(timedelta(hours=9))

        # 새벽 3시 → night (전날 야간 교대)
        assert _detect_current_shift(datetime(2026, 5, 10, 3, 0, tzinfo=kst)) == "night"
        # 06:00 정각 → morning
        assert _detect_current_shift(datetime(2026, 5, 10, 6, 0, tzinfo=kst)) == "morning"
        # 13:59 → morning
        assert _detect_current_shift(datetime(2026, 5, 10, 13, 59, tzinfo=kst)) == "morning"
        # 14:00 정각 → afternoon
        assert _detect_current_shift(datetime(2026, 5, 10, 14, 0, tzinfo=kst)) == "afternoon"
        # 21:59 → afternoon
        assert _detect_current_shift(datetime(2026, 5, 10, 21, 59, tzinfo=kst)) == "afternoon"
        # 22:00 정각 → night
        assert _detect_current_shift(datetime(2026, 5, 10, 22, 0, tzinfo=kst)) == "night"
        # 23:59 → night
        assert _detect_current_shift(datetime(2026, 5, 10, 23, 59, tzinfo=kst)) == "night"
