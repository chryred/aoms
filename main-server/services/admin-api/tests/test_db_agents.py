"""DB 에이전트 (agent_type='db') 등록·삭제·제어 테스트."""

import json
import uuid
from unittest.mock import patch, MagicMock

import pytest
from httpx import AsyncClient


async def _create_system(client: AsyncClient) -> int:
    """테스트용 시스템 생성 후 ID 반환. 고유 이름 사용."""
    unique = uuid.uuid4().hex[:8]
    resp = await client.post("/api/v1/systems", json={
        "system_name": f"test_db_{unique}",
        "display_name": f"테스트 DB {unique}",
        "os_type": "linux",
        "system_type": "db",
    })
    assert resp.status_code == 201
    return resp.json()["id"]


# ── 에이전트 등록 ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@patch.dict("os.environ", {"ENCRYPTION_KEY": "UTdPqU2vURPOkzmJaP_JX3BZt-N6Jiesb6k5TChqvbs="})
async def test_create_oracle_db_agent(authed_client: AsyncClient):
    """oracle db_type 에이전트 등록 — password 암호화 + status=running."""
    system_id = await _create_system(authed_client)

    with patch("services.db_backends.oracle.oracledb") as mock_ora:
        mock_conn = MagicMock()
        mock_ora.connect.return_value = mock_conn

        resp = await authed_client.post("/api/v1/agents", json={
            "system_id": system_id,
            "host": "scan.example.com",
            "agent_type": "db",
            "port": 1521,
            "os_type": "linux",
            "server_type": "db",
            "label_info": json.dumps({
                "db_type": "oracle",
                "service_name": "ORCL",
                "username": "monitor",
                "password": "secret123",
                "instance_role": "db-primary",
            }),
        })

    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "running"
    # password가 encrypted_password로 변환되었는지 확인
    label = json.loads(data["label_info"])
    assert "password" not in label
    assert "encrypted_password" in label
    assert label["db_type"] == "oracle"


@pytest.mark.asyncio
@patch.dict("os.environ", {"ENCRYPTION_KEY": "UTdPqU2vURPOkzmJaP_JX3BZt-N6Jiesb6k5TChqvbs="})
async def test_create_postgresql_db_agent(authed_client: AsyncClient):
    """postgresql db_type 에이전트 등록."""
    system_id = await _create_system(authed_client)

    with patch("services.db_backends.postgres.psycopg2") as mock_pg:
        mock_conn = MagicMock()
        mock_pg.connect.return_value = mock_conn

        resp = await authed_client.post("/api/v1/agents", json={
            "system_id": system_id,
            "host": "pg.example.com",
            "agent_type": "db",
            "port": 5432,
            "os_type": "linux",
            "server_type": "db",
            "label_info": json.dumps({
                "db_type": "postgresql",
                "database": "mydb",
                "username": "monitor",
                "password": "secret123",
                "instance_role": "db-primary",
            }),
        })

    assert resp.status_code == 201
    label = json.loads(resp.json()["label_info"])
    assert label["db_type"] == "postgresql"
    assert label.get("database") == "mydb"
    assert "encrypted_password" in label


@pytest.mark.asyncio
@patch.dict("os.environ", {"ENCRYPTION_KEY": "UTdPqU2vURPOkzmJaP_JX3BZt-N6Jiesb6k5TChqvbs="})
async def test_create_mssql_db_agent(authed_client: AsyncClient):
    """mssql db_type 에이전트 등록."""
    system_id = await _create_system(authed_client)

    with patch("services.db_backends.mssql.pymssql") as mock_mssql:
        mock_conn = MagicMock()
        mock_mssql.connect.return_value = mock_conn

        resp = await authed_client.post("/api/v1/agents", json={
            "system_id": system_id,
            "host": "mssql.example.com",
            "agent_type": "db",
            "port": 1433,
            "os_type": "windows",
            "server_type": "db",
            "label_info": json.dumps({
                "db_type": "mssql",
                "database": "mydb",
                "username": "sa",
                "password": "secret123",
                "instance_role": "db-primary",
            }),
        })

    assert resp.status_code == 201
    label = json.loads(resp.json()["label_info"])
    assert label["db_type"] == "mssql"


@pytest.mark.asyncio
@patch.dict("os.environ", {"ENCRYPTION_KEY": "UTdPqU2vURPOkzmJaP_JX3BZt-N6Jiesb6k5TChqvbs="})
async def test_create_mysql_db_agent(authed_client: AsyncClient):
    """mysql db_type 에이전트 등록."""
    system_id = await _create_system(authed_client)

    with patch("services.db_backends.mysql.mysql.connector") as mock_mysql:
        mock_conn = MagicMock()
        mock_mysql.connect.return_value = mock_conn

        resp = await authed_client.post("/api/v1/agents", json={
            "system_id": system_id,
            "host": "mysql.example.com",
            "agent_type": "db",
            "port": 3306,
            "os_type": "linux",
            "server_type": "db",
            "label_info": json.dumps({
                "db_type": "mysql",
                "database": "mydb",
                "username": "monitor",
                "password": "secret123",
                "instance_role": "db-primary",
            }),
        })

    assert resp.status_code == 201
    label = json.loads(resp.json()["label_info"])
    assert label["db_type"] == "mysql"


# ── 에러 케이스 ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_db_agent_missing_encryption_key(authed_client: AsyncClient):
    """ENCRYPTION_KEY 미설정 시 400."""
    system_id = await _create_system(authed_client)

    with patch.dict("os.environ", {}, clear=False):
        # ENCRYPTION_KEY가 없는 상태 보장
        import os
        os.environ.pop("ENCRYPTION_KEY", None)

        resp = await authed_client.post("/api/v1/agents", json={
            "system_id": system_id,
            "host": "db.example.com",
            "agent_type": "db",
            "label_info": json.dumps({
                "db_type": "oracle",
                "service_name": "ORCL",
                "username": "monitor",
                "password": "secret",
            }),
        })

    assert resp.status_code == 400
    assert "ENCRYPTION_KEY" in resp.json()["detail"]


@pytest.mark.asyncio
@patch.dict("os.environ", {"ENCRYPTION_KEY": "UTdPqU2vURPOkzmJaP_JX3BZt-N6Jiesb6k5TChqvbs="})
async def test_db_agent_connection_failure(authed_client: AsyncClient):
    """연결 실패 시 400."""
    system_id = await _create_system(authed_client)

    with patch("services.db_backends.oracle.oracledb") as mock_ora:
        mock_ora.connect.side_effect = Exception("ORA-12541: TNS:no listener")

        resp = await authed_client.post("/api/v1/agents", json={
            "system_id": system_id,
            "host": "bad.host.com",
            "agent_type": "db",
            "label_info": json.dumps({
                "db_type": "oracle",
                "service_name": "ORCL",
                "username": "monitor",
                "password": "secret",
            }),
        })

    assert resp.status_code == 400
    assert "DB 연결 실패" in resp.json()["detail"]


@pytest.mark.asyncio
@patch.dict("os.environ", {"ENCRYPTION_KEY": "UTdPqU2vURPOkzmJaP_JX3BZt-N6Jiesb6k5TChqvbs="})
async def test_db_agent_unsupported_db_type(authed_client: AsyncClient):
    """지원하지 않는 db_type 시 400."""
    system_id = await _create_system(authed_client)

    resp = await authed_client.post("/api/v1/agents", json={
        "system_id": system_id,
        "host": "db.example.com",
        "agent_type": "db",
        "label_info": json.dumps({
            "db_type": "cassandra",
            "database": "mydb",
            "username": "user",
            "password": "secret",
        }),
    })

    assert resp.status_code == 400
    assert "지원하지 않는 db_type" in resp.json()["detail"]


# ── 삭제 ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@patch.dict("os.environ", {"ENCRYPTION_KEY": "UTdPqU2vURPOkzmJaP_JX3BZt-N6Jiesb6k5TChqvbs="})
async def test_delete_db_agent(authed_client: AsyncClient):
    """DB 에이전트 삭제."""
    system_id = await _create_system(authed_client)

    with patch("services.db_backends.oracle.oracledb") as mock_ora:
        mock_ora.connect.return_value = MagicMock()
        resp = await authed_client.post("/api/v1/agents", json={
            "system_id": system_id,
            "host": "db.example.com",
            "agent_type": "db",
            "label_info": json.dumps({
                "db_type": "oracle",
                "service_name": "ORCL",
                "username": "monitor",
                "password": "secret",
            }),
        })
    agent_id = resp.json()["id"]

    resp = await authed_client.delete(f"/api/v1/agents/{agent_id}")
    assert resp.status_code == 204

    resp = await authed_client.get(f"/api/v1/agents/{agent_id}")
    assert resp.status_code == 404


# ── 제어 거부 ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
@patch.dict("os.environ", {"ENCRYPTION_KEY": "UTdPqU2vURPOkzmJaP_JX3BZt-N6Jiesb6k5TChqvbs="})
async def test_db_agent_start_stop(authed_client: AsyncClient):
    """DB 에이전트 start/stop — SSH 없이 상태 전환."""
    system_id = await _create_system(authed_client)

    with patch("services.db_backends.oracle.oracledb") as mock_ora:
        mock_ora.connect.return_value = MagicMock()
        resp = await authed_client.post("/api/v1/agents", json={
            "system_id": system_id,
            "host": "db.example.com",
            "agent_type": "db",
            "label_info": json.dumps({
                "db_type": "oracle",
                "service_name": "ORCL",
                "username": "monitor",
                "password": "secret",
            }),
        })
    agent_id = resp.json()["id"]
    assert resp.json()["status"] == "running"

    # SSH 세션 없이 stop → 200 (DB 에이전트는 SSH 불필요)
    resp = await authed_client.post(f"/api/v1/agents/{agent_id}/stop")
    assert resp.status_code == 200
    assert resp.json()["status"] == "stopped"

    # SSH 세션 없이 start → 200
    resp = await authed_client.post(f"/api/v1/agents/{agent_id}/start")
    assert resp.status_code == 200
    assert resp.json()["status"] == "running"

    # restart도 동작
    resp = await authed_client.post(f"/api/v1/agents/{agent_id}/restart")
    assert resp.status_code == 200
    assert resp.json()["status"] == "running"
