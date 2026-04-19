"""admin-api 내부 도구 executor — systems/alert_history/contacts 조회."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models import AlertHistory, Contact, System, SystemContact


async def _list_systems(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    stmt = select(System)
    if args.get("system_type"):
        stmt = stmt.where(System.system_type == args["system_type"])
    if args.get("status"):
        stmt = stmt.where(System.status == args["status"])
    rows = (await db.execute(stmt.order_by(System.id))).scalars().all()
    return {
        "systems": [
            {
                "id": s.id,
                "system_name": s.system_name,
                "display_name": s.display_name,
                "system_type": s.system_type,
                "status": s.status,
                "host": s.host,
            }
            for s in rows
        ],
        "count": len(rows),
    }


async def _search_alert_history(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    since_hours = int(args.get("since_hours", 24))
    limit = min(int(args.get("limit", 20)), 100)
    since = datetime.utcnow() - timedelta(hours=since_hours)

    conds = [AlertHistory.created_at >= since]
    if args.get("system_id"):
        conds.append(AlertHistory.system_id == int(args["system_id"]))
    if args.get("severity"):
        conds.append(AlertHistory.severity == args["severity"])

    stmt = (
        select(AlertHistory)
        .where(and_(*conds))
        .order_by(AlertHistory.created_at.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "alerts": [
            {
                "id": a.id,
                "system_id": a.system_id,
                "alertname": a.alertname,
                "title": a.title,
                "severity": a.severity,
                "instance_role": a.instance_role,
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
                "alert_type": a.alert_type,
                "acknowledged": a.acknowledged,
            }
            for a in rows
        ],
        "count": len(rows),
        "since_hours": since_hours,
    }


async def _list_contacts(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    if args.get("system_id"):
        sid = int(args["system_id"])
        stmt = (
            select(Contact)
            .join(SystemContact, SystemContact.contact_id == Contact.id)
            .where(SystemContact.system_id == sid)
            .order_by(Contact.id)
        )
    else:
        stmt = select(Contact).order_by(Contact.id)
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "contacts": [
            {
                "id": c.id,
                "name": c.name,
                "email": c.email,
                "teams_upn": c.teams_upn,
            }
            for c in rows
        ],
        "count": len(rows),
    }


async def execute(db: AsyncSession, name: str, args: dict[str, Any]) -> dict[str, Any]:
    try:
        if name == "admin_list_systems":
            return await _list_systems(db, args)
        if name == "admin_search_alert_history":
            return await _search_alert_history(db, args)
        if name == "admin_list_contacts":
            return await _list_contacts(db, args)
        return {"error": f"unknown admin tool: {name}"}
    except Exception as e:  # noqa: BLE001
        return {"error": f"admin 도구 실패: {str(e)[:200]}"}
