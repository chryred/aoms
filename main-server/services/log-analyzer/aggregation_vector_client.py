"""
Synapse Phase 5 — 집계 데이터 벡터 클라이언트 (ADR-011 Hybrid)

1시간/일간/주간/월간 집계 요약을 Qdrant에 저장하고, UI 유사도 검색 프록시로 활용한다.

컬렉션 & 벡터 구성:
  metric_hourly_patterns  — Dense(1024) + Sparse(BM25) Hybrid (챗봇 RAG + UI 검색)
  aggregation_summaries   — Dense(1024) + Sparse(BM25) Hybrid (RAG 챗봇 대상, 시스템명·기간 키워드 검색 필요)
"""

import logging
from datetime import datetime, timezone
from uuid import uuid4

from vector_client import (
    QDRANT_URL,
    _hybrid_search,
    _qdrant_http,
    ensure_collection,
    get_embedding,
    get_sparse_vector,
)

logger = logging.getLogger(__name__)

HOURLY_PATTERNS_COLLECTION = "metric_hourly_patterns"
AGG_SUMMARIES_COLLECTION   = "aggregation_summaries"


async def ensure_aggregation_collections() -> dict:
    """두 컬렉션이 없으면 생성. 둘 다 Dense+Sparse Hybrid 스키마."""
    hourly_created  = await ensure_collection(HOURLY_PATTERNS_COLLECTION, hybrid=True)
    summary_created = await ensure_collection(AGG_SUMMARIES_COLLECTION,  hybrid=True)
    return {
        HOURLY_PATTERNS_COLLECTION: hourly_created,
        AGG_SUMMARIES_COLLECTION:   summary_created,
    }


async def store_hourly_pattern_vector(
    embedding: list[float],
    sparse: dict,
    system_id: int,
    system_name: str,
    hour_bucket: str,          # ISO 형식
    collector_type: str,
    metric_group: str,
    summary_text: str,
    llm_severity: str,
    llm_trend: str | None,
    llm_prediction: str | None,
    pg_row_id: int,
) -> str:
    """1시간 집계 패턴을 Qdrant metric_hourly_patterns에 Dense+Sparse로 저장. point_id 반환."""
    point_id = str(uuid4())
    payload = {
        "system_id":      system_id,
        "system_name":    system_name,
        "hour_bucket":    hour_bucket,
        "collector_type": collector_type,
        "metric_group":   metric_group,
        "summary_text":   summary_text[:1000],
        "llm_severity":   llm_severity,
        "llm_trend":      llm_trend,
        "llm_prediction": llm_prediction,
        "pg_row_id":      pg_row_id,
        "stored_at":      datetime.now(timezone.utc).isoformat(),
    }
    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{HOURLY_PATTERNS_COLLECTION}/points",
        json={
            "points": [{
                "id": point_id,
                "vector": {
                    "dense": embedding,
                    "sparse": {
                        "indices": sparse["indices"],
                        "values":  sparse["values"],
                    },
                },
                "payload": payload,
            }]
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    return point_id


async def store_aggregation_summary_vector(
    embedding: list[float],
    sparse: dict,
    system_id: int,
    system_name: str,
    period_type: str,
    period_start: str,
    summary_text: str,
    dominant_severity: str,
    pg_row_id: int,
) -> str:
    """집계 요약을 Qdrant aggregation_summaries에 Dense+Sparse로 저장. point_id 반환."""
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
            "points": [{
                "id": point_id,
                "vector": {
                    "dense": embedding,
                    "sparse": {
                        "indices": sparse["indices"],
                        "values":  sparse["values"],
                    },
                },
                "payload": payload,
            }]
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
    *,
    rerank: bool = False,
    rerank_top_k: int = 10,
) -> list[dict]:
    """
    query_text를 임베딩하여 Qdrant 컬렉션에서 유사 집계 검색.
    UI 프록시 엔드포인트 /aggregation/search 에서 호출.
    두 컬렉션 모두 Hybrid (Dense + Sparse RRF) 검색.

    rerank=True 일 때 cross-encoder(bge-reranker-v2-m3)로 재정렬한다.
    이 경우 retrieval 후보를 limit*4 까지 늘려 확보한 뒤 reranker로 rerank_top_k 개만 반환.
    """
    if collection not in (HOURLY_PATTERNS_COLLECTION, AGG_SUMMARIES_COLLECTION):
        raise ValueError(f"지원하지 않는 컬렉션: {collection}")

    dense = await get_embedding(query_text)
    sparse = await get_sparse_vector(query_text)

    filter_must = None
    if system_id is not None:
        filter_must = [{"key": "system_id", "match": {"value": system_id}}]

    retrieval_limit = limit * 4 if rerank else limit
    hits = await _hybrid_search(
        collection=collection,
        dense=dense,
        sparse=sparse,
        filter_must=filter_must,
        limit=retrieval_limit,
    )

    if not rerank or not hits:
        return hits

    # 재정렬 대상 텍스트 평탄화 (payload.summary_text)
    from reranker import rerank as _rerank
    candidates = []
    for h in hits:
        payload = h.get("payload") or {}
        candidates.append({**h, "_rerank_text": payload.get("summary_text", "")})
    reranked = await _rerank(
        query_text, candidates, top_k=rerank_top_k, text_field="_rerank_text"
    )
    # 내부 임시 필드 제거
    for r in reranked:
        r.pop("_rerank_text", None)
    return reranked


async def search_similar_by_vector(
    point_id: str,
    collection: str,
    system_id: int | None = None,
    limit: int = 5,
) -> list[dict]:
    """
    기존 Qdrant point의 벡터를 그대로 사용하여 유사 기간 검색.
    /aggregation/similar-period 엔드포인트에서 호출.
    Dense 벡터 기준 검색 (Sparse는 유사 기간 검색 품질에 큰 영향 없음).
    """
    if collection not in (HOURLY_PATTERNS_COLLECTION, AGG_SUMMARIES_COLLECTION):
        raise ValueError(f"지원하지 않는 컬렉션: {collection}")

    # point의 dense 벡터 조회
    resp = await _qdrant_http.get(
        f"{QDRANT_URL}/collections/{collection}/points/{point_id}",
        params={"with_vectors": "true"},
        timeout=15.0,
    )
    resp.raise_for_status()
    point_data = resp.json().get("result", {})

    vectors = point_data.get("vector") or {}
    # named vectors 응답: {"dense": [...], "sparse": {...}} 또는 flat list
    if isinstance(vectors, dict):
        dense = vectors.get("dense")
    else:
        dense = vectors

    if not dense:
        return []

    filter_must = None
    if system_id is not None:
        filter_must = [{"key": "system_id", "match": {"value": system_id}}]

    body: dict = {
        "query":        dense,   # Qdrant 1.17: dense는 배열 직접 전달
        "using":        "dense",
        "limit":        limit + 1,  # 자기 자신 제외 예비
        "with_payload": True,
    }
    if filter_must:
        body["filter"] = {"must": filter_must}

    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{collection}/points/query",
        json=body,
        timeout=30.0,
    )
    resp.raise_for_status()
    points = resp.json().get("result", {}).get("points", [])
    return [
        {"id": p["id"], "score": p["score"], "payload": p.get("payload", {})}
        for p in points
        if p["id"] != point_id
    ][:limit]


async def get_collections_info() -> dict:
    """UI 헬스/상태 확인용 — 4개 컬렉션의 point 수 및 상태 반환"""
    from vector_client import COLLECTION as LOG_COLLECTION, METRIC_COLLECTION

    all_collections = (
        LOG_COLLECTION,
        METRIC_COLLECTION,
        HOURLY_PATTERNS_COLLECTION,
        AGG_SUMMARIES_COLLECTION,
    )
    info = {}
    for name in all_collections:
        try:
            resp = await _qdrant_http.get(f"{QDRANT_URL}/collections/{name}")
            if resp.status_code == 200:
                data = resp.json().get("result", {})
                info[name] = {
                    "points_count":  data.get("points_count", 0),
                    "vectors_count": data.get("vectors_count", 0),
                    "status":        data.get("status", "unknown"),
                }
            else:
                info[name] = {"status": "not_found"}
        except Exception as e:
            info[name] = {"status": "error", "detail": str(e)}
    return info
