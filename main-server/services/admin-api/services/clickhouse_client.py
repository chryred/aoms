"""ClickHouse HTTP 비동기 클라이언트 (Agent-T APM 조회용).

SQL 은 `{name:Type}` 바인딩 + `param_<name>` 쿼리스트링으로만 값을 전달한다 (문자열 결합 금지).
"""
import json
import os
from datetime import datetime, timezone
from typing import Any

import httpx

_TIMEOUT_SECONDS = 15.0
_MAX_EXECUTION_SECONDS = 10  # 서버측 쿼리 상한 — HTTP 타임아웃(15s)보다 먼저 실패시켜 CH 점유를 막는다
_transport: httpx.AsyncBaseTransport | None = None  # 테스트에서 MockTransport 주입


class ClickHouseError(Exception):
    """ClickHouse 조회 실패 (연결·HTTP 오류·응답 파싱 오류)."""


def _quote_str(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _format_param(value: Any) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value.strftime("%Y-%m-%d %H:%M:%S.") + f"{value.microsecond // 1000:03d}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(
            _quote_str(v) if isinstance(v, str) else _format_param(v) for v in value
        ) + "]"
    return str(value)


async def query(sql: str, params: dict | None = None) -> list[dict]:
    """SELECT 를 실행하고 JSONEachRow 결과를 dict 리스트로 반환한다."""
    url = os.getenv("CLICKHOUSE_URL", "http://clickhouse:8123")
    headers = {}
    user = os.getenv("CLICKHOUSE_USER")
    if user:
        headers["X-ClickHouse-User"] = user
        headers["X-ClickHouse-Key"] = os.getenv("CLICKHOUSE_PASSWORD", "")
    qs = {
        "database": os.getenv("CLICKHOUSE_DB", "agent_t"),
        "max_execution_time": str(_MAX_EXECUTION_SECONDS),
    }
    for name, value in (params or {}).items():
        qs[f"param_{name}"] = _format_param(value)

    body = sql.rstrip().rstrip(";") + "\nFORMAT JSONEachRow"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS, transport=_transport) as client:
            resp = await client.post(url, params=qs, content=body.encode("utf-8"), headers=headers)
    except httpx.HTTPError as exc:
        raise ClickHouseError(f"ClickHouse 연결 실패: {exc}") from exc
    if resp.status_code != 200:
        raise ClickHouseError(f"ClickHouse HTTP {resp.status_code}: {resp.text[:300]}")
    try:
        return [json.loads(line) for line in resp.text.splitlines() if line.strip()]
    except ValueError as exc:
        raise ClickHouseError(f"ClickHouse 응답 파싱 실패: {exc}") from exc
