"""Qdrant Hybrid Search 기반 RAG executor (ADR-011).

log-analyzer HTTP 프록시를 통해 Qdrant Hybrid 검색 결과를 챗봇에 전달한다.

검색(Search) 도구:
- qdrant_search_incident_knowledge: log_incidents + metric_baselines 통합 검색
- qdrant_search_aggregation_summary: aggregation_summaries 기간별 요약 검색
- qdrant_search_hourly_patterns: metric_hourly_patterns 1시간 집계 패턴 검색
- qdrant_search_guide: knowledge_guides Hybrid 검색 (시스템별 + 공통 가이드)
- qdrant_search_incident_postmortem: incident_postmortems 사후분석 검색
- qdrant_search_knowledge: V1 knowledge federated 검색 (jira/confluence/documents)

청크 조회(Get-Chunks) 도구 — 검색 결과의 청크가 부족하면 LLM이 호출:
- qdrant_get_chunks(source, id, chunk_indexes?, max_chunks?): 청크 조회 통합 도구.
  source: 'guide' (id=guide_id) | 'document' (id=file_hash) | 'confluence' (id=page_id).
  chunk_indexes 명시 시 surgical fetch, 생략 시 전체 (max_chunks 한도).
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
    system_ids  = args.get("system_ids")  # list[int] 다중 필터 (신규)
    limit       = min(int(args.get("limit", 5)), 10)
    base        = await _base_url(db)

    payload: dict[str, Any] = {"query": query, "limit": limit}
    if system_name:
        payload["system_name"] = system_name
    if system_ids:
        payload["system_ids"] = [int(sid) for sid in system_ids]

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

    system_id  = args.get("system_id")
    system_ids = args.get("system_ids")  # list[int] 다중 필터 (신규)
    limit      = min(int(args.get("limit", 5)), 10)
    base       = await _base_url(db)

    payload: dict[str, Any] = {
        "query_text": query,
        "collection": "aggregation_summaries",
        "limit":      limit,
    }
    if system_id is not None:
        payload["system_id"] = int(system_id)
    if system_ids:
        payload["system_ids"] = [int(sid) for sid in system_ids]

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
    system_ids  = args.get("system_ids")  # list[int] 다중 필터 (신규)
    limit       = min(int(args.get("limit", 5)), 10)
    base        = await _base_url(db)

    payload: dict[str, Any] = {
        "query_text": query,
        "collection": "metric_hourly_patterns",
        "limit":      limit,
    }
    if system_name:
        payload["system_name"] = system_name
    if system_ids:
        payload["system_ids"] = [int(sid) for sid in system_ids]

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


async def _search_incident_postmortem(
    db: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    """인시던트 사후분석(원인·해결책·OCR 첨부 통합) 시맨틱 검색.

    log-analyzer POST /incident-postmortem/search 프록시.
    """
    query = (args.get("query") or "").strip()
    if not query:
        return {"error": "query 파라미터 필요"}

    # system_ids (list) takes priority; fall back to single system_id for BC
    raw_system_ids = args.get("system_ids")
    system_id      = args.get("system_id")
    severity       = args.get("severity")
    limit          = min(int(args.get("limit", 5)), 10)
    base           = await _base_url(db)

    if raw_system_ids:
        effective_system_ids = [int(x) for x in raw_system_ids]
    elif system_id is not None:
        effective_system_ids = [int(system_id)]
    else:
        effective_system_ids = []

    payload: dict[str, Any] = {"query": query, "limit": limit}
    if effective_system_ids:
        payload["system_ids"] = effective_system_ids
    if severity:
        payload["severity"] = severity

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{base}/incident-postmortem/search", json=payload)
            if resp.status_code >= 400:
                return {
                    "error": f"log-analyzer {resp.status_code}: {resp.text[:200]}",
                    "query": query,
                }
            return resp.json()
    except Exception as e:
        return {"error": f"incident-postmortem 검색 실패: {str(e)[:200]}", "query": query}


async def _search_knowledge(
    db: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    """V1 knowledge 컬렉션(Jira/Confluence/Documents) federated Hybrid+Reranker 검색.
    log-analyzer POST /knowledge/search 호출.
    """
    query = (args.get("query") or "").strip()
    if not query:
        return {"error": "query 파라미터 필요"}

    system_id  = args.get("system_id")
    system_name = args.get("system_name")
    sources    = args.get("sources")
    limit      = min(int(args.get("limit", 5)), 10)
    rerank     = bool(args.get("rerank", True))
    base       = await _base_url(db)

    payload: dict[str, Any] = {"query": query, "limit": limit, "rerank": rerank}
    if system_id is not None:
        payload["system_id"] = int(system_id)
    if system_name:
        payload["system_name"] = system_name
    if sources:
        payload["sources"] = sources

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{base}/knowledge/search", json=payload)
            if resp.status_code >= 400:
                return {
                    "error": f"log-analyzer {resp.status_code}: {resp.text[:200]}",
                    "query": query,
                }
            data = resp.json()
    except Exception as e:
        return {"error": f"knowledge 검색 실패: {str(e)[:200]}", "query": query}

    results = data.get("results") or []
    return {
        "query":    query,
        "count":    len(results),
        "results":  [
            {
                # federated_search 응답: {"point_id", "collection", "score", "payload": {...}}
                # 본문 필드는 payload 안에 중첩되어 있으므로 반드시 payload를 경유해야 함
                "source":     r.get("collection"),
                "title":      ((p := r.get("payload") or {}).get("title") or p.get("page_title") or "")[:200],
                "content":    (p.get("text") or p.get("content") or p.get("description") or "")[:500],
                "score":      r.get("score"),
                "system_id":  p.get("system_id"),
                "tags":       p.get("tags"),
                # 전문 조회용 식별자 — LLM이 qdrant_get_chunks 호출 시 사용
                "file_hash":  p.get("file_hash"),
                "page_id":    p.get("page_id"),
                "file_name":  p.get("file_name"),
            }
            for r in results
        ],
    }


async def _search_guides(
    db: AsyncSession, args: dict[str, Any]
) -> dict[str, Any]:
    """knowledge_guides Hybrid 검색 (시스템별 운영 가이드 + 전체 공용 가이드).

    log-analyzer POST /guides/search 호출.
    `system_ids` 지정 시 "system_id IN list OR system_id IS NULL" 필터가
    log-analyzer 측에서 적용된다 (공용 가이드는 항상 함께 노출).
    rerank=True(기본)으로 federated_search와 동일한 reranker 정책 적용.
    """
    query = (args.get("query") or "").strip()
    if not query:
        return {"error": "query 파라미터 필요"}

    system_ids = args.get("system_ids")
    limit      = min(int(args.get("limit", 5)), 10)
    base       = await _base_url(db)

    payload: dict[str, Any] = {
        "query": query,
        "limit": limit,
        "group_by_guide": True,
        "rerank": True,
        "rerank_top_k": limit,
    }
    if system_ids:
        payload["system_ids"] = [int(sid) for sid in system_ids]

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(f"{base}/guides/search", json=payload)
            if resp.status_code >= 400:
                return {
                    "error": f"log-analyzer {resp.status_code}: {resp.text[:200]}",
                    "query": query,
                }
            data = resp.json()
    except Exception as e:
        return {"error": f"가이드 검색 실패: {str(e)[:200]}", "query": query}

    if not isinstance(data, list):
        data = []

    return {
        "query":   query,
        "count":   len(data),
        "results": [
            {
                "guide_id":             (r.get("payload") or {}).get("guide_id") or r.get("id"),
                "system_id":            (r.get("payload") or {}).get("system_id"),
                "title":                ((r.get("payload") or {}).get("title") or "")[:200],
                "content":              ((r.get("payload") or {}).get("content") or "")[:1500],
                "chunk_index":          (r.get("payload") or {}).get("chunk_index"),
                "total_chunks":         (r.get("payload") or {}).get("total_chunks"),
                "matched_chunk_indexes": (r.get("payload") or {}).get("matched_chunk_indexes"),
                "matched_chunks_count": (r.get("payload") or {}).get("matched_chunks_count"),
                "score":                r.get("score"),
                "reranked":             (r.get("payload") or {}).get("reranked", False),
            }
            for r in data
        ],
    }


# ── 청크 조회 (chunked collections) ──────────────────────────────────────────

def _coerce_chunk_indexes(args: dict[str, Any]) -> list[int] | None:
    raw = args.get("chunk_indexes")
    if raw is None or raw == "":
        return None
    if isinstance(raw, str):
        raw = [s.strip() for s in raw.split(",") if s.strip()]
    if not isinstance(raw, (list, tuple)):
        return None
    out: list[int] = []
    for v in raw:
        try:
            out.append(int(v))
        except (TypeError, ValueError):
            continue
    return out or None


async def _get_guide_chunks(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    """가이드 청크 조회. chunk_indexes 명시 시 surgical, 생략 시 전체 (max_chunks 한도).

    log-analyzer GET /guides/{guide_id}/chunks 프록시.
    """
    guide_id = (args.get("guide_id") or "").strip()
    if not guide_id:
        return {"error": "guide_id 파라미터 필요 (검색 결과의 guide_id 사용)"}
    chunk_indexes = _coerce_chunk_indexes(args)
    max_chunks = min(int(args.get("max_chunks", 50)), 100)
    base = await _base_url(db)

    params: list[tuple[str, str | int]] = [("max_chunks", max_chunks)]
    if chunk_indexes:
        for ci in chunk_indexes:
            params.append(("chunk_indexes", ci))

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(f"{base}/guides/{guide_id}/chunks", params=params)
            if resp.status_code >= 400:
                return {"error": f"log-analyzer {resp.status_code}: {resp.text[:200]}", "guide_id": guide_id}
            data = resp.json()
    except Exception as e:
        return {"error": f"가이드 청크 조회 실패: {str(e)[:200]}", "guide_id": guide_id}

    chunks = data.get("chunks") or []
    return {
        "guide_id":       guide_id,
        "total_chunks":   data.get("total_chunks") or len(chunks),
        "fetched_chunks": len(chunks),
        "title":          chunks[0].get("title") if chunks else "",
        "system_id":      chunks[0].get("system_id") if chunks else None,
        "chunks": [
            {
                "chunk_index": c.get("chunk_index"),
                "content":     (c.get("content") or "")[:2000],
            }
            for c in chunks
        ],
    }


async def _get_document_chunks(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    """문서 청크 조회. chunk_indexes 명시 시 surgical, 생략 시 전체.

    log-analyzer GET /knowledge/documents/{file_hash}/chunks 프록시.
    """
    file_hash = (args.get("file_hash") or "").strip()
    if not file_hash:
        return {"error": "file_hash 파라미터 필요 (검색 결과의 file_hash 사용)"}
    chunk_indexes = _coerce_chunk_indexes(args)
    base = await _base_url(db)

    params: list[tuple[str, str | int]] = []
    if chunk_indexes:
        for ci in chunk_indexes:
            params.append(("chunk_indexes", ci))

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{base}/knowledge/documents/{file_hash}/chunks",
                params=params or None,
            )
            if resp.status_code >= 400:
                return {"error": f"log-analyzer {resp.status_code}: {resp.text[:200]}", "file_hash": file_hash}
            data = resp.json()
    except Exception as e:
        return {"error": f"문서 청크 조회 실패: {str(e)[:200]}", "file_hash": file_hash}

    chunks = data.get("chunks") or []
    return {
        "file_hash":      file_hash,
        "total_chunks":   len(chunks),
        "fetched_chunks": len(chunks),
        "chunks": [
            {
                "chunk_index": c.get("chunk_index"),
                "text":        (c.get("text") or "")[:2000],
                "page_no":     c.get("page_no"),
                "sheet_name":  c.get("sheet_name"),
                "slide_no":    c.get("slide_no"),
                "heading":     c.get("heading"),
            }
            for c in chunks
        ],
    }


async def _get_confluence_chunks(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    """Confluence 페이지 청크 조회. chunk_indexes 명시 시 surgical, 생략 시 전체.

    log-analyzer GET /knowledge/confluence/{page_id}/chunks 프록시.
    """
    page_id = (args.get("page_id") or "").strip()
    if not page_id:
        return {"error": "page_id 파라미터 필요 (검색 결과의 page_id 사용)"}
    chunk_indexes = _coerce_chunk_indexes(args)
    max_chunks = min(int(args.get("max_chunks", 50)), 100)
    base = await _base_url(db)

    params: list[tuple[str, str | int]] = [("max_chunks", max_chunks)]
    if chunk_indexes:
        for ci in chunk_indexes:
            params.append(("chunk_indexes", ci))

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{base}/knowledge/confluence/{page_id}/chunks",
                params=params,
            )
            if resp.status_code >= 400:
                return {"error": f"log-analyzer {resp.status_code}: {resp.text[:200]}", "page_id": page_id}
            data = resp.json()
    except Exception as e:
        return {"error": f"Confluence 청크 조회 실패: {str(e)[:200]}", "page_id": page_id}

    chunks = data.get("chunks") or []
    return {
        "page_id":        page_id,
        "page_title":     chunks[0].get("page_title") if chunks else "",
        "url":            chunks[0].get("url") if chunks else None,
        "total_chunks":   len(chunks),
        "fetched_chunks": len(chunks),
        "chunks": [
            {
                "chunk_index": c.get("chunk_index"),
                "heading":     c.get("heading"),
                "text":        (c.get("text") or "")[:2000],
            }
            for c in chunks
        ],
    }


async def _get_chunks(db: AsyncSession, args: dict[str, Any]) -> dict[str, Any]:
    """청크 조회 통합 도구 — source에 따라 guide/document/confluence 분기.

    args:
      source: "guide" | "document" | "confluence" (필수)
      id: source에 따라 guide_id(uuid) | file_hash(sha256) | page_id (필수)
      chunk_indexes?: 부분 청크만 받을 때 (surgical fetch)
      max_chunks?: chunk_indexes 미지정 시 상한 (기본 50, 최대 100). document에는 영향 없음.
    """
    source = (args.get("source") or "").strip().lower()
    target_id = (args.get("id") or "").strip()

    if source not in ("guide", "document", "confluence"):
        return {
            "error": f"source는 'guide' | 'document' | 'confluence' 중 하나여야 합니다 (받음: {source!r})."
        }
    if not target_id:
        id_label = "guide_id" if source == "guide" else "file_hash" if source == "document" else "page_id"
        return {"error": f"id가 필요합니다 (source={source}일 때 {id_label})."}

    if source == "guide":
        delegate_args = {
            "guide_id": target_id,
            "chunk_indexes": args.get("chunk_indexes"),
            "max_chunks": args.get("max_chunks"),
        }
        return await _get_guide_chunks(db, delegate_args)
    if source == "document":
        delegate_args = {
            "file_hash": target_id,
            "chunk_indexes": args.get("chunk_indexes"),
        }
        return await _get_document_chunks(db, delegate_args)
    # confluence
    delegate_args = {
        "page_id": target_id,
        "chunk_indexes": args.get("chunk_indexes"),
        "max_chunks": args.get("max_chunks"),
    }
    return await _get_confluence_chunks(db, delegate_args)


async def execute(db: AsyncSession, name: str, args: dict[str, Any]) -> dict[str, Any]:
    """도구 디스패처."""
    try:
        if name == "qdrant_search_incident_knowledge":
            return await _search_incident_knowledge(db, args)
        if name == "qdrant_search_aggregation_summary":
            return await _search_aggregation_summary(db, args)
        if name == "qdrant_search_hourly_patterns":
            return await _search_hourly_patterns(db, args)
        if name == "qdrant_search_incident_postmortem":
            return await _search_incident_postmortem(db, args)
        if name == "qdrant_search_knowledge":
            return await _search_knowledge(db, args)
        if name == "qdrant_search_guide":
            return await _search_guides(db, args)
        if name == "qdrant_get_chunks":
            return await _get_chunks(db, args)
        return {"error": f"unknown qdrant tool: {name}"}
    except Exception as e:
        return {"error": f"qdrant 도구 실패: {str(e)[:200]}"}
