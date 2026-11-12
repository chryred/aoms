"""SSH helper. Password only from env SV_PW. Usage:
  r.py "<cmd>"            run on server
  r.py put <local> <remote>
  r.py get <remote> <local>
env: SV_HOST (default 10.253.21.106), SV_USER (default container), SV_TO (timeout s, default 300)
"""
import os
import sys

import paramiko

host = os.environ.get("SV_HOST", "10.253.21.106")
user = os.environ.get("SV_USER", "container")
pw = os.environ["SV_PW"]
to = int(os.environ.get("SV_TO", "300"))

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(host, username=user, password=pw, timeout=20, allow_agent=False, look_for_keys=False)
try:
    if sys.argv[1] == "put":
        s = c.open_sftp()
        s.put(sys.argv[2], sys.argv[3])
        s.close()
        print("put ok", sys.argv[3])
    elif sys.argv[1] == "get":
        s = c.open_sftp()
        s.get(sys.argv[2], sys.argv[3])
        s.close()
        print("get ok", sys.argv[3])
    else:
        import re, time, uuid
        mark = "__END_" + uuid.uuid4().hex[:8]
        ch = c.invoke_shell(width=250, height=50)
        ch.settimeout(to)
        ch.send("export PS1='' PS2=''; stty -echo; unset HISTFILE\n")
        time.sleep(1.0)
        while ch.recv_ready():
            ch.recv(65536)
        ch.send("( " + sys.argv[1] + " ) 2>&1; echo " + mark + "_$?\n")
        buf = ""
        start = time.time()
        while True:
            if ch.recv_ready():
                buf += ch.recv(65536).decode(errors="replace")
                m = re.search(mark + r"_(\d+)", buf)
                if m:
                    break
            elif time.time() - start > to:
                print(buf); print("TIMEOUT"); sys.exit(124)
            else:
                time.sleep(0.2)
        out = buf[: m.start()]
        out = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", out).replace("\r", "")
        sys.stdout.write(out)
        sys.exit(int(m.group(1)))
finally:
    c.close()
