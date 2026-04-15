"""
Phase 5 — /api/v1/collector-config 단위 테스트
수집기 설정 CRUD + 타입별 템플릿 조회
"""

import pytest
from httpx import AsyncClient


SYSTEM_PAYLOAD = {
    "system_name": "config-test-server",
    "display_name": "Config Test Server",
}


async def create_system(client: AsyncClient) -> int:
    resp = await client.post("/api/v1/systems", json=SYSTEM_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()["id"]


# ── 등록 ─────────────────────────────────────────────────────────────────────

async def test_create_collector_config(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    resp = await authed_client.post("/api/v1/collector-config", json={
        "system_id": system_id,
        "collector_type": "node_exporter",
        "metric_group": "cpu",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["collector_type"] == "node_exporter"
    assert data["metric_group"] == "cpu"
    assert data["enabled"] is True


async def test_create_multiple_collector_configs(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    for group in ("cpu", "memory", "disk"):
        resp = await authed_client.post("/api/v1/collector-config", json={
            "system_id": system_id,
            "collector_type": "node_exporter",
            "metric_group": group,
        })
        assert resp.status_code == 201


# ── 조회 ─────────────────────────────────────────────────────────────────────

async def test_list_collector_configs(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    for group in ("cpu", "memory"):
        await authed_client.post("/api/v1/collector-config", json={
            "system_id": system_id,
            "collector_type": "node_exporter",
            "metric_group": group,
        })

    resp = await authed_client.get("/api/v1/collector-config", params={"system_id": system_id})
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 2
    groups = {item["metric_group"] for item in items}
    assert groups == {"cpu", "memory"}


async def test_list_collector_configs_filter_type(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    await authed_client.post("/api/v1/collector-config", json={
        "system_id": system_id, "collector_type": "node_exporter", "metric_group": "cpu",
    })
    await authed_client.post("/api/v1/collector-config", json={
        "system_id": system_id, "collector_type": "jmx_exporter", "metric_group": "jvm_heap",
    })

    resp = await authed_client.get("/api/v1/collector-config", params={"collector_type": "jmx_exporter"})
    assert resp.status_code == 200
    items = resp.json()
    assert all(item["collector_type"] == "jmx_exporter" for item in items)


# ── 수정 ─────────────────────────────────────────────────────────────────────

async def test_update_collector_config(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    create_resp = await authed_client.post("/api/v1/collector-config", json={
        "system_id": system_id,
        "collector_type": "node_exporter",
        "metric_group": "cpu",
    })
    config_id = create_resp.json()["id"]

    resp = await authed_client.patch(f"/api/v1/collector-config/{config_id}", json={"enabled": False})
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


async def test_update_collector_config_not_found(authed_client: AsyncClient):
    resp = await authed_client.patch("/api/v1/collector-config/9999", json={"is_active": False})
    assert resp.status_code == 404


# ── 삭제 ─────────────────────────────────────────────────────────────────────

async def test_delete_collector_config(authed_client: AsyncClient):
    system_id = await create_system(authed_client)
    create_resp = await authed_client.post("/api/v1/collector-config", json={
        "system_id": system_id,
        "collector_type": "node_exporter",
        "metric_group": "network",
    })
    config_id = create_resp.json()["id"]

    resp = await authed_client.delete(f"/api/v1/collector-config/{config_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True

    list_resp = await authed_client.get("/api/v1/collector-config", params={"system_id": system_id})
    assert len(list_resp.json()) == 0


async def test_delete_collector_config_not_found(authed_client: AsyncClient):
    resp = await authed_client.delete("/api/v1/collector-config/9999")
    assert resp.status_code == 404


# ── 템플릿 ────────────────────────────────────────────────────────────────────
# node_exporter, jmx_exporter는 synapse_agent로 대체되어 제거됨

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
