import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from services.jeus_domain import add_javaagent

FIXTURE = Path(__file__).parent / "fixtures" / "jeus_domain_min.xml"
OPT = "-javaagent:/home/jeussic/agent-t/agent-t-legacy.jar"


def _server_options(xml: str, name: str) -> list[str]:
    root = ET.fromstring(xml)
    for el in root.iter():
        if el.tag.endswith("server") and any(c.tag.endswith("name") and c.text == name for c in el):
            return [o.text for o in el.iter() if o.tag.endswith("jvm-option")]
    raise AssertionError(name)


def test_jeus_add_javaagent_idempotent():
    original = FIXTURE.read_text()
    once, diff = add_javaagent(original, "sic_server1", OPT)
    assert f"+                <jvm-option>{OPT}</jvm-option>" in diff
    assert "+<jvm-option>-javaagent:" not in diff  # 들여쓰기 보존
    assert _server_options(once, "sic_server1")[-1] == OPT

    twice, diff2 = add_javaagent(once, "sic_server1", OPT)
    assert diff2 == ""
    assert twice == once

    # 다른 서버 항목 불변, 변경은 추가된 1줄뿐
    assert _server_options(once, "sic_server2") == _server_options(original, "sic_server2")
    added = [l for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++")]
    removed = [l for l in diff.splitlines() if l.startswith("-") and not l.startswith("---")]
    assert len(added) == 1 and removed == []


def test_jeus_unknown_server_raises():
    with pytest.raises(ValueError, match="찾을 수 없습니다"):
        add_javaagent(FIXTURE.read_text(), "nope", OPT)


def test_jeus_server_without_jvm_config_gets_block():
    xml = "<domain><servers><server>\n  <name>s1</name>\n</server></servers></domain>"
    new, diff = add_javaagent(xml, "s1", OPT)
    assert _server_options(new, "s1") == [OPT]
    assert diff
