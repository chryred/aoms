"""E2E 시드 — PG 에 시스템 2개 + agent_t 인스턴스 2개 + 테스트 admin 사용자를 만들고 토큰 파일을 쓴다.

사용: seed.py <work_dir> [--agentsim-jvms N]
평문 토큰은 .work/ (gitignore) 에만 저장한다. 테스트 사용자는 dev 전용.
"""
import hashlib
import json
import secrets
import subprocess
import sys

from passlib.context import CryptContext

WORK = sys.argv[1]
SIM_JVMS = int(sys.argv[2]) if len(sys.argv) > 2 else 50
ADMIN_EMAIL = "e2e-admin@example.test"
ADMIN_PW = "e2e-admin-1234"


def psql(sql: str) -> str:
    return subprocess.run(
        ["docker", "exec", "-i", "e2e-postgres", "psql", "-U", "synapse", "-d", "synapse", "-At", "-v", "ON_ERROR_STOP=1"],
        input=sql, capture_output=True, text=True, check=True,
    ).stdout


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


targets = [
    ("e2e-sys-a", "E2E 시스템 A (JDK7)", "was1", "agent7", "tomcat7"),
    ("e2e-sys-b", "E2E 시스템 B (JDK17)", "was1", "agent9", "tomcat9"),
]
tokens = {}
sql = []
for name, disp, role, _d, host in targets:
    tok = secrets.token_urlsafe(32)
    tokens[name] = tok
    sha = hashlib.sha256(tok.encode()).hexdigest()
    label = json.dumps({"instance_role": role, "agent_token_sha256": sha})
    sql.append(f"""
INSERT INTO systems (system_name, display_name, environment, tx_slow_threshold_ms, tx_retention_days)
VALUES ({q(name)}, {q(disp)}, 'dev', 3000, 7) ON CONFLICT (system_name) DO NOTHING;
DELETE FROM agent_instances WHERE agent_type='agent_t' AND system_id=(SELECT id FROM systems WHERE system_name={q(name)});
INSERT INTO agent_instances (system_id, host, agent_type, ssh_username, label_info, status)
SELECT id, {q(host)}, 'agent_t', 'e2e', {q(label)}, 'running' FROM systems WHERE system_name={q(name)};
""")
# agentsim 용 시스템 (JVM 수만큼 인스턴스; 같은 시스템에 role 별로 분리)
sim_tokens = []
name = "e2e-sys-sim"
sql.append(f"""INSERT INTO systems (system_name, display_name, environment, tx_slow_threshold_ms, tx_retention_days)
VALUES ({q(name)}, 'E2E 부하 시뮬레이터', 'dev', 3000, 7) ON CONFLICT (system_name) DO NOTHING;
DELETE FROM agent_instances WHERE agent_type='agent_t' AND system_id=(SELECT id FROM systems WHERE system_name={q(name)});""")
for i in range(SIM_JVMS):
    tok = secrets.token_urlsafe(32)
    sim_tokens.append(tok)
    sha = hashlib.sha256(tok.encode()).hexdigest()
    label = json.dumps({"instance_role": f"sim{i:02d}", "agent_token_sha256": sha})
    sql.append(f"""INSERT INTO agent_instances (system_id, host, agent_type, ssh_username, label_info, status)
SELECT id, 'sim-{i}', 'agent_t', 'e2e', {q(label)}, 'running' FROM systems WHERE system_name={q(name)};""")

h = CryptContext(schemes=["bcrypt"]).hash(ADMIN_PW)
sql.append(f"""INSERT INTO users (email, password_hash, name, role, is_active, is_approved)
VALUES ({q(ADMIN_EMAIL)}, {q(h)}, 'E2E Admin', 'admin', true, true)
ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, is_active=true, is_approved=true, role='admin';""")
psql("\n".join(sql))

for name, _disp, role, d, _h in targets:
    with open(f"{WORK}/{d}/agent-t.properties", "w") as f:
        f.write(
            f"gateway.url=http://agent-t-gateway:8330\nagent.token={tokens[name]}\n"
            f"instance.role={role}\nsystem.name={name}\nlog.dir=/opt/agent-t/logs\n"
        )
with open(f"{WORK}/tokens-sim.txt", "w") as f:
    f.write("\n".join(sim_tokens) + "\n")
ids = psql("SELECT system_name||'='||id FROM systems WHERE system_name LIKE 'e2e-%' ORDER BY id;")
with open(f"{WORK}/system-ids.env", "w") as f:
    for ln in ids.split():
        k, v = ln.split("=")
        f.write(f"ID_{k.upper().replace('-', '_')}={v}\n")
print("seeded", ids.split())
