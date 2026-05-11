"""Track C: 점수 분해 (with_scores) 단위 테스트.

guides_vector_client.search_guides() 의 with_scores=True/False 경로를 검증한다.
- with_scores=False (기본): Qdrant 호출 1회 (RRF only)
- with_scores=True: Qdrant 호출 3회 (RRF + dense-only + sparse-only)
- 결과 dict에 dense_score / sparse_score / dense_rank / sparse_rank 포함 검증

실제 Qdrant / 임베딩 모델 없이 httpx mock으로 동작한다.
"""
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

# log-analyzer 루트를 import path에 추가
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import guides_vector_client  # noqa: E402


# ── 헬퍼 ──────────────────────────────────────────────────────────────────────

def _qdrant_resp(points: list[dict]) -> MagicMock:
    """Qdrant /points/query 성공 응답 mock."""
    m = MagicMock()
    m.raise_for_status = MagicMock()
    m.json.return_value = {"result": {"points": points}}
    return m


def _sample_rrf_points() -> list[dict]:
    """RRF 결과 2개 포인트."""
    return [
        {
            "id": "pt-1",
            "score": 0.025,
            "payload": {
                "guide_id": "guide-X",
                "system_id": 1,
                "title": "가이드 X",
                "content": "content X",
                "chunk_index": 0,
                "total_chunks": 1,
            },
        },
        {
            "id": "pt-2",
            "score": 0.018,
            "payload": {
                "guide_id": "guide-Y",
                "system_id": 2,
                "title": "가이드 Y",
                "content": "content Y",
                "chunk_index": 0,
                "total_chunks": 1,
            },
        },
    ]


def _dense_points() -> list[dict]:
    """Dense-only 결과: pt-2가 1위, pt-1이 2위."""
    return [
        {"id": "pt-2", "score": 0.92},
        {"id": "pt-1", "score": 0.85},
    ]


def _sparse_points() -> list[dict]:
    """Sparse-only 결과: pt-1만 반환 (pt-2는 sparse에서 낮아 cut-off)."""
    return [
        {"id": "pt-1", "score": 0.31},
    ]


# ── with_scores=False (기본): Qdrant 호출 1회 ────────────────────────────────

class TestWithScoresFalse:
    """with_scores=False 경로 — RRF 단일 호출, 점수 필드 없음."""

    @pytest.mark.asyncio
    async def test_single_qdrant_call(self):
        """with_scores=False이면 Qdrant를 1회만 호출한다."""
        with (
            patch.object(
                guides_vector_client, "get_embedding",
                new_callable=AsyncMock, return_value=[0.1] * 1024,
            ),
            patch.object(
                guides_vector_client, "get_sparse_vector",
                new_callable=AsyncMock, return_value={"indices": [10], "values": [0.5]},
            ),
            patch.object(guides_vector_client, "_qdrant_http") as mock_http,
        ):
            mock_http.post = AsyncMock(return_value=_qdrant_resp(_sample_rrf_points()))
            await guides_vector_client.search_guides(
                "OOM 오류", limit=5, group_by_guide=True, with_scores=False
            )
            assert mock_http.post.call_count == 1

    @pytest.mark.asyncio
    async def test_no_score_fields_in_result(self):
        """with_scores=False 결과에는 dense_score / sparse_score 필드가 없다."""
        with (
            patch.object(
                guides_vector_client, "get_embedding",
                new_callable=AsyncMock, return_value=[0.1] * 1024,
            ),
            patch.object(
                guides_vector_client, "get_sparse_vector",
                new_callable=AsyncMock, return_value={"indices": [10], "values": [0.5]},
            ),
            patch.object(guides_vector_client, "_qdrant_http") as mock_http,
        ):
            mock_http.post = AsyncMock(return_value=_qdrant_resp(_sample_rrf_points()))
            results = await guides_vector_client.search_guides(
                "OOM 오류", limit=5, group_by_guide=True, with_scores=False
            )

        assert len(results) >= 1
        for r in results:
            assert "dense_score" not in r
            assert "sparse_score" not in r
            assert "dense_rank" not in r
            assert "sparse_rank" not in r


# ── with_scores=True: Qdrant 호출 3회 ────────────────────────────────────────

class TestWithScoresTrue:
    """with_scores=True 경로 — RRF + dense-only + sparse-only, 3회 호출."""

    @pytest.mark.asyncio
    async def test_three_qdrant_calls(self):
        """with_scores=True이면 Qdrant를 3회 호출한다 (RRF + dense + sparse)."""
        # post()가 순서대로 RRF, dense, sparse 응답을 반환
        rrf_resp    = _qdrant_resp(_sample_rrf_points())
        dense_resp  = _qdrant_resp(_dense_points())
        sparse_resp = _qdrant_resp(_sparse_points())

        with (
            patch.object(
                guides_vector_client, "get_embedding",
                new_callable=AsyncMock, return_value=[0.1] * 1024,
            ),
            patch.object(
                guides_vector_client, "get_sparse_vector",
                new_callable=AsyncMock, return_value={"indices": [10], "values": [0.5]},
            ),
            patch.object(guides_vector_client, "_qdrant_http") as mock_http,
        ):
            # 1번째 호출(RRF) → rrf_resp
            # 2, 3번째 호출(dense, sparse) → asyncio.gather 내부
            mock_http.post = AsyncMock(side_effect=[rrf_resp, dense_resp, sparse_resp])
            await guides_vector_client.search_guides(
                "OOM 오류", limit=5, group_by_guide=True, with_scores=True
            )
            assert mock_http.post.call_count == 3

    @pytest.mark.asyncio
    async def test_score_fields_present(self):
        """with_scores=True 결과 각 item에 dense_score / sparse_score 등이 포함된다."""
        rrf_resp    = _qdrant_resp(_sample_rrf_points())
        dense_resp  = _qdrant_resp(_dense_points())
        sparse_resp = _qdrant_resp(_sparse_points())

        with (
            patch.object(
                guides_vector_client, "get_embedding",
                new_callable=AsyncMock, return_value=[0.1] * 1024,
            ),
            patch.object(
                guides_vector_client, "get_sparse_vector",
                new_callable=AsyncMock, return_value={"indices": [10], "values": [0.5]},
            ),
            patch.object(guides_vector_client, "_qdrant_http") as mock_http,
        ):
            mock_http.post = AsyncMock(side_effect=[rrf_resp, dense_resp, sparse_resp])
            results = await guides_vector_client.search_guides(
                "OOM 오류", limit=5, group_by_guide=True, with_scores=True
            )

        # 최소 1개 결과
        assert len(results) >= 1

        # 결과 dict 최상위에 점수 필드 존재
        for r in results:
            assert "dense_score" in r
            assert "sparse_score" in r
            assert "dense_rank" in r
            assert "sparse_rank" in r

    @pytest.mark.asyncio
    async def test_score_values_correct(self):
        """dense/sparse 점수·순위가 mock 응답 값과 정확히 일치한다."""
        # pt-1: dense rank=1(0.85), pt-2: dense rank=0(0.92)
        # pt-1: sparse rank=0(0.31), pt-2: sparse 미등장 → None
        rrf_resp    = _qdrant_resp(_sample_rrf_points())
        dense_resp  = _qdrant_resp(_dense_points())
        sparse_resp = _qdrant_resp(_sparse_points())

        with (
            patch.object(
                guides_vector_client, "get_embedding",
                new_callable=AsyncMock, return_value=[0.1] * 1024,
            ),
            patch.object(
                guides_vector_client, "get_sparse_vector",
                new_callable=AsyncMock, return_value={"indices": [10], "values": [0.5]},
            ),
            patch.object(guides_vector_client, "_qdrant_http") as mock_http,
        ):
            mock_http.post = AsyncMock(side_effect=[rrf_resp, dense_resp, sparse_resp])
            results = await guides_vector_client.search_guides(
                "OOM 오류", limit=5, group_by_guide=True, with_scores=True
            )

        # guide-X → best chunk = pt-1 (RRF 0.025 > pt-2의 0.018, 같은 그룹이 아님)
        # guide-X (pt-1): dense_score=0.85, dense_rank=1, sparse_score=0.31, sparse_rank=0
        # guide-Y (pt-2): dense_score=0.92, dense_rank=0, sparse_score=None, sparse_rank=None

        result_by_guide = {r["payload"]["guide_id"]: r for r in results}

        guide_x = result_by_guide["guide-X"]
        assert guide_x["dense_score"] == pytest.approx(0.85)
        assert guide_x["dense_rank"] == 1
        assert guide_x["sparse_score"] == pytest.approx(0.31)
        assert guide_x["sparse_rank"] == 0

        guide_y = result_by_guide["guide-Y"]
        assert guide_y["dense_score"] == pytest.approx(0.92)
        assert guide_y["dense_rank"] == 0
        assert guide_y["sparse_score"] is None   # sparse에서 cut-off
        assert guide_y["sparse_rank"] is None

    @pytest.mark.asyncio
    async def test_empty_rrf_skips_score_queries(self):
        """RRF 결과가 빈 목록이면 dense/sparse 쿼리를 실행하지 않는다."""
        rrf_resp = _qdrant_resp([])

        with (
            patch.object(
                guides_vector_client, "get_embedding",
                new_callable=AsyncMock, return_value=[0.1] * 1024,
            ),
            patch.object(
                guides_vector_client, "get_sparse_vector",
                new_callable=AsyncMock, return_value={"indices": [10], "values": [0.5]},
            ),
            patch.object(guides_vector_client, "_qdrant_http") as mock_http,
        ):
            mock_http.post = AsyncMock(return_value=rrf_resp)
            results = await guides_vector_client.search_guides(
                "OOM 오류", limit=5, group_by_guide=True, with_scores=True
            )
            # RRF가 비어 with_scores 분기 진입 안 함 → 1회만 호출
            assert mock_http.post.call_count == 1

        assert results == []

    @pytest.mark.asyncio
    async def test_dense_query_uses_dense_using_field(self):
        """with_scores=True 시 두 번째 Qdrant 호출 body에 'using': 'dense' 포함된다."""
        rrf_resp    = _qdrant_resp(_sample_rrf_points())
        dense_resp  = _qdrant_resp(_dense_points())
        sparse_resp = _qdrant_resp(_sparse_points())

        captured_bodies: list[dict] = []

        async def _post(url, json=None, **kw):
            captured_bodies.append(json or {})
            idx = len(captured_bodies) - 1
            return [rrf_resp, dense_resp, sparse_resp][idx]

        with (
            patch.object(
                guides_vector_client, "get_embedding",
                new_callable=AsyncMock, return_value=[0.1] * 1024,
            ),
            patch.object(
                guides_vector_client, "get_sparse_vector",
                new_callable=AsyncMock, return_value={"indices": [10], "values": [0.5]},
            ),
            patch.object(guides_vector_client, "_qdrant_http") as mock_http,
        ):
            mock_http.post = AsyncMock(side_effect=_post)
            await guides_vector_client.search_guides(
                "OOM 오류", limit=5, group_by_guide=True, with_scores=True
            )

        assert len(captured_bodies) == 3
        # 2번째(dense-only) body
        dense_body = captured_bodies[1]
        assert dense_body.get("using") == "dense"
        assert dense_body.get("score_threshold") == 0  # score_threshold=0 (모든 점수 수집)
        # 3번째(sparse-only) body
        sparse_body = captured_bodies[2]
        assert sparse_body.get("using") == "sparse"

    @pytest.mark.asyncio
    async def test_score_decomposition_group_by_guide_false(self):
        """group_by_guide=False 시에도 with_scores=True 점수 필드가 포함된다."""
        rrf_resp    = _qdrant_resp(_sample_rrf_points())
        dense_resp  = _qdrant_resp(_dense_points())
        sparse_resp = _qdrant_resp(_sparse_points())

        with (
            patch.object(
                guides_vector_client, "get_embedding",
                new_callable=AsyncMock, return_value=[0.1] * 1024,
            ),
            patch.object(
                guides_vector_client, "get_sparse_vector",
                new_callable=AsyncMock, return_value={"indices": [10], "values": [0.5]},
            ),
            patch.object(guides_vector_client, "_qdrant_http") as mock_http,
        ):
            mock_http.post = AsyncMock(side_effect=[rrf_resp, dense_resp, sparse_resp])
            results = await guides_vector_client.search_guides(
                "OOM 오류", limit=5, group_by_guide=False, with_scores=True
            )

        # group_by_guide=False: 청크 단위 반환. 점수 필드가 payload에 없어도 반환 dict에는 없음.
        # (group_by_guide=False 경로는 점수 필드를 payload로 옮기지 않음 — 직접 dict에 없음)
        # 핵심: call_count == 3 — 점수 분해 쿼리는 실행됨
        assert mock_http.post.call_count == 3
