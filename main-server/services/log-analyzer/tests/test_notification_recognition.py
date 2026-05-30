"""template 단위 notification 인식 + 결정적 point_id 단위 테스트.

검증 대상 (Qdrant/임베딩 모델 없이 httpx/함수 mock):
- vector_client.template_point_id: 결정적·멱등 (같은 입력 같은 id, 다른 입력 다른 id)
- vector_client.store_incident_vector: point_key 지정 시 결정적 id로 upsert
- analyzer._recognize_templates: tier-1 exact / tier-2 fuzzy / novel 분기
"""
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import vector_client  # noqa: E402
import analyzer  # noqa: E402


# ── template_point_id ─────────────────────────────────────────────────────────

def test_template_point_id_deterministic():
    a = vector_client.template_point_id("cxm", "was1", "OverlapException at <NUM>")
    b = vector_client.template_point_id("cxm", "was1", "OverlapException at <NUM>")
    assert a == b  # 같은 입력 → 같은 id (멱등)


def test_template_point_id_distinct_by_template_and_scope():
    base = vector_client.template_point_id("cxm", "was1", "NullPointerException")
    assert base != vector_client.template_point_id("cxm", "was1", "SQLException")      # 다른 template
    assert base != vector_client.template_point_id("cxm", "was2", "NullPointerException")  # 다른 role
    assert base != vector_client.template_point_id("erp", "was1", "NullPointerException")  # 다른 system


def test_template_point_id_is_uuid_string():
    import uuid
    pid = vector_client.template_point_id("cxm", "was1", "X")
    # UUID 문자열이어야 Qdrant store/retrieve/delete/DB 전 구간 타입 일관
    assert isinstance(pid, str)
    uuid.UUID(pid)  # 파싱 실패 시 ValueError


# ── store_incident_vector 결정적 id ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_store_incident_vector_deterministic_id():
    put_mock = AsyncMock(return_value=MagicMock(raise_for_status=MagicMock()))
    with patch.object(vector_client, "ensure_collection", AsyncMock()), \
         patch.object(vector_client._qdrant_http, "put", put_mock):
        pid = await vector_client.store_incident_vector(
            [0.1] * 4, {"indices": [1], "values": [0.5]},
            system_name="cxm", instance_role="was1", severity="info",
            log_pattern="IllegalAccessException: BatchJob<X>",
            is_notification=True, point_key="IllegalAccessException: BatchJob<X>",
        )
    expected = vector_client.template_point_id("cxm", "was1", "IllegalAccessException: BatchJob<X>")
    assert pid == expected
    # 실제 PUT 바디의 point id도 결정적 id와 일치
    sent_id = put_mock.call_args.kwargs["json"]["points"][0]["id"]
    assert sent_id == expected


@pytest.mark.asyncio
async def test_store_incident_vector_uuid_fallback_without_point_key():
    put_mock = AsyncMock(return_value=MagicMock(raise_for_status=MagicMock()))
    with patch.object(vector_client, "ensure_collection", AsyncMock()), \
         patch.object(vector_client._qdrant_http, "put", put_mock):
        pid = await vector_client.store_incident_vector(
            [0.1] * 4, {"indices": [1], "values": [0.5]},
            system_name="cxm", instance_role="was1", severity="warning",
            log_pattern="x", is_notification=False,
        )
    # point_key 미지정 → 두 번째 호출과 다른 uuid4 (비결정적, 하위 호환)
    assert pid != vector_client.template_point_id("cxm", "was1", "x")


# ── _recognize_templates 분기 ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_recognize_tier1_exact_inherits_stored_decision():
    """이미 저장된 포인트(tier-1 exact) → 저장된 is_notification/severity 승계, 임베딩 0회."""
    stored = {"payload": {"is_notification": True, "severity": "info", "occurrence_count": 3}}
    embed_batch = AsyncMock()
    with patch.object(analyzer, "retrieve_point", AsyncMock(return_value=stored)), \
         patch.object(analyzer, "get_embedding_batch", embed_batch):
        recog = await analyzer._recognize_templates("cxm", "was1", ["IllegalAccessException: job"])
    info = recog["IllegalAccessException: job"]
    assert info["recognized"] and info["is_notification"] and info["point_exists"]
    assert info["occurrence"] == 3
    embed_batch.assert_not_called()  # tier-1 hit이면 임베딩 호출 없음 (성능)


@pytest.mark.asyncio
async def test_recognize_tier2_fuzzy_variant_recognized_as_notification():
    """tier-1 미스지만 기존 notification 포인트와 유사(fuzzy) → 알림성 변형으로 인식 (랜덤분리 방지)."""
    hit = [{"id": "p", "score": 0.95, "payload": {"is_notification": True}}]
    with patch.object(analyzer, "retrieve_point", AsyncMock(return_value=None)), \
         patch.object(analyzer, "get_embedding_batch", AsyncMock(return_value=[[0.1] * 4])), \
         patch.object(analyzer, "get_sparse_vector", AsyncMock(return_value={"indices": [1], "values": [0.5]})), \
         patch.object(analyzer, "search_notification_incidents", AsyncMock(return_value=hit)):
        recog = await analyzer._recognize_templates("cxm", "was1", ["IllegalAccessException: BatchJobBranMD"])
    info = recog["IllegalAccessException: BatchJobBranMD"]
    assert info["recognized"] and info["is_notification"]
    assert info["point_exists"] is False           # 자기 포인트는 신규(저장 대상)
    assert info["dense"] is not None               # 저장 재사용용 임베딩 동봉


@pytest.mark.asyncio
async def test_recognize_novel_error_not_recognized():
    """신규 실에러(OverlapException) → 어떤 notification 포인트와도 매칭 안 됨 → 미인식 (LLM 대상)."""
    with patch.object(analyzer, "retrieve_point", AsyncMock(return_value=None)), \
         patch.object(analyzer, "get_embedding_batch", AsyncMock(return_value=[[0.1] * 4])), \
         patch.object(analyzer, "get_sparse_vector", AsyncMock(return_value={"indices": [1], "values": [0.5]})), \
         patch.object(analyzer, "search_notification_incidents", AsyncMock(return_value=[])):
        recog = await analyzer._recognize_templates("cxm", "was1", ["OverlapException at line <NUM>"])
    info = recog["OverlapException at line <NUM>"]
    assert info["recognized"] is False and info["is_notification"] is False
