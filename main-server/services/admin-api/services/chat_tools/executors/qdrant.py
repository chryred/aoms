"""Qdrant Hybrid Search 기반 RAG executor (ADR-011).

log-analyzer HTTP 프록시를 통해 Qdrant Hybrid 검색 결과를 챗봇에 전달한다.
- qdrant_search_incident_knowledge: log_incidents + metric_baselines 통합 검색
- qdrant_search_aggregation_summary: aggregation_summaries 기간별 요약 검색
- qdrant_search_hourly_patterns: metric_hourly_patterns 1시간 집계 패턴 검색
"""

import os
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from services.chat_tools.executor_config import load_executor_config

LOG_ANALYZER_URL_DEFAULT = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")


async def _base_url(db: AsyncSession) -> str:
    """executor_config 또는 환경변수에서 log-analyzer base_url 획득."""
    config = await load_executor_config(db, "qdrant")
    url = (config.get("base_url") or LOG_ANALYZER_URL_DEFAULT or "").rstrip("/")
    return url or LOG_ANALYZER_URL_DEFAULT


async def _search_incident_knowledge(
    db: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    """
    과거 장애 이력·해결책 Hybrid 검색.
    log-analyzer POST /incident/search 호출.
    """
    query = (args.get("query") or "").strip()
    if not query:
        return {"error": "query 파라미터 필요"}

    system_name = args.get("system_name")
    limit       = min(int(args.get("limit", 5)), 10)
    base        = await _base_url(db)

    payload = {"query": query, "limit": limit}
    if system_name:
        payload["system_name"] = system_name

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(f"{base}/incident/search", json=payload)
            if resp.status_code >= 400:
                return {
                    "error": f"log-analyzer {resp.status_code}: {resp.text[:200]}",
                    "query": query,
                }
            data = resp.json()
    except Exception as e:
        return {"error": f"Qdrant 검색 실패: {str(e)[:200]}", "query": query}

    log_items = data.get("log_incidents") or []
    metric_items = data.get("metric_incidents") or []

    # 챗봇이 바로 답변에 쓸 수 있도록 텍스트 간결화
    return {
        "query": query,
        "system_name": system_name,
        "log_count":    len(log_items),
        "metric_count": len(metric_items),
        "log_incidents": [
            {
                "system":        r.get("system_name"),
                "severity":      r.get("severity"),
                "pattern":       r.get("log_pattern"),
                "root_cause":    (r.get("root_cause") or "")[:300],
                "recommendation": (r.get("recommendation") or "")[:300],
                "resolution":    (r.get("resolution") or "")[:300],
                "resolver":      r.get("resolver"),
                "timestamp":     r.get("timestamp"),
                "score":         r.get("score"),
            }
            for r in log_items
        ],
        "metric_incidents": [
            {
                "system":       r.get("system_name"),
                "metric":       r.get("metric_name"),
                "alertname":    r.get("alertname"),
                "severity":     r.get("severity"),
                "metric_value": r.get("metric_value"),
                "resolution":   (r.get("resolution") or "")[:300],
                "resolver":     r.get("resolver"),
                "timestamp":    r.get("timestamp"),
                "score":        r.get("score"),
            }
            for r in metric_items
        ],
    }


async def _search_aggregation_summary(
    db: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    """
    기간별 집계 요약 Hybrid 검색.
    log-analyzer POST /aggregation/search (collection=aggregation_summaries) 호출.
    """
    query = (args.get("query") or "").strip()
    if not query:
        return {"error": "query 파라미터 필요"}

    system_id = args.get("system_id")
    limit     = min(int(args.get("limit", 5)), 10)
    base      = await _base_url(db)

    payload = {
        "query_text": query,
        "collection": "aggregation_summaries",
        "limit":      limit,
    }
    if system_id is not None:
        payload["system_id"] = int(system_id)

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(f"{base}/aggregation/search", json=payload)
            if resp.status_code >= 400:
                return {
                    "error": f"log-analyzer {resp.status_code}: {resp.text[:200]}",
                    "query": query,
                }
            data = resp.json()
    except Exception as e:
        return {"error": f"Qdrant 검색 실패: {str(e)[:200]}", "query": query}

    results = data.get("results") or []
    return {
        "query":     query,
        "system_id": system_id,
        "count":     len(results),
        "results":   [
            {
                "period_type":  r["payload"].get("period_type"),
                "period_start": r["payload"].get("period_start"),
                "system":       r["payload"].get("system_name"),
                "severity":     r["payload"].get("dominant_severity"),
                "summary":      (r["payload"].get("summary_text") or "")[:500],
                "score":        r.get("score"),
            }
            for r in results
        ],
    }


async def _search_hourly_patterns(
    db: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    """
    1시간 집계 패턴 Hybrid 검색.
    log-analyzer POST /aggregation/search (collection=metric_hourly_patterns) 호출.
    """
    query = (args.get("query") or "").strip()
    if not query:
        return {"error": "query 파라미터 필요"}

    system_name = args.get("system_name")
    limit       = min(int(args.get("limit", 5)), 10)
    base        = await _base_url(db)

    payload: dict[str, Any] = {
        "query_text": query,
        "collection": "metric_hourly_patterns",
        "limit":      limit,
    }
    if system_name:
        payload["system_name"] = system_name

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(f"{base}/aggregation/search", json=payload)
            if resp.status_code >= 400:
                return {
                    "error": f"log-analyzer {resp.status_code}: {resp.text[:200]}",
                    "query": query,
                }
            data = resp.json()
    except Exception as e:
        return {"error": f"Qdrant 검색 실패: {str(e)[:200]}", "query": query}

    results = data.get("results") or []
    return {
        "query":       query,
        "system_name": system_name,
        "count":       len(results),
        "results": [
            {
                "hour_bucket":    r["payload"].get("hour_bucket"),
                "system":         r["payload"].get("system_name"),
                "collector_type": r["payload"].get("collector_type"),
                "metric_group":   r["payload"].get("metric_group"),
                "severity":       r["payload"].get("llm_severity"),
                "trend":          r["payload"].get("llm_trend"),
                "prediction":     r["payload"].get("llm_prediction"),
                "summary":        (r["payload"].get("summary_text") or "")[:500],
                "score":          r.get("score"),
            }
            for r in results
        ],
    }


async def execute(db: AsyncSession, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """도구 디스패처."""
    try:
        if name == "qdrant_search_incident_knowledge":
            return await _search_incident_knowledge(db, args)
        if name == "qdrant_search_aggregation_summary":
            return await _search_aggregation_summary(db, args)
        if name == "qdrant_search_hourly_patterns":
            return await _search_hourly_patterns(db, args)
        return {"error": f"unknown qdrant tool: {name}"}
    except Exception as e:
        return {"error": f"qdrant 도구 실패: {str(e)[:200]}"}
