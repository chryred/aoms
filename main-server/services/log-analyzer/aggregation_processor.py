"""
Synapse Phase 5 — 집계 처리기 (WF6~WF11 이관)

n8n WF6~WF11의 처리 로직을 Python asyncio 병렬 처리로 이관.
각 run_* 함수가 admin-api + Prometheus + LLM + Teams를 직접 호출.
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone, timedelta

_KST = timezone(timedelta(hours=9))  # 집계 버킷 경계 기준 타임존


def _dt_naive(dt: datetime) -> str:
    """admin-api는 timezone-naive datetime을 기대하므로 UTC offset 제거 후 isoformat 반환"""
    return dt.replace(tzinfo=None).isoformat()

import httpx

import aggregation_vector_client
import vector_client
from prompts import (
    build_hourly_agg_prompt,
    build_daily_agg_prompt,
    build_weekly_agg_prompt,
    build_monthly_agg_prompt,
    build_longperiod_agg_prompt,
    build_trend_alert_prompt,
)

logger = logging.getLogger(__name__)

# ── 환경변수 ────────────────────────────────────────────────────────────────

from llm_client import call_llm_text
from analyzer import get_agent_code_for_area
from trace_summarizer import build_trace_context

ADMIN_API_URL    = os.getenv("ADMIN_API_URL",    "http://admin-api:8080")
PROMETHEUS_URL   = os.getenv("PROMETHEUS_URL",   "http://prometheus:9090")
TEAMS_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")

# 알림성 로그 비율 임계값 — 이 비율 이상이면 집계 LLM 프롬프트에 필터링 컨텍스트 주입
_NOTIFICATION_RATIO_THRESHOLD = 0.5


async def _get_notification_ratio(
    client: httpx.AsyncClient,
    system_id: int,
    from_dt: str,
    to_dt: str,
) -> float:
    """해당 기간 log_analysis_history에서 알림성 로그(anomaly_type=notification|notification_auto) 비율 반환.
    조회 실패 시 0.0 반환 (안전 fallback — 비율 주입 없이 계속)."""
    try:
        resp = await client.get(
            f"{ADMIN_API_URL}/api/v1/analysis",
            params={"system_id": system_id, "from_dt": from_dt, "to_dt": to_dt, "limit": 500},
            timeout=5.0,
        )
        if resp.status_code != 200:
            return 0.0
        records = resp.json()
        if not records:
            return 0.0
        notification_count = sum(
            1 for r in records
            if r.get("anomaly_type") in ("notification", "notification_auto")
        )
        return notification_count / len(records)
    except Exception as exc:
        logger.debug("알림성 비율 조회 실패 (무시): %s", exc)
        return 0.0


def _notification_hint(ratio: float) -> str:
    """알림성 비율이 임계값 이상이면 LLM 프롬프트에 주입할 컨텍스트 반환."""
    if ratio < _NOTIFICATION_RATIO_THRESHOLD:
        return ""
    pct = int(ratio * 100)
    return (
        f"\n[참고] 해당 기간 로그 분석 중 알림성 로그 비율: {pct}%\n"
        "알림성 로그는 실제 시스템 이상이 아니므로 심각도 판단에서 제외하세요.\n"
    )


# ── PromQL 매핑 ──────────────────────────────────────────────────────────────

PROMQL_MAP: dict[str, dict[str, dict[str, str]]] = {
    # node_exporter, jmx_exporter는 synapse_agent로 대체됨 → 제거
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
    # Phase 6 — synapse_agent 단일 바이너리 수집기 (node_exporter 대체)
    "synapse_agent": {
        "cpu": {
            "cpu_avg": 'avg_over_time(cpu_usage_percent{{system_name="{sn}",core="total"}}[1h])',
            "cpu_max": 'max_over_time(cpu_usage_percent{{system_name="{sn}",core="total"}}[1h])',
            "cpu_p95": 'quantile_over_time(0.95, cpu_usage_percent{{system_name="{sn}",core="total"}}[1h])',
            "load1":   'avg_over_time(cpu_load_avg{{system_name="{sn}",interval="1m"}}[1h])',
            "load5":   'avg_over_time(cpu_load_avg{{system_name="{sn}",interval="5m"}}[1h])',
        },
        "memory": {
            # type 라벨이 달라 ignoring(type)으로 label 매칭 무시 후 나눗셈
            "mem_used_pct": 'avg_over_time(memory_used_bytes{{system_name="{sn}",type="used"}}[1h]) / ignoring(type) avg_over_time(memory_used_bytes{{system_name="{sn}",type="total"}}[1h]) * 100',
            "mem_p95":      'quantile_over_time(0.95, memory_used_bytes{{system_name="{sn}",type="used"}}[1h]) / ignoring(type) avg_over_time(memory_used_bytes{{system_name="{sn}",type="total"}}[1h]) * 100',
        },
        "disk": {
            "disk_read_mb":  'avg_over_time(rate(disk_bytes_total{{system_name="{sn}",direction="read"}}[5m])[1h:5m]) / 1048576',
            "disk_write_mb": 'avg_over_time(rate(disk_bytes_total{{system_name="{sn}",direction="write"}}[5m])[1h:5m]) / 1048576',
            "disk_io_ms":    'avg_over_time(disk_io_time_ms{{system_name="{sn}"}}[1h])',
        },
        "network": {
            "net_rx_mb": 'avg_over_time(rate(network_bytes_total{{system_name="{sn}",direction="rx"}}[5m])[1h:5m]) / 1048576',
            "net_tx_mb": 'avg_over_time(rate(network_bytes_total{{system_name="{sn}",direction="tx"}}[5m])[1h:5m]) / 1048576',
        },
        "log": {
            # synapse_agent는 에러 로그 1건마다 별도 시계열(value=1)을 푸시.
            # instant count()는 stale marker(기본 5분) 이후 비활성 시계열을 제외해
            # 가끔 발생하는 로그에 대해 실제 건수보다 훨씬 작게 잡히는 문제가 있음.
            # → range [1h] 내 존재한 샘플을 모두 합산하도록 수정.
            "log_errors":     'sum(sum_over_time(log_error_total{{system_name="{sn}"}}[1h])) or vector(0)',
            "log_errors_err": 'sum(sum_over_time(log_error_total{{system_name="{sn}",level="ERROR"}}[1h])) or vector(0)',
        },
        "web": {
            "req_total":   'sum_over_time(increase(http_request_total{{system_name="{sn}"}}[5m])[1h:5m])',
            "req_slow":    'sum_over_time(increase(http_request_slow_total{{system_name="{sn}"}}[5m])[1h:5m])',
            "resp_avg_ms": 'avg_over_time(http_request_duration_ms{{system_name="{sn}"}}[1h])',
        },
    },
}

# ── 추이 기반 이상 감지 설정 ─────────────────────────────────────────────────
# 절대값 임계치 미달이지만 연속 상승/하락 추이를 보이는 경우 감지
TREND_THRESHOLDS: dict[tuple[str, str], dict] = {
    ("synapse_agent", "cpu"):          {"key": "cpu_avg",        "direction": "up",   "min_delta": 5.0,   "min_hours": 2, "min_floor": 60.0, "label": "CPU 평균 상승 추이"},
    ("synapse_agent", "memory"):       {"key": "mem_used_pct",   "direction": "up",   "min_delta": 3.0,   "min_hours": 2, "label": "메모리 사용률 상승 추이"},
    ("synapse_agent", "web"):          {"key": "resp_avg_ms",    "direction": "up",   "min_delta": 300.0, "min_hours": 2, "label": "평균 응답시간 상승 추이"},
    ("synapse_agent", "disk"):         {"key": "disk_io_ms",     "direction": "up",   "min_delta": 50.0,  "min_hours": 2, "label": "디스크 I/O 지연 상승 추이"},
    ("synapse_agent", "network"):      {"key": "net_rx_mb",      "direction": "up",   "min_delta": 20.0,  "min_hours": 2, "label": "네트워크 RX 트래픽 상승 추이"},
    ("db_exporter", "db_connections"): {"key": "conn_active_pct","direction": "up",   "min_delta": 5.0,   "min_hours": 2, "label": "DB 연결 사용률 상승 추이"},
    ("db_exporter", "db_cache"):       {"key": "cache_hit_rate", "direction": "down", "min_delta": 1.0,   "min_hours": 2, "label": "캐시 히트율 하락 추이"},
}


# ── metric_group 한국어 라벨 ─────────────────────────────────────────────────
_METRIC_GROUP_LABEL: dict[str, str] = {
    "cpu": "CPU",
    "memory": "메모리",
    "disk": "디스크 I/O",
    "network": "네트워크",
    "web": "웹 응답",
    "log": "로그 에러",
    "db_connections": "DB 연결",
    "db_query": "DB 쿼리",
    "db_cache": "DB 캐시",
    "db_replication": "DB 복제",
}


def _metric_label(metric_group: str) -> str:
    return _METRIC_GROUP_LABEL.get(metric_group, metric_group)


def _mention_text(contacts: list[dict]) -> str:
    return " ".join(f"<at>{c['name']}</at>" for c in contacts if c.get("teams_upn"))


def _mention_entities(contacts: list[dict]) -> list[dict]:
    return [
        {
            "type": "mention",
            "text": f"<at>{c['name']}</at>",
            "mentioned": {"id": c["teams_upn"], "name": c["name"]},
        }
        for c in contacts if c.get("teams_upn")
    ]


async def _fetch_contacts(client: httpx.AsyncClient, system_id: int) -> tuple[int, list[dict]]:
    try:
        r = await client.get(
            f"{ADMIN_API_URL}/api/v1/systems/{system_id}/contacts", timeout=5.0
        )
        return system_id, r.json() if r.status_code == 200 else []
    except Exception:
        return system_id, []


# ── 공통 헬퍼 ────────────────────────────────────────────────────────────────

async def _query_prometheus(client: httpx.AsyncClient, promql: str) -> float | None:
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


def _detect_anomaly(
    collector_type: str,
    metric_group: str,
    metrics: dict[str, float],
) -> tuple[bool, str]:
    """
    WF6 node 7 이상 감지 로직 이식.
    Returns (detected: bool, reason: str)
    """
    if collector_type == "node_exporter":
        if metric_group == "cpu":
            if metrics.get("cpu_p95", 0) > 75:
                return True, f"CPU p95 {metrics['cpu_p95']}% > 75%"
            if metrics.get("cpu_avg", 0) > 65:
                return True, f"CPU avg {metrics['cpu_avg']}% > 65%"
            if metrics.get("iowait", 0) > 20:
                return True, f"iowait {metrics['iowait']}% > 20%"
        elif metric_group == "memory":
            if metrics.get("mem_p95", 0) > 85:
                return True, f"Memory p95 {metrics['mem_p95']}% > 85%"
            if metrics.get("mem_used_pct", 0) > 80:
                return True, f"Memory avg {metrics['mem_used_pct']}% > 80%"
        elif metric_group == "disk":
            if metrics.get("disk_util_pct", 0) > 80:
                return True, f"디스크 사용률 {metrics['disk_util_pct']}% > 80%"

    elif collector_type == "jmx_exporter":
        if metrics.get("heap_p95", 0) > 85:
            return True, f"JVM heap p95 {metrics['heap_p95']}% > 85%"
        if metrics.get("gc_time_pct", 0) > 15:
            return True, f"GC time {metrics['gc_time_pct']}% > 15%"
        if metrics.get("rejection_count", 0) > 0:
            return True, f"Thread rejection {metrics['rejection_count']}건 발생"
        if metrics.get("req_error_rate", 0) > 1:
            return True, f"요청 오류율 {metrics['req_error_rate']}% > 1%"
        if metrics.get("resp_p95_ms", 0) > 2000:
            return True, f"응답시간 p95 {metrics['resp_p95_ms']}ms > 2000ms"

    elif collector_type == "synapse_agent":
        if metric_group == "cpu":
            if metrics.get("cpu_p95", 0) > 75:
                return True, f"CPU p95 {metrics['cpu_p95']}% > 75%"
            if metrics.get("cpu_avg", 0) > 65:
                return True, f"CPU avg {metrics['cpu_avg']}% > 65%"
        elif metric_group == "memory":
            if metrics.get("mem_p95", 0) > 80:
                return True, f"Memory p95 {metrics['mem_p95']}% > 80%"
            if metrics.get("mem_used_pct", 0) > 70:
                return True, f"Memory avg {metrics['mem_used_pct']}% > 70%"
        elif metric_group == "log":
            if metrics.get("log_errors_err", 0) > 10:
                return True, f"ERROR 로그 {int(metrics['log_errors_err'])}건 발생"
        elif metric_group == "web":
            if metrics.get("req_slow", 0) > 0 and metrics.get("req_total", 0) > 0:
                slow_rate = metrics["req_slow"] / metrics["req_total"] * 100
                if slow_rate > 5:
                    return True, f"슬로우 요청 {slow_rate:.1f}% > 5%"
            if metrics.get("resp_avg_ms", 0) > 2000:
                return True, f"평균 응답시간 {metrics['resp_avg_ms']}ms > 2000ms"
        elif metric_group == "network":
            _net_max_mb = float(os.getenv("PROM_NET_MAX_MBPS", "1000.0")) / 8
            _net_thr = _net_max_mb * float(os.getenv("PROM_ALERT_NET_THRESHOLD_PCT", "70.0")) / 100
            if metrics.get("net_rx_mb", 0) > _net_thr:
                pct = metrics["net_rx_mb"] / _net_max_mb * 100
                return True, f"네트워크 RX {metrics['net_rx_mb']:.1f} MB/s ({pct:.0f}%) > 대역폭 70%"
            if metrics.get("net_tx_mb", 0) > _net_thr:
                pct = metrics["net_tx_mb"] / _net_max_mb * 100
                return True, f"네트워크 TX {metrics['net_tx_mb']:.1f} MB/s ({pct:.0f}%) > 대역폭 70%"

    elif collector_type == "db_exporter":
        if metrics.get("conn_active_pct", 0) > 80:
            return True, f"DB 연결 {metrics['conn_active_pct']}% > 80%"
        # cache_hit_rate 는 낮을 때 이상 → 기본값을 100으로 설정해야 false positive 방지
        cache = metrics.get("cache_hit_rate")
        if cache is not None and cache < 95:
            return True, f"캐시 히트율 {cache}% < 95%"
        if metrics.get("repl_lag_sec", 0) > 10:
            return True, f"복제 지연 {metrics['repl_lag_sec']}초 > 10초"

    return False, ""


async def _fetch_previous_hours(
    client: httpx.AsyncClient,
    system_id: int,
    collector_type: str,
    metric_group: str,
    hour_bucket_iso: str,   # run_hourly_aggregation이 이미 naive UTC로 변환한 값
    n: int = 3,
) -> list[dict]:
    """이전 n시간 집계 레코드 조회. 실패 시 빈 리스트 반환."""
    hour_bucket_dt = datetime.fromisoformat(hour_bucket_iso)  # 이미 naive UTC
    from_dt = (hour_bucket_dt - timedelta(hours=n)).isoformat()
    to_dt   = (hour_bucket_dt - timedelta(hours=1)).isoformat()
    try:
        resp = await client.get(
            f"{ADMIN_API_URL}/api/v1/aggregations/hourly",
            params={
                "system_id":      system_id,
                "collector_type": collector_type,
                "metric_group":   metric_group,
                "from_dt":        from_dt,
                "to_dt":          to_dt,
                "limit":          n,
            },
            timeout=5.0,
        )
        if resp.status_code == 200:
            records = resp.json()
            records.sort(key=lambda r: r["hour_bucket"])
            return records
    except Exception as exc:
        logger.debug("이전 시간 집계 조회 실패: %s", exc)
    return []


def _detect_trend_anomaly(
    prev_records: list[dict],
    current_metrics: dict,
    collector_type: str,
    metric_group: str,
) -> tuple[bool, str]:
    """이전 N시간 집계 기반 연속 상승/하락 추이 감지."""
    cfg = TREND_THRESHOLDS.get((collector_type, metric_group))
    if not cfg:
        return False, ""

    key       = cfg["key"]
    direction = cfg["direction"]
    min_delta = cfg["min_delta"]
    min_hours = cfg["min_hours"]

    values: list[float] = []
    for rec in prev_records:
        try:
            v = json.loads(rec["metrics_json"]).get(key)
            if v is not None:
                values.append(float(v))
        except Exception:
            pass

    cur = current_metrics.get(key)
    if cur is None:
        return False, ""

    min_floor = cfg.get("min_floor", 0.0)
    if float(cur) < min_floor:
        return False, ""

    values.append(float(cur))

    if len(values) < min_hours + 1:
        return False, ""

    values = values[-(min_hours + 1):]
    deltas = [values[i + 1] - values[i] for i in range(len(values) - 1)]

    if direction == "up":
        if all(d >= min_delta for d in deltas):
            total = values[-1] - values[0]
            return True, f"{cfg['label']}: {values[0]:.1f}→{values[-1]:.1f} (+{total:.1f}, {len(deltas)}시간 연속)"
    else:
        if all(d <= -min_delta for d in deltas):
            total = values[0] - values[-1]
            return True, f"{cfg['label']}: {values[0]:.1f}→{values[-1]:.1f} (-{total:.1f}, {len(deltas)}시간 연속)"

    return False, ""


def _parse_llm_json(text: str | None, fallback: dict) -> dict:
    """LLM 응답에서 JSON 블록 추출"""
    if not text:
        return fallback
    try:
        match = re.search(r"\{[\s\S]*\}", text)
        return json.loads(match.group(0)) if match else fallback
    except Exception:
        return fallback


async def _send_teams(
    client: httpx.AsyncClient,
    webhook_url: str,
    card_payload: dict,
) -> None:
    """Teams Adaptive Card 발송"""
    url = webhook_url or TEAMS_WEBHOOK_URL
    if not url:
        logger.warning("Teams Webhook URL 미설정 — 알림 생략")
        return
    try:
        resp = await client.post(url, json=card_payload, timeout=15.0)
        resp.raise_for_status()
    except Exception as exc:
        logger.warning("Teams 알림 발송 실패: %s", exc)


def _make_alert_type_fact(label: str) -> dict:
    """알림 유형 FactSet 행 생성 — FactSet facts 리스트 맨 앞에 삽입"""
    return {"title": "알림 유형", "value": label}


def _build_report_card_body(
    title: str,
    llm_summary: str,
    system_summary: dict[str, dict],
    period_range: str | None = None,
    alert_type_label: str | None = None,
) -> list[dict]:
    """
    공통 Adaptive Card body 빌더.
    system_summary values: { display_name, total_anomaly_hours, worst_severity, cause? }
    period_range: 장기 리포트용 "YYYY-MM-DD ~ YYYY-MM-DD" (None이면 생략)
    alert_type_label: 알림 유형 표시용 subtitle (None이면 생략)
    """
    body: list[dict] = [
        {"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium"},
    ]
    if alert_type_label:
        body.append({
            "type": "TextBlock",
            "text": f"알림 유형: {alert_type_label}",
            "size": "Small",
            "isSubtle": True,
        })
    body.append({"type": "TextBlock", "text": llm_summary, "wrap": True})

    if period_range:
        body.append({"type": "TextBlock", "text": f"기간: {period_range}", "weight": "Bolder"})

    sys_list = "\n".join(f"  └ {s['display_name']}" for s in system_summary.values())
    body.append({"type": "TextBlock", "text": f"모니터링 시스템 {len(system_summary)}개", "weight": "Bolder"})
    if sys_list:
        body.append({"type": "TextBlock", "text": sys_list, "wrap": True})

    def _cause_suffix(s: dict) -> str:
        cause = (s.get("cause") or "").strip()
        return f" ({cause[:35]})" if cause else ""

    total_anomaly = sum(s["total_anomaly_hours"] for s in system_summary.values())
    anomaly_lines = "\n".join(
        f"  └ {s['display_name']}: {round(s['total_anomaly_hours'])}시간{_cause_suffix(s)}"
        for s in system_summary.values()
        if s["total_anomaly_hours"] > 0
    )
    body.append({"type": "TextBlock", "text": f"이상발생 시간 총 {round(total_anomaly)}h", "weight": "Bolder"})
    if anomaly_lines:
        body.append({"type": "TextBlock", "text": anomaly_lines, "wrap": True})

    critical_systems = [s for s in system_summary.values() if s["worst_severity"] == "critical"]
    if critical_systems:
        crit_list = "\n".join(
            f"  └ {s['display_name']}{_cause_suffix(s)}" for s in critical_systems
        )
        body.append({
            "type": "TextBlock",
            "text": f"Critical 시스템 총 {len(critical_systems)}개",
            "weight": "Bolder",
            "color": "Attention",
        })
        body.append({"type": "TextBlock", "text": crit_list, "wrap": True})

    return body


# ── WF6: run_hourly_aggregation ───────────────────────────────────────────────

async def _process_single_config(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    config: dict,
    hour_bucket_iso: str,
    otel_system_ids: set[int] | None = None,
    contacts_map: dict[int, list[dict]] | None = None,
) -> dict:
    """
    단일 collector_config에 대한 1시간 집계 처리.
    에러 격리: 예외 발생 시 {"status": "error"} 반환.
    """
    system_name    = config.get("system_name", "")
    system_id      = config.get("system_id", 0)
    display_name   = config.get("display_name", system_name)
    collector_type = config.get("collector_type", "")
    metric_group   = config.get("metric_group", "")

    async with sem:
        try:
            # metric_group PromQL 조회
            group_queries = (PROMQL_MAP.get(collector_type) or {}).get(metric_group) or {}
            if not group_queries:
                return {"status": "skipped", "reason": "no_promql", "system": system_name}

            keys    = list(group_queries.keys())
            promqls = [q.format(sn=system_name) for q in group_queries.values()]

            # 모든 쿼리 동시 실행
            values = await asyncio.gather(
                *[_query_prometheus(client, pql) for pql in promqls],
                return_exceptions=True,
            )
            metrics: dict[str, float] = {}
            for key, val in zip(keys, values):
                if isinstance(val, Exception) or val is None:
                    continue
                metrics[key] = val

            if not metrics:
                return {"status": "skipped", "reason": "no_prometheus_data", "system": system_name}

            # 이상 감지 — 절대값 임계치
            anomaly_detected, anomaly_reason = _detect_anomaly(
                collector_type, metric_group, metrics
            )

            # 추이 감지 — 절대값 미달 시에만 이전 n시간 조회
            prev_records: list[dict] = []
            trend_anomaly = False
            if not anomaly_detected:
                prev_records = await _fetch_previous_hours(
                    client, system_id, collector_type, metric_group, hour_bucket_iso, n=3
                )
                trend_anomaly, trend_reason = _detect_trend_anomaly(
                    prev_records, metrics, collector_type, metric_group
                )
                if trend_anomaly:
                    anomaly_detected = True
                    anomaly_reason   = trend_reason

            # 기본 집계 저장 (llm_severity='normal')
            hourly_payload = {
                "system_id":      system_id,
                "hour_bucket":    hour_bucket_iso,
                "collector_type": collector_type,
                "metric_group":   metric_group,
                "metrics_json":   json.dumps(metrics),
                "llm_severity":   "normal",
            }
            saved_resp = await client.post(
                f"{ADMIN_API_URL}/api/v1/aggregations/hourly",
                json=hourly_payload,
                timeout=10.0,
            )
            saved_resp.raise_for_status()
            pg_row_id = saved_resp.json().get("id")

            if not anomaly_detected:
                return {"status": "ok", "system": system_name, "anomaly": False}

            # OTel gating: running otel_javaagent 있는 시스템이면 hourly trace context 조회
            trace_section = ""
            has_otel = otel_system_ids is not None and system_id in otel_system_ids
            if has_otel:
                import time as _time
                now_ns = int(_time.time() * 1e9)
                start_ns = now_ns - 3600 * 1_000_000_000
                try:
                    trace_ctx, _ = await build_trace_context(system_name, start_ns, now_ns, tier="hourly")
                    if trace_ctx:
                        trace_section = f"\n[분산 추적 요약 (hourly)]\n{trace_ctx}\n"
                except Exception as exc:
                    logger.debug("hourly trace_context 실패 → 생략: %s", exc)

            # 이상 감지 → LLM 분석
            metrics_formatted = "\n".join(f"  {k}: {v}" for k, v in metrics.items())

            trend_section = ""
            if trend_anomaly and prev_records:
                cfg_key = (TREND_THRESHOLDS.get((collector_type, metric_group)) or {}).get("key", "")
                lines = []
                for rec in prev_records:
                    try:
                        v = json.loads(rec["metrics_json"]).get(cfg_key)
                        if v is not None:
                            lines.append(f"  {rec['hour_bucket']}: {cfg_key}={v:.1f}")
                    except Exception:
                        pass
                if cfg_key and metrics.get(cfg_key) is not None:
                    lines.append(f"  {hour_bucket_iso}: {cfg_key}={metrics[cfg_key]:.1f}  ← 현재")
                if lines:
                    trend_section = "\n[최근 추이]\n" + "\n".join(lines) + "\n"

            # 알림성 로그 비율 조회 → log 메트릭 그룹에만 프롬프트 컨텍스트 주입
            notif_hint = ""
            if metric_group == "log":
                hour_from = (
                    datetime.fromisoformat(hour_bucket_iso).replace(tzinfo=None)
                    - timedelta(hours=1)
                ).isoformat()
                notif_ratio = await _get_notification_ratio(
                    client, system_id, hour_from, hour_bucket_iso
                )
                notif_hint = _notification_hint(notif_ratio)

            llm_prompt = build_hourly_agg_prompt(
                display_name, system_name, hour_bucket_iso,
                collector_type, metric_group, anomaly_reason,
                metrics_formatted, trace_section, trend_section,
            ) + notif_hint

            _hourly_agent_code = await get_agent_code_for_area("metric_hourly_aggregation")
            llm_text = await call_llm_text(llm_prompt, max_tokens=400, agent_code=_hourly_agent_code)
            llm_result = _parse_llm_json(llm_text, {
                "severity": "warning", "trend": "LLM 파싱 오류", "prediction": None,
                "root_cause_hypothesis": "", "recommendation": "",
            })

            llm_severity   = llm_result.get("severity", "warning")
            llm_trend      = llm_result.get("trend", "")
            llm_prediction = llm_result.get("prediction")
            llm_summary    = (
                f"{llm_result.get('root_cause_hypothesis', '')} "
                f"{llm_result.get('recommendation', '')}".strip()
            )

            # 요약 텍스트 생성 & Qdrant 저장
            summary_parts = [
                f"시스템:{system_name} 수집기:{collector_type}/{metric_group}",
                f"이상: {anomaly_reason}",
                f"추세: {llm_trend}" if llm_trend else "",
                f"예측: {llm_prediction}" if llm_prediction else "",
                f"원인: {llm_result.get('root_cause_hypothesis', '')}" if llm_result.get("root_cause_hypothesis") else "",
            ]
            summary_text = " | ".join(p for p in summary_parts if p)

            # 임베딩 입력은 검색 의도 필드(이상·원인)만 사용 — 시스템명/수집기/추세/예측 같은
            # 메타 정보가 쿼리와 방향 일치를 떨어뜨려 짧은 쿼리의 유사도가 낮게 나오던 문제 해소.
            # payload의 summary_text(표시용)와 임베딩 입력은 분리 관리.
            embed_input = " ".join(
                p for p in [anomaly_reason, llm_result.get("root_cause_hypothesis", "")] if p
            ).strip() or summary_text

            point_id = None
            if pg_row_id:
                try:
                    embedding = await vector_client.get_embedding(embed_input)
                    sparse_vec = await vector_client.get_sparse_vector(embed_input)
                    point_id = await aggregation_vector_client.store_hourly_pattern_vector(
                        embedding=embedding,
                        sparse=sparse_vec,
                        system_id=system_id,
                        system_name=system_name,
                        hour_bucket=hour_bucket_iso,
                        collector_type=collector_type,
                        metric_group=metric_group,
                        summary_text=summary_text,
                        llm_severity=llm_severity,
                        llm_trend=llm_trend,
                        llm_prediction=llm_prediction,
                        pg_row_id=pg_row_id,
                    )
                except Exception as exc:
                    logger.warning("Qdrant 저장 실패 [%s/%s]: %s", system_name, metric_group, exc)

            # hourly 레코드 LLM 결과로 업데이트
            update_payload = {
                "system_id":      system_id,
                "hour_bucket":    hour_bucket_iso,
                "collector_type": collector_type,
                "metric_group":   metric_group,
                "metrics_json":   json.dumps(metrics),
                "llm_summary":    llm_summary,
                "llm_severity":   llm_severity,
                "llm_trend":      llm_trend,
                "llm_prediction": llm_prediction,
                "llm_model_used": "internal_llm",
                "qdrant_point_id": point_id,
            }
            await client.post(
                f"{ADMIN_API_URL}/api/v1/aggregations/hourly",
                json=update_payload,
                timeout=10.0,
            )

            # 프로액티브 알림 필요 여부 (예측이 있고 critical 또는 예측에 '시간' 포함)
            needs_alert = bool(
                llm_prediction and (
                    llm_severity == "critical"
                    or "시간" in str(llm_prediction)
                )
            )
            if needs_alert:
                contacts  = (contacts_map or {}).get(system_id, [])
                entities  = _mention_entities(contacts)
                mention   = _mention_text(contacts)
                hourly_facts = [
                    _make_alert_type_fact("시간별 예방 알림 · 매시 :05분"),
                    {"title": "시스템",    "value": f"{display_name} ({system_name})"},
                    {"title": "자원",      "value": _metric_label(metric_group)},
                    {"title": "이상 감지", "value": anomaly_reason},
                    {"title": "추세",      "value": llm_trend or "-"},
                    {"title": "예측",      "value": llm_prediction or "-"},
                    {"title": "권고 조치", "value": llm_summary or "-"},
                ]
                if mention:
                    hourly_facts.append({"title": "담당자", "value": mention})
                card = {
                    "type": "message",
                    "attachments": [{
                        "contentType": "application/vnd.microsoft.card.adaptive",
                        "content": {
                            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                            "type": "AdaptiveCard",
                            "version": "1.4",
                            "body": [
                                {
                                    "type": "TextBlock",
                                    "text": f"[장애 예방] {display_name} 임계치 도달 예측",
                                    "weight": "Bolder",
                                    "size": "Medium",
                                    "color": "Warning",
                                },
                                {"type": "FactSet", "facts": hourly_facts},
                            ],
                            "msteams": {"entities": entities},
                        },
                    }],
                }
                await _send_teams(client, "", card)

            return {
                "status": "ok",
                "system": system_name,
                "anomaly": True,
                "llm_severity": llm_severity,
                "point_id": point_id,
            }

        except Exception as exc:
            logger.error("집계 처리 오류 [%s/%s/%s]: %s", system_name, collector_type, metric_group, exc)
            return {"status": "error", "system": system_name, "error": str(exc)}


async def run_hourly_aggregation() -> dict:
    """
    WF6 로직 이관 — 1시간 집계 + LLM 이상 분석 + Qdrant 저장 + 프로액티브 알림.

    1. GET /api/v1/collector-config 에서 활성 수집기 목록 조회
    2. asyncio.Semaphore(20) 병렬 처리
    3. 각 config별 Prometheus 쿼리 → 이상 감지 → 저장 → LLM → Qdrant → 알림
    """
    # KST 기준 정각으로 버킷 경계 설정 → UTC naive로 DB 저장
    hour_bucket = (
        datetime.now(_KST)
        .replace(minute=0, second=0, microsecond=0)
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )
    hour_bucket_iso = hour_bucket.isoformat()

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 활성 수집기 목록 조회
        try:
            resp = await client.get(f"{ADMIN_API_URL}/api/v1/collector-config")
            resp.raise_for_status()
            configs = resp.json()
            if isinstance(configs, dict):
                configs = configs.get("items", configs.get("data", []))
        except Exception as exc:
            logger.error("수집기 설정 조회 실패: %s", exc)
            return {"processed": 0, "skipped": 0, "anomalies": 0, "errors": 1}

        if not configs:
            logger.info("활성 수집기 설정 없음")
            return {"processed": 0, "skipped": 0, "anomalies": 0, "errors": 0}

        # OTel gating: has_otel 시스템 set 조회
        otel_system_ids: set[int] = set()
        try:
            health_resp = await client.get(f"{ADMIN_API_URL}/api/v1/dashboard/system-health", timeout=5.0)
            if health_resp.status_code == 200:
                for s in health_resp.json().get("systems", []):
                    if s.get("has_otel"):
                        otel_system_ids.add(s["system_id"])
        except Exception as exc:
            logger.debug("hourly OTel system set 조회 실패: %s", exc)

        # 담당자 멘션용 contacts 선조회 (시스템별 병렬)
        unique_sids = {cfg["system_id"] for cfg in configs}
        contact_results = await asyncio.gather(*[_fetch_contacts(client, sid) for sid in unique_sids])
        contacts_map: dict[int, list[dict]] = dict(contact_results)

        sem = asyncio.Semaphore(20)
        tasks = [
            _process_single_config(client, sem, cfg, hour_bucket_iso, otel_system_ids, contacts_map)
            for cfg in configs
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    processed = skipped = anomalies = errors = 0
    for r in results:
        if isinstance(r, Exception):
            errors += 1
        elif r.get("status") == "ok":
            processed += 1
            if r.get("anomaly"):
                anomalies += 1
        elif r.get("status") == "skipped":
            skipped += 1
        else:
            errors += 1

    logger.info(
        "hourly 집계 완료 — processed=%d skipped=%d anomalies=%d errors=%d",
        processed, skipped, anomalies, errors,
    )
    return {"processed": processed, "skipped": skipped, "anomalies": anomalies, "errors": errors}


# ── WF7: run_daily_aggregation ────────────────────────────────────────────────

async def run_daily_aggregation() -> dict:
    """
    WF7 로직 이관 — 전일 시간별 집계 → 일별 롤업 → Qdrant 요약 저장.

    1. GET /api/v1/aggregations/hourly?from_dt=<어제00:00>&to_dt=<오늘00:00>&limit=500
    2. 시스템+collector_type+metric_group별 그룹핑 및 집계
    3. 각 그룹: POST /api/v1/aggregations/daily
    4. 요약 텍스트 생성 → Qdrant 저장
    """
    # KST 기준 어제/오늘 자정 경계 → UTC naive로 DB 저장
    now_kst = datetime.now(_KST)
    today_start_kst = now_kst.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start_kst = today_start_kst - timedelta(days=1)
    today_start = today_start_kst.astimezone(timezone.utc).replace(tzinfo=None)
    yesterday_start = yesterday_start_kst.astimezone(timezone.utc).replace(tzinfo=None)
    day_bucket_iso = yesterday_start.isoformat()

    async with httpx.AsyncClient(timeout=30.0) as client:
        # 시스템 목록 조회 — system_id → {system_name, display_name} 매핑
        systems_map: dict[int, dict] = {}
        try:
            sys_resp = await client.get(f"{ADMIN_API_URL}/api/v1/systems")
            sys_resp.raise_for_status()
            systems_list = sys_resp.json()
            if isinstance(systems_list, dict):
                systems_list = systems_list.get("items", systems_list.get("data", []))
            for sys in systems_list:
                systems_map[sys.get("id")] = sys
        except Exception as exc:
            logger.warning("일별 집계 — 시스템 목록 조회 실패: %s", exc)

        try:
            resp = await client.get(
                f"{ADMIN_API_URL}/api/v1/aggregations/hourly",
                params={
                    "from_dt": _dt_naive(yesterday_start),
                    "to_dt":   _dt_naive(today_start),
                    "limit":   500,
                },
            )
            resp.raise_for_status()
            hourly_rows = resp.json()
            if isinstance(hourly_rows, dict):
                hourly_rows = hourly_rows.get("items", hourly_rows.get("data", []))
        except Exception as exc:
            logger.error("일별 집계 — hourly 데이터 조회 실패: %s", exc)
            return {"processed": 0, "errors": 1}

        if not hourly_rows:
            logger.info("일별 집계 — 어제 hourly 데이터 없음")
            return {"processed": 0, "errors": 0}

        # 그룹핑 (system_id + collector_type + metric_group)
        groups: dict[tuple, dict] = {}
        for row in hourly_rows:
            sid = row.get("system_id")
            sys_info = systems_map.get(sid, {})
            row_system_name = sys_info.get("system_name") or row.get("system_name", "")
            row_display_name = sys_info.get("display_name") or row.get("display_name", row_system_name)
            key = (
                sid,
                row_system_name,
                row_display_name,
                row.get("collector_type", ""),
                row.get("metric_group", ""),
            )
            if key not in groups:
                groups[key] = {
                    "system_id":      key[0],
                    "system_name":    key[1],
                    "display_name":   key[2],
                    "collector_type": key[3],
                    "metric_group":   key[4],
                    "hour_count":     0,
                    "anomaly_hours":  0,
                    "worst_severity": "normal",
                    "predictions":    [],
                    "cpu_avgs":       [],
                    "mem_avgs":       [],
                }
            g = groups[key]
            g["hour_count"] += 1
            sev = row.get("llm_severity", "normal")
            if sev in ("warning", "critical"):
                g["anomaly_hours"] += 1
            if sev == "critical":
                g["worst_severity"] = "critical"
            elif sev == "warning" and g["worst_severity"] != "critical":
                g["worst_severity"] = "warning"
            if row.get("llm_prediction"):
                g["predictions"].append(row["llm_prediction"])

            # 대표 메트릭 (있는 경우만)
            try:
                mj = json.loads(row.get("metrics_json") or "{}")
                if "cpu_avg" in mj:
                    g["cpu_avgs"].append(mj["cpu_avg"])
                if "mem_used_pct" in mj:
                    g["mem_avgs"].append(mj["mem_used_pct"])
            except Exception:
                pass

        processed = errors = 0
        for g in groups.values():
            try:
                dominant_severity = g["worst_severity"]
                metrics_json_dict = {
                    "hour_count":     g["hour_count"],
                    "anomaly_hours":  g["anomaly_hours"],
                    "worst_severity": dominant_severity,
                }
                if g["cpu_avgs"]:
                    metrics_json_dict["cpu_avg"] = round(
                        sum(g["cpu_avgs"]) / len(g["cpu_avgs"]), 2
                    )
                if g["mem_avgs"]:
                    metrics_json_dict["mem_avg"] = round(
                        sum(g["mem_avgs"]) / len(g["mem_avgs"]), 2
                    )

                daily_payload = {
                    "system_id":      g["system_id"],
                    "day_bucket":     day_bucket_iso,
                    "collector_type": g["collector_type"],
                    "metric_group":   g["metric_group"],
                    "metrics_json":   json.dumps(metrics_json_dict),
                    "llm_severity":   dominant_severity,
                }
                saved_resp = await client.post(
                    f"{ADMIN_API_URL}/api/v1/aggregations/daily",
                    json=daily_payload,
                    timeout=10.0,
                )
                saved_resp.raise_for_status()
                pg_row_id = saved_resp.json().get("id")

                # Qdrant 요약 저장
                predictions_str = " | ".join(g["predictions"][:3])
                summary_parts = [
                    f"시스템:{g['system_name']} 날짜:{yesterday_start_kst.strftime('%Y-%m-%d')}",
                    f"수집기:{g['collector_type']}/{g['metric_group']}",
                    f"집계시간:{g['hour_count']}h 이상:{g['anomaly_hours']}h",
                ]
                if predictions_str:
                    summary_parts.append(f"예측:{predictions_str[:200]}")
                summary_text = " | ".join(summary_parts)

                # 임베딩 입력은 검색 의도 필드(예측·이상시간)만 사용. 시스템/날짜 같은
                # 메타는 payload 필터로 처리하고 벡터 공간에서는 제외해 유사도 해상도 확보.
                embed_input = (
                    predictions_str or f"이상 {g['anomaly_hours']}시간 발생"
                ).strip()

                if pg_row_id:
                    try:
                        # Hybrid 저장 — Dense + Sparse 둘 다 생성 (ADR-011)
                        embedding = await vector_client.get_embedding(embed_input)
                        sparse    = await vector_client.get_sparse_vector(embed_input)
                        await aggregation_vector_client.store_aggregation_summary_vector(
                            embedding=embedding,
                            sparse=sparse,
                            system_id=g["system_id"],
                            system_name=g["system_name"],
                            period_type="daily",
                            period_start=day_bucket_iso,
                            summary_text=summary_text,
                            dominant_severity=dominant_severity,
                            pg_row_id=pg_row_id,
                        )
                    except Exception as exc:
                        logger.warning(
                            "Qdrant 일별 요약 저장 실패 [%s]: %s",
                            g["system_name"], exc,
                        )

                processed += 1
            except Exception as exc:
                logger.error(
                    "일별 집계 처리 오류 [%s/%s/%s]: %s",
                    g.get("system_name"), g.get("collector_type"), g.get("metric_group"), exc,
                )
                errors += 1

        # ── 일별 Teams 알림 (시스템 단위 롤업) ──────────────────────────
        daily_system_summary: dict[str, dict] = {}
        for g in groups.values():
            sn = g["system_name"]
            if sn not in daily_system_summary:
                daily_system_summary[sn] = {
                    "display_name":        g["display_name"],
                    "total_anomaly_hours": 0.0,
                    "worst_severity":      "normal",
                    "cause":               g["predictions"][0] if g["predictions"] else "",
                }
            ds = daily_system_summary[sn]
            ds["total_anomaly_hours"] += g["anomaly_hours"]
            if g["worst_severity"] == "critical":
                ds["worst_severity"] = "critical"
            elif g["worst_severity"] == "warning" and ds["worst_severity"] != "critical":
                ds["worst_severity"] = "warning"
            if not ds["cause"] and g["predictions"]:
                ds["cause"] = g["predictions"][0]

        if daily_system_summary:
            day_label = yesterday_start_kst.strftime("%Y년 %m월 %d일")
            daily_system_lines = [
                f"- {ds['display_name']}: 이상 {round(ds['total_anomaly_hours'])}시간, "
                f"심각도: {ds['worst_severity']}"
                + (f", 주요원인: {ds['cause'][:50]}" if ds.get("cause") else "")
                for ds in daily_system_summary.values()
            ]
            # 전날 전체 알림성 비율 — system_id=None이면 전체 시스템 합산 추정
            daily_notif_ratios = []
            for sn_info in daily_system_summary.values():
                # system_name → system_id 역조회는 비용이 크므로 system_id 없이 전체 비율 사용
                pass
            # 단순화: 일별 집계는 system_id 없이 전체 비율 추정 불가 → 프롬프트에 일반 안내만 추가
            daily_notif_hint = (
                "\n[참고] 알림성 로그(is_notification)는 실제 시스템 이상이 아니므로 "
                "심각도 판단에서 제외하세요.\n"
            )

            daily_llm_prompt = build_daily_agg_prompt(
                day_label, daily_system_lines, len(daily_system_summary),
            ) + daily_notif_hint
            try:
                _daily_agent_code = await get_agent_code_for_area("metric_daily_aggregation")
                daily_llm_text = await call_llm_text(daily_llm_prompt, max_tokens=200, agent_code=_daily_agent_code)
            except Exception as exc:
                logger.warning("일별 LLM 요약 실패: %s", exc)
                daily_llm_text = None
            daily_llm_summary = daily_llm_text if daily_llm_text else "일별 요약 생성 실패"

            daily_card = {
                "type": "message",
                "attachments": [{
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "content": {
                        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                        "type": "AdaptiveCard",
                        "version": "1.4",
                        "body": _build_report_card_body(
                            title=f"일별 모니터링 리포트: {day_label}",
                            llm_summary=daily_llm_summary,
                            system_summary=daily_system_summary,
                            alert_type_label="일별 모니터링 리포트",
                        ),
                    },
                }],
            }
            await _send_teams(client, "", daily_card)

    logger.info("daily 집계 완료 — processed=%d errors=%d", processed, errors)
    return {"processed": processed, "errors": errors}


# ── WF8: run_weekly_report ────────────────────────────────────────────────────

async def run_weekly_report() -> dict:
    """
    WF8 로직 이관 — 전주 일별 집계 → 주간 통계 → LLM → Teams → 이력 저장.
    """
    # KST 기준 이번 주/지난 주 월요일 자정 → UTC naive로 DB 저장
    now_kst = datetime.now(_KST)
    weekday = now_kst.weekday()  # 0=월
    this_monday_kst = (now_kst - timedelta(days=weekday)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    last_monday_kst = this_monday_kst - timedelta(days=7)
    last_monday = last_monday_kst.astimezone(timezone.utc).replace(tzinfo=None)
    this_monday = this_monday_kst.astimezone(timezone.utc).replace(tzinfo=None)

    week_start_iso = last_monday.isoformat()
    week_end_iso   = (this_monday - timedelta(seconds=1)).isoformat()

    async with httpx.AsyncClient(timeout=60.0) as client:
        # 시스템 목록 조회 — system_id → {system_name, display_name} 매핑
        systems_map: dict[int, dict] = {}
        try:
            sys_resp = await client.get(f"{ADMIN_API_URL}/api/v1/systems")
            sys_resp.raise_for_status()
            systems_list = sys_resp.json()
            if isinstance(systems_list, dict):
                systems_list = systems_list.get("items", systems_list.get("data", []))
            for sys in systems_list:
                systems_map[sys.get("id")] = sys
        except Exception as exc:
            logger.warning("주간 리포트 — 시스템 목록 조회 실패: %s", exc)

        try:
            resp = await client.get(
                f"{ADMIN_API_URL}/api/v1/aggregations/daily",
                params={
                    "from_dt": _dt_naive(last_monday),
                    "to_dt":   _dt_naive(this_monday),
                    "limit":   500,
                },
            )
            resp.raise_for_status()
            daily_rows = resp.json()
            if isinstance(daily_rows, dict):
                daily_rows = daily_rows.get("items", daily_rows.get("data", []))
        except Exception as exc:
            logger.error("주간 리포트 — daily 데이터 조회 실패: %s", exc)
            return {"status": "error", "error": str(exc)}

        if not daily_rows:
            logger.info("주간 리포트 — 데이터 없음, 스킵")
            return {"status": "skipped", "reason": "no_data"}

        # 시스템별 그룹핑
        system_summary: dict[str, dict] = {}
        for row in daily_rows:
            sid = row.get("system_id")
            sys_info = systems_map.get(sid, {})
            sn = sys_info.get("system_name") or row.get("system_name", "")
            dn = sys_info.get("display_name") or row.get("display_name", sn)
            if sn not in system_summary:
                system_summary[sn] = {
                    "system_id":           sid,
                    "system_name":         sn,
                    "display_name":        dn,
                    "total_anomaly_hours": 0,
                    "worst_severity":      "normal",
                    "metrics":             [],
                    "cause":               "",
                }
            s = system_summary[sn]
            try:
                mj = json.loads(row.get("metrics_json") or "{}")
                s["total_anomaly_hours"] += float(mj.get("anomaly_hours", 0))
            except Exception:
                pass
            sev = row.get("llm_severity", "normal")
            if sev == "critical":
                s["worst_severity"] = "critical"
            elif sev == "warning" and s["worst_severity"] != "critical":
                s["worst_severity"] = "warning"
            if not s["cause"]:
                trend = row.get("llm_trend", "")
                if trend:
                    s["cause"] = trend

        sorted_systems = sorted(
            system_summary.values(),
            key=lambda x: x["total_anomaly_hours"],
            reverse=True,
        )[:10]

        system_lines = [
            f"- {s['display_name']}: 이상 {round(s['total_anomaly_hours'])}시간, "
            f"최고 심각도: {s['worst_severity']}"
            for s in sorted_systems
        ]

        week_start_dt = last_monday_kst
        week_end_dt   = this_monday_kst - timedelta(days=1)
        date_range = (
            f"{week_start_dt.strftime('%Y년 %m월 %d일')} ~ "
            f"{week_end_dt.strftime('%Y년 %m월 %d일')}"
        )

        llm_prompt = build_weekly_agg_prompt(system_lines, len(system_summary)) + (
            "\n[참고] 알림성 로그(is_notification)는 실제 시스템 이상이 아니므로 "
            "심각도 판단에서 제외하세요.\n"
        )

        _weekly_agent_code = await get_agent_code_for_area("metric_weekly_aggregation")
        llm_text = await call_llm_text(llm_prompt, max_tokens=300, agent_code=_weekly_agent_code)
        llm_summary = (
            llm_text if llm_text else "주간 요약 생성 실패"
        )

        card = {
            "type": "message",
            "attachments": [{
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": _build_report_card_body(
                        title=f"주간 모니터링 리포트: {date_range}",
                        llm_summary=llm_summary,
                        system_summary=system_summary,
                        alert_type_label="주간 모니터링 리포트",
                    ),
                },
            }],
        }

        await _send_teams(client, "", card)

        # 리포트 이력 저장
        try:
            await client.post(
                f"{ADMIN_API_URL}/api/v1/reports",
                json={
                    "report_type":  "weekly",
                    "period_start": week_start_iso,
                    "period_end":   week_end_iso,
                    "teams_status": "sent",
                    "llm_summary":  llm_summary,
                    "system_count": len(system_summary),
                },
                timeout=10.0,
            )
        except Exception as exc:
            logger.warning("주간 리포트 이력 저장 실패: %s", exc)

        # 주간 집계 저장 + Qdrant 요약 저장
        for sn, s in system_summary.items():
            # PG 저장 (실패해도 Qdrant 저장은 계속 진행)
            pg_row_id = 0
            try:
                metrics_json_dict = {
                    "total_anomaly_hours": round(s["total_anomaly_hours"], 2),
                    "worst_severity":      s["worst_severity"],
                    "system_count":        1,
                }
                saved_resp = await client.post(
                    f"{ADMIN_API_URL}/api/v1/aggregations/weekly",
                    json={
                        "system_id":      s["system_id"],
                        "week_start":     week_start_iso,
                        "metrics_json":   json.dumps(metrics_json_dict),
                        "llm_severity":   s["worst_severity"],
                        "llm_summary":    llm_summary[:500],
                    },
                    timeout=10.0,
                )
                if saved_resp.is_success:
                    pg_row_id = saved_resp.json().get("id") or 0
                else:
                    logger.warning("주간 집계 PG 저장 실패 [%s]: HTTP %s", sn, saved_resp.status_code)
            except Exception as exc:
                logger.warning("주간 집계 PG 저장 실패 [%s]: %s", sn, exc)

            # Qdrant 요약 저장 (Hybrid Dense+Sparse) — PG 결과와 무관하게 실행
            if sn:
                try:
                    cause_text = s.get("cause", "")
                    summary_parts = [
                        f"시스템:{sn} 주간:{last_monday_kst.strftime('%Y-%m-%d')}~{(this_monday_kst - timedelta(days=1)).strftime('%Y-%m-%d')}",
                        f"이상:{round(s['total_anomaly_hours'])}h 심각도:{s['worst_severity']}",
                    ]
                    if cause_text:
                        summary_parts.append(f"주요추세:{cause_text[:100]}")
                    summary_text = " | ".join(summary_parts)
                    embed_input = (cause_text or f"이상 {round(s['total_anomaly_hours'])}시간 발생").strip()

                    embedding = await vector_client.get_embedding(embed_input)
                    sparse    = await vector_client.get_sparse_vector(embed_input)
                    await aggregation_vector_client.store_aggregation_summary_vector(
                        embedding=embedding,
                        sparse=sparse,
                        system_id=s["system_id"],
                        system_name=sn,
                        period_type="weekly",
                        period_start=week_start_iso,
                        summary_text=summary_text,
                        dominant_severity=s["worst_severity"],
                        pg_row_id=pg_row_id,  # 0이면 PG 저장 실패 sentinel
                    )
                except Exception as exc:
                    logger.warning("Qdrant 주간 요약 저장 실패 [%s]: %s", sn, exc)

    logger.info("weekly 리포트 완료 — systems=%d", len(system_summary))
    return {"status": "ok", "system_count": len(system_summary)}


# ── WF9: run_monthly_report ───────────────────────────────────────────────────

async def run_monthly_report() -> dict:
    """
    WF9 로직 이관 — 전월 주별 집계 → 월간 통계 → LLM → Teams → 이력 저장.
    """
    # KST 기준 전월/이번달 시작 자정 → UTC naive로 DB 저장
    now_kst = datetime.now(_KST)
    this_month_start_kst = now_kst.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if this_month_start_kst.month == 1:
        prev_month_start_kst = this_month_start_kst.replace(
            year=this_month_start_kst.year - 1, month=12
        )
    else:
        prev_month_start_kst = this_month_start_kst.replace(month=this_month_start_kst.month - 1)
    this_month_start = this_month_start_kst.astimezone(timezone.utc).replace(tzinfo=None)
    prev_month_start = prev_month_start_kst.astimezone(timezone.utc).replace(tzinfo=None)

    month_start_iso = prev_month_start.isoformat()
    month_end_iso   = (this_month_start - timedelta(seconds=1)).isoformat()
    month_name = prev_month_start_kst.strftime("%Y년 %m월")

    async with httpx.AsyncClient(timeout=60.0) as client:
        # 시스템 목록 조회 — system_id → {system_name, display_name} 매핑
        systems_map: dict[int, dict] = {}
        try:
            sys_resp = await client.get(f"{ADMIN_API_URL}/api/v1/systems")
            sys_resp.raise_for_status()
            systems_list = sys_resp.json()
            if isinstance(systems_list, dict):
                systems_list = systems_list.get("items", systems_list.get("data", []))
            for sys in systems_list:
                systems_map[sys.get("id")] = sys
        except Exception as exc:
            logger.warning("월간 리포트 — 시스템 목록 조회 실패: %s", exc)

        try:
            resp = await client.get(
                f"{ADMIN_API_URL}/api/v1/aggregations/daily",
                params={
                    "from_dt": _dt_naive(prev_month_start),
                    "to_dt":   _dt_naive(this_month_start),
                    "limit":   500,
                },
            )
            resp.raise_for_status()
            daily_rows = resp.json()
            if isinstance(daily_rows, dict):
                daily_rows = daily_rows.get("items", daily_rows.get("data", []))
        except Exception as exc:
            logger.error("월간 리포트 — daily 데이터 조회 실패: %s", exc)
            return {"status": "error", "error": str(exc)}

        if not daily_rows:
            logger.info("월간 리포트 — 데이터 없음, 스킵")
            return {"status": "skipped", "reason": "no_data"}

        system_summary: dict[str, dict] = {}
        for row in daily_rows:
            sid = row.get("system_id")
            sys_info = systems_map.get(sid, {})
            sn = sys_info.get("system_name") or row.get("system_name", "")
            dn = sys_info.get("display_name") or row.get("display_name", sn)
            if sn not in system_summary:
                system_summary[sn] = {
                    "system_id":           sid,
                    "system_name":         sn,
                    "display_name":        dn,
                    "total_anomaly_hours": 0,
                    "worst_severity":      "normal",
                    "trends":              [],
                    "cause":               "",
                }
            s = system_summary[sn]
            try:
                mj = json.loads(row.get("metrics_json") or "{}")
                s["total_anomaly_hours"] += float(mj.get("anomaly_hours", 0))
            except Exception:
                pass
            sev = row.get("llm_severity", "normal")
            if sev == "critical":
                s["worst_severity"] = "critical"
            elif sev == "warning" and s["worst_severity"] != "critical":
                s["worst_severity"] = "warning"
            trend = row.get("llm_trend")
            if trend:
                s["trends"].append(trend[:100])
                if not s["cause"]:
                    s["cause"] = trend

        sorted_systems = sorted(
            system_summary.values(),
            key=lambda x: x["total_anomaly_hours"],
            reverse=True,
        )[:10]

        system_lines = [
            f"- {s['display_name']}: 이상 {round(s['total_anomaly_hours'])}시간, "
            f"심각도: {s['worst_severity']}"
            + (f", 주요추세: {s['trends'][0][:80]}" if s["trends"] else "")
            for s in sorted_systems
        ]

        llm_prompt = build_monthly_agg_prompt(month_name, system_lines, len(system_summary)) + (
            "\n[참고] 알림성 로그(is_notification)는 실제 시스템 이상이 아니므로 "
            "심각도 판단에서 제외하세요.\n"
        )

        _monthly_agent_code = await get_agent_code_for_area("metric_monthly_aggregation")
        llm_text = await call_llm_text(llm_prompt, max_tokens=400, agent_code=_monthly_agent_code)
        llm_summary = llm_text if llm_text else "월간 요약 생성 실패"

        card = {
            "type": "message",
            "attachments": [{
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": _build_report_card_body(
                        title=f"월간 모니터링 리포트: {month_name}",
                        llm_summary=llm_summary,
                        system_summary=system_summary,
                        alert_type_label="월간 모니터링 리포트",
                    ),
                },
            }],
        }

        await _send_teams(client, "", card)

        try:
            await client.post(
                f"{ADMIN_API_URL}/api/v1/reports",
                json={
                    "report_type":  "monthly",
                    "period_start": month_start_iso,
                    "period_end":   month_end_iso,
                    "teams_status": "sent",
                    "llm_summary":  llm_summary,
                    "system_count": len(system_summary),
                },
                timeout=10.0,
            )
        except Exception as exc:
            logger.warning("월간 리포트 이력 저장 실패: %s", exc)

        # Qdrant 월간 요약 저장 — 시스템별 1포인트
        for sn, s in system_summary.items():
            if not sn:
                continue
            try:
                cause_text = s.get("cause", "")
                summary_parts = [
                    f"시스템:{sn} 월간:{month_name}",
                    f"이상:{round(s['total_anomaly_hours'])}h 심각도:{s['worst_severity']}",
                ]
                if cause_text:
                    summary_parts.append(f"주요추세:{cause_text[:100]}")
                summary_text = " | ".join(summary_parts)
                embed_input = (cause_text or f"이상 {round(s['total_anomaly_hours'])}시간 발생").strip()

                embedding = await vector_client.get_embedding(embed_input)
                sparse    = await vector_client.get_sparse_vector(embed_input)
                await aggregation_vector_client.store_aggregation_summary_vector(
                    embedding=embedding,
                    sparse=sparse,
                    system_id=s["system_id"],
                    system_name=sn,
                    period_type="monthly",
                    period_start=month_start_iso,
                    summary_text=summary_text,
                    dominant_severity=s["worst_severity"],
                    pg_row_id=0,  # monthly는 report_history row만 있고 aggregation row는 없음
                )
            except Exception as exc:
                logger.warning("Qdrant 월간 요약 저장 실패 [%s]: %s", sn, exc)

    logger.info("monthly 리포트 완료 — systems=%d", len(system_summary))
    return {"status": "ok", "system_count": len(system_summary)}


# ── WF10: run_longperiod_report ───────────────────────────────────────────────

async def _run_single_period_report(
    client: httpx.AsyncClient,
    period_type: str,
    period_start: datetime,
    period_end: datetime,
    label: str,
) -> dict:
    """단일 장기 리포트 (quarterly / half_year / annual) 생성"""
    # 시스템 목록 조회 — system_id → {system_name, display_name} 매핑
    systems_map: dict[int, dict] = {}
    try:
        sys_resp = await client.get(f"{ADMIN_API_URL}/api/v1/systems")
        sys_resp.raise_for_status()
        systems_list = sys_resp.json()
        if isinstance(systems_list, dict):
            systems_list = systems_list.get("items", systems_list.get("data", []))
        for sys in systems_list:
            systems_map[sys.get("id")] = sys
    except Exception as exc:
        logger.warning("장기 리포트 — 시스템 목록 조회 실패 [%s]: %s", period_type, exc)

    try:
        resp = await client.get(
            f"{ADMIN_API_URL}/api/v1/aggregations/daily",
            params={
                "from_dt": _dt_naive(period_start),
                "to_dt":   _dt_naive(period_end),
                "limit":   500,
            },
        )
        resp.raise_for_status()
        rows = resp.json()
        if isinstance(rows, dict):
            rows = rows.get("items", rows.get("data", []))
    except Exception as exc:
        logger.error("장기 리포트 조회 실패 [%s]: %s", period_type, exc)
        return {"status": "error", "period_type": period_type, "error": str(exc)}

    if not rows:
        logger.info("장기 리포트 — 데이터 없음 [%s]", period_type)
        return {"status": "skipped", "period_type": period_type}

    system_summary: dict[str, dict] = {}
    for row in rows:
        sid = row.get("system_id")
        sys_info = systems_map.get(sid, {})
        sn = sys_info.get("system_name") or row.get("system_name", "")
        dn = sys_info.get("display_name") or row.get("display_name", sn)
        if sn not in system_summary:
            system_summary[sn] = {
                "system_id":           sid,
                "system_name":         sn,
                "display_name":        dn,
                "total_anomaly_hours": 0,
                "worst_severity":      "normal",
                "trends":              [],
                "cause":               "",
            }
        s = system_summary[sn]
        try:
            mj = json.loads(row.get("metrics_json") or "{}")
            s["total_anomaly_hours"] += float(mj.get("anomaly_hours", 0))
        except Exception:
            pass
        sev = row.get("llm_severity", "normal")
        if sev == "critical":
            s["worst_severity"] = "critical"
        elif sev == "warning" and s["worst_severity"] != "critical":
            s["worst_severity"] = "warning"
        if not s["cause"]:
            trend = row.get("llm_trend", "")
            if trend:
                s["cause"] = trend

    sorted_systems = sorted(
        system_summary.values(),
        key=lambda x: x["total_anomaly_hours"],
        reverse=True,
    )[:8]

    system_lines = [
        f"- {s['display_name']}: 이상 {round(s['total_anomaly_hours'])}시간, "
        f"심각도: {s['worst_severity']}"
        for s in sorted_systems
    ]

    period_label_kr = {
        "quarterly": "분기",
        "half_year": "반기",
        "annual":    "연간",
    }.get(period_type, period_type)

    llm_prompt = build_longperiod_agg_prompt(label, period_label_kr, system_lines, len(system_summary)) + (
        "\n[참고] 알림성 로그(is_notification)는 실제 시스템 이상이 아니므로 "
        "심각도 판단에서 제외하세요.\n"
    )

    _longperiod_agent_code = await get_agent_code_for_area("metric_longperiod_aggregation")
    llm_text = await call_llm_text(llm_prompt, max_tokens=500, agent_code=_longperiod_agent_code)
    llm_summary = llm_text if llm_text else "장기 요약 생성 실패"

    period_emoji = {"annual": "🗓️", "half_year": "📆"}.get(period_type, "📊")

    card = {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": _build_report_card_body(
                    title=f"{period_emoji} {label} 모니터링 리포트",
                    llm_summary=llm_summary,
                    system_summary=system_summary,
                    period_range=(
                        f"{period_start.strftime('%Y-%m-%d')} ~ "
                        f"{period_end.strftime('%Y-%m-%d')}"
                    ),
                    alert_type_label="월간(분기/반기/연간) 모니터링 리포트",
                ),
            },
        }],
    }

    await _send_teams(client, "", card)

    try:
        await client.post(
            f"{ADMIN_API_URL}/api/v1/reports",
            json={
                "report_type":  period_type,
                "period_start": _dt_naive(period_start),
                "period_end":   _dt_naive(period_end),
                "teams_status": "sent",
                "llm_summary":  llm_summary,
                "system_count": len(system_summary),
            },
            timeout=10.0,
        )
    except Exception as exc:
        logger.warning("장기 리포트 이력 저장 실패 [%s]: %s", period_type, exc)

    # Qdrant 장기 요약 저장 — 시스템별 1포인트
    period_start_iso = _dt_naive(period_start)
    for sn, s in system_summary.items():
        if not sn:
            continue
        try:
            cause_text = s.get("cause", "")
            summary_parts = [
                f"시스템:{sn} {period_type}:{period_start.strftime('%Y-%m-%d')}~{period_end.strftime('%Y-%m-%d')}",
                f"이상:{round(s['total_anomaly_hours'])}h 심각도:{s['worst_severity']}",
            ]
            if cause_text:
                summary_parts.append(f"주요추세:{cause_text[:100]}")
            summary_text = " | ".join(summary_parts)
            embed_input = (cause_text or f"이상 {round(s['total_anomaly_hours'])}시간 발생").strip()

            embedding = await vector_client.get_embedding(embed_input)
            sparse    = await vector_client.get_sparse_vector(embed_input)
            await aggregation_vector_client.store_aggregation_summary_vector(
                embedding=embedding,
                sparse=sparse,
                system_id=s["system_id"],
                system_name=sn,
                period_type=period_type,
                period_start=period_start_iso,
                summary_text=summary_text,
                dominant_severity=s["worst_severity"],
                pg_row_id=0,  # 장기 리포트는 aggregation 단위 행 없음 (report_history만 존재)
            )
        except Exception as exc:
            logger.warning("Qdrant 장기 요약 저장 실패 [%s/%s]: %s", period_type, sn, exc)

    return {"status": "ok", "period_type": period_type, "system_count": len(system_summary)}


async def run_longperiod_report() -> dict:
    """
    WF10 로직 이관 — 분기/반기/연간 리포트.
    오늘 날짜 기준으로 생성할 period_type 결정 후 순차 실행.
    """
    now = datetime.now(_KST)
    month = now.month

    # 항상 quarterly, 1월/7월은 half_year, 1월은 annual 추가
    period_configs: list[tuple[str, datetime, datetime, str]] = []

    # Quarterly
    quarter_start_month = ((month - 1) // 3) * 3 + 1 - 3
    if quarter_start_month <= 0:
        qs = now.replace(year=now.year - 1, month=quarter_start_month + 12, day=1,
                         hour=0, minute=0, second=0, microsecond=0)
    else:
        qs = now.replace(month=quarter_start_month, day=1,
                         hour=0, minute=0, second=0, microsecond=0)
    qe = now.replace(month=month, day=1, hour=0, minute=0, second=0, microsecond=0)
    q_num = ((month - 1) // 3)  # 0-based, so current quarter
    period_configs.append((
        "quarterly",
        qs,
        qe,
        f"{now.year}년 Q{q_num}분기",
    ))

    if month in (1, 7):
        hs = now.replace(month=month - 6 if month > 6 else month + 6,
                         day=1, hour=0, minute=0, second=0, microsecond=0)
        if month == 1:
            hs = now.replace(year=now.year - 1, month=7, day=1,
                             hour=0, minute=0, second=0, microsecond=0)
        he = now.replace(month=month, day=1, hour=0, minute=0, second=0, microsecond=0)
        period_configs.append((
            "half_year",
            hs,
            he,
            f"{now.year - (1 if month == 1 else 0)}년 {'하반기' if month == 1 else '상반기'}",
        ))

    if month == 1:
        as_ = now.replace(year=now.year - 1, month=1, day=1,
                          hour=0, minute=0, second=0, microsecond=0)
        ae  = now.replace(year=now.year - 1, month=12, day=31,
                          hour=23, minute=59, second=59, microsecond=0)
        period_configs.append(("annual", as_, ae, f"{now.year - 1}년 연간"))

    results = []
    async with httpx.AsyncClient(timeout=60.0) as client:
        for pt, ps, pe, label in period_configs:
            result = await _run_single_period_report(client, pt, ps, pe, label)
            results.append(result)

    logger.info("longperiod 리포트 완료 — %s", results)
    return {"results": results}


# ── WF11: run_trend_alert ─────────────────────────────────────────────────────

async def _process_single_trend_alert(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    item: dict,
    systems_map: dict[int, dict],
    contacts_map: dict[int, list[dict]],
) -> dict:
    """단일 시스템의 지속 이상 트렌드 알림 처리 — 모든 이상 자원 통합 카드 1장"""
    async with sem:
        try:
            system_id      = item.get("system_id")
            worst_severity = item.get("worst_severity", "warning")
            metric_items   = item.get("metric_items", {})

            sys_info     = systems_map.get(system_id, {})
            system_name  = item.get("system_name") or sys_info.get("system_name", "")
            display_name = item.get("display_name") or sys_info.get("display_name", system_name)
            webhook_url  = sys_info.get("teams_webhook_url") or ""

            # LLM 프롬프트용 자원 목록 (3시간 이상만)
            metric_items_for_prompt = [
                {
                    "metric_group":   mi["metric_group"],
                    "anomaly_hours":  mi["anomaly_hours"],
                    "worst_severity": mi["worst_severity"],
                    "trend_sequence": " → ".join(mi["trends"]) if mi["trends"] else "추세 데이터 없음",
                    "predictions":    " | ".join(mi["predictions"]) if mi["predictions"] else "예측 없음",
                }
                for mi in metric_items.values()
                if mi["anomaly_hours"] >= 3
            ]

            llm_prompt = build_trend_alert_prompt(display_name, system_name, metric_items_for_prompt)
            _trend_agent_code = await get_agent_code_for_area("trend_alert")
            llm_text = await call_llm_text(llm_prompt, max_tokens=400, agent_code=_trend_agent_code)
            llm_result = _parse_llm_json(llm_text, {
                "severity": "warning",
                "trend_summary": "분석 실패",
                "hours_to_breach": None,
                "breach_metric": "-",
                "immediate_actions": "-",
            })

            severity   = llm_result.get("severity", "warning")
            hours_text = (
                f"약 {llm_result['hours_to_breach']}시간 후"
                if llm_result.get("hours_to_breach") else "예측 불가"
            )

            # 이상 자원 요약 텍스트 — "CPU (5h/8h, CRITICAL) · 메모리 (3h/8h, WARNING)"
            resource_parts = [
                f"{_metric_label(mi['metric_group'])} ({mi['anomaly_hours']}h/8h, {mi['worst_severity'].upper()})"
                for mi in metric_items.values()
                if mi["anomaly_hours"] >= 3
            ]
            resource_text = " · ".join(resource_parts)

            contacts = contacts_map.get(system_id, [])
            entities = _mention_entities(contacts)
            mention  = _mention_text(contacts)

            trend_facts = [
                _make_alert_type_fact("지속 이상 트렌드 · 4시간주기"),
                {"title": "시스템",     "value": f"{display_name} ({system_name})"},
                {"title": "이상 자원",  "value": resource_text},
                {"title": "최고 심각도","value": worst_severity.upper()},
                {"title": "추세",       "value": llm_result.get("trend_summary", "-")},
                {"title": "임계치 예상","value": f"{llm_result.get('breach_metric', '-')} — {hours_text}"},
                {"title": "즉시 조치",  "value": llm_result.get("immediate_actions", "-")},
            ]
            if mention:
                trend_facts.append({"title": "담당자", "value": mention})

            _frontend_url = os.getenv("FRONTEND_EXTERNAL_URL", "")
            actions = []
            if _frontend_url:
                actions.append({
                    "type": "Action.OpenUrl",
                    "title": "대시보드 보기",
                    "url": f"{_frontend_url}/trend-alerts",
                })

            content: dict = {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "body": [
                    {
                        "type": "TextBlock",
                        "text": f"[장애 예방] {display_name} 지속 이상 감지",
                        "weight": "Bolder",
                        "size": "Medium",
                        "color": "Attention" if severity == "critical" else "Warning",
                    },
                    {"type": "FactSet", "facts": trend_facts},
                ],
                "msteams": {"entities": entities},
            }
            if actions:
                content["actions"] = actions

            card = {
                "type": "message",
                "attachments": [{
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "content": content,
                }],
            }

            await _send_teams(client, webhook_url, card)

            logger.info(
                "프로액티브 트렌드 알림 발송 — system=%s resources=%s severity=%s",
                system_name, resource_text, severity,
            )

            return {"status": "ok", "system": system_name, "severity": severity}

        except Exception as exc:
            logger.error("트렌드 알림 처리 오류 [%s]: %s", item.get("system_name"), exc)
            return {"status": "error", "system": item.get("system_name"), "error": str(exc)}


async def run_trend_alert() -> dict:
    """
    WF11 로직 이관 — 최근 8시간 중 3시간 이상 warning/critical인 시스템 감지 → LLM 트렌드 분석 → Teams 알림.

    1. GET /api/v1/aggregations/hourly?from_dt=<8시간전>&limit=500
    2. Python에서 warning/critical 필터 + 그룹핑
    3. anomaly_hours >= 3인 시스템만 처리 (Semaphore=10)
    """
    now = datetime.now(timezone.utc)
    eight_hours_ago = now - timedelta(hours=8)

    async with httpx.AsyncClient(timeout=60.0) as client:
        # 최근 8시간 hourly 데이터 조회
        try:
            resp = await client.get(
                f"{ADMIN_API_URL}/api/v1/aggregations/hourly",
                params={
                    "from_dt": _dt_naive(eight_hours_ago),
                    "to_dt":   _dt_naive(now),
                    "limit":   500,
                },
            )
            resp.raise_for_status()
            hourly_rows = resp.json()
            if isinstance(hourly_rows, dict):
                hourly_rows = hourly_rows.get("items", hourly_rows.get("data", []))
        except Exception as exc:
            logger.error("트렌드 알림 — hourly 데이터 조회 실패: %s", exc)
            return {"status": "error", "error": str(exc)}

        # 시스템 단위 그룹핑 — metric_group별 이상을 한 카드로 통합
        groups: dict[int, dict] = {}
        for row in hourly_rows:
            sev = row.get("llm_severity", "normal")
            if sev not in ("warning", "critical"):
                continue
            sid          = row.get("system_id")
            system_name  = row.get("system_name", "")
            display_name = row.get("display_name", "")
            ctype        = row.get("collector_type", "")
            mgroup       = row.get("metric_group", "")
            if sid not in groups:
                groups[sid] = {
                    "system_id":      sid,
                    "system_name":    system_name,
                    "display_name":   display_name,
                    "worst_severity": "warning",
                    "metric_items":   {},
                }
            g = groups[sid]
            item_key = f"{ctype}/{mgroup}"
            if item_key not in g["metric_items"]:
                g["metric_items"][item_key] = {
                    "collector_type": ctype,
                    "metric_group":   mgroup,
                    "anomaly_hours":  0,
                    "worst_severity": "warning",
                    "trends":         [],
                    "predictions":    [],
                }
            mi = g["metric_items"][item_key]
            mi["anomaly_hours"] += 1
            if sev == "critical":
                mi["worst_severity"] = "critical"
                g["worst_severity"]  = "critical"
            if row.get("llm_trend"):
                mi["trends"].append(row["llm_trend"])
            if row.get("llm_prediction"):
                mi["predictions"].append(row["llm_prediction"])

        # 시스템 내 어느 자원이라도 anomaly_hours >= 3이면 대상
        targets = [
            g for g in groups.values()
            if any(mi["anomaly_hours"] >= 3 for mi in g["metric_items"].values())
        ]

        if not targets:
            logger.info("트렌드 알림 — 대상 시스템 없음")
            return {"status": "ok", "alerted": 0}

        # 시스템 정보 조회 (webhook URL 등)
        systems_map: dict[int, dict] = {}
        try:
            sys_resp = await client.get(f"{ADMIN_API_URL}/api/v1/systems")
            sys_resp.raise_for_status()
            systems_list = sys_resp.json()
            if isinstance(systems_list, dict):
                systems_list = systems_list.get("items", systems_list.get("data", []))
            for sys in systems_list:
                systems_map[sys.get("id")] = sys
        except Exception as exc:
            logger.warning("시스템 목록 조회 실패: %s", exc)

        # 담당자 contacts 병렬 조회
        contact_results = await asyncio.gather(*[
            _fetch_contacts(client, t["system_id"]) for t in targets
        ])
        contacts_map: dict[int, list[dict]] = dict(contact_results)

        sem = asyncio.Semaphore(10)
        tasks = [
            _process_single_trend_alert(client, sem, item, systems_map, contacts_map)
            for item in targets[:20]  # 최대 20개
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    ok_cnt  = sum(1 for r in results if not isinstance(r, Exception) and r.get("status") == "ok")
    err_cnt = sum(1 for r in results if isinstance(r, Exception) or r.get("status") == "error")

    logger.info("trend_alert 완료 — alerted=%d errors=%d", ok_cnt, err_cnt)
    return {"status": "ok", "alerted": ok_cnt, "errors": err_cnt}
