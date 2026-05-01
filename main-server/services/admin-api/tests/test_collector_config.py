"""
/api/v1/collector-config 단위 테스트 (D4 이후)

GET  → agent_instances.label_info에서 derive
POST / PATCH / DELETE → 410 Gone
GET /templates/{type} → 그대로 유지
"""

import json
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from models import AgentInstance


SYSTEM_PAYLOAD = {
    "system_name": "config-test-server",
    "display_name": "Config Test Server",
}


async def create_system(client: AsyncClient) -> int:
    resp = await client.post("/api/v1/systems", json=SYSTEM_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()["id"]


async def create_agent_via_api(client: AsyncClient, system_id: int, agent_type: str, label_info: dict) -> int:
    """HTTP API 경유 에이전트 생성 (synapse_agent 등 SSH 기반)"""
    resp = await client.post("/api/v1/agents", json={
        "system_id": system_id,
        "agent_type": agent_type,
        "host": "1.2.3.4",
        "status": "running",
        "label_info": json.dumps(label_info),
    })
    assert resp.status_code == 201
    return resp.json()["id"]


async def create_db_agent_direct(db: AsyncSession, system_id: int, label_info: dict) -> int:
    """DB 에이전트는 HTTP API가 ENCRYPTION_KEY 체크를 하므로 직접 삽입"""
    agent = AgentInstance(
        system_id=system_id,
        agent_type="db",
        host="1.2.3.4",
        status="running",
        label_info=json.dumps(label_info),
    )
    db.add(agent)
    await db.flush()
    return agent.id


# ── GET: derive 검증 ──────────────────────────────────────────────────────────

async def test_list_derive_synapse_agent(authed_client: AsyncClient):
    """synapse_agent running → 6개 metric_group derive"""
    system_id = await create_system(authed_client)
    await create_agent_via_api(authed_client, system_id, "synapse_agent", {
        "system_name": "config-test-server",
        "collectors": {"cpu": True, "memory": True, "disk": False},
    })

    resp = await authed_client.get("/api/v1/collector-config", params={"system_id": system_id})
    assert resp.status_code == 200
    items = resp.json()
    # 6개 그룹 (cpu, memory, disk, network, log, web)
    assert len(items) == 6
    groups = {it["metric_group"] for it in items}
    assert groups == {"cpu", "memory", "disk", "network", "log", "web"}
    # collector_type 모두 synapse_agent
    assert all(it["collector_type"] == "synapse_agent" for it in items)
    # disk는 False → enabled=False
    disk_item = next(it for it in items if it["metric_group"] == "disk")
    assert disk_item["enabled"] is False
    # cpu는 True
    cpu_item = next(it for it in items if it["metric_group"] == "cpu")
    assert cpu_item["enabled"] is True


async def test_list_derive_db_agent(authed_client: AsyncClient, db_session: AsyncSession):
    """db running → db_exporter 4개 metric_group derive"""
    system_id = await create_system(authed_client)
    await create_db_agent_direct(db_session, system_id, {
        "db_type": "postgresql",
        "database": "testdb",
        "username": "u",
        "encrypted_password": "x",
    })

    resp = await authed_client.get("/api/v1/collector-config", params={"system_id": system_id})
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 4
    groups = {it["metric_group"] for it in items}
    assert groups == {"db_connections", "db_query", "db_cache", "db_replication"}
    assert all(it["collector_type"] == "db_exporter" for it in items)
    assert all(it["enabled"] is True for it in items)


async def test_list_derive_stopped_agent_excluded(authed_client: AsyncClient):
    """stopped 상태 에이전트는 derive 결과에 포함되지 않는다"""
    system_id = await create_system(authed_client)
    await create_agent_via_api(authed_client, system_id, "synapse_agent", {"system_name": "s"})
    # status를 stopped로 변경
    agents_resp = await authed_client.get("/api/v1/agents", params={"system_id": system_id})
    agent_id = agents_resp.json()[0]["id"]
    await authed_client.patch(f"/api/v1/agents/{agent_id}", json={"status": "stopped"})

    resp = await authed_client.get("/api/v1/collector-config", params={"system_id": system_id})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_derive_stable_id(authed_client: AsyncClient):
    """동일 에이전트에 대한 id는 호출마다 동일해야 한다"""
    system_id = await create_system(authed_client)
    await create_agent_via_api(authed_client, system_id, "synapse_agent", {"system_name": "s"})

    resp1 = await authed_client.get("/api/v1/collector-config", params={"system_id": system_id})
    resp2 = await authed_client.get("/api/v1/collector-config", params={"system_id": system_id})
    ids1 = [it["id"] for it in resp1.json()]
    ids2 = [it["id"] for it in resp2.json()]
    assert ids1 == ids2


async def test_list_derive_no_agents_returns_empty(authed_client: AsyncClient):
    """에이전트 없는 시스템 → 빈 목록"""
    system_id = await create_system(authed_client)
    resp = await authed_client.get("/api/v1/collector-config", params={"system_id": system_id})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_derive_filter_collector_type(authed_client: AsyncClient):
    """collector_type 필터가 동작한다"""
    system_id = await create_system(authed_client)
    await create_agent_via_api(authed_client, system_id, "synapse_agent", {"system_name": "s"})

    resp = await authed_client.get("/api/v1/collector-config", params={
        "system_id": system_id,
        "collector_type": "synapse_agent",
    })
    assert resp.status_code == 200
    assert all(it["collector_type"] == "synapse_agent" for it in resp.json())

    resp2 = await authed_client.get("/api/v1/collector-config", params={
        "system_id": system_id,
        "collector_type": "db_exporter",
    })
    assert resp2.status_code == 200
    assert resp2.json() == []


# ── POST / PATCH / DELETE → 410 Gone ──────────────────────────────────────────

async def test_post_returns_410(authed_client: AsyncClient):
    resp = await authed_client.post("/api/v1/collector-config", json={
        "system_id": 1, "collector_type": "synapse_agent", "metric_group": "cpu",
    })
    assert resp.status_code == 410


async def test_patch_returns_410(authed_client: AsyncClient):
    resp = await authed_client.patch("/api/v1/collector-config/1", json={"enabled": False})
    assert resp.status_code == 410


async def test_delete_returns_410(authed_client: AsyncClient):
    resp = await authed_client.delete("/api/v1/collector-config/1")
    assert resp.status_code == 410


# ── 템플릿 ────────────────────────────────────────────────────────────────────

async def test_get_template_db_exporter(authed_client: AsyncClient):
    resp = await authed_client.get("/api/v1/collector-config/templates/db_exporter")
    assert resp.status_code == 200
    data = resp.json()
    assert data["collector_type"] == "db_exporter"
    groups = [g["metric_group"] for g in data["metric_groups"]]
    assert "db_connections" in groups
    assert "db_query" in groups


async def test_get_template_synapse_agent(authed_client: AsyncClient):
    resp = await authed_client.get("/api/v1/collector-config/templates/synapse_agent")
    assert resp.status_code == 200
    groups = [g["metric_group"] for g in resp.json()["metric_groups"]]
    assert "cpu" in groups
    assert "memory" in groups


async def test_get_template_unknown_type(authed_client: AsyncClient):
    resp = await authed_client.get("/api/v1/collector-config/templates/unknown_exporter")
    assert resp.status_code == 404
