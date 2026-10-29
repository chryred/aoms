import httpx
import pytest

from services import clickhouse_client


async def test_clickhouse_client_parses_jsoneachrow(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url
        seen["body"] = request.content.decode()
        return httpx.Response(200, text='{"a":1,"b":"x"}\n{"a":2,"b":"y"}\n')

    monkeypatch.setattr(clickhouse_client, "_transport", httpx.MockTransport(handler))
    rows = await clickhouse_client.query(
        "SELECT a, b FROM t WHERE c = {c:String} AND d IN {d:Array(UInt64)}",
        {"c": "x' OR 1=1", "d": [1, 2]},
    )
    assert rows == [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]
    assert seen["body"].endswith("FORMAT JSONEachRow")
    assert "OR 1=1" not in seen["body"]
    assert seen["url"].params["param_c"] == "x' OR 1=1"
    assert seen["url"].params["param_d"] == "[1,2]"
    assert seen["url"].params["database"] == "agent_t"


async def test_clickhouse_client_raises_on_http_error(monkeypatch):
    monkeypatch.setattr(
        clickhouse_client, "_transport",
        httpx.MockTransport(lambda r: httpx.Response(500, text="boom")),
    )
    with pytest.raises(clickhouse_client.ClickHouseError):
        await clickhouse_client.query("SELECT 1", {})
