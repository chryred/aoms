"""챗봇 검색 검증 라우터 단위 테스트.

외부 HTTP(log-analyzer): AsyncMock으로 패치.
DB: SQLite in-memory (conftest.py 공통 fixture 사용).

응답 스키마 v2: { groups: CollectionGroup[], used_tools: str[], errors: ToolError[] }
  CollectionGroup: { collection, tool, reranked, results: dict[] }
  ToolError:       { tool, collection, reason }
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
    """log-analyzer /incident-postmortem/search 응답: list 형식."""
    return [
        {
            "id": "point-pm-1",
            "score": 0.80,
            "payload": {
                "system_id": 1,
                "system_name": "cxm",
                "title": "메모리 누수 인시던트",
                "root_cause": "힙 메모리 누수",
                "solution": "JVM 옵션 조정",
                "ocr_text": "첨부 OCR 내용",
                "severity": "critical",
                "alert_count": 3,
                "resolved_at": "2026-01-10T12:00:00",
                "incident_id": 42,
            },
        }
    ]


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


def _make_mock_httpx_response(data, status_code: int = 200) -> MagicMock:
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = data
    mock_resp.text = str(data)
    return mock_resp


def _groups_by_collection(data: dict) -> dict[str, dict]:
    """응답 groups 목록을 {collection: group} 딕셔너리로 인덱싱."""
    return {g["collection"]: g for g in data.get("groups", [])}


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


# ── 챗봇 모드 — 그룹 기반 결과 검증 ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_chatbot_mode_integrates_four_tools(authed_client: AsyncClient):
    """4개 도구 결과가 컬렉션별 그룹으로 분리되어 반환된다."""
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
            json={"query": "OOM 원인", "system_ids": [1]},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "groups" in data
    assert "used_tools" in data
    assert "errors" in data

    # 4개 도구 모두 사용됨
    used = set(data["used_tools"])
    assert "qdrant_search_incident_knowledge" in used
    assert "qdrant_search_incident_postmortem" in used
    assert "qdrant_search_aggregation_summary" in used
    assert "qdrant_search_knowledge" in used

    # 그룹별 컬렉션 확인 — mock 데이터에서 실제 결과가 있는 컬렉션
    groups = _groups_by_collection(data)
    assert "log_incidents" in groups
    assert "metric_baselines" in groups
    assert "incident_postmortems" in groups
    assert "aggregation_summaries" in groups
    assert "knowledge_documents" in groups
    assert "knowledge_jira_issues" in groups

    # 그룹 내 결과 수 확인
    assert len(groups["log_incidents"]["results"]) == 1
    assert len(groups["metric_baselines"]["results"]) == 1
    assert len(groups["incident_postmortems"]["results"]) == 1
    assert len(groups["aggregation_summaries"]["results"]) == 1

    # knowledge 그룹: documents 1개, jira 1개
    assert len(groups["knowledge_documents"]["results"]) == 1
    assert len(groups["knowledge_jira_issues"]["results"]) == 1

    # 오류 없음
    assert data["errors"] == []


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
    """각 그룹의 results 아이템에 collection 필드가 있다."""
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
    data = resp.json()
    valid_collections = {
        "log_incidents", "metric_baselines",
        "incident_postmortems",
        "aggregation_summaries", "metric_hourly_patterns",
        "knowledge_jira_issues", "knowledge_confluence_pages", "knowledge_documents",
    }
    for group in data["groups"]:
        assert group["collection"] in valid_collections
        for item in group["results"]:
            assert "collection" in item
            assert item["collection"] == group["collection"]


@pytest.mark.asyncio
async def test_chatbot_mode_group_internal_sort(authed_client: AsyncClient):
    """그룹 내 결과는 점수 내림차순 정렬된다."""
    # knowledge 그룹에 점수 역순 데이터 주입
    knowledge_resp = {
        "results": [
            {
                "collection": "knowledge_documents",
                "point_id": "pt-low",
                "score": 0.40,
                "payload": {"text": "낮은 점수", "doc_type": "docx", "system_id": 1},
            },
            {
                "collection": "knowledge_documents",
                "point_id": "pt-high",
                "score": 0.90,
                "payload": {"text": "높은 점수", "doc_type": "docx", "system_id": 1},
            },
        ]
    }

    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(side_effect=[
            _make_mock_httpx_response({"log_incidents": [], "metric_incidents": []}),
            _make_mock_httpx_response([]),
            _make_mock_httpx_response({"results": []}),
            _make_mock_httpx_response(knowledge_resp),
        ])

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/chatbot",
            json={"query": "검색", "system_ids": []},
        )

    assert resp.status_code == 200
    groups = _groups_by_collection(resp.json())
    doc_group = groups.get("knowledge_documents")
    assert doc_group is not None
    scores = [r["score"] for r in doc_group["results"]]
    assert scores == sorted(scores, reverse=True), "그룹 내 점수 내림차순 정렬 실패"


@pytest.mark.asyncio
async def test_chatbot_mode_knowledge_reranked_flag(authed_client: AsyncClient):
    """chatbot 모드: knowledge 그룹에 reranked=True, 나머지는 reranked=False."""
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
    groups = _groups_by_collection(resp.json())
    knowledge_collections = {"knowledge_jira_issues", "knowledge_confluence_pages", "knowledge_documents"}
    non_knowledge = {"log_incidents", "metric_baselines", "incident_postmortems", "aggregation_summaries"}

    for col in knowledge_collections:
        if col in groups:
            assert groups[col]["reranked"] is True, f"{col} 그룹이 reranked=True여야 함"
    for col in non_knowledge:
        if col in groups:
            assert groups[col]["reranked"] is False, f"{col} 그룹이 reranked=False여야 함"


@pytest.mark.asyncio
async def test_chatbot_mode_partial_failure_generates_errors(authed_client: AsyncClient):
    """일부 도구 실패 시 errors 목록에 컬렉션별 에러가 포함된다 (500 아님)."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        # knowledge 호출만 실패
        mock_instance.post = AsyncMock(side_effect=[
            _make_mock_httpx_response(_mock_incident_response()),
            _make_mock_httpx_response(_mock_postmortem_response()),
            _make_mock_httpx_response(_mock_aggregation_response()),
            Exception("knowledge 서버 오류"),
        ])

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/chatbot",
            json={"query": "장애", "system_ids": []},
        )

    assert resp.status_code == 200
    data = resp.json()
    # knowledge 실패 → 3개 컬렉션 에러
    error_collections = {e["collection"] for e in data["errors"]}
    assert "knowledge_jira_issues" in error_collections
    assert "knowledge_confluence_pages" in error_collections
    assert "knowledge_documents" in error_collections
    # 성공한 그룹은 정상 반환
    groups = _groups_by_collection(data)
    assert "log_incidents" in groups
    assert "incident_postmortems" in groups


# ── 컬렉션 모드 — 그룹 기반 결과 검증 ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_collections_mode_incident_only(authed_client: AsyncClient):
    """log_incidents 만 선택 시 해당 그룹만 반환 (metric_baselines 제외)."""
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
    groups = _groups_by_collection(data)
    # log_incidents 그룹만 결과 포함
    assert "log_incidents" in groups
    assert len(groups["log_incidents"]["results"]) == 1
    # metric_baselines 그룹은 없거나 결과가 0
    if "metric_baselines" in groups:
        assert len(groups["metric_baselines"]["results"]) == 0


@pytest.mark.asyncio
async def test_collections_mode_aggregation_only(authed_client: AsyncClient):
    """aggregation_summaries 만 선택 시 해당 그룹 1개 반환."""
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
    groups = _groups_by_collection(data)
    assert "aggregation_summaries" in groups
    assert len(groups["aggregation_summaries"]["results"]) == 1
    assert groups["aggregation_summaries"]["results"][0]["collection"] == "aggregation_summaries"


@pytest.mark.asyncio
async def test_collections_mode_knowledge_only(authed_client: AsyncClient):
    """knowledge_documents 선택 시 /knowledge/search 호출되고 그룹 반환."""
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
    groups = _groups_by_collection(data)
    assert "knowledge_documents" in groups
    assert len(groups["knowledge_documents"]["results"]) == 1
    assert groups["knowledge_documents"]["results"][0]["collection"] == "knowledge_documents"


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
    """log-analyzer 오류 시 빈 그룹 + errors 반환 (500 아님)."""
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
    data = resp.json()
    # errors에 log_incidents 에러 포함
    assert any(e["collection"] == "log_incidents" for e in data["errors"])
    # groups에 빈 그룹 (결과 없음)
    groups = _groups_by_collection(data)
    if "log_incidents" in groups:
        assert len(groups["log_incidents"]["results"]) == 0


@pytest.mark.asyncio
async def test_collections_mode_postmortem_only(authed_client: AsyncClient):
    """incident_postmortems 만 선택 시 postmortem 엔드포인트만 호출되고 그룹 반환."""
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
    groups = _groups_by_collection(data)
    assert "incident_postmortems" in groups
    pm_group = groups["incident_postmortems"]
    assert len(pm_group["results"]) == 1
    result = pm_group["results"][0]
    assert result["collection"] == "incident_postmortems"
    assert result["tool"] == "qdrant_search_incident_postmortem"
    assert result["doc_type"] == "incident_postmortem"
    assert result["incident_id"] == 42


@pytest.mark.asyncio
async def test_collections_mode_reranker_flag_propagated(authed_client: AsyncClient):
    """collections 모드 use_reranker=True 시 모든 그룹 reranked=True."""
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
                "query": "집계",
                "system_ids": [],
                "collections": ["aggregation_summaries"],
                "use_reranker": True,
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    groups = _groups_by_collection(data)
    assert "aggregation_summaries" in groups
    assert groups["aggregation_summaries"]["reranked"] is True


@pytest.mark.asyncio
async def test_collections_mode_reranker_false_flag(authed_client: AsyncClient):
    """collections 모드 use_reranker=False 시 reranked=False."""
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
                "query": "집계",
                "system_ids": [],
                "collections": ["aggregation_summaries"],
                "use_reranker": False,
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    groups = _groups_by_collection(data)
    assert "aggregation_summaries" in groups
    assert groups["aggregation_summaries"]["reranked"] is False


@pytest.mark.asyncio
async def test_collections_mode_error_attribution_incident(authed_client: AsyncClient):
    """incident 호출 실패 시 errors에 각 선택 컬렉션별 에러 항목 생성."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(side_effect=Exception("타임아웃"))

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/collections",
            json={
                "query": "장애",
                "system_ids": [],
                "collections": ["log_incidents", "metric_baselines"],
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    error_collections = {e["collection"] for e in data["errors"]}
    assert "log_incidents" in error_collections
    assert "metric_baselines" in error_collections


@pytest.mark.asyncio
async def test_collections_mode_postmortem_system_filter(authed_client: AsyncClient):
    """incident_postmortems 검색 시 system_ids 1개면 system_ids 리스트로 payload에 포함된다 (P2-A)."""
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
    assert captured_payloads[0].get("system_ids") == [7]


@pytest.mark.asyncio
async def test_collections_mode_postmortem_system_filter_multiple(authed_client: AsyncClient):
    """incident_postmortems 검색 시 system_ids 2개 이상이면 system_ids IN list 필터로 포함된다 (P2-A)."""
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
    assert captured_payloads[0].get("system_ids") == [1, 2]


@pytest.mark.asyncio
async def test_chatbot_mode_postmortem_multi_system_ids(authed_client: AsyncClient):
    """chatbot 모드에서 system_ids 복수 지정 시 postmortem payload에 system_ids 리스트가 전달된다 (P2-A)."""
    captured_payloads: list[dict] = []

    async def capturing_post(url: str, json: dict | None = None, **kwargs):
        if json is not None:
            captured_payloads.append({"url": url, "payload": json})
        if "incident/search" in url:
            return _make_mock_httpx_response(_mock_incident_response())
        if "incident-postmortem/search" in url:
            return _make_mock_httpx_response(_mock_postmortem_response())
        if "aggregation/search" in url:
            return _make_mock_httpx_response(_mock_aggregation_response())
        if "knowledge/search" in url:
            return _make_mock_httpx_response(_mock_knowledge_response())
        return _make_mock_httpx_response({})

    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(side_effect=capturing_post)

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/chatbot",
            json={"query": "OOM 장애", "system_ids": [3, 5]},
        )

    assert resp.status_code == 200
    pm_calls = [c for c in captured_payloads if "incident-postmortem/search" in c["url"]]
    assert len(pm_calls) == 1
    assert pm_calls[0]["payload"].get("system_ids") == [3, 5]


@pytest.mark.asyncio
async def test_chatbot_mode_incident_failure_generates_two_errors(authed_client: AsyncClient):
    """chatbot 모드에서 incident 실패 시 log_incidents + metric_baselines 2개 에러."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(side_effect=[
            Exception("incident 서버 오류"),
            _make_mock_httpx_response(_mock_postmortem_response()),
            _make_mock_httpx_response(_mock_aggregation_response()),
            _make_mock_httpx_response(_mock_knowledge_response()),
        ])

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/chatbot",
            json={"query": "OOM", "system_ids": []},
        )

    assert resp.status_code == 200
    data = resp.json()
    incident_errors = [e for e in data["errors"] if e["tool"] == "qdrant_search_incident_knowledge"]
    assert len(incident_errors) == 2
    error_cols = {e["collection"] for e in incident_errors}
    assert error_cols == {"log_incidents", "metric_baselines"}


@pytest.mark.asyncio
async def test_response_schema_has_groups_not_results(authed_client: AsyncClient):
    """v2 스키마 검증: 응답에 groups 있고 results 없음."""
    with patch("httpx.AsyncClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=None)
        mock_instance.post = AsyncMock(return_value=_make_mock_httpx_response(
            {"log_incidents": [], "metric_incidents": []}
        ))

        resp = await authed_client.post(
            "/api/v1/knowledge/search-verify/collections",
            json={"query": "테스트", "collections": ["log_incidents"]},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert "groups" in body
    assert "results" not in body


@pytest.mark.asyncio
async def test_collections_mode_canonical_group_order(authed_client: AsyncClient):
    """그룹 순서가 _CANONICAL_ORDER를 따른다 (log_incidents → metric_baselines)."""
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
                "query": "장애",
                "collections": ["log_incidents", "metric_baselines"],
                "use_reranker": False,
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    group_collections = [g["collection"] for g in data["groups"]]
    log_idx = group_collections.index("log_incidents") if "log_incidents" in group_collections else -1
    metric_idx = group_collections.index("metric_baselines") if "metric_baselines" in group_collections else -1
    if log_idx >= 0 and metric_idx >= 0:
        assert log_idx < metric_idx, "log_incidents 그룹이 metric_baselines보다 먼저 와야 함"
