"""챗봇 검색 검증 라우터 단위 테스트.

외부 HTTP(log-analyzer): AsyncMock으로 패치.
DB: SQLite in-memory (conftest.py 공통 fixture 사용).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


# ── 공통 mock 응답 ──────────────────────────────────────────────────────────────

def _mock_incident_response() -> dict:
    return {
        "log_incidents": [
            {
                "system_name": "cxm",
                "severity": "critical",
                "log_pattern": "OOM 발생",
                "root_cause": "힙 메모리 부족",
                "recommendation": "JVM 힙 증가",
                "resolution": "힙 2GB로 확장",
                "resolver": "hong",
                "timestamp": "2026-01-01T00:00:00",
                "score": 0.85,
                "point_id": "point-log-1",
            }
        ],
        "metric_incidents": [
            {
                "system_name": "cxm",
                "metric_name": "cpu_usage",
                "alertname": "HighCPU",
                "severity": "warning",
                "resolution": "프로세스 재시작",
                "resolver": "kim",
                "timestamp": "2026-01-02T00:00:00",
                "score": 0.72,
                "point_id": "point-metric-1",
            }
        ],
    }


def _mock_aggregation_response() -> dict:
    return {
        "results": [
            {
                "id": "point-agg-1",
                "score": 0.78,
                "payload": {
                    "system_name": "cxm",
                    "period_type": "daily",
                    "period_start": "2026-01-01T00:00:00",
                    "summary_text": "일일 집계 요약 텍스트입니다.",
                    "dominant_severity": "warning",
                },
            }
        ]
    }


def _mock_postmortem_response() -> dict:
    return {
        "results": [
            {
                "point_id": "point-pm-1",
                "score": 0.80,
                "system_id": 1,
                "system_name": "cxm",
                "title": "메모리 누수 인시던트",
                "root_cause": "힙 메모리 누수",
                "solution": "JVM 옵션 조정",
                "attachment_text": "첨부 OCR 내용",
                "severity": "critical",
                "alert_count": 3,
                "resolved_at": "2026-01-10T12:00:00",
                "incident_id": 42,
            }
        ]
    }


def _mock_knowledge_response() -> dict:
    """log-analyzer federated_search 의 실제 응답 형식 — { collection, point_id, score, payload }."""
    return {
        "results": [
            {
                "collection": "knowledge_documents",
                "point_id": "point-doc-1",
                "score": 0.65,
                "payload": {
                    "doc_type": "docx",
                    "title": "운영 매뉴얼",
                    "text": "배포 절차 설명",
                    "system_id": 1,
                    "tags": ["ops"],
                    "file_name": "manual.pdf",
                    "file_hash": "hash-abc",
                    "chunk_index": 0,
                },
            },
            {
                "collection": "knowledge_jira_issues",
                "point_id": "point-jira-1",
                "score": 0.60,
                "payload": {
                    "title": "INC-123",
                    "description": "Jira 이슈 내용",
                    "system_id": None,
                    "jira_key": "INC-123",
                },
            },
        ]
    }


def _make_mock_httpx_response(data: dict, status_code: int = 200) -> MagicMock:
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = data
    mock_resp.text = str(data)
    return mock_resp


# ── 권한 테스트 ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_chatbot_requires_auth(client: AsyncClient):
    """비로그인 시 401."""
    resp = await client.post(
        "/api/v1/knowledge/search-verify/chatbot",
        json={"query": "OOM", "system_ids": []},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_collections_requires_auth(client: AsyncClient):
    """비로그인 시 401."""
    resp = await client.post(
        "/api/v1/knowledge/search-verify/collections",
        json={"query": "OOM", "system_ids": [], "collections": ["log_incidents"]},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_chatbot_operator_allowed(authed_client: AsyncClient):
    """operator(authed_client는 admin이지만 같은 경로) → 200."""
    from auth import get_current_user
    from models import User

    fake_operator = User(
        email="op@test.com",
        password_hash="hashed",
        name="운영자",
        role="operator",
        is_active=True,
        is_approved=True,
    )

    from database import get_db
    from main import app
    from httpx import AsyncClient as HxClient, ASGITransport
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from database import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db_sess:
        db_sess.add(fake_operator)
        await db_sess.flush()

        app.dependency_overrides[get_db] = lambda: (yield db_sess)
        app.dependency_overrides[get_current_user] = lambda: fake_operator

        with patch("httpx.AsyncClient") as mock_cls:
            mock_instance = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
            mock_instance.post = AsyncMock(side_effect=[
                _make_mock_httpx_response(_mock_incident_response()),
                _make_mock_httpx_response(_mock_postmortem_response()),
                _make_mock_httpx_response(_mock_aggregation_response()),
                _make_mock_httpx_response(_mock_knowledge_response()),
            ])

            async with HxClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/v1/knowledge/search-verify/chatbot",
                    json={"query": "OOM", "system_ids": [1]},
                )

        app.dependency_overrides.clear()

    assert resp.status_code == 200


# ── 챗봇 모드 통합 결과 ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_chatbot_mode_integrates_four_tools(authed_client: AsyncClient):
    """4개 도구 결과가 통합되고 점수 내림차순으로 반환된다."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        # incident, postmortem, aggregation, knowledge 순서로 4번 호출
        mock_instance.post = AsyncMock(side_effect=[
            _make_mock_httpx_response(_mock_incident_response()),
            _make_mock_httpx_response(_mock_postmortem_response()),
            _make_mock_httpx_response(_mock_aggregation_response()),
            _make_mock_httpx_response(_mock_knowledge_response()),
        ])

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/chatbot",
            json={"query": "OOM 원인", "system_ids": [1]},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "results" in data
    assert "used_tools" in data

    # 4개 도구 모두 사용됨
    used = set(data["used_tools"])
    assert "qdrant_search_incident_knowledge" in used
    assert "qdrant_search_incident_postmortem" in used
    assert "qdrant_search_aggregation_summary" in used
    assert "qdrant_search_knowledge" in used

    # 총 결과 수: log(1) + metric(1) + postmortem(1) + aggregation(1) + knowledge(2) = 6
    assert len(data["results"]) == 6

    # 점수 내림차순 정렬 확인
    scores = [r["score"] for r in data["results"] if r["score"] is not None]
    assert scores == sorted(scores, reverse=True)


@pytest.mark.asyncio
async def test_chatbot_mode_empty_query_returns_400(authed_client: AsyncClient):
    """빈 query → 400."""
    resp = await authed_client.post(
        "/api/v1/knowledge/search-verify/chatbot",
        json={"query": "  ", "system_ids": []},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_chatbot_mode_collection_field_present(authed_client: AsyncClient):
    """각 결과 아이템에 collection 필드가 있다."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(side_effect=[
            _make_mock_httpx_response(_mock_incident_response()),
            _make_mock_httpx_response(_mock_postmortem_response()),
            _make_mock_httpx_response(_mock_aggregation_response()),
            _make_mock_httpx_response(_mock_knowledge_response()),
        ])

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/chatbot",
            json={"query": "장애", "system_ids": []},
        )

    assert resp.status_code == 200
    for item in resp.json()["results"]:
        assert "collection" in item
        assert item["collection"] in {
            "log_incidents", "metric_baselines",
            "incident_postmortems",
            "aggregation_summaries", "metric_hourly_patterns",
            "knowledge_jira_issues", "knowledge_confluence_pages", "knowledge_documents",
        }


# ── 컬렉션 모드 분기 ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_collections_mode_incident_only(authed_client: AsyncClient):
    """log_incidents 만 선택 시 incident 엔드포인트만 호출."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(return_value=_make_mock_httpx_response(
            _mock_incident_response()
        ))

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/collections",
            json={
                "query": "OOM",
                "system_ids": [1],
                "collections": ["log_incidents"],
                "use_reranker": False,
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    # log_incidents 결과만 포함 (metric_baselines 제거됨)
    for item in data["results"]:
        assert item["collection"] == "log_incidents"


@pytest.mark.asyncio
async def test_collections_mode_aggregation_only(authed_client: AsyncClient):
    """aggregation_summaries 만 선택."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(return_value=_make_mock_httpx_response(
            _mock_aggregation_response()
        ))

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/collections",
            json={
                "query": "일일 집계",
                "system_ids": [1],
                "collections": ["aggregation_summaries"],
                "use_reranker": False,
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 1
    assert data["results"][0]["collection"] == "aggregation_summaries"


@pytest.mark.asyncio
async def test_collections_mode_knowledge_only(authed_client: AsyncClient):
    """knowledge_documents 선택 시 /knowledge/search 호출."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(return_value=_make_mock_httpx_response(
            {"results": [
                {
                    "collection": "knowledge_documents",
                    "point_id": "point-doc-x",
                    "score": 0.75,
                    "payload": {
                        "doc_type": "docx",
                        "title": "테스트 문서",
                        "text": "내용",
                        "system_id": 1,
                        "file_name": "test.docx",
                        "file_hash": "hash-xyz",
                    },
                }
            ]}
        ))

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/collections",
            json={
                "query": "배포",
                "system_ids": [1],
                "collections": ["knowledge_documents"],
                "use_reranker": True,
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 1
    assert data["results"][0]["collection"] == "knowledge_documents"


@pytest.mark.asyncio
async def test_collections_mode_empty_collections_returns_400(authed_client: AsyncClient):
    """빈 컬렉션 목록 → 400."""
    resp = await authed_client.post(
        "/api/v1/knowledge/search-verify/collections",
        json={"query": "OOM", "system_ids": [], "collections": []},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_collections_mode_log_analyzer_error_graceful(authed_client: AsyncClient):
    """log-analyzer 오류 시 결과 빈 목록 반환 (500 아님)."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(side_effect=Exception("Connection refused"))

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/collections",
            json={
                "query": "장애",
                "system_ids": [],
                "collections": ["log_incidents"],
            },
        )

    assert resp.status_code == 200
    assert resp.json()["results"] == []


@pytest.mark.asyncio
async def test_collections_mode_postmortem_only(authed_client: AsyncClient):
    """incident_postmortems 만 선택 시 postmortem 엔드포인트만 호출되고 결과가 반환된다."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(return_value=_make_mock_httpx_response(
            _mock_postmortem_response()
        ))

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/collections",
            json={
                "query": "메모리 누수",
                "system_ids": [1],
                "collections": ["incident_postmortems"],
                "use_reranker": False,
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 1
    result = data["results"][0]
    assert result["collection"] == "incident_postmortems"
    assert result["tool"] == "qdrant_search_incident_postmortem"
    assert result["doc_type"] == "incident_postmortem"
    assert result["incident_id"] == 42


@pytest.mark.asyncio
async def test_collections_mode_postmortem_system_filter(authed_client: AsyncClient):
    """incident_postmortems 검색 시 system_ids 1개면 system_id 필터가 payload에 포함된다."""
    captured_payloads: list[dict] = []

    async def capturing_post(url: str, json: dict | None = None, **kwargs):
        if json is not None:
            captured_payloads.append(json)
        return _make_mock_httpx_response(_mock_postmortem_response())

    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(side_effect=capturing_post)

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/collections",
            json={
                "query": "장애",
                "system_ids": [7],
                "collections": ["incident_postmortems"],
            },
        )

    assert resp.status_code == 200
    assert len(captured_payloads) == 1
    assert captured_payloads[0].get("system_id") == 7


@pytest.mark.asyncio
async def test_collections_mode_postmortem_no_system_filter_for_multiple(authed_client: AsyncClient):
    """incident_postmortems 검색 시 system_ids 2개 이상이면 system_id 필터 미포함."""
    captured_payloads: list[dict] = []

    async def capturing_post(url: str, json: dict | None = None, **kwargs):
        if json is not None:
            captured_payloads.append(json)
        return _make_mock_httpx_response(_mock_postmortem_response())

    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(side_effect=capturing_post)

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/collections",
            json={
                "query": "장애",
                "system_ids": [1, 2],
                "collections": ["incident_postmortems"],
            },
        )

    assert resp.status_code == 200
    assert len(captured_payloads) == 1
    assert "system_id" not in captured_payloads[0]
