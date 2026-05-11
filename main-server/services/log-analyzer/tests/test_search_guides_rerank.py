"""guides_vector_client.search_guides() — rerank 통합 단위 테스트.

실제 Qdrant / 임베딩 모델 없이 httpx 및 embedding/reranker 모듈을 mock 하여
rerank=True 경로와 rerank=False(기존 BC) 경로를 독립적으로 검증한다.
"""
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# log-analyzer 루트 디렉터리를 import path에 추가 (서비스가 모듈 패키지화 안 되어 있음)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import guides_vector_client  # noqa: E402


# ── 공통 픽스처 / 헬퍼 ──────────────────────────────────────────────────────────

def _make_qdrant_response(points: list[dict]) -> MagicMock:
    """Qdrant /points/query 성공 응답 mock 생성."""
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"result": {"points": points}}
    return resp


def _sample_points() -> list[dict]:
    """3개 guide에 각 1~2 청크씩 포함된 샘플 Qdrant 포인트 목록."""
    return [
        # guide-A: 청크 0 (RRF 점수 0.80)
        {
            "id": "aaa0",
            "score": 0.80,
            "payload": {
                "guide_id": "guide-A",
                "system_id": 1,
                "title": "가이드 A",
                "content": "content of guide A chunk 0",
                "chunk_index": 0,
                "total_chunks": 2,
            },
        },
        # guide-A: 청크 1 (RRF 점수 0.70)
        {
            "id": "aaa1",
            "score": 0.70,
            "payload": {
                "guide_id": "guide-A",
                "system_id": 1,
                "title": "가이드 A",
                "content": "content of guide A chunk 1",
                "chunk_index": 1,
                "total_chunks": 2,
            },
        },
        # guide-B: 청크 0 (RRF 점수 0.60)
        {
            "id": "bbb0",
            "score": 0.60,
            "payload": {
                "guide_id": "guide-B",
                "system_id": 2,
                "title": "가이드 B",
                "content": "content of guide B",
                "chunk_index": 0,
                "total_chunks": 1,
            },
        },
        # guide-C: 청크 0 (RRF 점수 0.50)
        {
            "id": "ccc0",
            "score": 0.50,
            "payload": {
                "guide_id": "guide-C",
                "system_id": None,
                "title": "공용 가이드 C",
                "content": "content of guide C",
                "chunk_index": 0,
                "total_chunks": 1,
            },
        },
    ]


# ── rerank=False: BC 회귀 테스트 ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_guides_no_rerank_basic():
    """rerank=False 시 RRF 점수 기준으로 그룹화되고 reranked 필드가 없다 (BC 보장)."""
    points = _sample_points()

    with (
        patch.object(guides_vector_client, "get_embedding", new_callable=AsyncMock, return_value=[0.1] * 1024),
        patch.object(guides_vector_client, "get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [], "values": []}),
        patch.object(guides_vector_client, "_qdrant_http") as mock_http,
    ):
        mock_http.post = AsyncMock(return_value=_make_qdrant_response(points))
        results = await guides_vector_client.search_guides(
            "테스트 쿼리", limit=5, group_by_guide=True, rerank=False
        )

    # 3개 가이드 반환 (limit=5 이내)
    assert len(results) == 3

    # RRF 점수 내림차순 정렬 — guide-A(0.80) > guide-B(0.60) > guide-C(0.50)
    assert results[0]["payload"]["guide_id"] == "guide-A"
    assert results[1]["payload"]["guide_id"] == "guide-B"
    assert results[2]["payload"]["guide_id"] == "guide-C"

    # guide-A: 청크 0이 best (score=0.80), matched_chunk_indexes = [0, 1]
    assert results[0]["score"] == pytest.approx(0.80)
    assert results[0]["payload"]["matched_chunk_indexes"] == [0, 1]
    assert results[0]["payload"]["matched_chunks_count"] == 2

    # reranked 필드 없음 (rerank=False BC)
    assert "reranked" not in results[0]["payload"]


@pytest.mark.asyncio
async def test_search_guides_no_rerank_exact_output():
    """rerank=False 결과가 항등성을 만족하는지 dict 수준으로 검증."""
    points = [
        {
            "id": "x1",
            "score": 0.75,
            "payload": {
                "guide_id": "gX",
                "system_id": 1,
                "title": "X",
                "content": "hello",
                "chunk_index": 0,
                "total_chunks": 1,
            },
        }
    ]

    with (
        patch.object(guides_vector_client, "get_embedding", new_callable=AsyncMock, return_value=[0.0] * 1024),
        patch.object(guides_vector_client, "get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [], "values": []}),
        patch.object(guides_vector_client, "_qdrant_http") as mock_http,
    ):
        mock_http.post = AsyncMock(return_value=_make_qdrant_response(points))
        results = await guides_vector_client.search_guides(
            "q", limit=5, group_by_guide=True, rerank=False
        )

    assert len(results) == 1
    r = results[0]
    assert r["id"] == "x1"
    assert r["score"] == pytest.approx(0.75)
    assert r["payload"]["guide_id"] == "gX"
    assert r["payload"]["matched_chunk_indexes"] == [0]
    assert "reranked" not in r["payload"]


# ── rerank=True: reranker 호출 검증 ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_guides_rerank_calls_reranker():
    """rerank=True 시 reranker.rerank()가 호출되는지 검증."""
    points = _sample_points()

    # reranker가 입력 순서 그대로(점수 변환만) 반환하도록 mock
    async def _mock_rerank(query, candidates, top_k, text_field):
        return [
            {**c, "rerank_score": 0.9 - i * 0.1}
            for i, c in enumerate(candidates[:top_k])
        ]

    with (
        patch.object(guides_vector_client, "get_embedding", new_callable=AsyncMock, return_value=[0.1] * 1024),
        patch.object(guides_vector_client, "get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [], "values": []}),
        patch.object(guides_vector_client, "_qdrant_http") as mock_http,
        patch("guides_vector_client.rerank_fn", side_effect=_mock_rerank) as mock_rerank_call,
    ):
        mock_http.post = AsyncMock(return_value=_make_qdrant_response(points))

        # reranker 모듈을 동적 import 경로로 patch
        import importlib
        import reranker as reranker_mod
        with patch.object(reranker_mod, "rerank", side_effect=_mock_rerank) as mock_fn:
            results = await guides_vector_client.search_guides(
                "테스트 쿼리", limit=5, group_by_guide=True, rerank=True, rerank_top_k=10
            )
            assert mock_fn.call_count == 1

    # 결과가 반환됨
    assert len(results) >= 1


@pytest.mark.asyncio
async def test_search_guides_rerank_changes_order():
    """reranker 점수가 RRF 순서와 다를 때 그룹화 결과가 reranker 점수 기준으로 정렬된다."""
    points = _sample_points()
    # guide-A 청크들이 RRF 1위이지만, reranker는 guide-C를 1위로 뒤집는다.
    # 입력 순서: [guide-A chunk0, guide-A chunk1, guide-B, guide-C]
    rerank_scores = [0.2, 0.1, 0.3, 0.9]  # guide-C(idx 3)이 가장 높음

    async def _mock_rerank(query, candidates, top_k, text_field):
        enriched = []
        for i, c in enumerate(candidates):
            enriched.append({**c, "rerank_score": rerank_scores[i]})
        enriched.sort(key=lambda x: x["rerank_score"], reverse=True)
        return enriched[:top_k]

    import reranker as reranker_mod
    with (
        patch.object(guides_vector_client, "get_embedding", new_callable=AsyncMock, return_value=[0.1] * 1024),
        patch.object(guides_vector_client, "get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [], "values": []}),
        patch.object(guides_vector_client, "_qdrant_http") as mock_http,
        patch.object(reranker_mod, "rerank", side_effect=_mock_rerank),
    ):
        mock_http.post = AsyncMock(return_value=_make_qdrant_response(points))
        results = await guides_vector_client.search_guides(
            "테스트 쿼리", limit=5, group_by_guide=True, rerank=True, rerank_top_k=10
        )

    # guide-C가 reranker 1위(0.9)이므로 첫 번째로 와야 한다
    assert results[0]["payload"]["guide_id"] == "guide-C"
    assert results[0]["score"] == pytest.approx(0.9)

    # reranked 플래그가 payload에 포함됨
    assert results[0]["payload"]["reranked"] is True


@pytest.mark.asyncio
async def test_search_guides_rerank_payload_reranked_flag():
    """rerank=True 결과 payload에 reranked=True가 포함되어 있어야 한다."""
    points = [
        {
            "id": "z1",
            "score": 0.8,
            "payload": {
                "guide_id": "gZ",
                "system_id": 1,
                "title": "Z",
                "content": "some content",
                "chunk_index": 0,
                "total_chunks": 1,
            },
        }
    ]

    async def _trivial_rerank(query, candidates, top_k, text_field):
        return [{**c, "rerank_score": 0.95} for c in candidates[:top_k]]

    import reranker as reranker_mod
    with (
        patch.object(guides_vector_client, "get_embedding", new_callable=AsyncMock, return_value=[0.0] * 1024),
        patch.object(guides_vector_client, "get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [], "values": []}),
        patch.object(guides_vector_client, "_qdrant_http") as mock_http,
        patch.object(reranker_mod, "rerank", side_effect=_trivial_rerank),
    ):
        mock_http.post = AsyncMock(return_value=_make_qdrant_response(points))
        results = await guides_vector_client.search_guides(
            "q", limit=5, group_by_guide=True, rerank=True
        )

    assert len(results) == 1
    assert results[0]["payload"].get("reranked") is True
    assert results[0]["score"] == pytest.approx(0.95)


@pytest.mark.asyncio
async def test_search_guides_rerank_empty_points():
    """Qdrant가 빈 결과를 반환할 때 rerank=True도 빈 목록을 반환한다."""
    with (
        patch.object(guides_vector_client, "get_embedding", new_callable=AsyncMock, return_value=[0.0] * 1024),
        patch.object(guides_vector_client, "get_sparse_vector", new_callable=AsyncMock, return_value={"indices": [], "values": []}),
        patch.object(guides_vector_client, "_qdrant_http") as mock_http,
    ):
        mock_http.post = AsyncMock(return_value=_make_qdrant_response([]))
        results = await guides_vector_client.search_guides(
            "q", limit=5, group_by_guide=True, rerank=True
        )

    assert results == []
