import json

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


async def _make_agent_t(client, sid, label, host="10.0.0.1"):
    return await client.post(
        "/api/v1/agents",
        json={"system_id": sid, "host": host, "agent_type": "agent_t", "ssh_username": "was", "label_info": label},
    )


async def test_agent_t_label_info_must_be_json_object(authed_client: AsyncClient):
    sid = await _system_id(authed_client)
    for bad in ("not json", "[1,2]", '"str"', "null"):
        resp = await _make_agent_t(authed_client, sid, bad)
        assert resp.status_code == 422, bad
    ok = await _make_agent_t(authed_client, sid, '{"jvm_match": "-Dsic_server1"}')
    assert ok.status_code == 201
    resp = await authed_client.patch(f"/api/v1/agents/{ok.json()['id']}", json={"label_info": "[1]"})
    assert resp.status_code == 422


async def test_agent_t_instance_role_unique_per_system(authed_client: AsyncClient):
    sid = await _system_id(authed_client)
    a = await _make_agent_t(authed_client, sid, '{"instance_role": "sic_server1"}')
    assert a.status_code == 201
    dup = await _make_agent_t(authed_client, sid, '{"instance_role": "sic_server1"}', host="10.0.0.2")
    assert dup.status_code == 409
    b = await _make_agent_t(authed_client, sid, '{"instance_role": "sic_server2"}', host="10.0.0.2")
    assert b.status_code == 201
    # PATCH 로 다른 agent 의 role 을 가로채도 409, 자기 자신 role 유지는 허용
    resp = await authed_client.patch(
        f"/api/v1/agents/{b.json()['id']}", json={"label_info": '{"instance_role": "sic_server1"}'}
    )
    assert resp.status_code == 409
    resp = await authed_client.patch(
        f"/api/v1/agents/{b.json()['id']}", json={"label_info": '{"instance_role": "sic_server2", "x": 1}'}
    )
    assert resp.status_code == 200


async def test_agent_t_role_may_repeat_in_other_system(authed_client: AsyncClient):
    sid1 = await _system_id(authed_client)
    resp = await authed_client.post("/api/v1/systems", json={"system_name": "other-sys", "display_name": "O"})
    sid2 = resp.json()["id"]
    assert (await _make_agent_t(authed_client, sid1, '{"instance_role": "was1"}')).status_code == 201
    assert (await _make_agent_t(authed_client, sid2, '{"instance_role": "was1"}')).status_code == 201


async def test_start_stop_restart_rejected_for_agent_t(authed_client: AsyncClient):
    sid = await _system_id(authed_client)
    agent = (await _make_agent_t(authed_client, sid, '{"instance_role": "was1"}')).json()
    for action in ("start", "stop", "restart"):
        resp = await authed_client.post(f"/api/v1/agents/{agent['id']}/{action}")
        assert resp.status_code == 400, action


async def test_patch_agent_t_label_keeps_installer_keys(authed_client: AsyncClient):
    sid = await _system_id(authed_client)
    created = await _make_agent_t(
        authed_client, sid,
        '{"instance_role": "a", "agent_token_sha256": "abc", "jdk_major": 11, "jar": "agent-t.jar"}',
    )
    aid = created.json()["id"]

    resp = await authed_client.patch(
        f"/api/v1/agents/{aid}", json={"label_info": '{"instance_role": "b", "jvm_match": "-Dx"}'}
    )
    assert resp.status_code == 200
    info = json.loads(resp.json()["label_info"])
    assert info["agent_token_sha256"] == "abc"
    assert info["jdk_major"] == 11 and info["jar"] == "agent-t.jar"
    assert info["instance_role"] == "b" and info["jvm_match"] == "-Dx"

    # 요청이 명시한 값은 그대로 따른다
    resp = await authed_client.patch(
        f"/api/v1/agents/{aid}", json={"label_info": '{"instance_role": "b", "agent_token_sha256": "new"}'}
    )
    assert json.loads(resp.json()["label_info"])["agent_token_sha256"] == "new"
