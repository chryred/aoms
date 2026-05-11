"""reranker.py 단위 테스트.

실제 모델 로드 없이 _rerank_sync 를 mock 하여 async rerank() wrapper 동작 검증.
실제 모델 로드를 포함한 통합 테스트는 별도(현재는 미구현, skip 마킹).
"""
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# log-analyzer 루트 디렉터리를 import path에 추가 (서비스가 모듈 패키지화 안 되어 있음)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import reranker  # noqa: E402


# ── import / 모듈 검증 ─────────────────────────────────────────────────────

def test_module_constants():
    """기본 환경변수 상수가 노출되는지 확인."""
    assert reranker.RERANKER_MODEL  # 비어있지 않음
    assert reranker.RERANKER_ONNX_FILE.endswith("model.onnx")
    assert reranker.RERANKER_MAX_LENGTH > 0
    assert reranker._RERANK_MAX_CHARS == 3000


def test_rerank_sync_callable():
    """_rerank_sync 시그니처가 (query, docs, max_length=...) 형태인지 확인."""
    import inspect
    sig = inspect.signature(reranker._rerank_sync)
    params = list(sig.parameters.keys())
    assert params[0] == "query"
    assert params[1] == "docs"
    assert "max_length" in sig.parameters


# ── async wrapper 동작 (mock 사용) ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_rerank_sorts_by_score_desc():
    """rerank() 가 mock 점수 내림차순으로 정렬해 top_k 반환하는지."""
    candidates = [
        {"id": "a", "text": "doc A"},
        {"id": "b", "text": "doc B"},
        {"id": "c", "text": "doc C"},
    ]
    # _rerank_sync 가 [0.1, 0.9, 0.5] 반환하도록 mock
    with patch.object(reranker, "_rerank_sync", return_value=[0.1, 0.9, 0.5]):
        result = await reranker.rerank("query", candidates, top_k=2, text_field="text")

    assert len(result) == 2
    assert result[0]["id"] == "b"  # 0.9
    assert result[1]["id"] == "c"  # 0.5
    assert result[0]["rerank_score"] == pytest.approx(0.9)
    assert result[1]["rerank_score"] == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_rerank_empty_candidates():
    """빈 후보 리스트 → 빈 결과."""
    result = await reranker.rerank("query", [], top_k=5)
    assert result == []


@pytest.mark.asyncio
async def test_rerank_no_text_field():
    """text_field가 비어있는 경우 원본 순서 유지 (top_k 컷만)."""
    candidates = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    result = await reranker.rerank("query", candidates, top_k=2, text_field="missing")
    assert len(result) == 2
    assert result[0]["id"] == "a"
    assert result[1]["id"] == "b"


@pytest.mark.asyncio
async def test_rerank_inference_failure_falls_back():
    """추론 실패 시 원본 순서를 top_k로 잘라 반환."""
    candidates = [
        {"id": "a", "text": "doc A"},
        {"id": "b", "text": "doc B"},
        {"id": "c", "text": "doc C"},
    ]
    with patch.object(reranker, "_rerank_sync", side_effect=RuntimeError("model fail")):
        result = await reranker.rerank("query", candidates, top_k=2, text_field="text")

    assert len(result) == 2
    assert result[0]["id"] == "a"
    assert result[1]["id"] == "b"
    # 실패 시 rerank_score는 추가되지 않음
    assert "rerank_score" not in result[0]


@pytest.mark.asyncio
async def test_rerank_preserves_payload_fields():
    """원본 dict의 다른 필드(payload, score 등)가 보존되는지."""
    candidates = [
        {"id": "a", "score": 0.5, "payload": {"k": "v1"}, "text": "A"},
        {"id": "b", "score": 0.8, "payload": {"k": "v2"}, "text": "B"},
    ]
    with patch.object(reranker, "_rerank_sync", return_value=[2.0, 1.0]):
        result = await reranker.rerank("q", candidates, top_k=2, text_field="text")

    assert result[0]["id"] == "a"
    assert result[0]["score"] == 0.5
    assert result[0]["payload"] == {"k": "v1"}
    assert result[0]["rerank_score"] == pytest.approx(2.0)


# ── Track C: original_rank / rerank_rank 필드 ─────────────────────────────

@pytest.mark.asyncio
async def test_rerank_adds_original_rank():
    """각 결과에 original_rank(0-based, rerank 이전 순위)가 붙는지."""
    candidates = [
        {"id": "a", "text": "doc A"},
        {"id": "b", "text": "doc B"},
        {"id": "c", "text": "doc C"},
    ]
    # 점수: a=0.1, b=0.9, c=0.5 → 정렬 후: b(1위), c(2위)
    with patch.object(reranker, "_rerank_sync", return_value=[0.1, 0.9, 0.5]):
        result = await reranker.rerank("query", candidates, top_k=3, text_field="text")

    # original_rank는 입력 candidates 순서 기준 0-based
    by_id = {r["id"]: r for r in result}
    assert by_id["a"]["original_rank"] == 0  # candidates[0]
    assert by_id["b"]["original_rank"] == 1  # candidates[1]
    assert by_id["c"]["original_rank"] == 2  # candidates[2]


@pytest.mark.asyncio
async def test_rerank_adds_rerank_rank():
    """각 결과에 rerank_rank(0-based, rerank 이후 순위)가 붙는지."""
    candidates = [
        {"id": "a", "text": "doc A"},
        {"id": "b", "text": "doc B"},
        {"id": "c", "text": "doc C"},
    ]
    # 점수: a=0.1, b=0.9, c=0.5 → 정렬 후: b(rank 0), c(rank 1), a(rank 2)
    with patch.object(reranker, "_rerank_sync", return_value=[0.1, 0.9, 0.5]):
        result = await reranker.rerank("query", candidates, top_k=3, text_field="text")

    assert result[0]["id"] == "b"
    assert result[0]["rerank_rank"] == 0
    assert result[1]["id"] == "c"
    assert result[1]["rerank_rank"] == 1
    assert result[2]["id"] == "a"
    assert result[2]["rerank_rank"] == 2


@pytest.mark.asyncio
async def test_rerank_rank_change_visible():
    """original_rank와 rerank_rank를 비교하면 순위 이동을 알 수 있는지."""
    candidates = [
        {"id": "a", "text": "doc A"},  # original_rank=0
        {"id": "b", "text": "doc B"},  # original_rank=1
        {"id": "c", "text": "doc C"},  # original_rank=2
    ]
    # b가 가장 높은 점수 → rerank 후 1위(rank=0)로 이동 (original은 1위)
    # a는 가장 낮은 점수 → rerank 후 3위(rank=2)로 떨어짐 (original은 0위)
    with patch.object(reranker, "_rerank_sync", return_value=[0.1, 0.9, 0.5]):
        result = await reranker.rerank("query", candidates, top_k=3, text_field="text")

    by_id = {r["id"]: r for r in result}
    # b: original 1 → rerank 0 (상승)
    assert by_id["b"]["original_rank"] == 1
    assert by_id["b"]["rerank_rank"] == 0
    # a: original 0 → rerank 2 (하락)
    assert by_id["a"]["original_rank"] == 0
    assert by_id["a"]["rerank_rank"] == 2


@pytest.mark.asyncio
async def test_rerank_top_k_limits_rerank_rank():
    """top_k=2 시 rerank_rank는 0~1 사이에만 존재해야 한다."""
    candidates = [
        {"id": "a", "text": "doc A"},
        {"id": "b", "text": "doc B"},
        {"id": "c", "text": "doc C"},
    ]
    with patch.object(reranker, "_rerank_sync", return_value=[0.1, 0.9, 0.5]):
        result = await reranker.rerank("query", candidates, top_k=2, text_field="text")

    assert len(result) == 2
    rerank_ranks = [r["rerank_rank"] for r in result]
    assert sorted(rerank_ranks) == [0, 1]


@pytest.mark.asyncio
async def test_rerank_failure_no_rank_fields():
    """추론 실패(fallback) 시 original_rank / rerank_rank 가 붙지 않는지."""
    candidates = [
        {"id": "a", "text": "doc A"},
        {"id": "b", "text": "doc B"},
    ]
    with patch.object(reranker, "_rerank_sync", side_effect=RuntimeError("fail")):
        result = await reranker.rerank("query", candidates, top_k=2, text_field="text")

    assert "original_rank" not in result[0]
    assert "rerank_rank" not in result[0]


# ── 통합 테스트 (실제 모델 로드, 폐쇄망/CI 환경에서는 skip) ─────────────────

@pytest.mark.skip(reason="실제 모델 로드 통합 테스트 — Docker 이미지 환경에서만 실행")
@pytest.mark.asyncio
async def test_rerank_real_model():
    """실제 bge-reranker-v2-m3 ONNX 로딩 → 추론 검증 (수동 실행)."""
    candidates = [
        {"id": "a", "text": "데이터베이스 연결 풀 고갈로 인한 장애"},
        {"id": "b", "text": "오늘 점심 메뉴는 김치찌개"},
        {"id": "c", "text": "DB 커넥션 타임아웃 발생"},
    ]
    result = await reranker.rerank(
        "DB 연결 문제", candidates, top_k=3, text_field="text"
    )
    # DB 관련 문서가 상위에 와야 함
    assert result[0]["id"] in ("a", "c")
    assert result[-1]["id"] == "b"
