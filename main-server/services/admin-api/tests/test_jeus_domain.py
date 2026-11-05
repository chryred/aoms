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


# ── derive_domain_dir ─────────────────────────────────────────────────────────

from services.jeus_domain import derive_domain_dir  # noqa: E402

JEUS7_ARGS = (
    "/usr/local/jdk1.7.0_79/bin/java -Xms512m -Djeus.home=/apps/jeussic/jeus7 "
    "-Djeus.domain.name=sic_domain -Dsic_server1 -domain sic_domain "
    "-Djava.security.policy=/apps/jeussic/jeus7/domains/sic_domain/config/security/policy "
    "jeus.server.JEUSServerMain"
)


@pytest.mark.parametrize("args,expected", [
    (JEUS7_ARGS, "/apps/jeussic/jeus7/domains/sic_domain"),
    # 후행 슬래시
    ("java -Djeus.home=/apps/jeus8/ -Djeus.domain.name=d1 x", "/apps/jeus8/domains/d1"),
    # -domain 토큰 폴백
    ("java -Djeus.home=/apps/jeus8 -domain d2 x", "/apps/jeus8/domains/d2"),
    # JEUS 21 스타일: 도메인명 프로퍼티 우선
    ("java -Djeus.home=/opt/tmax/jeus21 -Djeus.domain.name=prod -domain other x", "/opt/tmax/jeus21/domains/prod"),
    # jeus.home 없이 domains 경로만
    ("java -Djava.security.policy=/data/jeus/domains/dom3/config/security/policy x", "/data/jeus/domains/dom3"),
    # 홈은 있으나 도메인명 없음 -> 경로 폴백도 없으면 None
    ("java -Djeus.home=/apps/jeus8 x", None),
    # 틸드는 확장하지 않는다
    ("java -Djeus.home=~/jeus7 -Djeus.domain.name=d x", None),
    # 따옴표 값은 지원하지 않는다
    ('java -Djeus.home="/apps/jeus7" -Djeus.domain.name=d x', None),
    ('java -Dp="/apps/jeus7/domains/d/config/x" y', None),
    # 도메인명에 위험 문자
    ("java -Djeus.home=/apps/jeus7 -Djeus.domain.name=a;rm x", None),
    ("", None),
    ("java -Dsic_server1 weblogic.Server", None),
])
def test_derive_domain_dir(args, expected):
    assert derive_domain_dir(args) == expected
