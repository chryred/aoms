import re

_PROMQL_LABEL_RE = re.compile(r'[^a-zA-Z0-9_.\-]')


def sanitize_promql_label(value: str) -> str:
    """PromQL label 값에서 주입 가능한 문자를 제거."""
    return _PROMQL_LABEL_RE.sub('', value)
