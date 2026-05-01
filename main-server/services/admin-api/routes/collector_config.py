"""
수집기 설정 관리 — /api/v1/collector-config

D4 결정(2026-05-01): system_collector_config 테이블 삭제.
수집기 설정은 agent_instances.label_info에서 on-the-fly로 derive한다.

GET   /api/v1/collector-config     — agent_instances → derive (하위 호환 응답 형식 유지)
POST  /api/v1/collector-config     — 410 Gone (테이블 삭제됨)
PATCH /api/v1/collector-config/{id} — 410 Gone
DELETE /api/v1/collector-config/{id} — 410 Gone
GET   /api/v1/collector-config/templates/{type} — 그대로 유지
"""

import hashlib
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import get_current_user
from database import get_db
from models import AgentInstance, System

router = APIRouter(prefix="/api/v1/collector-config", tags=["collector-config"])


# ── label_info.collectors key → metric_group 매핑 ──────────────────────────────
_SYNAPSE_LABEL_TO_GROUP: dict[str, str] = {
    "cpu":          "cpu",
    "memory":       "memory",
    "disk":         "disk",
    "network":      "network",
    "log_monitor":  "log",
    "web_servers":  "web",
}

_DB_GROUPS: list[str] = ["db_connections", "db_query", "db_cache", "db_replication"]


def _stable_id(system_id: int, collector_type: str, metric_group: str) -> int:
    """PYTHONHASHSEED 불변 결정론적 정수 ID (blake2s 4바이트)"""
    raw = f"{system_id}:{collector_type}:{metric_group}".encode()
    return int.from_bytes(hashlib.blake2s(raw).digest()[:4], "big")


def _derive_collector_configs(agents: list, system_name: str, display_name: str) -> list[dict]:
    """running/installed 상태 agent_instances → 합성 collector_config 행 목록"""
    rows: list[dict] = []
    seen: set[tuple] = set()

    for agent in agents:
        if agent.status not in ("running", "installed"):
            continue

        label_info: dict = {}
        if agent.label_info:
            try:
                label_info = json.loads(agent.label_info)
            except Exception:
                pass

        if agent.agent_type == "synapse_agent":
            collectors_cfg = label_info.get("collectors", {})
            for label_key, group in _SYNAPSE_LABEL_TO_GROUP.items():
                # enabled if explicitly True, or key absent (default-on)
                enabled = bool(collectors_cfg.get(label_key, True))
                key = (agent.system_id, "synapse_agent", group)
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    "id":             _stable_id(agent.system_id, "synapse_agent", group),
                    "system_id":      agent.system_id,
                    "system_name":    system_name,
                    "display_name":   display_name,
                    "collector_type": "synapse_agent",
                    "metric_group":   group,
                    "enabled":        enabled,
                    "prometheus_job": None,
                    "custom_config":  None,
                    "created_at":     None,
                    "updated_at":     None,
                })

        elif agent.agent_type == "db":
            for group in _DB_GROUPS:
                key = (agent.system_id, "db_exporter", group)
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    "id":             _stable_id(agent.system_id, "db_exporter", group),
                    "system_id":      agent.system_id,
                    "system_name":    system_name,
                    "display_name":   display_name,
                    "collector_type": "db_exporter",
                    "metric_group":   group,
                    "enabled":        True,
                    "prometheus_job": None,
                    "custom_config":  None,
                    "created_at":     None,
                    "updated_at":     None,
                })

    return rows


# ── collector_type별 기본 metric_group 템플릿 ──────────────────────────────────
_TEMPLATES: dict[str, list[dict]] = {
    "db_exporter": [
        {"metric_group": "db_connections", "description": "Active/idle/max connections, connection_pct"},
        {"metric_group": "db_query",       "description": "TPS, slow_query_count, avg_query_ms"},
        {"metric_group": "db_cache",       "description": "Cache hit rate %"},
        {"metric_group": "db_replication", "description": "Replication lag seconds"},
    ],
    "synapse_agent": [
        {"metric_group": "cpu",     "description": "CPU avg/max/p95%, load avg 1/5m"},
        {"metric_group": "memory",  "description": "Memory used%, p95%"},
        {"metric_group": "disk",    "description": "Disk read/write MB, I/O time ms"},
        {"metric_group": "network", "description": "Network rx/tx MB"},
        {"metric_group": "log",     "description": "Log error count (total/ERROR level)"},
        {"metric_group": "web",     "description": "HTTP requests total, slow count, avg response ms"},
    ],
    "custom": [
        {"metric_group": "custom", "description": "custom_config JSON으로 직접 정의"},
    ],
}


# ── GET ────────────────────────────────────────────────────────────────────────

@router.get("")
async def list_collector_configs(
    system_id: Optional[int] = None,
    collector_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """agent_instances에서 derive된 수집기 설정 목록 반환 (하위 호환 응답 형식 유지)"""
    # 에이전트 조회
    agent_q = select(AgentInstance)
    if system_id is not None:
        agent_q = agent_q.where(AgentInstance.system_id == system_id)
    if collector_type is not None:
        if collector_type == "synapse_agent":
            agent_q = agent_q.where(AgentInstance.agent_type == "synapse_agent")
        elif collector_type == "db_exporter":
            agent_q = agent_q.where(AgentInstance.agent_type == "db")

    agents_result = await db.execute(agent_q)
    agents = agents_result.scalars().all()

    # system_id → (system_name, display_name) 맵
    system_ids = list({a.system_id for a in agents})
    sys_map: dict[int, tuple[str, str]] = {}
    if system_ids:
        sys_result = await db.execute(
            select(System.id, System.system_name, System.display_name)
            .where(System.id.in_(system_ids))
        )
        for sid, sn, dn in sys_result.all():
            sys_map[sid] = (sn or "", dn or "")

    all_rows: list[dict] = []
    # system_id 별로 그룹화하여 derive 호출
    from collections import defaultdict
    agents_by_sys: dict[int, list] = defaultdict(list)
    for a in agents:
        agents_by_sys[a.system_id].append(a)

    for sid, sys_agents in agents_by_sys.items():
        sn, dn = sys_map.get(sid, ("", ""))
        rows = _derive_collector_configs(sys_agents, sn, dn)
        if collector_type is not None:
            rows = [r for r in rows if r["collector_type"] == collector_type]
        all_rows.extend(rows)

    # system_id, collector_type 기준 정렬 (하위 호환)
    all_rows.sort(key=lambda r: (r["system_id"], r["collector_type"]))
    return all_rows


# ── POST / PATCH / DELETE → 410 Gone ──────────────────────────────────────────

_GONE_DETAIL = (
    "system_collector_config 테이블이 삭제되었습니다(D4 결정, 2026-05-01). "
    "수집기 설정은 agent_instances.label_info에서 자동으로 derive됩니다."
)


@router.post("", status_code=410)
async def create_collector_config(_user=Depends(get_current_user)):
    raise HTTPException(status_code=410, detail=_GONE_DETAIL)


@router.patch("/{config_id}", status_code=410)
async def update_collector_config(config_id: int, _user=Depends(get_current_user)):
    raise HTTPException(status_code=410, detail=_GONE_DETAIL)


@router.delete("/{config_id}", status_code=410)
async def delete_collector_config(config_id: int, _user=Depends(get_current_user)):
    raise HTTPException(status_code=410, detail=_GONE_DETAIL)


# ── 템플릿 ────────────────────────────────────────────────────────────────────

@router.get("/templates/{collector_type}")
async def get_collector_template(collector_type: str):
    """
    collector_type별 지원 metric_group 목록 반환.
    """
    template = _TEMPLATES.get(collector_type)
    if not template:
        raise HTTPException(
            status_code=404,
            detail=f"알 수 없는 collector_type: {collector_type}. 지원: {list(_TEMPLATES.keys())}",
        )
    return {"collector_type": collector_type, "metric_groups": template}
