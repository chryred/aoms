import json
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

import database
from models import AgentInstallJob, AgentInstance, System
from routes import agents_control
from services import agent_t_installer as inst
from services.ssh_session import SSHError

SESSION = {"host": "10.0.0.5", "port": 22, "username": "jeussic", "password": "pw"}
FIXTURE = Path(__file__).parent / "fixtures" / "jeus_domain_min.xml"


class Remote:
    """ssh_* 목. 명령 문자열 부분 일치로 응답을 정한다."""

    def __init__(self):
        self.version = 'java version "1.7.0_79"\nJava(TM) SE Runtime Environment'
        self.ps = "4242 jeussic /usr/local/jdk1.7.0_79/bin/java -Dsic_server1 weblogic.Server"
        self.check = "OK"
        self.attach_code = 0
        self.exec_calls: list[str] = []
        self.shell_calls: list[str] = []
        self.binaries: dict[str, bytes] = {}
        self.files: dict[str, str] = {}
        self.read_map: dict[str, str | None] = {}
        self.exec_error: Exception | None = None

    def _run(self, cmd):
        if cmd.startswith("ps -eo"):
            return 0 if self.ps else 1, self.ps, ""
        if cmd.startswith("readlink"):
            return 0, "/usr/local/jdk1.7.0_79/bin/java\n", ""
        if "-version" in cmd:
            return 0, self.version, ""
        if "--check" in cmd:
            return 0, self.check, ""
        if "agent-t-attacher.jar" in cmd:
            return self.attach_code, "", ""
        if cmd == "echo $HOME":
            return 0, "/home/jeussic\n", ""
        return 0, "", ""

    def ssh_exec(self, host, port, user, pw, cmd):
        if self.exec_error:
            raise self.exec_error
        self.exec_calls.append(cmd)
        return self._run(cmd)

    def ssh_shell_exec(self, host, port, user, pw, cmd, timeout=60):
        self.shell_calls.append(cmd)
        return self._run(cmd)

    def put_binary(self, host, port, user, pw, path, data):
        self.binaries[path] = data

    def put_file(self, host, port, user, pw, path, content):
        self.files[path] = content

    def read_file(self, host, port, user, pw, path):
        return self.read_map.get(path)


@pytest.fixture
async def env(db_session, monkeypatch, tmp_path):
    art = tmp_path / "art"
    art.mkdir()
    (art / "agent-t.jar").write_bytes(b"modern")
    (art / "agent-t-legacy.jar").write_bytes(b"legacy")
    (art / "agent-t-attacher.jar").write_bytes(b"attacher")
    monkeypatch.setenv("AGENT_T_ARTIFACT_DIR", str(art))
    monkeypatch.setenv("AGENT_T_GATEWAY_URL", "http://gw:8330")

    monkeypatch.setattr(database, "AsyncSessionLocal", async_sessionmaker(db_session.bind, expire_on_commit=False))
    remote = Remote()
    monkeypatch.setattr(inst, "ssh_exec", remote.ssh_exec)
    monkeypatch.setattr(inst, "ssh_shell_exec", remote.ssh_shell_exec)
    monkeypatch.setattr(inst, "ssh_put_binary", remote.put_binary)
    monkeypatch.setattr(inst, "ssh_put_file", remote.put_file)
    monkeypatch.setattr(inst, "ssh_read_file", remote.read_file)

    snapshots: list[list[dict]] = [[{"system_id": 1, "instance_role": "was", "last_seen": 1}]]

    async def fake_snapshot(system_id, user):
        return snapshots[0]

    monkeypatch.setattr(inst, "fetch_snapshot", fake_snapshot)
    monkeypatch.setattr(inst, "_CONFIRM_TIMEOUT_S", 0)

    system = System(id=1, system_name="sic", display_name="SIC")
    db_session.add(system)
    await db_session.commit()

    async def make(label: dict):
        agent = AgentInstance(system_id=1, agent_type="agent_t", host="10.0.0.5",
                              ssh_username="jeussic", label_info=json.dumps(label), status="pending")
        db_session.add(agent)
        await db_session.flush()
        db_session.add(AgentInstallJob(job_id="job1", agent_id=agent.id, status="running", logs=""))
        await db_session.commit()
        agents_control._live_jobs["job1"] = {"status": "running", "logs": "", "error": None}
        return agent

    class Env:
        pass

    e = Env()
    e.remote, e.make, e.snapshots, e.db = remote, make, snapshots, db_session
    yield e
    agents_control._live_jobs.pop("job1", None)


async def _job(env):
    q = select(AgentInstallJob).where(AgentInstallJob.job_id == "job1").execution_options(populate_existing=True)
    return (await env.db.execute(q)).scalar_one()


async def _agent(env, agent):
    q = select(AgentInstance).where(AgentInstance.id == agent.id).execution_options(populate_existing=True)
    return (await env.db.execute(q)).scalar_one()


async def test_selects_legacy_for_jdk7(env):
    agent = await env.make({"jvm_match": "-Dsic_server1", "service_type": "tomcat", "service_path": "/opt/tomcat"})
    await inst.run_install("job1", agent, SESSION)
    assert "/home/jeussic/agent-t/agent-t-legacy.jar" in env.remote.binaries
    assert "/home/jeussic/agent-t/agent-t.jar" not in env.remote.binaries
    job = await _job(env)
    assert job.status == "done", job.error
    assert (await _agent(env, agent)).status == "running"
    # tomcat 영구 적용: setenv.sh 에 마커 블록 + env 파일에 legacy jar
    assert "agent-t-env.sh" in env.remote.files["/opt/tomcat/bin/setenv.sh"]
    assert "-javaagent:/home/jeussic/agent-t/agent-t-legacy.jar" in env.remote.files["/home/jeussic/agent-t/agent-t-env.sh"]


async def test_selects_modern_for_jdk11(env):
    env.remote.version = 'openjdk version "11.0.2" 2019-01-15'
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    assert "/home/jeussic/agent-t/agent-t.jar" in env.remote.binaries
    assert (await _job(env)).status == "done"


async def test_jdk5_fails(env):
    env.remote.version = 'java version "1.5.0_22"'
    agent = await env.make({"jvm_match": "-Dsic_server1"})
    await inst.run_install("job1", agent, SESSION)
    assert (await _job(env)).status == "failed"
    assert env.remote.binaries == {}


async def test_multiple_pids_fails(env):
    env.remote.ps = "1 u java -Dsic\n2 u java -Dsic"
    agent = await env.make({"jvm_match": "-Dsic"})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "failed" and "2개" in job.error
    assert (await _agent(env, agent)).status == "failed"


async def test_zero_pids_fails(env):
    env.remote.ps = ""
    agent = await env.make({"jvm_match": "-Dsic"})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "failed" and "0개" in job.error


async def test_precheck_failure_skips_attach(env):
    env.remote.check = "PRECHECK:no_tools_jar"
    agent = await env.make({"jvm_match": "-Dsic_server1", "service_type": "tomcat", "service_path": "/opt/tomcat"})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "done"
    assert "재기동 후 적용" in job.logs and "no_tools_jar" in job.logs
    assert not any("--check" not in c and "agent-t-attacher.jar" in c for c in env.remote.exec_calls)
    assert (await _agent(env, agent)).status == "installed"
    assert "/opt/tomcat/bin/setenv.sh" in env.remote.files  # 영구 적용은 진행


async def test_unconfirmed_gateway_keeps_installed(env):
    env.snapshots[0] = []
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    assert (await _job(env)).status == "done"
    assert (await _agent(env, agent)).status == "installed"


async def test_token_hash_stored_not_plaintext(env):
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    info = json.loads((await _agent(env, agent)).label_info)
    props = env.remote.files["/home/jeussic/agent-t/agent-t.properties"]
    token = next(l.split("=", 1)[1] for l in props.splitlines() if l.startswith("agent.token="))
    import hashlib
    assert info["agent_token_sha256"] == hashlib.sha256(token.encode()).hexdigest()
    assert token not in json.dumps(info)
    assert token not in (await _job(env)).logs
    assert "chmod 600 /home/jeussic/agent-t/agent-t.properties" in env.remote.exec_calls
    assert "gateway.url=http://gw:8330" in props


async def test_falls_back_to_shell_exec(env):
    env.remote.exec_error = SSHError("exec request failed")
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    assert env.remote.shell_calls
    assert (await _job(env)).status == "done"


async def test_connection_failure_does_not_fall_back(env):
    env.remote.exec_error = SSHError("SSH 연결 실패 (h:22): refused")
    agent = await env.make({"jvm_match": "-Dsic_server1"})
    await inst.run_install("job1", agent, SESSION)
    assert env.remote.shell_calls == []
    assert (await _job(env)).status == "failed"


def _jeus_label(**extra):
    return {"jvm_match": "-Dsic_server1", "service_type": "jeus",
            "service_path": "/jeus/domains/sic_domain", **extra}


async def test_jeus_requires_confirm(env):
    env.remote.read_map["/jeus/domains/sic_domain/config/domain.xml"] = FIXTURE.read_text()
    agent = await env.make(_jeus_label())
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "done"
    assert "확인 필요" in job.logs and "+" in job.logs and "-javaagent:" in job.logs
    assert not any(p.endswith("domain.xml") for p in env.remote.files)
    assert not any("domain.xml_" in c for c in env.remote.exec_calls)


async def test_jeus_confirmed_backs_up_and_writes(env):
    path = "/jeus/domains/sic_domain/config/domain.xml"
    env.remote.read_map[path] = FIXTURE.read_text()
    agent = await env.make(_jeus_label(jeus_confirm=True))
    await inst.run_install("job1", agent, SESSION)
    assert (await _job(env)).status == "done"
    assert any(c.startswith(f"cp -p {path} {path}_") and c.endswith("_agentt") for c in env.remote.exec_calls)
    written = env.remote.files[path]
    assert "-javaagent:/home/jeussic/agent-t/agent-t-legacy.jar" in written
    assert written.count("-javaagent:") == 1


async def test_parse_java_major():
    assert inst.parse_java_major('java version "1.6.0_45"') == 6
    assert inst.parse_java_major('openjdk version "17.0.1"') == 17
    assert inst.parse_java_major('openjdk version "21" 2023') == 21
    with pytest.raises(ValueError):
        inst.parse_java_major("garbage")


async def test_live_status_agent_t_uses_gateway_snapshot(env, authed_client, monkeypatch):
    import time
    agent = await env.make({"jvm_match": "-Dsic_server1", "instance_role": "was"})
    env.snapshots[0] = [{"system_id": 1, "instance_role": "was", "last_seen": int(time.time() * 1000)}]
    resp = await authed_client.get(f"/api/v1/agents/{agent.id}/live-status")
    body = resp.json()
    assert resp.status_code == 200
    assert body["type"] == "agent_t" and body["live"] is True and body["live_status"] == "collecting"

    env.snapshots[0] = []
    body = (await authed_client.get(f"/api/v1/agents/{agent.id}/live-status")).json()
    assert body["live"] is False and body["live_status"] == "no_data"
