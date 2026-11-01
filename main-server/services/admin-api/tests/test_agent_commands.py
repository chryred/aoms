from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from models import AgentCommand, AgentInstance, System
from services.clickhouse_client import ClickHouseError


async def _agent(db, agent_type="agent_t"):
    s = System(system_name=f"s-{agent_type}", display_name="s")
    db.add(s)
    await db.flush()
    a = AgentInstance(system_id=s.id, host="10.0.0.1", agent_type=agent_type, status="running")
    db.add(a)
    await db.flush()
    return a


async def test_request_creates_pending_command(authed_client, db_session):
    a = await _agent(db_session)
    resp = await authed_client.post(f"/api/v1/agents/{a.id}/thread-dump")
    assert resp.status_code == 201
    cmd = await db_session.get(AgentCommand, resp.json()["command_id"])
    assert cmd.command == "thread_dump" and cmd.status == "pending" and cmd.agent_instance_id == a.id


async def test_duplicate_inflight_request_409(authed_client, db_session):
    a = await _agent(db_session)
    assert (await authed_client.post(f"/api/v1/agents/{a.id}/thread-dump")).status_code == 201
    assert (await authed_client.post(f"/api/v1/agents/{a.id}/thread-dump")).status_code == 409


async def test_request_allowed_after_previous_done(authed_client, db_session):
    a = await _agent(db_session)
    db_session.add(AgentCommand(agent_instance_id=a.id, command="thread_dump", status="done"))
    await db_session.flush()
    assert (await authed_client.post(f"/api/v1/agents/{a.id}/thread-dump")).status_code == 201


async def test_non_agent_t_400(authed_client, db_session):
    a = await _agent(db_session, "synapse_agent")
    assert (await authed_client.post(f"/api/v1/agents/{a.id}/thread-dump")).status_code == 400


async def test_unknown_agent_404(authed_client):
    assert (await authed_client.post("/api/v1/agents/9999/thread-dump")).status_code == 404


async def test_list_joins_truncated_with_single_query(authed_client, db_session):
    a = await _agent(db_session)
    done = AgentCommand(agent_instance_id=a.id, command="thread_dump", status="done")
    failed = AgentCommand(agent_instance_id=a.id, command="thread_dump", status="failed")
    pending = AgentCommand(agent_instance_id=a.id, command="thread_dump", status="pending")
    db_session.add_all([done, failed, pending])
    await db_session.flush()
    qm = AsyncMock(return_value=[{"cmd_id": str(done.id), "truncated": 1}])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get(f"/api/v1/agents/{a.id}/thread-dumps")
    assert resp.status_code == 200
    items = {i["command_id"]: i for i in resp.json()}
    assert items[done.id]["truncated"] is True
    assert items[failed.id]["truncated"] is None and items[pending.id]["truncated"] is None
    assert items[done.id]["requested_at"].endswith("Z")
    assert [i["command_id"] for i in resp.json()] == sorted(items, reverse=True)
    assert qm.await_count == 1
    assert qm.await_args.args[1]["cmd_ids"] == [done.id]


async def test_list_skips_clickhouse_without_done(authed_client, db_session):
    a = await _agent(db_session)
    db_session.add(AgentCommand(agent_instance_id=a.id, command="thread_dump", status="pending"))
    await db_session.flush()
    qm = AsyncMock()
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get(f"/api/v1/agents/{a.id}/thread-dumps")
    assert resp.status_code == 200
    qm.assert_not_awaited()


async def test_get_dump_text(authed_client, db_session):
    a = await _agent(db_session)
    c = AgentCommand(agent_instance_id=a.id, command="thread_dump", status="done")
    db_session.add(c)
    await db_session.flush()
    qm = AsyncMock(return_value=[{"text": "Thread dump...", "truncated": 0, "ts": "2026-10-30 01:02:03.456"}])
    with patch("services.clickhouse_client.query", qm):
        resp = await authed_client.get(f"/api/v1/agents/{a.id}/thread-dumps/{c.id}")
    assert resp.status_code == 200
    assert resp.json()["text"] == "Thread dump..." and resp.json()["truncated"] is False
    assert resp.json()["ts"].endswith("Z")


async def test_get_dump_missing_404(authed_client, db_session):
    a = await _agent(db_session)
    c = AgentCommand(agent_instance_id=a.id, command="thread_dump", status="sent")
    db_session.add(c)
    await db_session.flush()
    with patch("services.clickhouse_client.query", AsyncMock(return_value=[])):
        resp = await authed_client.get(f"/api/v1/agents/{a.id}/thread-dumps/{c.id}")
    assert resp.status_code == 404


async def test_get_dump_clickhouse_error_502(authed_client, db_session):
    a = await _agent(db_session)
    c = AgentCommand(agent_instance_id=a.id, command="thread_dump", status="done")
    db_session.add(c)
    await db_session.flush()
    with patch("services.clickhouse_client.query", AsyncMock(side_effect=ClickHouseError("boom"))):
        resp = await authed_client.get(f"/api/v1/agents/{a.id}/thread-dumps/{c.id}")
    assert resp.status_code == 502
    assert resp.json()["detail"] == "트랜잭션 저장소 조회 실패"


def _utc_ago(seconds):
    return datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=seconds)


async def test_stale_inflight_is_failed_and_does_not_block(authed_client, db_session):
    a = await _agent(db_session)
    stale_pending = AgentCommand(agent_instance_id=a.id, command="thread_dump", status="pending", created_at=_utc_ago(300))
    stale_sent = AgentCommand(agent_instance_id=a.id, command="thread_dump", status="sent", created_at=_utc_ago(121))
    db_session.add_all([stale_pending, stale_sent])
    await db_session.flush()
    resp = await authed_client.post(f"/api/v1/agents/{a.id}/thread-dump")
    assert resp.status_code == 201
    await db_session.refresh(stale_pending)
    await db_session.refresh(stale_sent)
    assert stale_pending.status == "failed" and stale_sent.status == "failed"


async def test_fresh_inflight_still_409(authed_client, db_session):
    a = await _agent(db_session)
    fresh = AgentCommand(agent_instance_id=a.id, command="thread_dump", status="sent", created_at=_utc_ago(60))
    db_session.add(fresh)
    await db_session.flush()
    assert (await authed_client.post(f"/api/v1/agents/{a.id}/thread-dump")).status_code == 409
    await db_session.refresh(fresh)
    assert fresh.status == "sent"
