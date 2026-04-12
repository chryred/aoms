import pytest
from httpx import AsyncClient


CONTACT_PAYLOAD = {
    "name": "홍길동",
    "email": "hong@company.com",
    "teams_upn": "hong@company.com",
}

SYSTEM_PAYLOAD = {
    "system_name": "was-server",
    "display_name": "WAS 서버",
}


async def create_contact(client: AsyncClient, payload: dict = None) -> dict:
    resp = await client.post("/api/v1/contacts", json=payload or CONTACT_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()


async def create_system(client: AsyncClient) -> dict:
    resp = await client.post("/api/v1/systems", json=SYSTEM_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()


# ── 등록 ─────────────────────────────────────────────────────────────────────

async def test_create_contact(client: AsyncClient):
    data = await create_contact(client)

    assert data["name"] == "홍길동"
    assert data["email"] == "hong@company.com"
    assert data["id"] is not None


async def test_list_contacts(client: AsyncClient):
    await create_contact(client)
    resp = await client.get("/api/v1/contacts")

    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_get_contact(client: AsyncClient):
    created = await create_contact(client)
    resp = await client.get(f"/api/v1/contacts/{created['id']}")

    assert resp.status_code == 200
    assert resp.json()["name"] == "홍길동"


async def test_get_contact_not_found(client: AsyncClient):
    resp = await client.get("/api/v1/contacts/9999")
    assert resp.status_code == 404


# ── 수정 ─────────────────────────────────────────────────────────────────────

async def test_update_contact(client: AsyncClient):
    created = await create_contact(client)
    resp = await client.patch(
        f"/api/v1/contacts/{created['id']}",
        json={"email": "new@company.com"}
    )

    assert resp.status_code == 200
    assert resp.json()["email"] == "new@company.com"
    assert resp.json()["name"] == "홍길동"  # 나머지 필드 유지


# ── 삭제 ─────────────────────────────────────────────────────────────────────

async def test_delete_contact(client: AsyncClient):
    created = await create_contact(client)
    resp = await client.delete(f"/api/v1/contacts/{created['id']}")
    assert resp.status_code == 204

    resp = await client.get(f"/api/v1/contacts/{created['id']}")
    assert resp.status_code == 404


# ── 시스템-담당자 연결 ────────────────────────────────────────────────────────

async def test_add_and_list_system_contact(client: AsyncClient):
    system = await create_system(client)
    contact = await create_contact(client)

    resp = await client.post(
        f"/api/v1/systems/{system['id']}/contacts",
        json={"contact_id": contact["id"], "notify_channels": "teams"}
    )
    assert resp.status_code == 201

    resp = await client.get(f"/api/v1/systems/{system['id']}/contacts")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["contact"]["name"] == "홍길동"


async def test_add_system_contact_system_not_found(client: AsyncClient):
    contact = await create_contact(client)
    resp = await client.post(
        "/api/v1/systems/9999/contacts",
        json={"contact_id": contact["id"], "notify_channels": "teams"}
    )
    assert resp.status_code == 404


async def test_add_system_contact_contact_not_found(client: AsyncClient):
    system = await create_system(client)
    resp = await client.post(
        f"/api/v1/systems/{system['id']}/contacts",
        json={"contact_id": 9999, "notify_channels": "teams"}
    )
    assert resp.status_code == 404


async def test_remove_system_contact(client: AsyncClient):
    system = await create_system(client)
    contact = await create_contact(client)

    await client.post(
        f"/api/v1/systems/{system['id']}/contacts",
        json={"contact_id": contact["id"], "notify_channels": "teams"}
    )

    resp = await client.delete(f"/api/v1/systems/{system['id']}/contacts/{contact['id']}")
    assert resp.status_code == 204

    resp = await client.get(f"/api/v1/systems/{system['id']}/contacts")
    assert resp.json() == []
