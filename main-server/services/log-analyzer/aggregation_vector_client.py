"""
Synapse Phase 5 — 집계 데이터 벡터 클라이언트

1시간/일간/주간/월간 집계 요약을 Qdrant에 저장하고,
UI 유사도 검색 프록시로 활용한다.

컬렉션:
  metric_hourly_patterns  — WF6 저장 (1시간 집계 LLM 분석 결과)
  aggregation_summaries   — WF7-WF10 저장 (일/주/월 리포트 요약)
"""

import logging
import os
from datetime import datetime, timezone
from uuid import uuid4

from vector_client import get_embedding, ensure_collection, OLLAMA_URL, EMBED_MODEL, QDRANT_URL, _qdrant_http

logger = logging.getLogger(__name__)

HOURLY_PATTERNS_COLLECTION = "metric_hourly_patterns"
AGG_SUMMARIES_COLLECTION   = "aggregation_summaries"


async def ensure_aggregation_collections() -> dict:
    """두 컬렉션이 없으면 생성 (앱 시작 또는 WF12 호출 시)"""
    hourly_created = await ensure_collection(HOURLY_PATTERNS_COLLECTION)
    summary_created = await ensure_collection(AGG_SUMMARIES_COLLECTION)
    return {
        HOURLY_PATTERNS_COLLECTION: hourly_created,
        AGG_SUMMARIES_COLLECTION:   summary_created,
    }


async def store_hourly_pattern_vector(
    embedding: list[float],
    system_id: int,
    system_name: str,
    hour_bucket: str,          # ISO 형식
    collector_type: str,
    metric_group: str,
    summary_text: str,         # 임베딩에 사용된 텍스트 요약
    llm_severity: str,
    llm_trend: str | None,
    llm_prediction: str | None,
    pg_row_id: int,
) -> str:
    """1시간 집계 패턴을 Qdrant metric_hourly_patterns에 저장하고 point_id 반환"""
    point_id = str(uuid4())
    payload = {
        "system_id":      system_id,
        "system_name":    system_name,
        "hour_bucket":    hour_bucket,
        "collector_type": collector_type,
        "metric_group":   metric_group,
        "summary_text":   summary_text[:1000],  # 토큰 절약
        "llm_severity":   llm_severity,
        "llm_trend":      llm_trend,
        "llm_prediction": llm_prediction,
        "pg_row_id":      pg_row_id,
        "stored_at":      datetime.now(timezone.utc).isoformat(),
    }
    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{HOURLY_PATTERNS_COLLECTION}/points",
        json={
            "points": [{"id": point_id, "vector": embedding, "payload": payload}]
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    return point_id


async def store_aggregation_summary_vector(
    embedding: list[float],
    system_id: int,
    system_name: str,
    period_type: str,          # daily | weekly | monthly | quarterly | half_year | annual
    period_start: str,         # ISO 형식
    summary_text: str,
    dominant_severity: str,    # 해당 기간의 대표 severity
    pg_row_id: int,
) -> str:
    """집계 요약을 Qdrant aggregation_summaries에 저장하고 point_id 반환"""
    point_id = str(uuid4())
    payload = {
        "system_id":         system_id,
        "system_name":       system_name,
        "period_type":       period_type,
        "period_start":      period_start,
        "summary_text":      summary_text[:2000],
        "dominant_severity": dominant_severity,
        "pg_row_id":         pg_row_id,
        "stored_at":         datetime.now(timezone.utc).isoformat(),
    }
    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{AGG_SUMMARIES_COLLECTION}/points",
        json={
            "points": [{"id": point_id, "vector": embedding, "payload": payload}]
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    return point_id


async def search_similar_aggregations(
    query_text: str,
    collection: str,
    system_id: int | None = None,
    limit: int = 10,
    score_threshold: float = 0.70,
) -> list[dict]:
    """
    query_text를 임베딩하여 Qdrant 컬렉션에서 유사 집계를 검색.
    UI 프록시 엔드포인트 /aggregation/search 에서 호출.
    """
    if collection not in (HOURLY_PATTERNS_COLLECTION, AGG_SUMMARIES_COLLECTION):
        raise ValueError(f"지원하지 않는 컬렉션: {collection}")

    embedding = await get_embedding(query_text)

    body: dict = {
        "vector": embedding,
        "limit":  limit,
        "score_threshold": score_threshold,
        "with_payload": True,
    }
    if system_id is not None:
        body["filter"] = {
            "must": [{"key": "system_id", "match": {"value": system_id}}]
        }

    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{collection}/points/search",
        json=body,
        timeout=30.0,
    )
    resp.raise_for_status()
    results = resp.json().get("result", [])

    return [
        {"score": r["score"], "payload": r["payload"], "id": r["id"]}
        for r in results
    ]


async def search_similar_by_vector(
    point_id: str,
    collection: str,
    system_id: int | None = None,
    limit: int = 5,
) -> list[dict]:
    """
    기존 Qdrant point의 벡터를 그대로 사용하여 유사 기간 검색.
    /aggregation/similar-period 엔드포인트에서 호출.
    """
    if collection not in (HOURLY_PATTERNS_COLLECTION, AGG_SUMMARIES_COLLECTION):
        raise ValueError(f"지원하지 않는 컬렉션: {collection}")

    # point의 벡터 조회
    resp = await _qdrant_http.get(
        f"{QDRANT_URL}/collections/{collection}/points/{point_id}",
        params={"with_vector": "true"},
        timeout=15.0,
    )
    resp.raise_for_status()
    point_data = resp.json().get("result", {})

    vector = point_data.get("vector")
    if not vector:
        return []

    body: dict = {
        "vector": vector,
        "limit":  limit + 1,        # 자기 자신 제외 예비
        "score_threshold": 0.70,
        "with_payload": True,
    }
    if system_id is not None:
        body["filter"] = {
            "must": [{"key": "system_id", "match": {"value": system_id}}]
        }

    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{collection}/points/search",
        json=body,
        timeout=30.0,
    )
    resp.raise_for_status()
    results = resp.json().get("result", [])

    # 자기 자신 제외
    return [
        {"score": r["score"], "payload": r["payload"], "id": r["id"]}
        for r in results
        if r["id"] != point_id
    ][:limit]


async def get_collections_info() -> dict:
    """UI 헬스/상태 확인용 — 4개 컬렉션의 point 수 및 벡터 차원 반환"""
    from vector_client import COLLECTION as LOG_COLLECTION, METRIC_COLLECTION

    all_collections = (
        LOG_COLLECTION,              # log_incidents
        METRIC_COLLECTION,           # metric_baselines
        HOURLY_PATTERNS_COLLECTION,  # metric_hourly_patterns
        AGG_SUMMARIES_COLLECTION,    # aggregation_summaries
    )
    info = {}
    for name in all_collections:
        try:
            resp = await _qdrant_http.get(f"{QDRANT_URL}/collections/{name}")
            if resp.status_code == 200:
                data = resp.json().get("result", {})
                info[name] = {
                    "points_count": data.get("points_count", 0),
                    "vectors_count": data.get("vectors_count", 0),
                    "status": data.get("status", "unknown"),
                }
            else:
                info[name] = {"status": "not_found"}
        except Exception as e:
            info[name] = {"status": "error", "detail": str(e)}
    return info
