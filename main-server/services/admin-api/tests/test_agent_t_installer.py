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


def _inst_at(age_s: float = 0, role: str = "sic_server1", host: str = "10.0.0.5"):
    import time
    return {"system_id": 1, "instance_role": role, "host": host, "last_seen": int((time.time() - age_s) * 1000)}


class Remote:
    """ssh_* 목. 명령 문자열 부분 일치로 응답을 정한다."""

    def __init__(self):
        self.version = 'java version "1.7.0_79"\nJava(TM) SE Runtime Environment'
        self.ps = "4242 jeussic /usr/local/jdk1.7.0_79/bin/java -Dsic_server1 weblogic.Server"
        self.check = "OK"
        self.attach_code = 0
        self.exec_calls: list[str] = []
        self.mv_calls: list[str] = []
        self.shell_calls: list[str] = []
        self.binaries: dict[str, bytes] = {}
        self.files: dict[str, str] = {}
        self.read_map: dict[str, str | None] = {}
        self.exec_error: Exception | None = None
        self.events: list[tuple[str, str]] = []
        self.attached = False
        self.mode = "600"

    def _run(self, cmd):
        if cmd.startswith("ps -eo"):
            return 0 if self.ps else 1, self.ps, ""
        if cmd.startswith("readlink"):
            return 0, "/usr/local/jdk1.7.0_79/bin/java\n", ""
        if "-version" in cmd:
            return 0, self.version, ""
        if cmd.startswith("mv -f"):
            self.mv_calls.append(cmd)
            return 0, "", ""
        if "--check" in cmd:
            return 0, self.check, ""
        if cmd.startswith("stat -c %a"):
            return 0, self.mode + "\n", ""
        if "agent-t-attacher.jar" in cmd:
            if self.attach_code == 0:
                self.attached = True
            return self.attach_code, "", ""
        if cmd == "echo $HOME":
            return 0, "/home/jeussic\n", ""
        return 0, "", ""

    def ssh_exec(self, host, port, user, pw, cmd):
        if self.exec_error:
            raise self.exec_error
        self.exec_calls.append(cmd)
        self.events.append(("exec", cmd))
        return self._run(cmd)

    def ssh_shell_exec(self, host, port, user, pw, cmd, timeout=60):
        self.shell_calls.append(cmd)
        return self._run(cmd)

    def put_binary(self, host, port, user, pw, path, data):
        self.binaries[path] = data

    def put_file(self, host, port, user, pw, path, content):
        self.files[path] = content
        self.events.append(("put", path))

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
    monkeypatch.setenv("AGENT_T_GATEWAY_URL", "http://10.9.9.9:8330")

    monkeypatch.setattr(database, "AsyncSessionLocal", async_sessionmaker(db_session.bind, expire_on_commit=False))
    remote = Remote()
    monkeypatch.setattr(inst, "ssh_exec", remote.ssh_exec)
    monkeypatch.setattr(inst, "ssh_shell_exec", remote.ssh_shell_exec)
    monkeypatch.setattr(inst, "ssh_put_binary", remote.put_binary)
    monkeypatch.setattr(inst, "ssh_put_file", remote.put_file)
    monkeypatch.setattr(inst, "ssh_read_file", remote.read_file)

    # None = attach 가 일어난 뒤에만 인스턴스가 보인다
    snapshots: list = [None]

    async def fake_snapshot(system_id, user):
        if snapshots[0] is not None:
            return snapshots[0]
        return [_inst_at()] if remote.attached else []

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
    assert "/home/jeussic/agent-t/agent-t-legacy.jar.tmp" in env.remote.binaries
    assert "/home/jeussic/agent-t/agent-t.jar.tmp" not in env.remote.binaries
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
    assert "/home/jeussic/agent-t/agent-t.jar.tmp" in env.remote.binaries
    assert (await _job(env)).status == "done"


async def test_jdk5_fails(env):
    env.remote.version = 'java version "1.5.0_22"'
    agent = await env.make({"jvm_match": "-Dsic_server1"})
    await inst.run_install("job1", agent, SESSION)
    assert (await _job(env)).status == "failed"
    assert env.remote.binaries == {}


async def test_multiple_pids_ends_needs_target_with_candidates(env):
    env.remote.ps = (
        "1 u /jdk/bin/java -Dsic -Djeus.server.name=sic_a weblogic.Server\n"
        "2 u /jdk/bin/java -Dsic -Djeus.server.name=sic_b weblogic.Server"
    )
    agent = await env.make({"jvm_match": "-Dsic"})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "needs_target" and job.error is None
    assert env.remote.binaries == {} and env.remote.mv_calls == []
    assert (await _agent(env, agent)).status == "pending"
    from routes.agents_control import _split_candidates
    logs, cands = _split_candidates(job.logs)
    assert [c["pid"] for c in cands] == [1, 2]
    assert cands[0]["user"] == "u" and cands[0]["server_name"] == "sic_a"
    assert "JVM_CANDIDATES" not in logs and "2개" in logs


async def test_target_pid_valid_proceeds_with_that_pid(env):
    env.remote.ps = "1 u /jdk/bin/java -Dsic a\n2 u /jdk/bin/java -Dsic b"
    agent = await env.make({"jvm_match": "-Dsic", "permanent": False})
    await inst.run_install("job1", agent, SESSION, target_pid=2)
    job = await _job(env)
    assert job.status == "done"
    assert any("readlink /proc/2/exe" in c for c in env.remote.exec_calls)
    assert "target_pid" not in (await _agent(env, agent)).label_info


async def test_target_pid_not_in_candidates_fails(env):
    env.remote.ps = "1 u /jdk/bin/java -Dsic a\n2 u /jdk/bin/java -Dsic b"
    agent = await env.make({"jvm_match": "-Dsic", "permanent": False})
    await inst.run_install("job1", agent, SESSION, target_pid=999)
    job = await _job(env)
    assert job.status == "failed" and "999" in job.error and "재기동" in job.error
    assert env.remote.binaries == {}


async def test_target_pid_stale_after_process_gone_fails(env):
    env.remote.ps = "1 u /jdk/bin/java -Dsic a"
    agent = await env.make({"jvm_match": "-Dsic", "permanent": False})
    await inst.run_install("job1", agent, SESSION, target_pid=2)
    assert (await _job(env)).status == "failed"


async def test_boundary_excludes_prefix_neighbours_so_single_install(env):
    env.remote.ps = (
        "10 u /jdk/bin/java -Dsic_server10 x\n"
        "11 u /jdk/bin/java -Dsic_server1_bak x\n"
        "4242 u /jdk/bin/java -Dsic_server1 x"
    )
    agent = await env.make({"jvm_match": "sic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    assert (await _job(env)).status == "done"
    assert any("readlink /proc/4242/exe" in c for c in env.remote.exec_calls)


def test_filter_boundary_rules():
    f = lambda out, m: [c["pid"] for c in inst.filter_jvm_candidates(out, m)]  # noqa: E731
    ps = (
        "1 u java -Dsic_server1 a\n"
        "2 u java -Djeus.server.name=sic_server1 a\n"
        "3 u java -cp /servers/sic_server1/lib a\n"
        "4 u java -Dsic_server10 a\n"
        "5 u java -Dsic_server1_bak a\n"
        "6 u java -Dxsic_server1 a\n"
        "7 u java -Dsic_server1"
    )
    assert f(ps, "sic_server1") == [1, 2, 3, 7]
    assert f(ps, "-Dsic_server1") == [1, 7]


def test_filter_excludes_helpers_and_non_java():
    ps = (
        "1 u bash -c ps -eo pid,user,args | grep -F -- java -Dsic\n"
        "2 u grep -F -- -Dsic\n"
        "3 u /usr/sbin/sshd -Dsic\n"
        "4 u python3 app.py -Dsic\n"
        "5 u /jdk/bin/java -Dsic ok\n"
        "bad line"
    )
    assert [c["pid"] for c in inst.filter_jvm_candidates(ps, "-Dsic")] == [5]
    assert inst.filter_jvm_candidates(ps, "") == []


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
    assert not any("--check" not in c and "-jar" in c for c in env.remote.exec_calls)
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
    props = env.remote.files["/home/jeussic/agent-t/agent-t.properties.tmp"]
    token = next(l.split("=", 1)[1] for l in props.splitlines() if l.startswith("agent.token="))
    import hashlib
    assert info["agent_token_sha256"] == hashlib.sha256(token.encode()).hexdigest()
    assert token not in json.dumps(info)
    assert token not in (await _job(env)).logs
    tmp = "/home/jeussic/agent-t/agent-t.properties.tmp"
    prep = f"umask 077; : > {tmp}; chmod 600 {tmp}"
    ev = env.remote.events
    assert ev.index(("exec", prep)) < ev.index(("put", tmp))
    # 검증 후 mv 로 교체 — 기존 properties 는 업로드 성공 전까지 건드리지 않는다
    mv = f"mv -f {tmp} /home/jeussic/agent-t/agent-t.properties"
    assert ev.index(("put", tmp)) < ev.index(("exec", "stat -c %a " + tmp)) < ev.index(("exec", mv))
    assert ("put", "/home/jeussic/agent-t/agent-t.properties") not in ev
    assert info["instance_role"] == "sic_server1"
    assert "gateway.url=http://10.9.9.9:8330" in props


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
    assert "확인 필요" in job.logs
    assert any(l.startswith("+") and "-javaagent:" in l and not l.startswith("+++") for l in job.logs.splitlines())
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
    agent = await env.make({"jvm_match": "-Dsic_server1", "instance_role": "was"})
    env.snapshots[0] = [_inst_at(role="was")]
    resp = await authed_client.get(f"/api/v1/agents/{agent.id}/live-status")
    body = resp.json()
    assert resp.status_code == 200
    assert body["type"] == "agent_t" and body["live"] is True and body["live_status"] == "collecting"

    env.snapshots[0] = []
    body = (await authed_client.get(f"/api/v1/agents/{agent.id}/live-status")).json()
    assert body["live"] is False and body["live_status"] == "no_data"


async def test_non_600_properties_mode_fails(env):
    env.remote.mode = "644"
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "failed" and "600" in job.error


async def test_newline_injection_in_role_rejected_before_remote(env):
    agent = await env.make({"jvm_match": "-Dsic_server1", "instance_role": "was\ngateway.url=http://evil"})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "failed" and "instance_role" in job.error
    assert env.remote.events == []


async def test_newline_injection_in_system_name_rejected(env):
    agent = await env.make({"jvm_match": "-Dsic_server1"})
    sys_obj = await env.db.get(System, 1)
    sys_obj.system_name = "sic\nagent.token=x"
    await env.db.commit()
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "failed" and "system_name" in job.error
    assert env.remote.events == []


async def test_jeus_config_error_fails_before_upload_and_attach(env):
    env.remote.read_map["/jeus/domains/sic_domain/config/domain.xml"] = FIXTURE.read_text()
    agent = await env.make(_jeus_label(server_name="no_such_server"))
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "failed" and "찾을 수 없습니다" in job.error
    assert env.remote.binaries == {} and not env.remote.attached


async def test_jeus_missing_service_path_fails_early(env):
    agent = await env.make({"jvm_match": "-Dsic_server1", "service_type": "jeus"})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "failed" and "service_path" in job.error
    assert env.remote.binaries == {} and not env.remote.attached


async def test_rerun_keeps_token_and_skips_attach_when_live(env):
    path = "/jeus/domains/sic_domain/config/domain.xml"
    env.remote.read_map[path] = FIXTURE.read_text()
    agent = await env.make(_jeus_label())
    await inst.run_install("job1", agent, SESSION)
    first = json.loads((await _agent(env, agent)).label_info)
    props_path = "/home/jeussic/agent-t/agent-t.properties"
    first_props = env.remote.files[props_path + ".tmp"]
    assert env.remote.attached

    # 재실행: 원격 properties 가 이미 있고 gateway 에도 보인다
    env.remote.read_map[props_path] = first_props
    env.remote.attached = False
    env.remote.exec_calls.clear()
    env.snapshots[0] = [_inst_at()]
    agent2 = await _agent(env, agent)
    agents_control._live_jobs["job1"] = {"status": "running", "logs": "", "error": None}
    agent2.label_info = json.dumps({**json.loads(agent2.label_info), "jeus_confirm": True})
    await env.db.commit()
    await inst.run_install("job1", agent2, SESSION)

    job = await _job(env)
    assert job.status == "done", job.error
    assert "이미 적용됨" in job.logs
    assert not any("-jar" in c and "--check" not in c for c in env.remote.exec_calls)
    second = json.loads((await _agent(env, agent)).label_info)
    assert second["agent_token_sha256"] == first["agent_token_sha256"]
    assert env.remote.files[props_path + ".tmp"] == first_props
    assert (await _agent(env, agent)).status == "running"
    assert "-javaagent:" in env.remote.files[path]  # jeus_confirm 으로 반영됨


async def test_stale_gateway_entry_does_not_skip_attach_or_confirm(env):
    env.snapshots[0] = [_inst_at(600)]  # 10분 전 — 유휴 인스턴스 잔존
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "done"
    assert env.remote.attached and "이미 적용됨" not in job.logs
    assert (await _agent(env, agent)).status == "installed"  # 확인 단계도 stale 은 불인정


async def test_safe_value_re_rejects_trailing_newline():
    assert inst._SAFE_VALUE_RE.fullmatch("sic_server1")
    assert not inst._SAFE_VALUE_RE.fullmatch("sic_server1\n")


async def test_default_role_from_jeus_server_name_then_host():
    assert inst.default_instance_role({"jvm_match": "-Dsic_server1"}, "10.0.0.5") == "sic_server1"
    assert inst.default_instance_role({"jvm_match": "-Djeus.server=sic_server2", "server_name": "sic_server2"}, "h") == "sic_server2"
    assert inst.default_instance_role({"jvm_match": "/opt/jeus/bin/x y"}, "was01.corp.local") == "was01"
    assert inst.default_instance_role({"jvm_match": "/opt/jeus/bin/x y"}, "10.0.0.5") == "10.0.0.5"


async def test_already_applied_requires_same_host(env):
    # 같은 system·role 이지만 다른 서버의 인스턴스가 보인다 → attach 를 건너뛰면 안 된다
    env.snapshots[0] = [_inst_at(host="10.0.0.99")]
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "done", job.error
    assert env.remote.attached and "이미 적용됨" not in job.logs


async def test_duplicate_role_in_system_fails_install(env):
    other = AgentInstance(system_id=1, agent_type="agent_t", host="10.0.0.9", ssh_username="u",
                          label_info=json.dumps({"instance_role": "sic_server1"}), status="running")
    env.db.add(other)
    await env.db.commit()
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "failed" and "sic_server1" in job.error
    assert env.remote.events == []


@pytest.mark.parametrize("url", [
    "", "http://agent-t-gateway:8330", "http://localhost:8330", "http://127.0.0.1:8330", "not-a-url",
])
async def test_unreachable_gateway_url_rejected_before_remote(env, monkeypatch, url):
    monkeypatch.setenv("AGENT_T_GATEWAY_URL", url)
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "failed" and "AGENT_T_GATEWAY_URL" in job.error
    assert env.remote.events == []


async def test_failed_properties_check_keeps_existing_file(env):
    env.remote.mode = "644"
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    assert ("put", "/home/jeussic/agent-t/agent-t.properties") not in env.remote.events
    assert any(c.startswith("rm -f ") and c.endswith("agent-t.properties.tmp") for c in env.remote.exec_calls)


async def test_jars_uploaded_as_tmp_then_atomic_mv(env):
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    assert (await _job(env)).status == "done"
    d = "/home/jeussic/agent-t"
    assert f"{d}/agent-t-legacy.jar.tmp" in env.remote.binaries
    assert f"{d}/agent-t-legacy.jar" not in env.remote.binaries  # 최종 경로에 직접 쓰지 않는다
    assert f"{d}/agent-t-attacher.jar.tmp" in env.remote.binaries
    assert f"mv -f {d}/agent-t-legacy.jar.tmp {d}/agent-t-legacy.jar" in env.remote.mv_calls
    assert f"mv -f {d}/agent-t-attacher.jar.tmp {d}/agent-t-attacher.jar" in env.remote.mv_calls
    # sha256 검증은 mv 이후(최종 파일)에 수행
    cmds = env.remote.exec_calls
    assert max(i for i, c in enumerate(cmds) if c.startswith("mv -f") and ".jar.tmp" in c) < next(
        i for i, c in enumerate(cmds) if "sha256sum -c" in c)


async def test_jar_mv_works_via_shell_fallback(env):
    env.remote.exec_error = SSHError("exec 채널 거부")
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    assert (await _job(env)).status == "done"
    assert any(c.startswith("mv -f") and ".jar.tmp" in c for c in env.remote.shell_calls)


async def test_kill_switch_off_does_not_report_running(env):
    env.snapshots[0] = [_inst_at()]  # 에이전트는 heartbeat 중
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False, "enabled": False})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "done", job.error
    assert "킬 스위치(enabled=false) 상태 — 수집 비활성" in job.logs
    assert (await _agent(env, agent)).status == "stopped"


async def test_loaded_same_dir_skips_attach(env):
    env.remote.check = "OK\nLOADED:/home/jeussic/agent-t/agent-t-legacy.jar"
    env.snapshots[0] = [_inst_at()]
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "done", job.error
    assert "이미 로드됨" in job.logs and not env.remote.attached
    assert (await _agent(env, agent)).status == "running"


async def test_loaded_other_dir_requires_restart_and_not_running(env):
    env.remote.check = "OK\nLOADED:/home/jeussic/agent-t-poc/agent-t.jar"
    env.snapshots[0] = [_inst_at()]  # PoC 에이전트가 같은 role 로 heartbeat 중이어도
    agent = await env.make({"jvm_match": "-Dsic_server1", "service_type": "tomcat", "service_path": "/opt/tomcat"})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "done", job.error
    assert "WAS 재기동" in job.logs and "agent-t-poc" in job.logs
    assert "attach 완료" not in job.logs and not env.remote.attached
    assert (await _agent(env, agent)).status == "installed"
    assert "/opt/tomcat/bin/setenv.sh" in env.remote.files  # 영구 적용은 진행


async def test_legacy_loaded_marker_true_treated_as_other(env):
    env.remote.check = "OK\nLOADED:true"
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    assert not env.remote.attached
    assert (await _agent(env, agent)).status == "installed"


async def test_job_api_exposes_candidates_and_hides_marker(env, authed_client):
    env.remote.ps = "1 u /jdk/bin/java -Dsic a\n2 u /jdk/bin/java -Dsic b"
    agent = await env.make({"jvm_match": "-Dsic"})
    await inst.run_install("job1", agent, SESSION)
    body = (await authed_client.get("/api/v1/agents/jobs/job1")).json()
    assert body["status"] == "needs_target"
    assert [c["pid"] for c in body["candidates"]] == [1, 2]
    assert "JVM_CANDIDATES" not in body["logs"]


async def test_install_request_rejects_invalid_target_pid(authed_client):
    resp = await authed_client.post("/api/v1/agents/install", json={"agent_id": 1, "target_pid": 0})
    assert resp.status_code == 422


class _OrderedLive(dict):
    """status 가 종료 값으로 바뀌는 시점을 DB commit 과 같은 타임라인에 기록한다."""

    def __init__(self, events, *a, **kw):
        super().__init__(*a, **kw)
        self._events = events

    def __setitem__(self, key, value):
        if key == "status" and value in ("done", "failed", "needs_target"):
            self._events.append(f"live:{value}")
        super().__setitem__(key, value)


def _track_commits(env, monkeypatch):
    from sqlalchemy.ext.asyncio import AsyncSession

    events: list[str] = []

    class TrackedSession(AsyncSession):
        async def commit(self):
            await super().commit()
            events.append("commit")

    monkeypatch.setattr(
        database, "AsyncSessionLocal",
        async_sessionmaker(env.db.bind, class_=TrackedSession, expire_on_commit=False),
    )
    agents_control._live_jobs["job1"] = _OrderedLive(events, {"status": "running", "logs": "", "error": None})
    return events


async def test_live_done_exposed_only_after_db_commit(env, monkeypatch):
    env.snapshots[0] = []
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    events = _track_commits(env, monkeypatch)
    await inst.run_install("job1", agent, SESSION)
    assert events[-2:] == ["commit", "live:done"]
    assert (await _agent(env, agent)).status == "installed"


async def test_live_failed_exposed_only_after_db_commit(env, monkeypatch):
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    env.remote.ps = ""
    events = _track_commits(env, monkeypatch)
    await inst.run_install("job1", agent, SESSION)
    assert events[-2:] == ["commit", "live:failed"]
    assert (await _agent(env, agent)).status == "failed"


async def test_live_needs_target_exposed_only_after_db_commit(env, monkeypatch):
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    env.remote.ps = (
        "4242 jeussic /usr/local/jdk1.7.0_79/bin/java -Dsic_server1 weblogic.Server\n"
        "4343 jeussic /usr/local/jdk1.7.0_79/bin/java -Dsic_server1 weblogic.Server"
    )
    events = _track_commits(env, monkeypatch)
    await inst.run_install("job1", agent, SESSION)
    assert events[-2:] == ["commit", "live:needs_target"]


def _written_props(env):
    return env.remote.files["/home/jeussic/agent-t/agent-t.properties.tmp"]


async def test_capture_params_default_off(env):
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False})
    await inst.run_install("job1", agent, SESSION)
    props = _written_props(env)
    assert "capture.params=false" in props.splitlines()
    assert "capture.params.uri" not in props


async def test_capture_params_written_with_globs(env):
    agent = await env.make({
        "jvm_match": "-Dsic_server1", "permanent": False, "capture_params": True,
        "capture_params_include": ["/api/*", "/order/**"], "capture_params_exclude": "/api/login, /health",
    })
    await inst.run_install("job1", agent, SESSION)
    lines = _written_props(env).splitlines()
    assert "capture.params=true" in lines
    assert "capture.params.uri.include=/api/*,/order/**" in lines
    assert "capture.params.uri.exclude=/api/login,/health" in lines


async def test_capture_params_truthy_string_stays_off_and_globs_ignored(env):
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False, "capture_params": "true",
                            "capture_params_include": ["/api/*"]})
    await inst.run_install("job1", agent, SESSION)
    props = _written_props(env)
    assert "capture.params=false" in props.splitlines()
    assert "uri.include" not in props


async def test_capture_params_bad_glob_fails_job_before_upload(env):
    agent = await env.make({"jvm_match": "-Dsic_server1", "permanent": False, "capture_params": True,
                            "capture_params_include": ["/a\ngateway.url=http://evil"]})
    await inst.run_install("job1", agent, SESSION)
    assert (await _job(env)).status == "failed"
    assert "agent-t.properties.tmp" not in " ".join(str(e) for e in env.remote.events)


def test_capture_properties_pure():
    assert inst.capture_properties({}) == "capture.params=false\n"
    assert inst.capture_properties({"capture_params": True}) == "capture.params=true\n"
    with pytest.raises(ValueError):
        inst.capture_properties({"capture_params": True, "capture_params_exclude": [1]})


def test_capture_properties_pool_metrics_kill_switch():
    assert "pool.metrics" not in inst.capture_properties({})
    assert "pool.metrics" not in inst.capture_properties({"pool_metrics": True})
    assert "pool.metrics" not in inst.capture_properties({"pool_metrics": "false"})
    assert inst.capture_properties({"pool_metrics": False}).endswith("pool.metrics=false\n")


# ── 사전 점검 (dry-run) ──────────────────────────────────────────────────────

_WRITE_MARKERS = ("mkdir", "mv ", "rm ", "chmod", "cp ", "tee", ": >", " > ", ">>", "sed -i", "--attach", "systemctl")


def _assert_read_only(remote):
    for cmd in remote.exec_calls + remote.shell_calls:
        assert not any(m in cmd for m in _WRITE_MARKERS if m not in ("--attach",)), cmd
        if "agent-t-attacher.jar" in cmd:
            raise AssertionError(f"attacher 실행 금지: {cmd}")
    assert remote.binaries == {} and remote.files == {} and remote.mv_calls == []
    assert not [e for e in remote.events if e[0] == "put"]


def _by_item(res):
    return {c["item"]: c for c in res}


async def test_precheck_all_ok_and_read_only(env):
    env.remote.ps = "4242 jeussic /usr/local/jdk1.7.0_79/bin/java -Dsic_server1 weblogic.Server"
    orig = env.remote._run

    def run(cmd):
        if cmd.startswith("d="):
            return 0, "W /home/jeussic\n/dev/x 1000000 1 900000 1% /\n", ""
        if "curl" in cmd:
            return 0, "200", ""
        return orig(cmd)

    env.remote._run = run
    agent = await env.make({"jvm_match": "sic_server1", "service_type": "standalone"})
    res = await inst.precheck_install(agent, SESSION)
    items = _by_item(res)
    assert all(c["status"] == "ok" for c in res), res
    assert {"설정값", "SSH 접속", "대상 JVM", "JDK", "설치 경로", "디스크 여유", "gateway 도달"} <= set(items)
    assert any("/healthz" in c for c in env.remote.exec_calls)
    _assert_read_only(env.remote)


async def test_precheck_reports_failures_without_writing(env):
    env.remote.ps = ""
    env.remote.version = 'java version "1.5.0_22"'
    orig = env.remote._run

    def run(cmd):
        if cmd.startswith("d="):
            return 0, "N /opt\n/dev/x 100 1 1024 99% /opt\n", ""
        if "curl" in cmd:
            return 0, "000", ""
        return orig(cmd)

    env.remote._run = run
    agent = await env.make({"jvm_match": "sic_server1", "service_type": "standalone", "install_dir": "/opt/agent-t"})
    items = _by_item(await inst.precheck_install(agent, SESSION))
    assert items["대상 JVM"]["status"] == "fail"
    assert items["설치 경로"]["status"] == "fail"
    assert items["디스크 여유"]["status"] == "fail"
    assert items["gateway 도달"]["status"] == "fail"
    _assert_read_only(env.remote)


async def test_precheck_multiple_jvm_is_warn_and_old_jdk_fail(env):
    env.remote.ps = (
        "4242 jeussic /j/bin/java -Dsic_server1 a\n"
        "4343 jeussic /j/bin/java -Dsic_server1 b"
    )
    env.remote.version = 'java version "1.5.0_22"'
    agent = await env.make({"jvm_match": "sic_server1"})
    items = _by_item(await inst.precheck_install(agent, SESSION))
    assert items["대상 JVM"]["status"] == "warn"
    assert items["JDK"]["status"] == "fail"
    _assert_read_only(env.remote)


async def test_precheck_jeus_reads_domain_xml_only(env):
    env.remote.read_map["/home/jeussic/domain/config/domain.xml"] = FIXTURE.read_text()
    orig = env.remote._run
    env.remote._run = lambda cmd: (0, "W /home/jeussic\n/dev/x 1 1 900000 1% /\n", "") if cmd.startswith("d=") else orig(cmd)
    agent = await env.make({
        "jvm_match": "sic_server1", "service_type": "jeus", "service_path": "/home/jeussic/domain",
        "server_name": "sic_server1",
    })
    items = _by_item(await inst.precheck_install(agent, SESSION))
    assert items["영구 적용"]["status"] == "ok", items["영구 적용"]
    _assert_read_only(env.remote)


JEUS_PS = (
    "4242 jeussic /usr/local/jdk1.7.0_79/bin/java -Djeus.home=/apps/jeussic/jeus7 "
    "-Djeus.domain.name=sic_domain -Dsic_server1 -domain sic_domain weblogic.Server"
)
DERIVED = "/apps/jeussic/jeus7/domains/sic_domain"


def _jeus_precheck_env(env):
    orig = env.remote._run
    env.remote._run = lambda cmd: (0, "W /home/jeussic\n/dev/x 1 1 900000 1% /\n", "") if cmd.startswith("d=") else orig(cmd)


async def test_precheck_jeus_autodetect_empty_path(env):
    env.remote.ps = JEUS_PS
    env.remote.read_map[f"{DERIVED}/config/domain.xml"] = FIXTURE.read_text()
    _jeus_precheck_env(env)
    agent = await env.make({"jvm_match": "sic_server1", "service_type": "jeus", "server_name": "sic_server1"})
    items = _by_item(await inst.precheck_install(agent, SESSION))
    assert items["영구 적용"]["status"] == "ok", items["영구 적용"]
    assert DERIVED in items["영구 적용"]["detail"] and "자동 탐지" in items["영구 적용"]["detail"]
    _assert_read_only(env.remote)


async def test_precheck_jeus_path_mismatch_warns(env):
    env.remote.ps = JEUS_PS
    env.remote.read_map["/home/jeussic/domain/config/domain.xml"] = FIXTURE.read_text()
    _jeus_precheck_env(env)
    agent = await env.make({"jvm_match": "sic_server1", "service_type": "jeus",
                            "service_path": "/home/jeussic/domain", "server_name": "sic_server1"})
    items = _by_item(await inst.precheck_install(agent, SESSION))
    d = items["영구 적용"]
    assert d["status"] == "warn" and "/home/jeussic/domain" in d["detail"] and DERIVED in d["detail"]
    _assert_read_only(env.remote)


async def test_precheck_jeus_wrong_path_suggests_derived(env):
    env.remote.ps = JEUS_PS
    env.remote.read_map[f"{DERIVED}/config/domain.xml"] = FIXTURE.read_text()
    _jeus_precheck_env(env)
    agent = await env.make({"jvm_match": "sic_server1", "service_type": "jeus",
                            "service_path": "/nope", "server_name": "sic_server1"})
    items = _by_item(await inst.precheck_install(agent, SESSION))
    d = items["영구 적용"]
    assert d["status"] == "fail" and "/nope/config/domain.xml" in d["detail"] and DERIVED in d["detail"]
    _assert_read_only(env.remote)


async def test_precheck_jeus_no_path_no_detection_fails(env):
    _jeus_precheck_env(env)
    agent = await env.make({"jvm_match": "sic_server1", "service_type": "jeus", "server_name": "sic_server1"})
    items = _by_item(await inst.precheck_install(agent, SESSION))
    assert items["영구 적용"]["status"] == "fail" and "service_path" in items["영구 적용"]["detail"]


async def test_install_jeus_autodetects_domain_path(env):
    env.remote.ps = JEUS_PS
    env.remote.read_map[f"{DERIVED}/config/domain.xml"] = FIXTURE.read_text()
    agent = await env.make({"jvm_match": "-Dsic_server1", "service_type": "jeus"})
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "done", job.error
    assert f"도메인 경로 자동 탐지: {DERIVED}" in job.logs


async def test_install_jeus_user_path_differs_logs_and_uses_user_path(env):
    env.remote.ps = JEUS_PS
    env.remote.read_map["/jeus/domains/sic_domain/config/domain.xml"] = FIXTURE.read_text()
    agent = await env.make(_jeus_label())
    await inst.run_install("job1", agent, SESSION)
    job = await _job(env)
    assert job.status == "done", job.error
    assert "탐지한 경로" in job.logs and DERIVED in job.logs
    assert "자동 탐지: " not in job.logs


async def test_precheck_systemd_non_root_fails(env):
    agent = await env.make({"jvm_match": "sic_server1", "service_type": "systemd"})
    items = _by_item(await inst.precheck_install(agent, SESSION))
    assert items["영구 적용"]["status"] == "fail"


async def test_precheck_bad_config_stops_before_ssh(env):
    agent = await env.make({"service_type": "standalone"})
    res = await inst.precheck_install(agent, SESSION)
    assert res == [{"item": "설정값", "status": "fail", "detail": "jvm_match 가 필요합니다 (예: -Dsic_server1)."}]
    assert env.remote.exec_calls == []


async def test_precheck_ssh_failure_reported(env):
    env.remote.exec_error = SSHError("SSH 연결 실패: timeout")
    agent = await env.make({"jvm_match": "sic_server1"})
    items = _by_item(await inst.precheck_install(agent, SESSION))
    assert items["SSH 접속"]["status"] == "fail"


async def test_precheck_route_requires_session_and_returns_shape(env, authed_client, monkeypatch):
    agent = await env.make({"jvm_match": "sic_server1", "service_type": "standalone"})
    r = await authed_client.post(f"/api/v1/agents/{agent.id}/precheck")
    assert r.status_code == 401
    monkeypatch.setattr(agents_control, "get_session", lambda t: SESSION if t == "tok" else None)
    r = await authed_client.post(f"/api/v1/agents/{agent.id}/precheck", headers={"X-SSH-Session": "tok"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"ok", "overall", "checked_at", "checks"}
    assert body["checks"] and set(body["checks"][0]) == {"item", "status", "detail"}
    _assert_read_only(env.remote)
