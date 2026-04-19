import pytest
from httpx import AsyncClient


SYSTEM_PAYLOAD = {
    "system_name": "was-server",
    "display_name": "WAS 서버",
}


async def get_admin_user_id(client: AsyncClient) -> int:
    """테스트용: 승인된 사용자 목록에서 첫 번째 유저 ID 반환"""
    resp = await client.get("/api/v1/auth/users")
    assert resp.status_code == 200
    users = resp.json()
    assert len(users) > 0, "authed_client fixture가 admin을 DB에 저장해야 합니다"
    return users[0]["id"]


async def create_contact(client: AsyncClient, user_id: int) -> dict:
    resp = await client.post("/api/v1/contacts", json={"user_id": user_id, "teams_upn": "admin@test.com"})
    assert resp.status_code == 201
    return resp.json()


async def create_system(client: AsyncClient) -> dict:
    resp = await client.post("/api/v1/systems", json=SYSTEM_PAYLOAD)
    assert resp.status_code == 201
    return resp.json()


# ── 등록 ─────────────────────────────────────────────────────────────────────

async def test_create_contact(authed_client: AsyncClient):
    user_id = await get_admin_user_id(authed_client)
    data = await create_contact(authed_client, user_id)

    assert data["name"] == "테스트관리자"
    assert data["email"] == "admin@test.com"
    assert data["user_id"] == user_id
    assert data["id"] is not None


async def test_list_contacts(authed_client: AsyncClient):
    user_id = await get_admin_user_id(authed_client)
    await create_contact(authed_client, user_id)
    resp = await authed_client.get("/api/v1/contacts")

    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_get_contact(authed_client: AsyncClient):
    user_id = await get_admin_user_id(authed_client)
    created = await create_contact(authed_client, user_id)
    resp = await authed_client.get(f"/api/v1/contacts/{created['id']}")

    assert resp.status_code == 200
    assert resp.json()["name"] == "테스트관리자"


async def test_get_contact_not_found(authed_client: AsyncClient):
    resp = await authed_client.get("/api/v1/contacts/9999")
    assert resp.status_code == 404


async def test_create_contact_duplicate(authed_client: AsyncClient):
    """동일 user_id로 두 번 등록 시 409"""
    user_id = await get_admin_user_id(authed_client)
    await create_contact(authed_client, user_id)
    resp = await authed_client.post("/api/v1/contacts", json={"user_id": user_id})
    assert resp.status_code == 409


# ── 수정 ─────────────────────────────────────────────────────────────────────

async def test_update_contact(authed_client: AsyncClient):
    user_id = await get_admin_user_id(authed_client)
    created = await create_contact(authed_client, user_id)
    resp = await authed_client.patch(
        f"/api/v1/contacts/{created['id']}",
        json={"teams_upn": "new@company.com"}
    )

    assert resp.status_code == 200
    assert resp.json()["teams_upn"] == "new@company.com"
    assert resp.json()["name"] == "테스트관리자"  # user.name 유지


# ── 삭제 ─────────────────────────────────────────────────────────────────────

async def test_delete_contact(authed_client: AsyncClient):
    user_id = await get_admin_user_id(authed_client)
    created = await create_contact(authed_client, user_id)
    resp = await authed_client.delete(f"/api/v1/contacts/{created['id']}")
    assert resp.status_code == 204

    resp = await authed_client.get(f"/api/v1/contacts/{created['id']}")
    assert resp.status_code == 404


# ── 시스템-담당자 연결 ────────────────────────────────────────────────────────

async def test_add_and_list_system_contact(authed_client: AsyncClient):
    user_id = await get_admin_user_id(authed_client)
    system = await create_system(authed_client)
    contact = await create_contact(authed_client, user_id)

    resp = await authed_client.post(
        f"/api/v1/systems/{system['id']}/contacts",
        json={"contact_id": contact["id"], "notify_channels": "teams"}
    )
    assert resp.status_code == 201

    resp = await authed_client.get(f"/api/v1/systems/{system['id']}/contacts")
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["contact"]["name"] == "테스트관리자"


async def test_add_system_contact_system_not_found(authed_client: AsyncClient):
    user_id = await get_admin_user_id(authed_client)
    contact = await create_contact(authed_client, user_id)
    resp = await authed_client.post(
        "/api/v1/systems/9999/contacts",
        json={"contact_id": contact["id"], "notify_channels": "teams"}
    )
    assert resp.status_code == 404


async def test_add_system_contact_contact_not_found(authed_client: AsyncClient):
    system = await create_system(authed_client)
    resp = await authed_client.post(
        f"/api/v1/systems/{system['id']}/contacts",
        json={"contact_id": 9999, "notify_channels": "teams"}
    )
    assert resp.status_code == 404


async def test_remove_system_contact(authed_client: AsyncClient):
    user_id = await get_admin_user_id(authed_client)
    system = await create_system(authed_client)
    contact = await create_contact(authed_client, user_id)

    await authed_client.post(
        f"/api/v1/systems/{system['id']}/contacts",
        json={"contact_id": contact["id"], "notify_channels": "teams"}
    )

    resp = await authed_client.delete(f"/api/v1/systems/{system['id']}/contacts/{contact['id']}")
    assert resp.status_code == 204

    resp = await authed_client.get(f"/api/v1/systems/{system['id']}/contacts")
    assert resp.json() == []
