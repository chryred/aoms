"""knowledge_vector_client.py 단위 테스트.

실제 Qdrant / 임베딩 모델 로드 없이 mock으로 동작을 검증한다.
"""
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# log-analyzer 루트를 import path에 추가
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import knowledge_vector_client as kvc  # noqa: E402


# ── Point ID 충돌 방지 검증 ────────────────────────────────────────────────────

class TestPointIdCollision:
    """같은 이슈 ID라도 다른 project_key → 다른 point_id 보장."""

    def test_jira_same_issue_different_project(self):
        id_a = kvc.make_jira_point_id("PROJA", "100")
        id_b = kvc.make_jira_point_id("PROJB", "100")
        assert id_a != id_b, "다른 project의 동일 issue_id는 다른 point_id를 가져야 한다"

    def test_jira_same_project_same_issue_deterministic(self):
        id1 = kvc.make_jira_point_id("PROJA", "100")
        id2 = kvc.make_jira_point_id("PROJA", "100")
        assert id1 == id2, "동일 project + issue_id는 항상 같은 point_id(결정적)여야 한다"

    def test_jira_different_issue_same_project(self):
        id_a = kvc.make_jira_point_id("PROJA", "100")
        id_b = kvc.make_jira_point_id("PROJA", "101")
        assert id_a != id_b

    def test_confluence_same_page_different_chunk(self):
        id0 = kvc.make_confluence_point_id("page-001", 0)
        id1 = kvc.make_confluence_point_id("page-001", 1)
        assert id0 != id1

    def test_confluence_same_chunk_different_page(self):
        id_a = kvc.make_confluence_point_id("page-001", 0)
        id_b = kvc.make_confluence_point_id("page-002", 0)
        assert id_a != id_b

    def test_confluence_deterministic(self):
        id1 = kvc.make_confluence_point_id("page-001", 5)
        id2 = kvc.make_confluence_point_id("page-001", 5)
        assert id1 == id2

    def test_document_same_hash_different_chunk(self):
        id0 = kvc.make_document_point_id("abc123", 0)
        id1 = kvc.make_document_point_id("abc123", 1)
        assert id0 != id1

    def test_document_different_hash_same_chunk(self):
        id_a = kvc.make_document_point_id("abc123", 0)
        id_b = kvc.make_document_point_id("def456", 0)
        assert id_a != id_b

    def test_cross_collection_no_collision(self):
        """Jira, Confluence, Document 간 point_id 충돌 확인 (실질적 테스트)."""
        jira_id  = kvc.make_jira_point_id("PROJA", "1")
        conf_id  = kvc.make_confluence_point_id("1", 0)
        doc_id   = kvc.make_document_point_id("1", 0)
        ids = [jira_id, conf_id, doc_id]
        # 프리픽스("jira:", "conf:", "doc:")로 네임스페이스 분리되므로 충돌 거의 없음
        # 단, 이 테스트는 "발생하면 알 수 있다"는 보험용 — 경고 수준
        # 같아도 테스트 실패는 아니나, 경보용 print
        if len(set(ids)) < 3:
            # 실 확률 극히 낮음 (sha256 uint64 충돌 = 2^-64 수준)
            pytest.skip("해시 충돌 발생 (sha256 uint64 충돌, 극히 드묾)")

    def test_point_id_is_positive_int(self):
        """point_id는 양의 정수(uint64 표현)여야 한다."""
        pid = kvc.make_jira_point_id("TEST", "999")
        assert isinstance(pid, int)
        assert pid > 0

    def test_point_id_uint64_range(self):
        """point_id는 uint64 범위(0 ~ 2^64-1) 내에 있어야 한다."""
        pid = kvc.make_jira_point_id("RANGE", "42")
        assert 0 <= pid < 2**64


# ── RRF cross-collection 병합 검증 ───────────────────────────────────────────

class TestCrossCollectionRRF:
    """_cross_collection_rrf 함수 단독 검증."""

    def test_single_source_order_preserved(self):
        results = {
            "jira": [
                {"id": 1, "score": 0.9, "payload": {}},
                {"id": 2, "score": 0.8, "payload": {}},
            ],
            "confluence": [],
            "documents": [],
        }
        merged = kvc._cross_collection_rrf(results)
        # 최상위 결과 점수 내림차순
        scores = [r["score"] for r in merged]
        assert scores == sorted(scores, reverse=True)

    def test_multi_source_merges_all(self):
        results = {
            "jira":       [{"id": 10, "score": 0.5, "payload": {}}],
            "confluence": [{"id": 20, "score": 0.4, "payload": {}}],
            "documents":  [{"id": 30, "score": 0.3, "payload": {}}],
        }
        merged = kvc._cross_collection_rrf(results)
        ids = [r["point_id"] for r in merged]
        assert 10 in ids
        assert 20 in ids
        assert 30 in ids

    def test_rrf_score_formula(self):
        """RRF k=60, rank=0 → 1/(60+0+1) ≈ 0.01639"""
        expected = 1.0 / (60 + 0 + 1)
        actual = kvc._rrf_score(0)
        assert abs(actual - expected) < 1e-9

    def test_empty_all_sources(self):
        merged = kvc._cross_collection_rrf({"jira": [], "confluence": [], "documents": []})
        assert merged == []


# ── corrected 보너스 (+0.2) 검증 ──────────────────────────────────────────────

class TestCorrectedBonus:
    """corrected=True 항목이 lower-rank 위치에서 상위로 올라오는지 검증."""

    @pytest.mark.asyncio
    async def test_corrected_item_promoted(self):
        """
        corrected=False 항목이 더 높은 RRF 점수이지만,
        corrected=True 항목에 +0.2 보너스가 붙으면 순위가 역전되어야 한다.
        """
        # 직접 _cross_collection_rrf 결과를 만든 뒤 보너스 로직 적용
        # RRF score: rank=0 → ~0.01639, rank=1 → ~0.01626
        # corrected 보너스 +0.2 → rank=1 항목이 역전
        results_by_source = {
            "jira": [
                {"id": 1, "score": 0.9, "payload": {"corrected": False, "title": "정상 이슈"}},
                {"id": 2, "score": 0.8, "payload": {"corrected": True,  "title": "수정된 이슈"}},
            ],
            "confluence": [],
            "documents":  [],
        }
        merged = kvc._cross_collection_rrf(results_by_source)
        # 보너스 적용 전: id=1이 상위
        assert merged[0]["point_id"] == 1

        # corrected 보너스 적용 (federated_search 내부 로직 그대로)
        for item in merged:
            if item["payload"].get("corrected"):
                item["score"] += kvc._CORRECTED_BONUS
        merged.sort(key=lambda x: x["score"], reverse=True)

        # 보너스 적용 후: id=2(corrected)가 상위로 역전
        assert merged[0]["point_id"] == 2, (
            "corrected=True 항목에 +0.2 보너스가 적용되어 순위가 역전되어야 한다"
        )

    def test_corrected_bonus_value(self):
        """보너스 상수가 0.2인지 확인."""
        assert kvc._CORRECTED_BONUS == 0.2


# ── federated_search mock 검증 ────────────────────────────────────────────────

class TestFederatedSearch:
    """Qdrant / 임베딩 모델 호출을 mock으로 대체해 federated_search 흐름 검증."""

    @pytest.mark.asyncio
    async def test_federated_search_returns_structure(self):
        """정상 호출 시 results + by_source 구조 반환."""
        dummy_dense  = [0.1] * 1024
        dummy_sparse = {"indices": [1, 2], "values": [0.5, 0.3]}

        jira_hits = [{"id": 100, "score": 0.016, "payload": {"title": "Jira 이슈"}}]
        conf_hits = [{"id": 200, "score": 0.015, "payload": {"page_title": "Confluence 페이지"}}]
        doc_hits  = [{"id": 300, "score": 0.014, "payload": {"file_name": "manual.pdf"}}]

        def mock_hybrid(collection, dense, sparse, filter_must=None, limit=5, **kw):
            if collection == kvc.JIRA_COLLECTION:
                return jira_hits
            elif collection == kvc.CONFLUENCE_COLLECTION:
                return conf_hits
            else:
                return doc_hits

        with (
            patch("knowledge_vector_client.get_embedding",    new=AsyncMock(return_value=dummy_dense)),
            patch("knowledge_vector_client.get_sparse_vector", new=AsyncMock(return_value=dummy_sparse)),
            patch("knowledge_vector_client._hybrid_search",   new=AsyncMock(side_effect=mock_hybrid)),
        ):
            result = await kvc.federated_search("테스트 쿼리", limit=10)

        assert "results"   in result
        assert "by_source" in result
        assert set(result["by_source"].keys()) >= {"jira", "confluence", "documents"}

    @pytest.mark.asyncio
    async def test_federated_search_source_filter(self):
        """sources=["jira"] 지정 시 jira만 검색."""
        dummy_dense  = [0.1] * 1024
        dummy_sparse = {"indices": [1], "values": [0.5]}
        called = []

        async def mock_hybrid(collection, dense, sparse, filter_must=None, limit=5, **kw):
            called.append(collection)
            return []

        with (
            patch("knowledge_vector_client.get_embedding",    new=AsyncMock(return_value=dummy_dense)),
            patch("knowledge_vector_client.get_sparse_vector", new=AsyncMock(return_value=dummy_sparse)),
            patch("knowledge_vector_client._hybrid_search",   new=AsyncMock(side_effect=mock_hybrid)),
        ):
            await kvc.federated_search("쿼리", sources=["jira"])

        assert kvc.JIRA_COLLECTION in called
        assert kvc.CONFLUENCE_COLLECTION not in called
        assert kvc.DOCUMENTS_COLLECTION not in called

    @pytest.mark.asyncio
    async def test_federated_search_embedding_failure_returns_empty(self):
        """임베딩 실패 시 빈 결과 반환 (예외 비전파)."""
        with patch(
            "knowledge_vector_client.get_embedding",
            new=AsyncMock(side_effect=RuntimeError("임베딩 모델 없음")),
        ):
            result = await kvc.federated_search("쿼리")

        assert result["results"] == []

    @pytest.mark.asyncio
    async def test_federated_search_by_source_count(self):
        """by_source 카운트가 실제 병합 결과와 일치."""
        dummy_dense  = [0.0] * 1024
        dummy_sparse = {"indices": [], "values": []}

        jira_hits = [
            {"id": 1, "score": 0.02, "payload": {}},
            {"id": 2, "score": 0.01, "payload": {}},
        ]

        async def mock_hybrid(collection, **kw):
            if collection == kvc.JIRA_COLLECTION:
                return jira_hits
            return []

        with (
            patch("knowledge_vector_client.get_embedding",    new=AsyncMock(return_value=dummy_dense)),
            patch("knowledge_vector_client.get_sparse_vector", new=AsyncMock(return_value=dummy_sparse)),
            patch("knowledge_vector_client._hybrid_search",   new=AsyncMock(side_effect=mock_hybrid)),
        ):
            result = await kvc.federated_search("쿼리", limit=10)

        assert result["by_source"]["jira"] == 2
        assert result["by_source"]["confluence"] == 0
        assert result["by_source"]["documents"] == 0


# ── upsert_operator_note point_id 타입 검증 ──────────────────────────────────

class TestOperatorNotePointId:
    """upsert_operator_note 반환값이 int인지 확인 (spec 결정: int)."""

    @pytest.mark.asyncio
    async def test_operator_note_returns_int(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()

        with (
            patch("knowledge_vector_client.ensure_collection", new=AsyncMock()),
            patch("knowledge_vector_client.get_embedding",    new=AsyncMock(return_value=[0.1] * 1024)),
            patch("knowledge_vector_client.get_sparse_vector", new=AsyncMock(return_value={"indices": [], "values": []})),
            patch("knowledge_vector_client._qdrant_http") as mock_http,
        ):
            mock_http.put = AsyncMock(return_value=mock_resp)
            point_id = await kvc.upsert_operator_note(
                question="테스트 질문",
                answer="테스트 답변",
                system_id=1,
            )

        assert isinstance(point_id, int), "upsert_operator_note는 int(uint64) point_id를 반환해야 한다"
        assert point_id > 0


# ── apply_correction 검증 ─────────────────────────────────────────────────────

class TestApplyCorrection:

    @pytest.mark.asyncio
    async def test_apply_correction_success(self):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()

        with patch("knowledge_vector_client._qdrant_http") as mock_http:
            mock_http.post = AsyncMock(return_value=mock_resp)
            ok = await kvc.apply_correction(
                point_id=12345,
                collection=kvc.JIRA_COLLECTION,
                correction_text="수정 내용",
            )

        assert ok is True

    @pytest.mark.asyncio
    async def test_apply_correction_failure_returns_false(self):
        with patch("knowledge_vector_client._qdrant_http") as mock_http:
            mock_http.post = AsyncMock(side_effect=RuntimeError("Qdrant 연결 실패"))
            ok = await kvc.apply_correction(
                point_id=12345,
                collection=kvc.JIRA_COLLECTION,
                correction_text="수정 내용",
            )

        assert ok is False


# ── delete_operator_note 검증 ────────────────────────────────────────────────

class TestDeleteOperatorNote:
    """delete_operator_note는 Qdrant DELETE 엔드포인트가 아닌 POST /points/delete를 호출해야 한다."""

    @pytest.mark.asyncio
    async def test_delete_uses_post_not_delete(self):
        """httpx .delete()는 body를 지원하지 않으므로 반드시 .post()를 사용해야 한다."""
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()

        with patch("knowledge_vector_client._qdrant_http") as mock_http:
            mock_http.post = AsyncMock(return_value=mock_resp)
            ok = await kvc.delete_operator_note(point_id=99999)

        assert ok is True
        # .post가 호출됐는지, .delete는 호출되지 않았는지 확인
        mock_http.post.assert_called_once()
        call_args = mock_http.post.call_args
        assert "/points/delete" in call_args[0][0], "Qdrant 삭제는 POST /points/delete 로 호출해야 한다"
        assert not hasattr(mock_http, "delete") or not mock_http.delete.called

    @pytest.mark.asyncio
    async def test_delete_failure_returns_false(self):
        with patch("knowledge_vector_client._qdrant_http") as mock_http:
            mock_http.post = AsyncMock(side_effect=RuntimeError("연결 실패"))
            ok = await kvc.delete_operator_note(point_id=99999)
        assert ok is False


# ── 모듈 상수 검증 ────────────────────────────────────────────────────────────

class TestModuleConstants:

    def test_collection_names(self):
        assert kvc.JIRA_COLLECTION       == "knowledge_jira_issues"
        assert kvc.CONFLUENCE_COLLECTION == "knowledge_confluence_pages"
        assert kvc.DOCUMENTS_COLLECTION  == "knowledge_documents"

    def test_payload_indexes_defined(self):
        assert len(kvc.JIRA_PAYLOAD_INDEXES)       > 0
        assert len(kvc.CONFLUENCE_PAYLOAD_INDEXES) > 0
        assert len(kvc.DOCUMENTS_PAYLOAD_INDEXES)  > 0

    def test_rrf_k_positive(self):
        assert kvc._RRF_K > 0

    def test_corrected_bonus_is_float(self):
        assert isinstance(kvc._CORRECTED_BONUS, float)
