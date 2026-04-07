"""
수집기 설정 관리 — /api/v1/collector-config

시스템별로 어떤 exporter(node_exporter, jmx_exporter 등)의
어떤 metric_group을 집계할지 등록/조회/수정/삭제.
WF6(1시간 집계)이 이 테이블을 참조하여 Prometheus 쿼리를 동적으로 생성한다.
"""

import json
import os
import textwrap
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import System, SystemCollectorConfig
from schemas import (
    CollectorConfigCreate,
    CollectorConfigOut,
    CollectorConfigUpdate,
    CollectorStatusOut,
    DownloadOption,
    InstallGuideOut,
    RequiredFile,
)

router = APIRouter(prefix="/api/v1/collector-config", tags=["collector-config"])

# ── 환경변수 ─────────────────────────────────────────────────────────────────
_PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
_MONITORING_SERVER_IP = os.getenv("MONITORING_SERVER_IP", "")
_INSTALL_SCRIPT_PATH = os.getenv("INSTALL_SCRIPT_PATH", "/app/install-agents.sh")

# ── 타입별 exporter 기본 포트 ────────────────────────────────────────────────
_EXPORTER_DEFAULT_PORTS: dict[str, int] = {
    "node_exporter": 9100,
    "jmx_exporter": 9404,
    "alloy": 12345,
    "db_exporter": 9187,
}

# ── 바이너리 다운로드 옵션 ─────────────────────────────────────────────────────
_NODE_EXPORTER_FILES = [
    RequiredFile(
        filename="node_exporter-1.10.2.linux-amd64.tar.gz",
        description="Node Exporter 바이너리 (Linux amd64)",
        download_options=[
            DownloadOption(
                label="Linux amd64 (RHEL 8.9)",
                filename="node_exporter-1.10.2.linux-amd64.tar.gz",
                download_url="https://github.com/prometheus/node_exporter/releases/download/v1.10.2/node_exporter-1.10.2.linux-amd64.tar.gz",
            )
        ],
    )
]

_JMX_EXPORTER_FILES = [
    RequiredFile(
        filename="jmx_prometheus_javaagent.jar",
        description="JMX Prometheus JavaAgent (Java 버전에 맞게 선택)",
        download_options=[
            DownloadOption(
                label="Java 17+",
                filename="jmx_prometheus_javaagent-1.0.1.jar",
                download_url="https://github.com/prometheus/jmx_exporter/releases/download/1.0.1/jmx_prometheus_javaagent-1.0.1.jar",
            ),
            DownloadOption(
                label="Java 11",
                filename="jmx_prometheus_javaagent-0.20.0.jar",
                download_url="https://github.com/prometheus/jmx_exporter/releases/download/0.20.0/jmx_prometheus_javaagent-0.20.0.jar",
            ),
            DownloadOption(
                label="Java 8",
                filename="jmx_prometheus_javaagent-0.15.0.jar",
                download_url="https://github.com/prometheus/jmx_exporter/releases/download/0.15.0/jmx_prometheus_javaagent-0.15.0.jar",
                note="Java 8 마지막 지원 버전",
            ),
        ],
    )
]

_ALLOY_FILES = [
    RequiredFile(
        filename="alloy-linux-amd64.zip",
        description="Grafana Alloy 바이너리 (Linux amd64)",
        download_options=[
            DownloadOption(
                label="Linux amd64",
                filename="alloy-linux-amd64.zip",
                download_url="https://github.com/grafana/alloy/releases/download/v1.7.1/alloy-linux-amd64.zip",
            )
        ],
    )
]


# collector_type별 기본 metric_group 템플릿
_TEMPLATES: dict[str, list[dict]] = {
    "node_exporter": [
        {"metric_group": "cpu",     "description": "CPU avg/max/min/p95, iowait%, steal%"},
        {"metric_group": "memory",  "description": "Memory used%, available_gb, cached_gb"},
        {"metric_group": "disk",    "description": "Disk read/write IOPS, throughput, utilization%, await_ms"},
        {"metric_group": "network", "description": "Network rx/tx MB, errors, drops"},
        {"metric_group": "system",  "description": "Load avg 1/5/15m, context_switches"},
        {"metric_group": "process", "description": "프로세스별 CPU/메모리 Top5 (--collector.processes 활성화 필요, CPU 급증 원인 추적용)"},
    ],
    "jmx_exporter": [
        {"metric_group": "jvm_heap",       "description": "JVM Heap used/max MB, GC time%, GC count"},
        {"metric_group": "thread_pool",    "description": "Thread pool active/max, queue_size, rejection_count"},
        {"metric_group": "request",        "description": "TPS, error_rate%, avg/p95/p99 response_ms"},
        {"metric_group": "connection_pool","description": "Connection pool active/max, wait_count, avg_wait_ms"},
        {"metric_group": "gc_detail",      "description": "Young/Old GC 소요시간 및 횟수 상세 (CPU 급증 원인 추적용)"},
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


@router.get("/install-script")
async def download_install_script():
    """install-agents.sh 파일 다운로드"""
    script_path = Path(_INSTALL_SCRIPT_PATH)
    if not script_path.exists():
        raise HTTPException(status_code=404, detail="install-agents.sh 파일을 찾을 수 없습니다.")
    return FileResponse(
        path=str(script_path),
        filename="install-agents.sh",
        media_type="application/x-sh",
        headers={"Content-Disposition": "attachment; filename=install-agents.sh"},
    )


@router.get("/{config_id}/install-guide", response_model=InstallGuideOut)
async def get_install_guide(
    config_id: int,
    db: AsyncSession = Depends(get_db),
):
    """수집기 설치 가이드 — install-agents.sh 실행 명령어 + 바이너리 목록 + Prometheus 스니펫 반환"""
    result = await db.execute(
        select(SystemCollectorConfig, System)
        .join(System, SystemCollectorConfig.system_id == System.id)
        .where(SystemCollectorConfig.id == config_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="수집기 설정을 찾을 수 없습니다.")

    config, system = row

    custom = json.loads(config.custom_config) if config.custom_config else {}
    instance_role = custom.get("instance_role", "was1")
    exporter_port = custom.get("exporter_port", _EXPORTER_DEFAULT_PORTS.get(config.collector_type, 9100))
    java_version = custom.get("java_version", 17)
    jeus_log_base = custom.get("jeus_log_base", "/apps/logs")

    # install-agents.sh --type 매핑
    type_map = {"node_exporter": "node", "jmx_exporter": "jmx", "alloy": "alloy", "db_exporter": "node"}
    install_type = type_map.get(config.collector_type, "node")

    monitoring_server = _MONITORING_SERVER_IP or "<monitoring-server-ip>"

    cmd_parts = [
        "./install-agents.sh",
        f"  --system-name {system.system_name}",
        f"  --instance-role {instance_role}",
        f"  --host {system.host}",
        f"  --monitoring-server {monitoring_server}",
        f"  --install-dir /opt/aoms-agents",
        f"  --type {install_type}",
    ]
    if config.collector_type == "alloy":
        cmd_parts.append(f"  --jeus-log-base {jeus_log_base}")
    if config.collector_type == "jmx_exporter":
        cmd_parts.append(f"  --jmx-port {exporter_port}")

    install_command = " \\\n".join(cmd_parts)

    # 필요 파일 목록
    if config.collector_type == "node_exporter":
        required_files = _NODE_EXPORTER_FILES
    elif config.collector_type == "jmx_exporter":
        required_files = _JMX_EXPORTER_FILES
    elif config.collector_type == "alloy":
        required_files = _ALLOY_FILES
    else:
        required_files = []

    # JMX java_version별 jar 파일명
    jvm_args: str | None = None
    if config.collector_type == "jmx_exporter":
        if java_version >= 17:
            jar = "jmx_prometheus_javaagent-1.0.1.jar"
        elif java_version >= 11:
            jar = "jmx_prometheus_javaagent-0.20.0.jar"
        else:
            jar = "jmx_prometheus_javaagent-0.15.0.jar"
        jvm_args = (
            f"-javaagent:/opt/aoms-agents/jmx_exporter/{jar}"
            f"={exporter_port}:/opt/aoms-agents/jmx_exporter/jmx-config.yml"
        )

    # Prometheus scrape snippet
    job_name = config.prometheus_job or f"{config.collector_type}-{system.system_name}"
    scrape_snippet = textwrap.dedent(f"""\
        - job_name: "{job_name}"
          static_configs:
            - targets: ["{system.host}:{exporter_port}"]
          relabel_configs:
            - target_label: system_name
              replacement: "{system.system_name}"
            - target_label: instance_role
              replacement: "{instance_role}"
    """)

    return InstallGuideOut(
        collector_type=config.collector_type,
        system_name=system.system_name,
        host=system.host,
        install_command=install_command,
        required_files=required_files,
        prometheus_scrape_snippet=scrape_snippet,
        jvm_args=jvm_args,
    )


@router.get("/{config_id}/status", response_model=CollectorStatusOut)
async def get_collector_status(
    config_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Prometheus에서 수집기 up 메트릭 조회 — up/down/unknown 반환"""
    result = await db.execute(
        select(SystemCollectorConfig, System)
        .join(System, SystemCollectorConfig.system_id == System.id)
        .where(SystemCollectorConfig.id == config_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="수집기 설정을 찾을 수 없습니다.")

    config, system = row

    custom = json.loads(config.custom_config) if config.custom_config else {}
    exporter_port = custom.get("exporter_port", _EXPORTER_DEFAULT_PORTS.get(config.collector_type, 9100))
    job_name = config.prometheus_job or f"{config.collector_type}-{system.system_name}"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{_PROMETHEUS_URL}/api/v1/query",
                params={"query": f'up{{job="{job_name}",instance=~"{system.host}:{exporter_port}.*"}}'},
            )
        data = resp.json()
        results = data.get("data", {}).get("result", [])
        if not results:
            # job 이름으로 재시도 (instance 필터 없이)
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp2 = await client.get(
                    f"{_PROMETHEUS_URL}/api/v1/query",
                    params={"query": f'up{{job="{job_name}"}}'},
                )
            data2 = resp2.json()
            results = data2.get("data", {}).get("result", [])

        if not results:
            return CollectorStatusOut(status="unknown")

        value = results[0]["value"][1]  # "1" or "0"
        status = "up" if value == "1" else "down"
        return CollectorStatusOut(status=status)
    except Exception:
        return CollectorStatusOut(status="unknown")


# ── Prometheus HTTP SD 타겟 엔드포인트 (인증 없음 — 내부 네트워크 전용) ──────────
prometheus_router = APIRouter(prefix="/api/v1/prometheus", tags=["prometheus"])


@prometheus_router.get("/targets")
async def get_prometheus_targets(db: AsyncSession = Depends(get_db)):
    """
    Prometheus HTTP SD 표준 JSON 반환.
    enabled=True인 수집기 설정을 system.host + exporter_port로 타겟 목록 생성.
    prometheus.yml http_sd_configs에서 1분 주기로 폴링.
    """
    result = await db.execute(
        select(SystemCollectorConfig, System)
        .join(System, SystemCollectorConfig.system_id == System.id)
        .where(SystemCollectorConfig.enabled == True)  # noqa: E712
        .order_by(SystemCollectorConfig.system_id, SystemCollectorConfig.collector_type)
    )
    rows = result.all()

    # 같은 (system, collector_type)은 하나의 타겟으로 합침
    # (metric_group이 여러 개여도 exporter 포트는 동일)
    seen: set[tuple] = set()
    targets = []

    for config, system in rows:
        custom = json.loads(config.custom_config) if config.custom_config else {}
        instance_role = custom.get("instance_role", "")
        exporter_port = custom.get("exporter_port", _EXPORTER_DEFAULT_PORTS.get(config.collector_type, 9100))
        job_name = config.prometheus_job or f"{config.collector_type}-{system.system_name}"

        key = (system.host, exporter_port, job_name)
        if key in seen:
            continue
        seen.add(key)

        targets.append({
            "targets": [f"{system.host}:{exporter_port}"],
            "labels": {
                "job": job_name,
                "system_name": system.system_name,
                **({"instance_role": instance_role} if instance_role else {}),
            },
        })

    return targets
