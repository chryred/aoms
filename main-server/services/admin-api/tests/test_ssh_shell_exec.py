import re

import pytest

from services import ssh_session


class FakeChannel:
    """send() 된 명령에서 마커를 읽어 PTY 처럼 echo + 출력 + 종료코드를 돌려준다."""

    def __init__(self, output: str, code: int, never_finish: bool = False):
        self.output, self.code, self.never_finish = output, code, never_finish
        self.pending = b""
        self.closed = False

    def send(self, data: str):
        marker = re.search(r"(__AGT_[0-9a-f]+__)S", data).group(1)
        echoed = data.replace("\n", "\r\n")  # PTY echo: 마커의 $? 는 확장되지 않은 채 보인다
        body = f"{marker}S\r\n{self.output}\r\n"
        if not self.never_finish:
            body += f"{marker}{self.code}\r\n"
        self.pending = (echoed + body).encode()

    def recv_ready(self):
        return bool(self.pending)

    def recv(self, n):
        data, self.pending = self.pending, b""
        return data

    def close(self):
        self.closed = True


class FakeClient:
    def __init__(self, chan):
        self.chan, self.closed = chan, False

    def invoke_shell(self, **kw):
        return self.chan

    def close(self):
        self.closed = True


def test_ssh_shell_exec_parses_exit_code(monkeypatch):
    chan = FakeChannel("hello\nworld", 3)
    client = FakeClient(chan)
    monkeypatch.setattr(ssh_session, "_ssh_connect", lambda *a: client)
    code, out, err = ssh_session.ssh_shell_exec("h", 22, "u", "p", "echo hello")
    assert code == 3
    assert out.strip() == "hello\nworld"
    assert "echo hello" not in out and "__AGT_" not in out
    assert err == ""
    assert chan.closed and client.closed


def test_ssh_shell_exec_timeout(monkeypatch):
    monkeypatch.setattr(ssh_session, "_ssh_connect", lambda *a: FakeClient(FakeChannel("x", 0, never_finish=True)))
    with pytest.raises(ssh_session.SSHError, match="시간 초과"):
        ssh_session.ssh_shell_exec("h", 22, "u", "p", "sleep 99", timeout=1)
