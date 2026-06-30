"""retrieve_points_batch — tier-1 인식을 단일 Qdrant 호출로 (Phase B-1)."""
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import vector_client  # noqa: E402


@pytest.mark.asyncio
async def test_retrieve_points_batch_maps_by_id_and_fills_missing():
    """요청한 id들을 단일 POST로 조회하고, 존재하는 것은 매핑·미존재는 None."""
    resp = MagicMock(raise_for_status=MagicMock())
    resp.json = MagicMock(return_value={"result": [
        {"id": "id-a", "payload": {"is_notification": True}},
        {"id": "id-c", "payload": {"severity": "warning"}},
    ]})
    post_mock = AsyncMock(return_value=resp)
    with patch.object(vector_client._qdrant_http, "post", post_mock):
        out = await vector_client.retrieve_points_batch(["id-a", "id-b", "id-c"])
    post_mock.assert_called_once()  # N개 id를 단일 호출로
    sent = post_mock.call_args.kwargs["json"]
    assert sent["ids"] == ["id-a", "id-b", "id-c"]
    assert out["id-a"]["payload"]["is_notification"] is True
    assert out["id-b"] is None          # 미존재 → None
    assert out["id-c"]["payload"]["severity"] == "warning"


@pytest.mark.asyncio
async def test_retrieve_points_batch_empty_returns_empty():
    out = await vector_client.retrieve_points_batch([])
    assert out == {}


@pytest.mark.asyncio
async def test_retrieve_points_batch_error_returns_all_none():
    post_mock = AsyncMock(side_effect=RuntimeError("qdrant down"))
    with patch.object(vector_client._qdrant_http, "post", post_mock):
        out = await vector_client.retrieve_points_batch(["x", "y"])
    assert out == {"x": None, "y": None}
