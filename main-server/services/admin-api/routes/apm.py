"""Agent-T APM 조회 API — ClickHouse(agent_t DB) 의 트랜잭션 검색·상세·산점도·시스템 요약.

모든 값은 ClickHouse `{name:Type}` 바인딩으로만 전달한다. uint64 id(uri_id/sql_id) 는
클라이언트에 16자 소문자 hex 로 노출한다.
"""
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AgentInstance, System
from schemas import (
    ApmSystemSummaryOut, ScatterOut, ScatterPoint, TxDetailBody, TxDetailOut,
    TxListOut, TxSqlOut, TxSummaryOut,
)
from services import clickhouse_client
from services.apm_masking import mask_ip, mask_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/apm", tags=["apm"])

_DEFAULT_RANGE = timedelta(hours=1)
_SUMMARY_COLUMNS = (
    "trace_id, span_id, parent_span, system_id, instance_role, start_ts, uri_id, method, "
    "status, error, exc_class, elapsed_ms, cpu_ms, sql_ms, sql_cnt, fetch_cnt, fetch_ms, "
    "ext_ms, ext_cnt, conn_open, conn_close, conn_leak, conn_uncommit, user_ip, user_id, "
    "biz_key, has_detail"
)
_URI_MATCH_LIMIT = 1000


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_naive_utc(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _hex_id(value) -> str:
    return f"{int(value):016x}"


async def _load_systems(db: AsyncSession, system_ids: list[int]) -> dict[int, System]:
    rows = (await db.execute(select(System).where(System.id.in_(system_ids)))).scalars().all()
    found = {s.id: s for s in rows}
    missing = sorted(set(system_ids) - set(found))
    if missing:
        raise HTTPException(status_code=404, detail=f"시스템을 찾을 수 없습니다: {missing}")
    return found


def _resolve_range(
    systems: dict[int, System], start: Optional[datetime], end: Optional[datetime]
) -> tuple[datetime, datetime]:
    end_utc = _to_naive_utc(end) if end else _now_utc()
    start_utc = _to_naive_utc(start) if start else end_utc - _DEFAULT_RANGE
    if start_utc >= end_utc:
        raise HTTPException(status_code=422, detail="start 는 end 보다 앞서야 합니다")
    retention_days = max((s.tx_retention_days or 7) for s in systems.values())
    if end_utc - start_utc > timedelta(days=retention_days):
        raise HTTPException(status_code=422, detail=f"조회 범위는 보관일({retention_days}일)을 넘을 수 없습니다")
    return start_utc, end_utc


async def _dict_texts(table: str, ids: list[int]) -> dict[int, str]:
    if not ids:
        return {}
    rows = await clickhouse_client.query(
        f"SELECT id, argMax(text, last_seen) AS text FROM agent_t.{table} "
        "WHERE id IN {ids:Array(UInt64)} GROUP BY id",
        {"ids": sorted(set(ids))},
    )
    return {int(r["id"]): r["text"] for r in rows}


def _summary_from_row(row: dict, uris: dict[int, str], names: dict[int, str]) -> TxSummaryOut:
    return TxSummaryOut(
        trace_id=row["trace_id"],
        span_id=row["span_id"],
        parent_span=row.get("parent_span") or "",
        system_id=row["system_id"],
        system_name=names.get(int(row["system_id"])),
        instance_role=row.get("instance_role") or "",
        start_ts=row["start_ts"],
        uri=uris.get(int(row.get("uri_id") or 0), ""),
        method=row.get("method") or "",
        status=row.get("status") or 0,
        error=bool(row.get("error")),
        exc_class=row.get("exc_class") or "",
        elapsed_ms=row.get("elapsed_ms") or 0,
        cpu_ms=row.get("cpu_ms") or 0,
        sql_ms=row.get("sql_ms") or 0,
        sql_cnt=row.get("sql_cnt") or 0,
        fetch_cnt=row.get("fetch_cnt") or 0,
        fetch_ms=row.get("fetch_ms") or 0,
        ext_ms=row.get("ext_ms") or 0,
        ext_cnt=row.get("ext_cnt") or 0,
        conn_open=row.get("conn_open") or 0,
        conn_close=row.get("conn_close") or 0,
        conn_leak=row.get("conn_leak") or 0,
        conn_uncommit=row.get("conn_uncommit") or 0,
        user_ip=mask_ip(row.get("user_ip") or ""),
        user_id=mask_user(row.get("user_id") or ""),
        biz_key=row.get("biz_key") or "",
        has_detail=bool(row.get("has_detail")),
    )


async def _build_summaries(db: AsyncSession, rows: list[dict]) -> list[TxSummaryOut]:
    if not rows:
        return []
    uris = await _dict_texts("dict_uri", [int(r.get("uri_id") or 0) for r in rows])
    sys_ids = sorted({int(r["system_id"]) for r in rows})
    names = {
        sid: name
        for sid, name in (await db.execute(
            select(System.id, System.system_name).where(System.id.in_(sys_ids))
        )).all()
    }
    return [_summary_from_row(r, uris, names) for r in rows]


@router.get("/transactions", response_model=TxListOut)
async def search_transactions(
    system_ids: list[int] = Query(..., min_length=1),
    instance_role: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    uri: Optional[str] = None,
    user_ip: Optional[str] = None,
    user_id: Optional[str] = None,
    min_elapsed_ms: Optional[int] = Query(None, ge=0),
    min_sql_ms: Optional[int] = Query(None, ge=0),
    error_only: bool = False,
    trace_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    systems = await _load_systems(db, system_ids)
    start_utc, end_utc = _resolve_range(systems, start, end)

    where = [
        "system_id IN {system_ids:Array(UInt32)}",
        "start_ts >= {start:DateTime64(3, 'UTC')}",
        "start_ts < {end:DateTime64(3, 'UTC')}",
    ]
    params: dict = {"system_ids": system_ids, "start": start_utc, "end": end_utc}

    if uri:
        matched = await clickhouse_client.query(
            "SELECT DISTINCT id FROM agent_t.dict_uri "
            "WHERE positionCaseInsensitive(text, {uri:String}) > 0 LIMIT {uri_limit:UInt32}",
            {"uri": uri, "uri_limit": _URI_MATCH_LIMIT},
        )
        if not matched:
            return TxListOut(items=[], has_more=False)
        where.append("uri_id IN {uri_ids:Array(UInt64)}")
        params["uri_ids"] = [int(r["id"]) for r in matched]
    if instance_role:
        where.append("instance_role = {instance_role:String}")
        params["instance_role"] = instance_role
    if user_ip:
        where.append("user_ip = {user_ip:String}")
        params["user_ip"] = user_ip
    if user_id:
        where.append("user_id = {user_id:String}")
        params["user_id"] = user_id
    if min_elapsed_ms is not None:
        where.append("elapsed_ms >= {min_elapsed_ms:UInt32}")
        params["min_elapsed_ms"] = min_elapsed_ms
    if min_sql_ms is not None:
        where.append("sql_ms >= {min_sql_ms:UInt32}")
        params["min_sql_ms"] = min_sql_ms
    if error_only:
        where.append("error = 1")
    if trace_id:
        where.append("trace_id = {trace_id:String}")
        params["trace_id"] = trace_id

    params.update({"limit": limit + 1, "offset": offset})
    rows = await clickhouse_client.query(
        f"SELECT {_SUMMARY_COLUMNS} FROM agent_t.tx_summary WHERE " + " AND ".join(where) +
        " ORDER BY start_ts DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}",
        params,
    )
    has_more = len(rows) > limit
    return TxListOut(items=await _build_summaries(db, rows[:limit]), has_more=has_more)


def _parse_json(text_value):
    if not text_value:
        return None
    try:
        return json.loads(text_value)
    except (TypeError, ValueError):
        return text_value


@router.get("/transactions/{trace_id}/{span_id}", response_model=TxDetailOut)
async def get_transaction_detail(
    trace_id: str = Path(..., pattern=r"^[0-9a-fA-F]{32}$"),
    span_id: str = Path(..., pattern=r"^[0-9a-fA-F]{16}$"),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    path_rows = await clickhouse_client.query(
        f"SELECT {_SUMMARY_COLUMNS} FROM agent_t.tx_summary "
        "WHERE trace_id = {trace_id:String} ORDER BY start_ts ASC",
        {"trace_id": trace_id},
    )
    own = next((r for r in path_rows if r["span_id"] == span_id), None)
    if own is None:
        raise HTTPException(status_code=404, detail="트랜잭션을 찾을 수 없습니다")

    path = await _build_summaries(db, path_rows)
    summary = next(p for p in path if p.span_id == span_id)

    sql_rows = await clickhouse_client.query(
        "SELECT sql_id, cnt, ms, max_ms, fetch_cnt, fetch_ms, err FROM agent_t.tx_sql "
        "WHERE trace_id = {trace_id:String} AND span_id = {span_id:String} ORDER BY ms DESC",
        {"trace_id": trace_id, "span_id": span_id},
    )
    texts = await _dict_texts("dict_sql", [int(r["sql_id"]) for r in sql_rows])
    sql_items = [
        TxSqlOut(
            sql_id=_hex_id(r["sql_id"]),
            sql_text=texts.get(int(r["sql_id"]), ""),
            cnt=r.get("cnt") or 0, ms=r.get("ms") or 0, max_ms=r.get("max_ms") or 0,
            fetch_cnt=r.get("fetch_cnt") or 0, fetch_ms=r.get("fetch_ms") or 0,
            err=r.get("err") or 0,
        )
        for r in sql_rows
    ]

    detail = None
    if summary.has_detail:
        detail_rows = await clickhouse_client.query(
            "SELECT nodes, stacks FROM agent_t.tx_detail "
            "WHERE trace_id = {trace_id:String} AND span_id = {span_id:String} LIMIT 1",
            {"trace_id": trace_id, "span_id": span_id},
        )
        if detail_rows:
            detail = TxDetailBody(
                nodes=_parse_json(detail_rows[0].get("nodes")),
                stacks=_parse_json(detail_rows[0].get("stacks")),
            )
    return TxDetailOut(summary=summary, sql=sql_items, detail=detail, path=path)


@router.get("/scatter", response_model=ScatterOut)
async def get_scatter(
    system_ids: list[int] = Query(..., min_length=1),
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    limit: int = Query(5000, ge=1, le=20000),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    systems = await _load_systems(db, system_ids)
    start_utc, end_utc = _resolve_range(systems, start, end)
    base_where = (
        "system_id IN {system_ids:Array(UInt32)} AND start_ts >= {start:DateTime64(3, 'UTC')} "
        "AND start_ts < {end:DateTime64(3, 'UTC')}"
    )
    params: dict = {"system_ids": system_ids, "start": start_utc, "end": end_utc}
    cols = "start_ts AS ts, elapsed_ms, error, trace_id, span_id, system_id"

    count_rows = await clickhouse_client.query(
        f"SELECT count() AS c FROM agent_t.tx_summary WHERE {base_where}", params
    )
    total = int(count_rows[0]["c"]) if count_rows else 0

    if total <= limit:
        rows = await clickhouse_client.query(
            f"SELECT {cols} FROM agent_t.tx_summary WHERE {base_where} ORDER BY start_ts ASC LIMIT {{limit:UInt32}}",
            {**params, "limit": limit},
        )
        truncated = False
    else:
        # 느린·에러 트랜잭션 우선(절반) + 나머지는 span_id 해시로 균등 샘플링
        half = max(limit // 2, 1)
        modulo = -(-total // max(limit - half, 1))
        priority = await clickhouse_client.query(
            f"SELECT {cols} FROM agent_t.tx_summary WHERE {base_where} "
            "ORDER BY error DESC, elapsed_ms DESC LIMIT {half:UInt32}",
            {**params, "half": half},
        )
        sampled = await clickhouse_client.query(
            f"SELECT {cols} FROM agent_t.tx_summary WHERE {base_where} "
            "AND cityHash64(span_id) % {modulo:UInt32} = 0 LIMIT {limit:UInt32}",
            {**params, "modulo": modulo, "limit": limit},
        )
        merged: dict[tuple, dict] = {}
        for r in priority + sampled:
            merged.setdefault((r["trace_id"], r["span_id"]), r)
        rows = sorted(merged.values(), key=lambda r: r["ts"])[:limit]
        truncated = True

    points = [
        ScatterPoint(
            ts=r["ts"], elapsed_ms=r["elapsed_ms"], error=bool(r["error"]),
            trace_id=r["trace_id"], span_id=r["span_id"], system_id=r["system_id"],
        )
        for r in rows
    ]
    return ScatterOut(points=points, truncated=truncated)


@router.get("/systems/{system_id}/summary", response_model=ApmSystemSummaryOut)
async def get_system_summary(
    system_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    system = (await _load_systems(db, [system_id]))[system_id]
    threshold = system.tx_slow_threshold_ms or 3000
    agent_id = (await db.execute(
        select(AgentInstance.id).where(
            AgentInstance.system_id == system_id,
            AgentInstance.agent_type == "agent_t",
            AgentInstance.status.in_(["running", "installed"]),
        ).limit(1)
    )).scalar_one_or_none()
    if agent_id is None:
        return ApmSystemSummaryOut(has_agent_t=False, slow_threshold_ms=threshold)

    since = _now_utc() - timedelta(hours=1)
    rows = await clickhouse_client.query(
        "SELECT count() AS cnt, avg(elapsed_ms) AS avg_ms, countIf(elapsed_ms >= {slow:UInt32}) AS slow_cnt "
        "FROM agent_t.tx_summary WHERE system_id = {system_id:UInt32} "
        "AND start_ts >= {since:DateTime64(3, 'UTC')}",
        {"slow": threshold, "system_id": system_id, "since": since},
    )
    row = rows[0] if rows else {}
    cnt = int(row.get("cnt") or 0)
    return ApmSystemSummaryOut(
        has_agent_t=True,
        tps_1h=round(cnt / 3600, 3),
        avg_ms_1h=round(float(row.get("avg_ms") or 0), 1),
        slow_count_1h=int(row.get("slow_cnt") or 0),
        slow_threshold_ms=threshold,
    )
