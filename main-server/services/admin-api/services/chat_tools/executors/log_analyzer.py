"""log-analyzer HTTP 프록시 executor.

기본 URL 우선순위: executor_config.base_url > env LOG_ANALYZER_URL > None.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import LogAnalysisHistory, System
from services.chat_tools.executor_config import load_executor_config


async def _base_url(db: AsyncSession) -> str | None:
    config = await load_executor_config(db, "log_analyzer")
    return (config.get("base_url") or os.getenv("LOG_ANALYZER_URL") or "").rstrip("/") or None


async def _recent_analyses(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    since_hours = int(args.get("since_hours", 24))
    limit = min(int(args.get("limit", 10)), 50)
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=since_hours)

    conds = [LogAnalysisHistory.created_at >= since]
    if args.get("system_id"):
        conds.append(LogAnalysisHistory.system_id == int(args["system_id"]))

    stmt = (
        select(LogAnalysisHistory)
        .where(and_(*conds))
        .order_by(LogAnalysisHistory.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "analyses": [
            {
                "id": r.id,
                "system_id": r.system_id,
                "instance_role": r.instance_role,
                "severity": r.severity,
                "analysis_result": (r.analysis_result or "")[:500],
                "root_cause": r.root_cause,
                "recommendation": r.recommendation,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "error_message": r.error_message,
            }
            for r in rows
        ],
        "count": len(rows),
    }


async def _log_error_rate(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    """log-analyzer HTTP 호출 기반 에러율 요약 (엔드포인트 가용 시)."""
    base = await _base_url(db)
    if not base:
        return {"error": "log-analyzer URL이 구성되지 않았습니다."}

    system_name = args.get("system_name")
    if not system_name:
        return {"error": "system_name 필요"}
    minutes = int(args.get("minutes", 60))

    # 우선 admin-api DB에서 system 존재 확인 (선택)
    sys_row = (
        await db.execute(select(System).where(System.system_name == system_name))
    ).scalar_one_or_none()
    if sys_row is None:
        return {"error": f"시스템을 찾을 수 없습니다: {system_name}"}

    # log-analyzer /analyze/recent 스타일(엔드포인트가 실제 존재하지 않을 수 있음)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{base}/analyze/summary",
                params={"system_name": system_name, "minutes": minutes},
            )
            if resp.status_code >= 400:
                return {
                    "error": f"log-analyzer {resp.status_code}: {resp.text[:150]}",
                    "system_name": system_name,
                    "minutes": minutes,
                }
            return {"system_name": system_name, "minutes": minutes, "result": resp.json()}
    except Exception as e:  # noqa: BLE001
        return {"error": f"log-analyzer 호출 실패: {str(e)[:200]}"}


async def execute(db: AsyncSession, name: str, args: dict[str, Any]) -> dict[str, Any]:
    try:
        if name == "log_analyzer_recent_analyses":
            return await _recent_analyses(db, args)
        if name == "log_analyzer_log_error_rate":
            return await _log_error_rate(db, args)
        return {"error": f"unknown log_analyzer tool: {name}"}
    except Exception as e:  # noqa: BLE001
        return {"error": f"log_analyzer 도구 실패: {str(e)[:200]}"}
