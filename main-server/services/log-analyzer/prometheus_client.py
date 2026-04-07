"""
Prometheus 클라이언트 — PromQL 쿼리 + 메트릭 스냅샷

aggregation_processor.py에서 공통 로직을 추출.
analyzer.py에서 LLM 프롬프트 강화에도 사용.
"""

import asyncio
import logging
import os

import httpx

logger = logging.getLogger(__name__)

PROMETHEUS_URL = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
ADMIN_API_URL  = os.getenv("ADMIN_API_URL",  "http://admin-api:8080")

# ── PromQL 매핑 ──────────────────────────────────────────────────────────────
# (collector_type, metric_group) → {metric_name: promql_template}
# {sn} 자리표시자는 실행 시 system_name으로 치환됨
PROMQL_MAP: dict[str, dict[str, dict[str, str]]] = {
    "node_exporter": {
        "cpu": {
            "cpu_avg": 'avg_over_time(node_cpu_usage_percent{{system_name="{sn}"}}[1h])',
            "cpu_max": 'max_over_time(node_cpu_usage_percent{{system_name="{sn}"}}[1h])',
            "cpu_min": 'min_over_time(node_cpu_usage_percent{{system_name="{sn}"}}[1h])',
            "cpu_p95": 'quantile_over_time(0.95, node_cpu_usage_percent{{system_name="{sn}"}}[1h])',
            "iowait":  'avg_over_time(node_cpu_iowait_percent{{system_name="{sn}"}}[1h])',
        },
        "memory": {
            "mem_used_pct": 'avg_over_time(node_memory_used_percent{{system_name="{sn}"}}[1h])',
            "mem_p95":      'quantile_over_time(0.95, node_memory_used_percent{{system_name="{sn}"}}[1h])',
            "mem_avail_gb": 'min_over_time(node_memory_available_bytes{{system_name="{sn}"}}[1h]) / 1073741824',
        },
        "disk": {
            "disk_util_pct":   'avg_over_time(node_disk_utilization_percent{{system_name="{sn}"}}[1h])',
            "disk_read_iops":  'avg_over_time(node_disk_reads_completed_total{{system_name="{sn}"}}[1h])',
            "disk_write_iops": 'avg_over_time(node_disk_writes_completed_total{{system_name="{sn}"}}[1h])',
        },
        "network": {
            "net_rx_mb": 'avg_over_time(rate(node_network_receive_bytes_total{{system_name="{sn}"}}[5m])[1h:5m]) / 1048576',
            "net_tx_mb": 'avg_over_time(rate(node_network_transmit_bytes_total{{system_name="{sn}"}}[5m])[1h:5m]) / 1048576',
        },
        "system": {
            "load1":  'avg_over_time(node_load1{{system_name="{sn}"}}[1h])',
            "load5":  'avg_over_time(node_load5{{system_name="{sn}"}}[1h])',
            "load15": 'avg_over_time(node_load15{{system_name="{sn}"}}[1h])',
        },
        # CPU 급증 원인 추적 — 프로세스별 CPU/메모리 Top5
        # node_exporter --collector.processes 활성화 필요
        "process": {
            "top_cpu_process": (
                'topk(5, sum by (groupname)'
                '(rate(namedprocess_namegroup_cpu_seconds_total{{system_name="{sn}",mode="user"}}[5m]))) * 100'
            ),
            "top_mem_process": (
                'topk(5, namedprocess_namegroup_memory_bytes{{system_name="{sn}",memtype="resident"}})'
            ),
        },
    },
    "jmx_exporter": {
        "jvm_heap": {
            "heap_used_pct": 'avg_over_time(jvm_heap_used_percent{{system_name="{sn}"}}[1h])',
            "heap_p95":      'quantile_over_time(0.95, jvm_heap_used_percent{{system_name="{sn}"}}[1h])',
            "gc_time_pct":   'avg_over_time(jvm_gc_time_percent{{system_name="{sn}"}}[1h])',
        },
        "thread_pool": {
            "thread_active":   'avg_over_time(jvm_threads_active{{system_name="{sn}"}}[1h])',
            "thread_max":      'max_over_time(jvm_threads_active{{system_name="{sn}"}}[1h])',
            "rejection_count": 'sum_over_time(jvm_thread_pool_rejections_total{{system_name="{sn}"}}[1h])',
        },
        "request": {
            "req_tps":        'avg_over_time(jvm_requests_per_second{{system_name="{sn}"}}[1h])',
            "req_error_rate": 'avg_over_time(jvm_request_error_rate{{system_name="{sn}"}}[1h])',
            "resp_p95_ms":    'quantile_over_time(0.95, jvm_response_time_ms{{system_name="{sn}"}}[1h])',
        },
        "connection_pool": {
            "conn_active": 'avg_over_time(jvm_connection_pool_active{{system_name="{sn}"}}[1h])',
            "conn_wait":   'max_over_time(jvm_connection_pool_waiting{{system_name="{sn}"}}[1h])',
        },
        # GC 상세 — CPU 급증 원인 추적 (Young/Old GC 소요시간 및 횟수)
        "gc_detail": {
            "gc_young_ms": (
                'rate(jvm_gc_collection_seconds_total{{system_name="{sn}",gc=~".*Young.*"}}[5m]) * 1000'
            ),
            "gc_old_ms": (
                'rate(jvm_gc_collection_seconds_total{{system_name="{sn}",gc=~".*Old.*"}}[5m]) * 1000'
            ),
            "gc_young_count": (
                'rate(jvm_gc_collection_seconds_count{{system_name="{sn}",gc=~".*Young.*"}}[5m])'
            ),
        },
    },
    "db_exporter": {
        "db_connections": {
            "conn_active_pct": 'avg_over_time(db_connections_active_percent{{system_name="{sn}"}}[1h])',
            "conn_max":        'max_over_time(db_connections_active{{system_name="{sn}"}}[1h])',
        },
        "db_query": {
            "tps":          'avg_over_time(db_transactions_per_second{{system_name="{sn}"}}[1h])',
            "slow_queries": 'sum_over_time(db_slow_queries_total{{system_name="{sn}"}}[1h])',
        },
        "db_cache": {
            "cache_hit_rate": 'avg_over_time(db_cache_hit_rate_percent{{system_name="{sn}"}}[1h])',
        },
        "db_replication": {
            "repl_lag_sec": 'max_over_time(db_replication_lag_seconds{{system_name="{sn}"}}[1h])',
        },
    },
}


async def query_prometheus(client: httpx.AsyncClient, promql: str) -> float | None:
    """
    Prometheus /api/v1/query 단건 호출.
    결과의 첫 번째 value를 float으로 반환. 데이터 없으면 None.
    """
    try:
        resp = await client.get(
            f"{PROMETHEUS_URL}/api/v1/query",
            params={"query": promql},
            timeout=10.0,
        )
        resp.raise_for_status()
        data = resp.json()
        results = data.get("data", {}).get("result", [])
        if not results:
            return None
        val = results[0].get("value", [None, None])[1]
        if val is None:
            return None
        return round(float(val), 2)
    except Exception as exc:
        logger.debug("Prometheus 쿼리 실패: %s — %s", promql[:80], exc)
        return None


async def get_metric_snapshot(
    system_name: str,
    system_id: int,
) -> dict[str, dict[str, float]]:
    """
    시스템의 활성 collector_config를 admin-api에서 조회한 뒤
    각 (collector_type, metric_group)의 현재 메트릭을 Prometheus instant query로 수집.

    반환: {"node_exporter/cpu": {"cpu_avg": 72.3, ...}, ...}
    활성 수집기가 없거나 조회 실패 시 빈 dict 반환.
    """
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{ADMIN_API_URL}/api/v1/collector-config",
                params={"system_id": system_id},
            )
            resp.raise_for_status()
            configs = resp.json()
    except Exception as exc:
        logger.debug("collector-config 조회 실패 (system_id=%s): %s", system_id, exc)
        return {}

    enabled_configs = [c for c in configs if c.get("enabled", False)]
    if not enabled_configs:
        return {}

    snapshot: dict[str, dict[str, float]] = {}

    async with httpx.AsyncClient(timeout=10.0) as client:

        async def _fetch_group(collector_type: str, metric_group: str) -> None:
            group_map = PROMQL_MAP.get(collector_type, {}).get(metric_group)
            if not group_map:
                return
            tasks = {
                name: query_prometheus(client, pql.format(sn=system_name))
                for name, pql in group_map.items()
            }
            results = await asyncio.gather(*tasks.values(), return_exceptions=True)
            values: dict[str, float] = {}
            for name, val in zip(tasks.keys(), results):
                if isinstance(val, float):
                    values[name] = val
            if values:
                key = f"{collector_type}/{metric_group}"
                snapshot[key] = values

        # 중복 (collector_type, metric_group) 제거
        seen: set[tuple[str, str]] = set()
        fetch_tasks = []
        for cfg in enabled_configs:
            ct = cfg["collector_type"]
            mg = cfg["metric_group"]
            if (ct, mg) not in seen:
                seen.add((ct, mg))
                fetch_tasks.append(_fetch_group(ct, mg))

        await asyncio.gather(*fetch_tasks)

    return snapshot


def format_metric_context(snapshot: dict[str, dict[str, float]]) -> str:
    """메트릭 스냅샷을 LLM 프롬프트용 텍스트로 변환"""
    if not snapshot:
        return ""
    lines = ["[로그 발생 시점 시스템 메트릭]"]
    for key, metrics in snapshot.items():
        lines.append(f"■ {key}")
        for name, val in metrics.items():
            lines.append(f"  {name}: {val}")
    return "\n".join(lines)
