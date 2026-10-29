"""APM 조회 응답의 개인정보 마스킹 (IP·사용자 ID)."""


def mask_ip(ip: str) -> str:
    """IPv4 `10.253.21.12` → `10.253.21.*`, IPv6 는 앞 4그룹 + `:*`."""
    if not ip:
        return ""
    if ":" in ip:
        return ":".join(ip.split(":")[:4]) + ":*"
    parts = ip.split(".")
    if len(parts) == 4:
        return ".".join(parts[:3]) + ".*"
    return "*"


def mask_user(uid: str) -> str:
    """`abcdef` → `ab****`, 2자 이하는 전부 `*`."""
    if not uid:
        return ""
    if len(uid) <= 2:
        return "*" * len(uid)
    return uid[:2] + "*" * (len(uid) - 2)
