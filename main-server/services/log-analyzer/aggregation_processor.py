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


def _dt_naive(dt: datetime) -> str:
    """admin-api는 timezone-naive datetime을 기대하므로 UTC offset 제거 후 isoformat 반환"""
    return dt.replace(tzinfo=None).isoformat()

import httpx

import aggregation_vector_client
import vector_client

logger = logging.getLogger(__name__)

# ── 환경변수 ────────────────────────────────────────────────────────────────

from llm_client import call_llm_text

ADMIN_API_URL    = os.getenv("ADMIN_API_URL",    "http://admin-api:8080")
PROMETHEUS_URL   = os.getenv("PROMETHEUS_URL",   "http://prometheus:9090")
TEAMS_WEBHOOK_URL = os.getenv("TEAMS_WEBHOOK_URL", "")

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
            # synapse_agent는 에러 로그 1건마다 별도 시계열(value=1)을 생성
            # increase() 대신 count()로 현재 활성 시계열(= 에러 건수) 집계
            "log_errors":     'count(log_error_total{{system_name="{sn}"}})',
            "log_errors_err": 'count(log_error_total{{system_name="{sn}",level="ERROR"}})',
        },
        "web": {
            "req_total":   'sum_over_time(increase(http_request_total{{system_name="{sn}"}}[5m])[1h:5m])',
            "req_slow":    'sum_over_time(increase(http_request_slow_total{{system_name="{sn}"}}[5m])[1h:5m])',
            "resp_avg_ms": 'avg_over_time(http_request_duration_ms{{system_name="{sn}"}}[1h])',
        },
    },
}


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
            if metrics.get("mem_p95", 0) > 85:
                return True, f"Memory p95 {metrics['mem_p95']}% > 85%"
            if metrics.get("mem_used_pct", 0) > 80:
                return True, f"Memory avg {metrics['mem_used_pct']}% > 80%"
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


# ── WF6: run_hourly_aggregation ───────────────────────────────────────────────

async def _process_single_config(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    config: dict,
    hour_bucket_iso: str,
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

            # 이상 감지
            anomaly_detected, anomaly_reason = _detect_anomaly(
                collector_type, metric_group, metrics
            )

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

            # 이상 감지 → LLM 분석
            metrics_formatted = "\n".join(f"  {k}: {v}" for k, v in metrics.items())
            llm_prompt = (
                f"시스템: {display_name} ({system_name})\n"
                f"시간대: {hour_bucket_iso} (1시간 집계)\n"
                f"수집기: {collector_type} / {metric_group}\n"
                f"이상 감지 사유: {anomaly_reason}\n\n"
                f"[현재 시간 집계 메트릭]\n{metrics_formatted}\n\n"
                "위 메트릭 데이터를 분석하여 다음 JSON 형식으로만 응답하세요:\n"
                "{\n"
                '  "severity": "normal 또는 warning 또는 critical 중 하나",\n'
                '  "trend": "상승 또는 하락 또는 안정 또는 불규칙 (1문장 설명)",\n'
                '  "prediction": "현재 추세가 지속되면 임계치 도달 예상 (예측 불가 시 null)",\n'
                '  "root_cause_hypothesis": "가능한 원인 (한국어, 1문장)",\n'
                '  "recommendation": "권고 조치 (한국어, 1~2문장)"\n'
                "}"
            )

            llm_text = await call_llm_text(llm_prompt, max_tokens=400)
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

            point_id = None
            if pg_row_id:
                try:
                    embedding = await vector_client.get_embedding(summary_text)
                    point_id = await aggregation_vector_client.store_hourly_pattern_vector(
                        embedding=embedding,
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
                                {
                                    "type": "FactSet",
                                    "facts": [
                                        {"title": "시스템",    "value": f"{display_name} ({system_name})"},
                                        {"title": "수집기",    "value": f"{collector_type} / {metric_group}"},
                                        {"title": "이상 감지", "value": anomaly_reason},
                                        {"title": "추세",      "value": llm_trend or "-"},
                                        {"title": "예측",      "value": llm_prediction or "-"},
                                        {"title": "권고 조치", "value": llm_summary or "-"},
                                    ],
                                },
                            ],
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
    now = datetime.now(timezone.utc)
    # 현재 시각 기준 정각 (집계 대상 시간대)
    hour_bucket = now.replace(minute=0, second=0, microsecond=0)
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

        sem = asyncio.Semaphore(20)
        tasks = [
            _process_single_config(client, sem, cfg, hour_bucket_iso)
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
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)
    day_bucket_iso = yesterday_start.isoformat()

    async with httpx.AsyncClient(timeout=30.0) as client:
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
            key = (
                row.get("system_id"),
                row.get("system_name", ""),
                row.get("display_name", row.get("system_name", "")),
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
                    f"시스템:{g['system_name']} 날짜:{day_bucket_iso.split('T')[0]}",
                    f"수집기:{g['collector_type']}/{g['metric_group']}",
                    f"집계시간:{g['hour_count']}h 이상:{g['anomaly_hours']}h",
                ]
                if predictions_str:
                    summary_parts.append(f"예측:{predictions_str[:200]}")
                summary_text = " | ".join(summary_parts)

                if pg_row_id:
                    try:
                        embedding = await vector_client.get_embedding(summary_text)
                        await aggregation_vector_client.store_aggregation_summary_vector(
                            embedding=embedding,
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

    logger.info("daily 집계 완료 — processed=%d errors=%d", processed, errors)
    return {"processed": processed, "errors": errors}


# ── WF8: run_weekly_report ────────────────────────────────────────────────────

async def run_weekly_report() -> dict:
    """
    WF8 로직 이관 — 전주 일별 집계 → 주간 통계 → LLM → Teams → 이력 저장.
    """
    now = datetime.now(timezone.utc)
    # 이번 주 월요일 00:00
    weekday = now.weekday()  # 0=월
    this_monday = (now - timedelta(days=weekday)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    last_monday = this_monday - timedelta(days=7)

    week_start_iso = last_monday.isoformat()
    week_end_iso   = (this_monday - timedelta(seconds=1)).isoformat()

    async with httpx.AsyncClient(timeout=60.0) as client:
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
            sn = row.get("system_name", "")
            dn = row.get("display_name", sn)
            if sn not in system_summary:
                system_summary[sn] = {
                    "system_id":           row.get("system_id"),
                    "display_name":        dn,
                    "total_anomaly_hours": 0,
                    "worst_severity":      "normal",
                    "metrics":             [],
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

        week_start_dt = last_monday
        week_end_dt   = this_monday - timedelta(days=1)
        date_range = (
            f"{week_start_dt.strftime('%Y년 %m월 %d일')} ~ "
            f"{week_end_dt.strftime('%Y년 %m월 %d일')}"
        )

        llm_prompt = (
            f"다음은 지난 7일간 시스템 모니터링 집계 데이터입니다.\n\n"
            f"[시스템별 주간 현황 (이상 시간 순)]\n"
            + "\n".join(system_lines)
            + f"\n\n총 {len(system_summary)}개 시스템 모니터링. "
            "한국어로 2-3 문장의 핵심 요약을 작성해 주세요. "
            "가장 주의가 필요한 시스템과 전체적인 추세를 포함해 주세요."
        )

        llm_text = await call_llm_text(llm_prompt, max_tokens=300)
        llm_summary = (
            llm_text if llm_text else "주간 요약 생성 실패"
        )

        total_anomaly = sum(s["total_anomaly_hours"] for s in system_summary.values())
        critical_cnt  = sum(1 for s in system_summary.values() if s["worst_severity"] == "critical")

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
                            "text": f"주간 모니터링 리포트: {date_range}",
                            "weight": "Bolder",
                            "size": "Medium",
                        },
                        {"type": "TextBlock", "text": llm_summary, "wrap": True},
                        {
                            "type": "FactSet",
                            "facts": [
                                {"title": "모니터링 시스템", "value": f"{len(system_summary)}개"},
                                {"title": "총 이상 발생",    "value": f"{round(total_anomaly)}시간"},
                                {"title": "Critical 시스템", "value": f"{critical_cnt}개"},
                            ],
                        },
                    ],
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

        # 주간 집계 저장
        for sn, s in system_summary.items():
            try:
                metrics_json_dict = {
                    "total_anomaly_hours": round(s["total_anomaly_hours"], 2),
                    "worst_severity":      s["worst_severity"],
                    "system_count":        1,
                }
                await client.post(
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
            except Exception as exc:
                logger.warning("주간 집계 저장 실패 [%s]: %s", sn, exc)

    logger.info("weekly 리포트 완료 — systems=%d", len(system_summary))
    return {"status": "ok", "system_count": len(system_summary)}


# ── WF9: run_monthly_report ───────────────────────────────────────────────────

async def run_monthly_report() -> dict:
    """
    WF9 로직 이관 — 전월 주별 집계 → 월간 통계 → LLM → Teams → 이력 저장.
    """
    now = datetime.now(timezone.utc)
    # 전월 시작일 ~ 이번달 시작일
    this_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if this_month_start.month == 1:
        prev_month_start = this_month_start.replace(
            year=this_month_start.year - 1, month=12
        )
    else:
        prev_month_start = this_month_start.replace(month=this_month_start.month - 1)

    month_start_iso = prev_month_start.isoformat()
    month_end_iso   = (this_month_start - timedelta(seconds=1)).isoformat()
    month_name = prev_month_start.strftime("%Y년 %m월")

    async with httpx.AsyncClient(timeout=60.0) as client:
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
            sn = row.get("system_name", "")
            dn = row.get("display_name", sn)
            if sn not in system_summary:
                system_summary[sn] = {
                    "system_id":           row.get("system_id"),
                    "display_name":        dn,
                    "total_anomaly_hours": 0,
                    "worst_severity":      "normal",
                    "trends":              [],
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

        llm_prompt = (
            f"{month_name} 전체 시스템 모니터링 월간 집계입니다.\n\n"
            f"[시스템별 월간 현황]\n"
            + "\n".join(system_lines)
            + f"\n\n총 {len(system_summary)}개 시스템. "
            "이번 달의 전반적인 시스템 안정성, 주목할 만한 이슈, "
            "다음 달 주의사항을 한국어로 3-4 문장으로 요약해 주세요."
        )

        llm_text = await call_llm_text(llm_prompt, max_tokens=400)
        llm_summary = llm_text if llm_text else "월간 요약 생성 실패"

        total_anomaly = sum(s["total_anomaly_hours"] for s in system_summary.values())
        critical_cnt  = sum(1 for s in system_summary.values() if s["worst_severity"] == "critical")

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
                            "text": f"월간 모니터링 리포트: {month_name}",
                            "weight": "Bolder",
                            "size": "Medium",
                        },
                        {"type": "TextBlock", "text": llm_summary, "wrap": True},
                        {
                            "type": "FactSet",
                            "facts": [
                                {"title": "모니터링 시스템", "value": f"{len(system_summary)}개"},
                                {"title": "총 이상 발생",    "value": f"{round(total_anomaly)}시간"},
                                {"title": "Critical 시스템", "value": f"{critical_cnt}개"},
                            ],
                        },
                    ],
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
        sn = row.get("system_name", "")
        dn = row.get("display_name", sn)
        if sn not in system_summary:
            system_summary[sn] = {
                "system_id":           row.get("system_id"),
                "display_name":        dn,
                "total_anomaly_hours": 0,
                "worst_severity":      "normal",
                "trends":              [],
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

    llm_prompt = (
        f"{label} 전체 시스템 모니터링 {period_label_kr} 집계입니다.\n\n"
        f"[시스템별 현황]\n"
        + "\n".join(system_lines)
        + f"\n\n총 {len(system_summary)}개 시스템. "
        "이 기간의 전반적인 시스템 안정성 평가, 개선된 점, "
        "우려되는 장기 추세, 향후 권고사항을 한국어로 4-5 문장으로 요약해 주세요."
    )

    llm_text = await call_llm_text(llm_prompt, max_tokens=500)
    llm_summary = llm_text if llm_text else "장기 요약 생성 실패"

    total_anomaly = sum(s["total_anomaly_hours"] for s in system_summary.values())
    critical_cnt  = sum(1 for s in system_summary.values() if s["worst_severity"] == "critical")

    period_emoji = {"annual": "🗓️", "half_year": "📆"}.get(period_type, "📊")

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
                        "text": f"{period_emoji} {label} 모니터링 리포트",
                        "weight": "Bolder",
                        "size": "Medium",
                    },
                    {"type": "TextBlock", "text": llm_summary, "wrap": True},
                    {
                        "type": "FactSet",
                        "facts": [
                            {
                                "title": "기간",
                                "value": (
                                    f"{period_start.strftime('%Y-%m-%d')} ~ "
                                    f"{period_end.strftime('%Y-%m-%d')}"
                                ),
                            },
                            {"title": "모니터링 시스템", "value": f"{len(system_summary)}개"},
                            {"title": "총 이상 발생",    "value": f"{round(total_anomaly)}시간"},
                            {"title": "Critical 시스템", "value": f"{critical_cnt}개"},
                        ],
                    },
                ],
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

    return {"status": "ok", "period_type": period_type, "system_count": len(system_summary)}


async def run_longperiod_report() -> dict:
    """
    WF10 로직 이관 — 분기/반기/연간 리포트.
    오늘 날짜 기준으로 생성할 period_type 결정 후 순차 실행.
    """
    now = datetime.now(timezone.utc)
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
) -> dict:
    """단일 시스템의 지속 이상 트렌드 알림 처리"""
    async with sem:
        try:
            system_id      = item.get("system_id")
            system_name    = item.get("system_name", "")
            display_name   = item.get("display_name", system_name)
            collector_type = item.get("collector_type", "")
            metric_group   = item.get("metric_group", "")
            anomaly_hours  = item.get("anomaly_hours", 0)
            worst_severity = item.get("worst_severity", "warning")
            trend_sequence = item.get("trend_sequence", "추세 데이터 없음")
            predictions    = item.get("predictions", "예측 없음")

            # 시스템별 webhook URL
            sys_info       = systems_map.get(system_id, {})
            webhook_url    = sys_info.get("teams_webhook_url") or ""

            llm_prompt = (
                f"시스템: {display_name} ({system_name})\n"
                f"분석 기간: 최근 8시간 중 {anomaly_hours}시간 이상 감지\n"
                f"수집기: {collector_type} / {metric_group}\n"
                f"최고 심각도: {worst_severity}\n\n"
                f"[시간별 추세 흐름]\n{trend_sequence}\n\n"
                f"[기존 예측 목록]\n{predictions}\n\n"
                "이 시스템이 지속적으로 이상 상태를 보이고 있습니다.\n"
                "임계치 도달 예상 시점과 조치 우선순위를 다음 JSON 형식으로만 응답해 주세요:\n"
                "{\n"
                '  "hours_to_breach": 숫자 또는 null,\n'
                '  "breach_metric": "임계치에 먼저 도달할 메트릭명",\n'
                '  "severity": "warning 또는 critical 중 하나",\n'
                '  "trend_summary": "지속 추세 요약 (1문장)",\n'
                '  "immediate_actions": "즉시 조치 사항 (1~2문장)"\n'
                "}"
            )

            llm_text = await call_llm_text(llm_prompt, max_tokens=300)
            llm_result = _parse_llm_json(llm_text, {
                "severity": "warning",
                "trend_summary": "분석 실패",
                "hours_to_breach": None,
                "breach_metric": "-",
                "immediate_actions": "-",
            })

            severity    = llm_result.get("severity", "warning")
            hours_text  = (
                f"약 {llm_result['hours_to_breach']}시간 후"
                if llm_result.get("hours_to_breach") else "예측 불가"
            )

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
                                "text": f"[장애 예방] {display_name} 지속 이상 감지",
                                "weight": "Bolder",
                                "size": "Medium",
                                "color": "Attention" if severity == "critical" else "Warning",
                            },
                            {
                                "type": "FactSet",
                                "facts": [
                                    {"title": "시스템",      "value": f"{display_name} ({system_name})"},
                                    {"title": "수집기",      "value": f"{collector_type} / {metric_group}"},
                                    {"title": "지속 이상",   "value": f"최근 8시간 중 {anomaly_hours}시간"},
                                    {"title": "추세",        "value": llm_result.get("trend_summary", "-")},
                                    {"title": "임계치 예상", "value": f"{llm_result.get('breach_metric', '-')} — {hours_text}"},
                                    {"title": "즉시 조치",   "value": llm_result.get("immediate_actions", "-")},
                                ],
                            },
                        ],
                    },
                }],
            }

            await _send_teams(client, webhook_url, card)

            # alert_history 저장 — admin-api에 적절한 엔드포인트 없음 → 로그만 기록
            logger.info(
                "프로액티브 트렌드 알림 발송 — system=%s collector=%s/%s severity=%s",
                system_name, collector_type, metric_group, severity,
            )

            return {"status": "ok", "system": system_name, "severity": severity}

        except Exception as exc:
            logger.error(
                "트렌드 알림 처리 오류 [%s]: %s",
                item.get("system_name"), exc,
            )
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

        # 시스템+collector_type+metric_group 그룹핑
        groups: dict[tuple, dict] = {}
        for row in hourly_rows:
            sev = row.get("llm_severity", "normal")
            if sev not in ("warning", "critical"):
                continue
            key = (
                row.get("system_id"),
                row.get("system_name", ""),
                row.get("display_name", ""),
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
                    "anomaly_hours":  0,
                    "worst_severity": "warning",
                    "trends":         [],
                    "predictions":    [],
                }
            g = groups[key]
            g["anomaly_hours"] += 1
            if sev == "critical":
                g["worst_severity"] = "critical"
            if row.get("llm_trend"):
                g["trends"].append(row["llm_trend"])
            if row.get("llm_prediction"):
                g["predictions"].append(row["llm_prediction"])

        # anomaly_hours >= 3 필터
        targets = [
            {
                **g,
                "trend_sequence": " → ".join(g["trends"]) if g["trends"] else "추세 데이터 없음",
                "predictions":    " | ".join(g["predictions"]) if g["predictions"] else "예측 없음",
            }
            for g in groups.values()
            if g["anomaly_hours"] >= 3
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

        sem = asyncio.Semaphore(10)
        tasks = [
            _process_single_trend_alert(client, sem, item, systems_map)
            for item in targets[:20]  # 최대 20개
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    ok_cnt  = sum(1 for r in results if not isinstance(r, Exception) and r.get("status") == "ok")
    err_cnt = sum(1 for r in results if isinstance(r, Exception) or r.get("status") == "error")

    logger.info("trend_alert 완료 — alerted=%d errors=%d", ok_cnt, err_cnt)
    return {"status": "ok", "alerted": ok_cnt, "errors": err_cnt}
