import pytest
from httpx import AsyncClient


SYSTEM_PAYLOAD = {
    "system_name": "was-server",
    "display_name": "WAS 서버",
}


async def create_system(client: AsyncClient, payload: dict = None) -> dict:
    resp = await client.post("/api/v1/systems", json=payload or SYSTEM_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()


# ── 등록 ─────────────────────────────────────────────────────────────────────

async def test_create_system(client: AsyncClient):
    data = await create_system(client)

    assert data["system_name"] == "was-server"
    assert data["display_name"] == "WAS 서버"
    assert data["id"] is not None


# ── 조회 ─────────────────────────────────────────────────────────────────────

async def test_list_systems(client: AsyncClient):
    await create_system(client)
    resp = await client.get("/api/v1/systems")

    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_get_system(client: AsyncClient):
    created = await create_system(client)
    resp = await client.get(f"/api/v1/systems/{created['id']}")

    assert resp.status_code == 200
    assert resp.json()["system_name"] == "was-server"


async def test_get_system_not_found(client: AsyncClient):
    resp = await client.get("/api/v1/systems/9999")
    assert resp.status_code == 404


# ── 수정 ─────────────────────────────────────────────────────────────────────

async def test_update_system(client: AsyncClient):
    created = await create_system(client)
    resp = await client.patch(
        f"/api/v1/systems/{created['id']}",
        json={"display_name": "WAS 서버 (수정)"}
    )

    assert resp.status_code == 200
    assert resp.json()["display_name"] == "WAS 서버 (수정)"
    assert resp.json()["system_name"] == "was-server"  # 나머지 필드 유지


async def test_update_system_not_found(client: AsyncClient):
    resp = await client.patch("/api/v1/systems/9999", json={"display_name": "없음"})
    assert resp.status_code == 404


# ── 삭제 ─────────────────────────────────────────────────────────────────────

async def test_delete_system(client: AsyncClient):
    created = await create_system(client)
    resp = await client.delete(f"/api/v1/systems/{created['id']}")
    assert resp.status_code == 204

    resp = await client.get(f"/api/v1/systems/{created['id']}")
    assert resp.status_code == 404


async def test_delete_system_not_found(client: AsyncClient):
    resp = await client.delete("/api/v1/systems/9999")
    assert resp.status_code == 404
