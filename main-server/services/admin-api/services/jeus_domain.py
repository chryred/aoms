"""JEUS domain.xml 의 특정 서버 jvm-config 에 -javaagent 옵션을 추가한다 (Agent-T 영구 적용).

원문을 텍스트로 유지한 채 대상 서버의 `<jvm-config>` 블록만 수정한다 (주석·들여쓰기·다른 서버 불변).
XML 구조 검증과 서버 탐색은 ElementTree 로 하고, 삽입 위치는 텍스트 오프셋으로 계산한다.
"""

import difflib
import re
import xml.etree.ElementTree as ET

_AGENT_RE = re.compile(r"-javaagent:\S*agent-t")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child_text(elem: ET.Element, name: str) -> str | None:
    for ch in elem:
        if _local(ch.tag) == name:
            return (ch.text or "").strip()
    return None


def _find_server(root: ET.Element, server_name: str) -> ET.Element:
    for el in root.iter():
        if _local(el.tag) == "server" and _child_text(el, "name") == server_name:
            return el
    raise ValueError(f"domain.xml 에서 서버를 찾을 수 없습니다: {server_name}")


def _server_span(xml_text: str, server_name: str) -> tuple[int, int]:
    """`<server>…</server>` 중 첫 `<name>` 이 server_name 인 블록의 [start, end) 오프셋."""
    pattern = re.compile(r"<server>(.*?)</server>", re.DOTALL)
    for m in pattern.finditer(xml_text):
        name = re.search(r"<name>\s*([^<]*?)\s*</name>", m.group(1))
        if name and name.group(1) == server_name:
            return m.start(), m.end()
    raise ValueError(f"domain.xml 에서 서버 블록 위치를 찾을 수 없습니다: {server_name}")


def add_javaagent(xml_text: str, server_name: str, option: str) -> tuple[str, str]:
    """(새 xml, unified diff). 이미 같은 `-javaagent:...agent-t` 가 있으면 (원문, "")."""
    try:
        root = ET.fromstring(xml_text.encode("utf-8"))
    except ET.ParseError as exc:
        raise ValueError(f"domain.xml 파싱 실패: {exc}") from exc

    server = _find_server(root, server_name)
    for cfg in server:
        if _local(cfg.tag) == "jvm-config":
            for opt in cfg:
                if _local(opt.tag) == "jvm-option" and _AGENT_RE.search(opt.text or ""):
                    return xml_text, ""

    start, end = _server_span(xml_text, server_name)
    block = xml_text[start:end]
    safe_option = option.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    close = re.search(r"([ \t]*)</jvm-config>", block)
    if close:
        opts = list(re.finditer(r"([ \t]*)<jvm-option>", block))
        indent = opts[-1].group(1) if opts else close.group(1) + "    "
        new_block = (
            block[: close.start()] + f"{indent}<jvm-option>{safe_option}</jvm-option>\n" + block[close.start():]
        )
    else:
        name_end = re.search(r"([ \t]*)<name>[^<]*</name>[ \t]*\n", block)
        if not name_end:
            raise ValueError(f"서버 {server_name} 블록 형식을 해석할 수 없습니다.")
        ind = name_end.group(1)
        insert = (
            f"{ind}<jvm-config>\n{ind}    <jvm-option>{safe_option}</jvm-option>\n{ind}</jvm-config>\n"
        )
        new_block = block[: name_end.end()] + insert + block[name_end.end():]

    new_xml = xml_text[:start] + new_block + xml_text[end:]
    ET.fromstring(new_xml.encode("utf-8"))  # 결과 검증
    diff = "".join(
        difflib.unified_diff(
            xml_text.splitlines(keepends=True),
            new_xml.splitlines(keepends=True),
            fromfile="domain.xml",
            tofile="domain.xml (agent-t)",
        )
    )
    return new_xml, diff
