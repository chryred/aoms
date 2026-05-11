"""knowledge_guides search group_by_guide 단위 테스트.

검증 항목:
1. group_by_guide=True (기본): 같은 guide_id의 여러 청크가 가이드 1개로 병합됨
2. group_by_guide=False: 기존 청크 단위 동작 유지
3. limit=N일 때 그룹 수(가이드 수)가 N을 초과하지 않음
4. matched_chunk_indexes, matched_chunks_count 필드 포함 확인
5. best_score 청크가 대표 포인트로 선택됨
6. 빈 결과 처리 — 오류 없이 빈 목록 반환
7. 그룹 정렬: best_score 내림차순
8. 챗봇 도구(_search_guides) 응답에 matched_chunk_indexes 포함
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch, MagicMock


# ── 공통 픽스처: Qdrant 응답 mock 데이터 ──────────────────────────────────────

def _make_point(point_id: str, score: float, guide_id: str, chunk_index: int, total_chunks: int = 3):
    """테스트용 Qdrant point dict 생성."""
    return {
        "id":      point_id,
        "score":   score,
        "payload": {
            "guide_id":     guide_id,
            "chunk_index":  chunk_index,
            "total_chunks": total_chunks,
            "title":        f"가이드 {guide_id}",
            "content":      f"내용 chunk={chunk_index}",
            "system_id":    1,
        },
    }


def _mock_qdrant_response(points: list[dict]):
    """Qdrant /points/query 응답을 모사하는 httpx Response mock."""
    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {"result": {"points": points}}
    return mock_resp


# ── 1. group_by_guide=True: 같은 guide_id 청크 병합 ──────────────────────────

@pytest.mark.anyio
async def test_group_by_guide_merges_same_guide():
    """같은 guide_id의 청크 3개가 하나의 결과로 병합된다."""
    points = [
        _make_point("pt1", 0.9, "guide-A", chunk_index=0),
        _make_point("pt2", 0.7, "guide-A", chunk_index=1),
        _make_point("pt3", 0.5, "guide-A", chunk_index=2),
    ]

    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "log-analyzer"))

    from guides_vector_client import search_guides

    mock_resp = _mock_qdrant_response(points)

    with patch("guides_vector_client.get_embedding", new_callable=AsyncMock, return_value=[0.1] * 1024), \
         patch("guides_vector_client.get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [0], "values": [1.0]}), \
         patch("guides_vector_client._qdrant_http") as mock_http:

        mock_http.post = AsyncMock(return_value=mock_resp)
        results = await search_guides(query="테스트", limit=5, group_by_guide=True)

    assert len(results) == 1, "같은 guide_id 청크 3개는 1개 결과로 병합되어야 함"
    r = results[0]
    assert r["payload"]["guide_id"] == "guide-A"
    assert r["payload"]["matched_chunks_count"] == 3
    assert sorted(r["payload"]["matched_chunk_indexes"]) == [0, 1, 2]


# ── 2. group_by_guide=False: 청크 단위 유지 ───────────────────────────────────

@pytest.mark.anyio
async def test_group_by_guide_false_returns_chunks():
    """group_by_guide=False이면 청크별로 별도 결과 반환."""
    points = [
        _make_point("pt1", 0.9, "guide-A", chunk_index=0),
        _make_point("pt2", 0.7, "guide-A", chunk_index=1),
    ]

    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "log-analyzer"))

    from guides_vector_client import search_guides

    mock_resp = _mock_qdrant_response(points)

    with patch("guides_vector_client.get_embedding", new_callable=AsyncMock, return_value=[0.1] * 1024), \
         patch("guides_vector_client.get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [0], "values": [1.0]}), \
         patch("guides_vector_client._qdrant_http") as mock_http:

        mock_http.post = AsyncMock(return_value=mock_resp)
        results = await search_guides(query="테스트", limit=5, group_by_guide=False)

    assert len(results) == 2, "group_by_guide=False이면 청크 2개가 그대로 반환"
    assert "matched_chunk_indexes" not in results[0]["payload"]


# ── 3. limit은 가이드(그룹) 수에 적용됨 ───────────────────────────────────────

@pytest.mark.anyio
async def test_limit_applies_to_guide_count():
    """limit=2일 때 서로 다른 guide_id 3개에서 2개만 반환."""
    points = [
        _make_point("pt1", 0.9, "guide-A", chunk_index=0),
        _make_point("pt2", 0.8, "guide-B", chunk_index=0),
        _make_point("pt3", 0.7, "guide-C", chunk_index=0),
    ]

    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "log-analyzer"))

    from guides_vector_client import search_guides

    mock_resp = _mock_qdrant_response(points)

    with patch("guides_vector_client.get_embedding", new_callable=AsyncMock, return_value=[0.1] * 1024), \
         patch("guides_vector_client.get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [0], "values": [1.0]}), \
         patch("guides_vector_client._qdrant_http") as mock_http:

        mock_http.post = AsyncMock(return_value=mock_resp)
        results = await search_guides(query="테스트", limit=2, group_by_guide=True)

    assert len(results) == 2, "limit=2이면 가이드 2개만 반환"


# ── 4. best_score 청크가 대표로 선택됨 ────────────────────────────────────────

@pytest.mark.anyio
async def test_best_score_chunk_selected_as_representative():
    """가이드 내 가장 높은 score를 가진 청크가 대표 포인트로 선택됨."""
    points = [
        _make_point("pt-low",  0.4, "guide-A", chunk_index=0),
        _make_point("pt-high", 0.9, "guide-A", chunk_index=2),
        _make_point("pt-mid",  0.6, "guide-A", chunk_index=1),
    ]

    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "log-analyzer"))

    from guides_vector_client import search_guides

    mock_resp = _mock_qdrant_response(points)

    with patch("guides_vector_client.get_embedding", new_callable=AsyncMock, return_value=[0.1] * 1024), \
         patch("guides_vector_client.get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [0], "values": [1.0]}), \
         patch("guides_vector_client._qdrant_http") as mock_http:

        mock_http.post = AsyncMock(return_value=mock_resp)
        results = await search_guides(query="테스트", limit=5, group_by_guide=True)

    assert len(results) == 1
    r = results[0]
    assert r["id"] == "pt-high", "best_score(0.9)를 가진 포인트가 대표로 선택"
    assert r["score"] == 0.9


# ── 5. 빈 결과 처리 ───────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_empty_results_handled_gracefully():
    """Qdrant 결과가 없으면 빈 목록 반환."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "log-analyzer"))

    from guides_vector_client import search_guides

    mock_resp = _mock_qdrant_response([])

    with patch("guides_vector_client.get_embedding", new_callable=AsyncMock, return_value=[0.1] * 1024), \
         patch("guides_vector_client.get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [0], "values": [1.0]}), \
         patch("guides_vector_client._qdrant_http") as mock_http:

        mock_http.post = AsyncMock(return_value=mock_resp)
        results = await search_guides(query="없는내용", limit=5, group_by_guide=True)

    assert results == []


# ── 6. 정렬: best_score 내림차순 ──────────────────────────────────────────────

@pytest.mark.anyio
async def test_results_sorted_by_best_score_descending():
    """결과는 각 가이드의 best_score 내림차순으로 정렬됨."""
    points = [
        _make_point("pt1", 0.5, "guide-X", chunk_index=0),
        _make_point("pt2", 0.9, "guide-Y", chunk_index=0),
        _make_point("pt3", 0.7, "guide-Z", chunk_index=0),
    ]

    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "log-analyzer"))

    from guides_vector_client import search_guides

    mock_resp = _mock_qdrant_response(points)

    with patch("guides_vector_client.get_embedding", new_callable=AsyncMock, return_value=[0.1] * 1024), \
         patch("guides_vector_client.get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [0], "values": [1.0]}), \
         patch("guides_vector_client._qdrant_http") as mock_http:

        mock_http.post = AsyncMock(return_value=mock_resp)
        results = await search_guides(query="테스트", limit=5, group_by_guide=True)

    assert len(results) == 3
    scores = [r["score"] for r in results]
    assert scores == sorted(scores, reverse=True), "best_score 내림차순 정렬"
    assert results[0]["payload"]["guide_id"] == "guide-Y"  # score 0.9


# ── 7. 여러 가이드 혼합: 각 가이드의 매칭 청크만 수집 ─────────────────────────

@pytest.mark.anyio
async def test_mixed_guides_correct_chunk_indexes():
    """서로 다른 guide_id 청크들이 각자의 그룹으로 올바르게 분리됨."""
    points = [
        _make_point("a1", 0.8, "guide-A", chunk_index=0),
        _make_point("b1", 0.9, "guide-B", chunk_index=1),
        _make_point("a2", 0.6, "guide-A", chunk_index=2),
    ]

    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "log-analyzer"))

    from guides_vector_client import search_guides

    mock_resp = _mock_qdrant_response(points)

    with patch("guides_vector_client.get_embedding", new_callable=AsyncMock, return_value=[0.1] * 1024), \
         patch("guides_vector_client.get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [0], "values": [1.0]}), \
         patch("guides_vector_client._qdrant_http") as mock_http:

        mock_http.post = AsyncMock(return_value=mock_resp)
        results = await search_guides(query="테스트", limit=5, group_by_guide=True)

    assert len(results) == 2
    # guide-B가 더 높은 score(0.9)이므로 첫 번째
    assert results[0]["payload"]["guide_id"] == "guide-B"
    assert results[0]["payload"]["matched_chunk_indexes"] == [1]
    assert results[0]["payload"]["matched_chunks_count"] == 1

    guide_a_result = next(r for r in results if r["payload"]["guide_id"] == "guide-A")
    assert guide_a_result["payload"]["matched_chunk_indexes"] == [0, 2]
    assert guide_a_result["payload"]["matched_chunks_count"] == 2


# ── 8. 챗봇 도구(_search_guides) matched_chunk_indexes 포함 ──────────────────

@pytest.mark.anyio
async def test_chat_tool_search_guides_includes_matched_chunk_indexes(db_session):
    """_search_guides 챗봇 도구 응답에 matched_chunk_indexes, matched_chunks_count 포함."""
    response_data = [
        {
            "id":    "pt-best",
            "score": 0.85,
            "payload": {
                "guide_id":             "guide-Z",
                "title":                "운영 가이드 Z",
                "content":              "내용",
                "system_id":            1,
                "chunk_index":          0,
                "total_chunks":         2,
                "matched_chunk_indexes": [0, 1],
                "matched_chunks_count": 2,
            },
        }
    ]

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = response_data

    from services.chat_tools.executors.qdrant import _search_guides

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_resp)

        result = await _search_guides(
            db=db_session,
            args={"query": "배포 절차", "limit": 5},
        )

    assert result["count"] == 1
    item = result["results"][0]
    assert item["guide_id"] == "guide-Z"
    assert item["matched_chunk_indexes"] == [0, 1]
    assert item["matched_chunks_count"] == 2


# ── 9. 챗봇 도구가 group_by_guide=True를 명시적으로 전달 ─────────────────────

@pytest.mark.anyio
async def test_chat_tool_sends_group_by_guide_true(db_session):
    """_search_guides 챗봇 도구가 log-analyzer 호출 시 group_by_guide=True를 전달."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = []

    from services.chat_tools.executors.qdrant import _search_guides

    captured_payload: dict = {}

    async def _capture_post(url, json=None, **kwargs):
        captured_payload.update(json or {})
        return mock_resp

    with patch("httpx.AsyncClient") as mock_client_cls:
        mock_client = AsyncMock()
        mock_client_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = _capture_post

        await _search_guides(
            db=db_session,
            args={"query": "알림 임계값", "limit": 3},
        )

    assert captured_payload.get("group_by_guide") is True, \
        "챗봇 도구는 group_by_guide=True를 명시적으로 log-analyzer에 전달해야 함"
