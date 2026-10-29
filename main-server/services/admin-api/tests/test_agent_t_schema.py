from httpx import AsyncClient


async def _system_id(client: AsyncClient) -> int:
    resp = await client.post(
        "/api/v1/systems", json={"system_name": "agent-t-sys", "display_name": "Agent-T"}
    )
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_agent_type_agent_t_requires_ssh_username(authed_client: AsyncClient):
    sid = await _system_id(authed_client)
    base = {"system_id": sid, "host": "10.0.0.1"}

    resp = await authed_client.post("/api/v1/agents", json={**base, "agent_type": "agent_t"})
    assert resp.status_code == 422

    resp = await authed_client.post(
        "/api/v1/agents", json={**base, "agent_type": "agent_t", "ssh_username": "was"}
    )
    assert resp.status_code == 201

    resp = await authed_client.post(
        "/api/v1/agents", json={**base, "agent_type": "bogus_type", "ssh_username": "was"}
    )
    assert resp.status_code == 422
