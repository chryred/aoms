"""P1-3 Knowledge Cleanup 단위 테스트.

scheduler_tasks._jira_cleanup_run / _confluence_cleanup_run 의 주요 안전 장치와
admin-api 프록시 엔드포인트를 검증한다.

외부 의존성(httpx + Qdrant HTTP) 은 모두 AsyncMock / MagicMock 으로 패치.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch, call

import pytest
from httpx import AsyncClient


# ── scheduler_tasks 임포트 전 의존 모듈 stub ───────────────────────────────────
# admin-api 테스트 환경에서는 log-analyzer 모듈이 없으므로 stub 처리

def _make_stub_module(name: str) -> types.ModuleType:
    mod = types.ModuleType(name)
    sys.modules[name] = mod
    return mod


def _stub_log_analyzer_deps() -> None:
    """log-analyzer scheduler_tasks 가 import하는 모듈을 stub 처리."""
    for name in ("analyzer", "aggregation_processor"):
        if name not in sys.modules:
            _make_stub_module(name)

    if "knowledge_vector_client" not in sys.modules:
        kvc = _make_stub_module("knowledge_vector_client")
        kvc.QDRANT_URL = "http://qdrant:6333"
        kvc.JIRA_COLLECTION = "knowledge_jira_issues"
        kvc.CONFLUENCE_COLLECTION = "knowledge_confluence_pages"
        # _qdrant_http stub — 각 테스트에서 추가 patch
        kvc._qdrant_http = MagicMock()

    if "vector_client" not in sys.modules:
        vc = _make_stub_module("vector_client")
        # guides_vector_client.py가 'from vector_client import ...' 하므로
        # 필요한 이름을 stub에 추가한다 (없으면 전체 테스트 실행 시 ImportError 발생)
        vc.QDRANT_URL = "http://qdrant:6333"
        vc._qdrant_http = MagicMock()
        vc.ensure_collection = AsyncMock()
        vc.get_embedding = AsyncMock(return_value=[0.0] * 1024)
        vc.get_sparse_vector = AsyncMock(return_value={"indices": [], "values": []})


_stub_log_analyzer_deps()

# scheduler_tasks 를 동적 import (admin-api 테스트 경로에 없으므로 직접 로드)
import importlib
import pathlib

_SCHEDULER_PATH = str(
    pathlib.Path(__file__).parents[3]
    / "services"
    / "log-analyzer"
    / "scheduler_tasks.py"
)

_spec = importlib.util.spec_from_file_location("scheduler_tasks", _SCHEDULER_PATH)
_st = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_st)  # type: ignore[union-attr]
scheduler_tasks = _st


# ── 헬퍼 ─────────────────────────────────────────────────────────────────────

def _mock_jira_resp(issues: list[dict], total: int, status_code: int = 200):
    """단일 Jira REST 페이지 응답 mock."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.raise_for_status = MagicMock() if status_code < 400 else MagicMock(
        side_effect=Exception(f"HTTP {status_code}")
    )
    resp.json.return_value = {"issues": issues, "total": total}
    return resp


def _mock_qdrant_scroll_resp(issue_keys: list[str], next_offset=None):
    """Qdrant /points/scroll 응답 mock."""
    points = [
        {"payload": {"issue_key": k, "project": k.split("-")[0]}}
        for k in issue_keys
    ]
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {
        "result": {
            "points": points,
            "next_page_offset": next_offset,
        }
    }
    return resp


def _mock_qdrant_delete_resp():
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"result": {"operation_id": 0, "status": "completed"}}
    return resp


def _mock_conf_resp(pages: list[dict], has_next: bool = False, status_code: int = 200):
    """단일 Confluence REST 페이지 응답 mock."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.raise_for_status = MagicMock() if status_code < 400 else MagicMock(
        side_effect=Exception(f"HTTP {status_code}")
    )
    links = {"next": "/wiki/rest/api/content?start=100"} if has_next else {}
    resp.json.return_value = {"results": pages, "_links": links}
    return resp


def _mock_qdrant_scroll_conf_resp(page_ids: list[str], next_offset=None):
    points = [{"payload": {"page_id": pid, "space": "DEV"}} for pid in page_ids]
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {
        "result": {"points": points, "next_page_offset": next_offset}
    }
    return resp


# ── Jira cleanup 테스트 ───────────────────────────────────────────────────────

class TestJiraCleanupRun:
    """_jira_cleanup_run() 주요 경로 검증."""

    @pytest.mark.asyncio
    async def test_env_not_configured_returns_skipped(self):
        with (
            patch.object(scheduler_tasks, "JIRA_URL", None),
            patch.object(scheduler_tasks, "JIRA_TOKEN", "tok"),
            patch.object(scheduler_tasks, "JIRA_PROJECTS", "PROJ"),
        ):
            result = await scheduler_tasks._jira_cleanup_run()
        assert result.get("skipped") is True

    @pytest.mark.asyncio
    async def test_no_stale_keys_returns_empty_deleted(self):
        """Jira active = Qdrant — 삭제 없음."""
        jira_issues = [{"key": "PROJ-1"}, {"key": "PROJ-2"}]
        qdrant_keys = ["PROJ-1", "PROJ-2"]

        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=_mock_jira_resp(jira_issues, total=2))

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http = MagicMock()
        kvc._qdrant_http.post = AsyncMock(return_value=_mock_qdrant_scroll_resp(qdrant_keys))

        with (
            patch.object(scheduler_tasks, "JIRA_URL", "http://jira"),
            patch.object(scheduler_tasks, "JIRA_TOKEN", "tok"),
            patch.object(scheduler_tasks, "JIRA_PROJECTS", "PROJ"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._jira_cleanup_run()

        assert result["deleted"] == 0
        assert result["missing"] == 0
        assert result["errors"] == 0

    @pytest.mark.asyncio
    async def test_stale_key_is_deleted(self):
        """Qdrant에만 있고 Jira active에 없는 키 — purge."""
        jira_issues = [{"key": "PROJ-1"}]
        qdrant_keys = ["PROJ-1", "PROJ-STALE"]

        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=_mock_jira_resp(jira_issues, total=1))

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http = MagicMock()
        # scroll 1회, delete 1회
        kvc._qdrant_http.post = AsyncMock(
            side_effect=[
                _mock_qdrant_scroll_resp(qdrant_keys),   # scroll
                _mock_qdrant_delete_resp(),               # delete
            ]
        )

        with (
            patch.object(scheduler_tasks, "JIRA_URL", "http://jira"),
            patch.object(scheduler_tasks, "JIRA_TOKEN", "tok"),
            patch.object(scheduler_tasks, "JIRA_PROJECTS", "PROJ"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._jira_cleanup_run()

        assert result["deleted"] == 1
        assert result["missing"] == 1
        assert result["errors"] == 0

    @pytest.mark.asyncio
    async def test_dry_run_no_delete(self):
        """dry_run=True — Qdrant delete 미호출."""
        jira_issues = [{"key": "PROJ-1"}]
        qdrant_keys = ["PROJ-1", "PROJ-STALE"]

        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=_mock_jira_resp(jira_issues, total=1))

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http = MagicMock()
        kvc._qdrant_http.post = AsyncMock(return_value=_mock_qdrant_scroll_resp(qdrant_keys))

        with (
            patch.object(scheduler_tasks, "JIRA_URL", "http://jira"),
            patch.object(scheduler_tasks, "JIRA_TOKEN", "tok"),
            patch.object(scheduler_tasks, "JIRA_PROJECTS", "PROJ"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._jira_cleanup_run(dry_run=True)

        assert result["dry_run"] is True
        assert result["deleted"] == 0       # 삭제 없음
        assert result["missing"] == 1       # 후보는 감지됨
        # Qdrant post 는 scroll 1회만 (delete 호출 없음)
        assert kvc._qdrant_http.post.call_count == 1

    @pytest.mark.asyncio
    async def test_api_error_aborts_project(self):
        """Jira API 오류 → 해당 프로젝트 purge 건너뜀, Qdrant delete 미호출."""
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=Exception("connection error"))

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        delete_mock = AsyncMock()
        kvc._qdrant_http.post = delete_mock

        with (
            patch.object(scheduler_tasks, "JIRA_URL", "http://jira"),
            patch.object(scheduler_tasks, "JIRA_TOKEN", "tok"),
            patch.object(scheduler_tasks, "JIRA_PROJECTS", "PROJ"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._jira_cleanup_run()

        assert result["errors"] == 1
        assert result["deleted"] == 0
        # scroll も delete も呼ばれない
        delete_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_incomplete_pagination_aborts_project(self):
        """total=100 이지만 반환 건수가 50 — abort."""
        # 50개만 반환, total=100
        issues_page1 = [{"key": f"PROJ-{i}"} for i in range(50)]
        # 두 번째 호출 시 빈 리스트 (early stop 흉내)
        jira_responses = [
            _mock_jira_resp(issues_page1, total=100),    # 첫 페이지: 50건 / total=100
            _mock_jira_resp([], total=100),              # 두 번째 페이지: 빈 결과
        ]

        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=jira_responses)

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http.post = AsyncMock()  # should NOT be called

        with (
            patch.object(scheduler_tasks, "JIRA_URL", "http://jira"),
            patch.object(scheduler_tasks, "JIRA_TOKEN", "tok"),
            patch.object(scheduler_tasks, "JIRA_PROJECTS", "PROJ"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._jira_cleanup_run()

        assert result["errors"] == 1
        assert result["deleted"] == 0
        # Qdrant scroll は呼ばれない (fetch_ok=False で continue)
        kvc._qdrant_http.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_active_list_skips_project(self):
        """active issue 0건 — purge 건너뜀 (false-positive 방지)."""
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        # total=0, issues=[] 응답
        mock_client.get = AsyncMock(return_value=_mock_jira_resp([], total=0))

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http.post = AsyncMock()

        with (
            patch.object(scheduler_tasks, "JIRA_URL", "http://jira"),
            patch.object(scheduler_tasks, "JIRA_TOKEN", "tok"),
            patch.object(scheduler_tasks, "JIRA_PROJECTS", "PROJ"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._jira_cleanup_run()

        assert result["errors"] == 0           # 정상 skip — error 아님
        assert result["skipped"] == 1          # skipped_details 에 기록됨
        assert result["deleted"] == 0
        kvc._qdrant_http.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_safety_threshold_aborts_purge(self):
        """missing > 50% of qdrant_set — purge 중단."""
        # Jira active: 1건, Qdrant: 3건 (missing=2 → 66% > 50%)
        jira_issues = [{"key": "PROJ-1"}]
        qdrant_keys = ["PROJ-1", "PROJ-2", "PROJ-3"]

        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=_mock_jira_resp(jira_issues, total=1))

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http.post = AsyncMock(return_value=_mock_qdrant_scroll_resp(qdrant_keys))

        with (
            patch.object(scheduler_tasks, "JIRA_URL", "http://jira"),
            patch.object(scheduler_tasks, "JIRA_TOKEN", "tok"),
            patch.object(scheduler_tasks, "JIRA_PROJECTS", "PROJ"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._jira_cleanup_run()

        assert result["deleted"] == 0
        assert result["errors"] == 1
        # scroll 만 1회, delete 는 없음
        assert kvc._qdrant_http.post.call_count == 1

    @pytest.mark.asyncio
    async def test_partial_project_success(self):
        """프로젝트 A는 성공 purge, 프로젝트 B는 API 실패 — A만 삭제."""
        # A: 1 active, qdrant has 2 (1 stale)
        # B: API error
        import sys

        jira_resp_a = _mock_jira_resp([{"key": "A-1"}], total=1)
        jira_resp_b_fail = MagicMock()
        jira_resp_b_fail.raise_for_status = MagicMock(side_effect=Exception("fail"))

        call_count = {"n": 0}

        async def jira_get_side_effect(*args, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return jira_resp_a
            return jira_resp_b_fail

        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=jira_get_side_effect)

        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http.post = AsyncMock(
            side_effect=[
                _mock_qdrant_scroll_resp(["A-1", "A-STALE"]),  # scroll for A
                _mock_qdrant_delete_resp(),                     # delete for A
            ]
        )

        with (
            patch.object(scheduler_tasks, "JIRA_URL", "http://jira"),
            patch.object(scheduler_tasks, "JIRA_TOKEN", "tok"),
            patch.object(scheduler_tasks, "JIRA_PROJECTS", "A,B"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._jira_cleanup_run()

        assert result["deleted"] == 1   # A만 삭제
        assert result["errors"] == 1    # B 오류


# ── Confluence cleanup 테스트 ─────────────────────────────────────────────────

class TestConfluenceCleanupRun:
    """_confluence_cleanup_run() 주요 경로 검증."""

    @pytest.mark.asyncio
    async def test_env_not_configured_returns_skipped(self):
        with (
            patch.object(scheduler_tasks, "CONFLUENCE_URL", None),
            patch.object(scheduler_tasks, "CONFLUENCE_TOKEN", "tok"),
            patch.object(scheduler_tasks, "CONFLUENCE_SPACES", "DEV"),
        ):
            result = await scheduler_tasks._confluence_cleanup_run()
        assert result.get("skipped") is True

    @pytest.mark.asyncio
    async def test_stale_page_is_deleted(self):
        """Qdrant 에만 있는 page_id — purge."""
        conf_pages = [{"id": "101"}]
        qdrant_ids = ["101", "999"]  # 999 is stale

        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=_mock_conf_resp(conf_pages, has_next=False))

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http.post = AsyncMock(
            side_effect=[
                _mock_qdrant_scroll_conf_resp(qdrant_ids),   # scroll
                _mock_qdrant_delete_resp(),                   # delete page 999
            ]
        )

        with (
            patch.object(scheduler_tasks, "CONFLUENCE_URL", "http://conf"),
            patch.object(scheduler_tasks, "CONFLUENCE_TOKEN", "tok"),
            patch.object(scheduler_tasks, "CONFLUENCE_SPACES", "DEV"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._confluence_cleanup_run()

        assert result["deleted"] == 1
        assert result["errors"] == 0

    @pytest.mark.asyncio
    async def test_api_error_aborts_space(self):
        """Confluence API 오류 → 스페이스 건너뜀."""
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=Exception("timeout"))

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http.post = AsyncMock()

        with (
            patch.object(scheduler_tasks, "CONFLUENCE_URL", "http://conf"),
            patch.object(scheduler_tasks, "CONFLUENCE_TOKEN", "tok"),
            patch.object(scheduler_tasks, "CONFLUENCE_SPACES", "DEV"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._confluence_cleanup_run()

        assert result["errors"] == 1
        assert result["deleted"] == 0
        kvc._qdrant_http.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_active_list_skips_space(self):
        """active 페이지 0건 — purge 건너뜀."""
        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=_mock_conf_resp([], has_next=False))

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http.post = AsyncMock()

        with (
            patch.object(scheduler_tasks, "CONFLUENCE_URL", "http://conf"),
            patch.object(scheduler_tasks, "CONFLUENCE_TOKEN", "tok"),
            patch.object(scheduler_tasks, "CONFLUENCE_SPACES", "DEV"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._confluence_cleanup_run()

        assert result["errors"] == 0           # 정상 skip — error 아님
        assert result["skipped"] == 1          # skipped_details 에 기록됨
        assert result["deleted"] == 0
        kvc._qdrant_http.post.assert_not_called()

    @pytest.mark.asyncio
    async def test_safety_threshold_aborts_confluence(self):
        """missing > 50% — purge 중단."""
        # active 1개, qdrant 3개 (missing=2, 66%)
        conf_pages = [{"id": "101"}]
        qdrant_ids = ["101", "102", "103"]

        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=_mock_conf_resp(conf_pages, has_next=False))

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http.post = AsyncMock(
            return_value=_mock_qdrant_scroll_conf_resp(qdrant_ids)
        )

        with (
            patch.object(scheduler_tasks, "CONFLUENCE_URL", "http://conf"),
            patch.object(scheduler_tasks, "CONFLUENCE_TOKEN", "tok"),
            patch.object(scheduler_tasks, "CONFLUENCE_SPACES", "DEV"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._confluence_cleanup_run()

        assert result["deleted"] == 0
        assert result["errors"] == 1
        # scroll 1회만, delete 없음
        assert kvc._qdrant_http.post.call_count == 1

    @pytest.mark.asyncio
    async def test_dry_run_no_delete(self):
        """dry_run=True — Qdrant delete 미호출."""
        conf_pages = [{"id": "101"}]
        qdrant_ids = ["101", "STALE"]

        mock_client = MagicMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=_mock_conf_resp(conf_pages, has_next=False))

        import sys
        kvc = sys.modules["knowledge_vector_client"]
        kvc._qdrant_http.post = AsyncMock(
            return_value=_mock_qdrant_scroll_conf_resp(qdrant_ids)
        )

        with (
            patch.object(scheduler_tasks, "CONFLUENCE_URL", "http://conf"),
            patch.object(scheduler_tasks, "CONFLUENCE_TOKEN", "tok"),
            patch.object(scheduler_tasks, "CONFLUENCE_SPACES", "DEV"),
            patch("httpx.AsyncClient", return_value=mock_client),
        ):
            result = await scheduler_tasks._confluence_cleanup_run(dry_run=True)

        assert result["dry_run"] is True
        assert result["deleted"] == 0
        assert result["missing"] == 1
        # scroll 만 1회
        assert kvc._qdrant_http.post.call_count == 1


# ── admin-api 프록시 엔드포인트 테스트 ────────────────────────────────────────

class TestCleanupProxyRoute:
    """POST /api/v1/knowledge/cleanup/{source} 엔드포인트 테스트."""

    @pytest.mark.asyncio
    async def test_cleanup_requires_auth(self, client: AsyncClient):
        resp = await client.post("/api/v1/knowledge/cleanup/jira")
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_cleanup_requires_admin(self, authed_operator_client: AsyncClient):
        resp = await authed_operator_client.post("/api/v1/knowledge/cleanup/jira")
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_invalid_source_returns_400(self, authed_client: AsyncClient):
        resp = await authed_client.post("/api/v1/knowledge/cleanup/invalid")
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_jira_cleanup_trigger(self, authed_client: AsyncClient):
        with patch(
            "services.knowledge_service.call_trigger_cleanup",
            new_callable=AsyncMock,
            return_value={"queued": True},
        ):
            resp = await authed_client.post("/api/v1/knowledge/cleanup/jira")
        assert resp.status_code == 200
        assert resp.json().get("queued") is True

    @pytest.mark.asyncio
    async def test_confluence_cleanup_dry_run(self, authed_client: AsyncClient):
        with patch(
            "services.knowledge_service.call_trigger_cleanup",
            new_callable=AsyncMock,
            return_value={"queued": True},
        ) as mock_call:
            resp = await authed_client.post(
                "/api/v1/knowledge/cleanup/confluence",
                params={"dry_run": "true"},
            )
        assert resp.status_code == 200
        mock_call.assert_awaited_once_with("confluence", dry_run=True)


# ── conftest.py 에 없는 operator 전용 fixture ──────────────────────────────────

@pytest.fixture
async def authed_operator_client(db_session):
    """role=operator 인 인증된 클라이언트 — admin 전용 엔드포인트 403 검증용."""
    from auth import get_current_user
    from database import get_db
    from models import User
    from main import app
    from httpx import AsyncClient, ASGITransport

    fake_op = User(
        email="op@test.com",
        password_hash="hashed",
        name="오퍼레이터",
        role="operator",
        is_active=True,
        is_approved=True,
    )
    db_session.add(fake_op)
    await db_session.flush()

    async def override_get_db():
        yield db_session

    async def override_get_current_user():
        return fake_op

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
