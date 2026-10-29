import pytest

from auth import get_current_user
from main import app
from models import ApmDashboard, User

URL = "/api/v1/apm/dashboards"


def _widget(i="w1", type_="tps", **kw):
    w = {"i": i, "type": type_, "x": 0, "y": 0, "w": 4, "h": 3}
    w.update(kw)
    return w


async def _other_user(db, role="operator", email="op@test.com"):
    u = User(email=email, password_hash="h", name="운영자", role=role, is_active=True, is_approved=True)
    db.add(u)
    await db.flush()
    return u


async def test_first_get_copies_shared_default(authed_client, db_session):
    owner = await _other_user(db_session, email="owner@test.com")
    db_session.add(ApmDashboard(
        owner_user_id=owner.id, name="기본", layout=[_widget()], filters={"a": 1}, is_shared_default=True,
    ))
    await db_session.flush()

    resp = await authed_client.get(URL)
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["name"] == "기본" and items[0]["is_shared_default"] is False
    assert items[0]["owner_user_id"] != owner.id
    assert items[0]["layout"][0]["type"] == "tps"

    again = await authed_client.get(URL)
    assert len(again.json()) == 1  # 재조회 시 중복 복사 없음


async def test_get_empty_without_shared_default(authed_client):
    resp = await authed_client.get(URL)
    assert resp.status_code == 200 and resp.json() == []


async def test_create_update_delete_roundtrip(authed_client):
    resp = await authed_client.post(URL, json={"name": "내 화면", "layout": [_widget(target={"system_ids": [1]})], "filters": {}})
    assert resp.status_code == 201
    did = resp.json()["id"]
    assert resp.json()["layout"][0]["target"] == {"system_ids": [1]}

    resp = await authed_client.put(f"{URL}/{did}", json={"name": "수정", "layout": [], "filters": {"k": "v"}})
    assert resp.status_code == 200 and resp.json()["name"] == "수정"

    assert (await authed_client.delete(f"{URL}/{did}")).status_code == 204
    assert (await authed_client.get(URL)).json() == []


async def test_put_delete_other_users_dashboard_403(authed_client, db_session):
    other = await _other_user(db_session)
    d = ApmDashboard(owner_user_id=other.id, name="남의 것", layout=[], filters={})
    db_session.add(d)
    await db_session.flush()
    resp = await authed_client.put(f"{URL}/{d.id}", json={"name": "x", "layout": [], "filters": {}})
    assert resp.status_code == 403
    assert (await authed_client.delete(f"{URL}/{d.id}")).status_code == 403


async def test_invalid_widget_type_422(authed_client):
    resp = await authed_client.post(URL, json={"name": "n", "layout": [_widget(type_="bogus")], "filters": {}})
    assert resp.status_code == 422


async def test_negative_coordinate_422(authed_client):
    resp = await authed_client.post(URL, json={"name": "n", "layout": [_widget(x=-1)], "filters": {}})
    assert resp.status_code == 422


@pytest.mark.parametrize("count,expected", [(30, 201), (31, 422)])
async def test_layout_max_30(authed_client, count, expected):
    layout = [_widget(i=f"w{n}") for n in range(count)]
    resp = await authed_client.post(URL, json={"name": "n", "layout": layout, "filters": {}})
    assert resp.status_code == expected


async def test_share_default_requires_admin(authed_client, db_session):
    op = await _other_user(db_session)
    d = ApmDashboard(owner_user_id=op.id, name="d", layout=[], filters={})
    db_session.add(d)
    await db_session.flush()

    async def as_operator():
        return op

    admin_override = app.dependency_overrides[get_current_user]
    app.dependency_overrides[get_current_user] = as_operator
    try:
        resp = await authed_client.post(f"{URL}/{d.id}/share-default")
    finally:
        app.dependency_overrides[get_current_user] = admin_override
    assert resp.status_code == 403


async def test_share_default_replaces_previous(authed_client, db_session):
    op = await _other_user(db_session)
    old = ApmDashboard(owner_user_id=op.id, name="old", layout=[], filters={}, is_shared_default=True)
    new = ApmDashboard(owner_user_id=op.id, name="new", layout=[], filters={})
    db_session.add_all([old, new])
    await db_session.flush()

    resp = await authed_client.post(f"{URL}/{new.id}/share-default")
    assert resp.status_code == 200 and resp.json()["is_shared_default"] is True
    await db_session.refresh(old)
    assert old.is_shared_default is False
