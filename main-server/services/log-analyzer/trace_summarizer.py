"""
Agent-T Trace Context 요약기

ClickHouse(agent_t.tx_summary)에서 해당 시스템의 느린·에러 트랜잭션 상위를 조회해
tier별 예산에 맞는 요약 텍스트와 trace_id 목록을 반환.

- 실패 시 ('', []) 반환 → analyzer는 현행 유지 (ADR-002 준수)
- 줄 포맷: "{uri} {elapsed_ms}ms sql {sql_ms}ms/{sql_cnt} {exc}"
- system_name → system_id 는 admin-api /api/v1/systems 결과를 300초 캐시
- 값은 ClickHouse 쿼리 파라미터({name:Type} + param_<name>)로만 전달
"""

import json
import logging
import os
import re
import time
from typing import Literal

import httpx

logger = logging.getLogger(__name__)

CLICKHOUSE_URL = os.getenv("CLICKHOUSE_URL", "http://clickhouse:8123")
_db = os.getenv("CLICKHOUSE_DB", "agent_t")
CLICKHOUSE_DB = _db if re.fullmatch(r"[A-Za-z0-9_]+", _db) else "agent_t"
CLICKHOUSE_USER = os.getenv("CLICKHOUSE_USER", "default")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "")
ADMIN_API_URL = os.getenv("ADMIN_API_URL", "http://admin-api:8080")

_SYSTEMS_TTL = 300.0
_QUERY_LIMIT = 20
_DEFAULT_SLOW_MS = 3000

# tier별 trace summary 예산 (자 단위)
_TIER_BUDGET = {
    "5min":   400,
    "hourly": 300,
    "daily":  200,
}

# system_name → system_id 캐시 ({"at": 적재시각, "map": {...}})
_systems_cache: dict = {}

_SQL = """
SELECT toString(t.trace_id) AS trace_id, d.text AS uri, t.elapsed_ms AS elapsed_ms,
       t.sql_ms AS sql_ms, t.sql_cnt AS sql_cnt, t.exc_class AS exc_class
FROM __DB__.tx_summary AS t
LEFT JOIN (
    SELECT id, argMax(text, last_seen) AS text
    FROM __DB__.dict_uri
    GROUP BY id
) AS d ON t.uri_id = d.id
WHERE t.system_id = {system_id:UInt32}
  AND t.start_ts >= fromUnixTimestamp64Milli({start_ms:Int64}, 'UTC')
  AND t.start_ts < fromUnixTimestamp64Milli({end_ms:Int64}, 'UTC')
  AND (t.error = 1 OR t.elapsed_ms >= {slow_ms:UInt32} OR t.conn_leak > 0 OR t.conn_uncommit > 0)
ORDER BY t.error DESC, t.elapsed_ms DESC
LIMIT {limit:UInt32}
FORMAT JSONEachRow
""".replace("__DB__", CLICKHOUSE_DB)


async def _resolve_system(client: httpx.AsyncClient, system_name: str) -> tuple[int, int] | None:
    """system_name -> (system_id, slow_ms)"""
    now = time.monotonic()
    if not _systems_cache or now - _systems_cache.get("at", 0.0) > _SYSTEMS_TTL:
        resp = await client.get(f"{ADMIN_API_URL}/api/v1/systems")
        resp.raise_for_status()
        _systems_cache["map"] = {
            s["system_name"]: (s["id"], s.get("tx_slow_threshold_ms") or _DEFAULT_SLOW_MS)
            for s in resp.json()
        }
        _systems_cache["at"] = now
    return _systems_cache["map"].get(system_name)


async def build_trace_context(
    system_name: str,
    start_ts_ns: int,
    end_ts_ns: int,
    tier: Literal["5min", "hourly", "daily"],
) -> tuple[str, list[str]]:
    """
    ClickHouse 조회 → tier별 예산 맞춘 요약 반환 (elapsed 내림차순 줄 목록).

    예산 초과 시 뒤쪽(덜 느린) 줄부터 버린다.
    실패 시 ('', []) 반환 → analyzer는 계속 진행 (ADR-002 준수).

    Returns:
        (summary_text, referenced_trace_ids)
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resolved = await _resolve_system(client, system_name)
            if resolved is None:
                return ("", [])
            system_id, slow_ms = resolved
            resp = await client.post(
                CLICKHOUSE_URL,
                params={
                    "database": CLICKHOUSE_DB,
                    "param_system_id": system_id,
                    "param_slow_ms": slow_ms,
                    "param_start_ms": start_ts_ns // 1_000_000,
                    "param_end_ms": end_ts_ns // 1_000_000,
                    "param_limit": _QUERY_LIMIT,
                },
                content=_SQL.encode("utf-8"),
                headers={
                    "X-ClickHouse-User": CLICKHOUSE_USER,
                    "X-ClickHouse-Key": CLICKHOUSE_PASSWORD,
                },
            )
            resp.raise_for_status()
            rows = [json.loads(ln) for ln in resp.text.splitlines() if ln.strip()]
    except Exception as exc:
        logger.debug("Agent-T trace query failed for %s/%s: %s", system_name, tier, exc)
        return ("", [])

    budget = _TIER_BUDGET[tier]
    lines: list[str] = []
    trace_ids: list[str] = []
    used = 0
    for r in rows:
        line = (
            f"{r.get('uri') or '?'} {r['elapsed_ms']}ms "
            f"sql {r['sql_ms']}ms/{r['sql_cnt']} {r.get('exc_class') or ''}"
        ).rstrip()
        sep = 1 if lines else 0
        remaining = budget - used - sep
        if remaining <= 0:
            break
        if len(line) > remaining:
            if lines:
                break
            line = line[:remaining - 1] + "…"
        cost = len(line) + sep
        lines.append(line)
        trace_ids.append(r["trace_id"])
        used += cost

    return ("\n".join(lines), trace_ids)
