"""
Phase 5 — /api/v1/collector-config 단위 테스트
수집기 설정 CRUD + 타입별 템플릿 조회
"""

import pytest
from httpx import AsyncClient


SYSTEM_PAYLOAD = {
    "system_name": "config-test-server",
    "display_name": "Config Test Server",
    "host": "10.0.0.1",
    "os_type": "linux",
    "system_type": "was",
}


async def create_system(client: AsyncClient) -> int:
    resp = await client.post("/api/v1/systems", json=SYSTEM_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()["id"]


# ── 등록 ─────────────────────────────────────────────────────────────────────

async def test_create_collector_config(client: AsyncClient):
    system_id = await create_system(client)
    resp = await client.post("/api/v1/collector-config", json={
        "system_id": system_id,
        "collector_type": "node_exporter",
        "metric_group": "cpu",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["collector_type"] == "node_exporter"
    assert data["metric_group"] == "cpu"
    assert data["enabled"] is True


async def test_create_multiple_collector_configs(client: AsyncClient):
    system_id = await create_system(client)
    for group in ("cpu", "memory", "disk"):
        resp = await client.post("/api/v1/collector-config", json={
            "system_id": system_id,
            "collector_type": "node_exporter",
            "metric_group": group,
        })
        assert resp.status_code == 201


# ── 조회 ─────────────────────────────────────────────────────────────────────

async def test_list_collector_configs(client: AsyncClient):
    system_id = await create_system(client)
    for group in ("cpu", "memory"):
        await client.post("/api/v1/collector-config", json={
            "system_id": system_id,
            "collector_type": "node_exporter",
            "metric_group": group,
        })

    resp = await client.get("/api/v1/collector-config", params={"system_id": system_id})
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 2
    groups = {item["metric_group"] for item in items}
    assert groups == {"cpu", "memory"}


async def test_list_collector_configs_filter_type(client: AsyncClient):
    system_id = await create_system(client)
    await client.post("/api/v1/collector-config", json={
        "system_id": system_id, "collector_type": "node_exporter", "metric_group": "cpu",
    })
    await client.post("/api/v1/collector-config", json={
        "system_id": system_id, "collector_type": "jmx_exporter", "metric_group": "jvm_heap",
    })

    resp = await client.get("/api/v1/collector-config", params={"collector_type": "jmx_exporter"})
    assert resp.status_code == 200
    items = resp.json()
    assert all(item["collector_type"] == "jmx_exporter" for item in items)


# ── 수정 ─────────────────────────────────────────────────────────────────────

async def test_update_collector_config(client: AsyncClient):
    system_id = await create_system(client)
    create_resp = await client.post("/api/v1/collector-config", json={
        "system_id": system_id,
        "collector_type": "node_exporter",
        "metric_group": "cpu",
    })
    config_id = create_resp.json()["id"]

    resp = await client.patch(f"/api/v1/collector-config/{config_id}", json={"enabled": False})
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


async def test_update_collector_config_not_found(client: AsyncClient):
    resp = await client.patch("/api/v1/collector-config/9999", json={"is_active": False})
    assert resp.status_code == 404


# ── 삭제 ─────────────────────────────────────────────────────────────────────

async def test_delete_collector_config(client: AsyncClient):
    system_id = await create_system(client)
    create_resp = await client.post("/api/v1/collector-config", json={
        "system_id": system_id,
        "collector_type": "node_exporter",
        "metric_group": "network",
    })
    config_id = create_resp.json()["id"]

    resp = await client.delete(f"/api/v1/collector-config/{config_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True

    list_resp = await client.get("/api/v1/collector-config", params={"system_id": system_id})
    assert len(list_resp.json()) == 0


async def test_delete_collector_config_not_found(client: AsyncClient):
    resp = await client.delete("/api/v1/collector-config/9999")
    assert resp.status_code == 404


# ── 템플릿 ────────────────────────────────────────────────────────────────────

async def test_get_template_node_exporter(client: AsyncClient):
    resp = await client.get("/api/v1/collector-config/templates/node_exporter")
    assert resp.status_code == 200
    data = resp.json()
    assert data["collector_type"] == "node_exporter"
    groups = [g["metric_group"] for g in data["metric_groups"]]
    assert "cpu" in groups
    assert "memory" in groups
    assert "disk" in groups


async def test_get_template_jmx_exporter(client: AsyncClient):
    resp = await client.get("/api/v1/collector-config/templates/jmx_exporter")
    assert resp.status_code == 200
    groups = [g["metric_group"] for g in resp.json()["metric_groups"]]
    assert "jvm_heap" in groups
    assert "thread_pool" in groups


async def test_get_template_unknown_type(client: AsyncClient):
    resp = await client.get("/api/v1/collector-config/templates/unknown_exporter")
    assert resp.status_code == 404
