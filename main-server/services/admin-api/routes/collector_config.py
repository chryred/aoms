"""
수집기 설정 관리 — /api/v1/collector-config

시스템별로 어떤 exporter(node_exporter, jmx_exporter 등)의
어떤 metric_group을 집계할지 등록/조회/수정/삭제.
WF6(1시간 집계)이 이 테이블을 참조하여 Prometheus 쿼리를 동적으로 생성한다.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import SystemCollectorConfig
from schemas import CollectorConfigCreate, CollectorConfigOut, CollectorConfigUpdate

router = APIRouter(prefix="/api/v1/collector-config", tags=["collector-config"])


# collector_type별 기본 metric_group 템플릿
_TEMPLATES: dict[str, list[dict]] = {
    "node_exporter": [
        {"metric_group": "cpu",     "description": "CPU avg/max/min/p95, iowait%, steal%"},
        {"metric_group": "memory",  "description": "Memory used%, available_gb, cached_gb"},
        {"metric_group": "disk",    "description": "Disk read/write IOPS, throughput, utilization%, await_ms"},
        {"metric_group": "network", "description": "Network rx/tx MB, errors, drops"},
        {"metric_group": "system",  "description": "Load avg 1/5/15m, context_switches"},
    ],
    "jmx_exporter": [
        {"metric_group": "jvm_heap",       "description": "JVM Heap used/max MB, GC time%, GC count"},
        {"metric_group": "thread_pool",    "description": "Thread pool active/max, queue_size, rejection_count"},
        {"metric_group": "request",        "description": "TPS, error_rate%, avg/p95/p99 response_ms"},
        {"metric_group": "connection_pool","description": "Connection pool active/max, wait_count, avg_wait_ms"},
    ],
    "db_exporter": [
        {"metric_group": "db_connections", "description": "Active/idle/max connections, connection_pct"},
        {"metric_group": "db_query",       "description": "TPS, slow_query_count, avg_query_ms"},
        {"metric_group": "db_cache",       "description": "Cache hit rate %"},
        {"metric_group": "db_replication", "description": "Replication lag seconds"},
    ],
    "custom": [
        {"metric_group": "custom", "description": "custom_config JSON으로 직접 정의"},
    ],
}


@router.get("")
async def list_collector_configs(
    system_id: Optional[int] = None,
    collector_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """시스템별 수집기 설정 목록 조회"""
    stmt = select(SystemCollectorConfig)
    if system_id is not None:
        stmt = stmt.where(SystemCollectorConfig.system_id == system_id)
    if collector_type:
        stmt = stmt.where(SystemCollectorConfig.collector_type == collector_type)
    result = await db.execute(stmt.order_by(SystemCollectorConfig.system_id, SystemCollectorConfig.collector_type))
    configs = result.scalars().all()
    return [CollectorConfigOut.model_validate(c) for c in configs]


@router.post("", status_code=201)
async def create_collector_config(
    body: CollectorConfigCreate,
    db: AsyncSession = Depends(get_db),
):
    """수집기 설정 등록"""
    config = SystemCollectorConfig(**body.model_dump())
    db.add(config)
    await db.commit()
    await db.refresh(config)
    return CollectorConfigOut.model_validate(config)


@router.patch("/{config_id}")
async def update_collector_config(
    config_id: int,
    body: CollectorConfigUpdate,
    db: AsyncSession = Depends(get_db),
):
    """수집기 설정 수정 (활성화/비활성화 등)"""
    result = await db.execute(
        select(SystemCollectorConfig).where(SystemCollectorConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="수집기 설정을 찾을 수 없습니다.")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(config, field, value)
    await db.commit()
    await db.refresh(config)
    return CollectorConfigOut.model_validate(config)


@router.delete("/{config_id}", status_code=200)
async def delete_collector_config(
    config_id: int,
    db: AsyncSession = Depends(get_db),
):
    """수집기 설정 삭제"""
    result = await db.execute(
        select(SystemCollectorConfig).where(SystemCollectorConfig.id == config_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="수집기 설정을 찾을 수 없습니다.")
    await db.delete(config)
    await db.commit()
    return {"deleted": True, "id": config_id}


@router.get("/templates/{collector_type}")
async def get_collector_template(collector_type: str):
    """
    collector_type별 지원 metric_group 목록 반환.
    WF6 초기 설정 및 UI 등록 폼에서 활용.
    """
    template = _TEMPLATES.get(collector_type)
    if not template:
        raise HTTPException(
            status_code=404,
            detail=f"알 수 없는 collector_type: {collector_type}. 지원: {list(_TEMPLATES.keys())}",
        )
    return {"collector_type": collector_type, "metric_groups": template}
