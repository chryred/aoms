"""챗봇 검색 검증 API — LLM 없이 RAG 도구 결과를 그대로 노출.

두 가지 모드:
  POST /search-verify/chatbot     — 챗봇이 실제 사용하는 3개 RAG 도구 로직 그대로 호출
  POST /search-verify/collections — 사용자가 선택한 컬렉션을 직접 검색
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from models import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["knowledge-verify"])

_LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")
_TIMEOUT = 20.0

# 컬렉션 → log-analyzer 엔드포인트 분류 (Qdrant 실제 컬렉션 이름 기준)
_INCIDENT_COLLECTIONS = {"log_incidents", "metric_baselines"}
_AGGREGATION_COLLECTIONS = {"aggregation_summaries", "metric_hourly_patterns"}
_KNOWLEDGE_COLLECTIONS = {
    "knowledge_jira_issues",
    "knowledge_confluence_pages",
    "knowledge_documents",
}

# knowledge 컬렉션 → federated_search sources 파라미터 값
_KNOWLEDGE_SOURCES_MAP = {
    "knowledge_jira_issues": "jira",
    "knowledge_confluence_pages": "confluence",
    "knowledge_documents": "documents",
}


# ── Pydantic 스키마 ─────────────────────────────────────────────────────────────

class ChatbotSearchRequest(BaseModel):
    query: str
    system_ids: list[int] = []


class CollectionsSearchRequest(BaseModel):
    query: str
    system_ids: list[int] = []
    collections: list[str] = list(
        _INCIDENT_COLLECTIONS | _AGGREGATION_COLLECTIONS | _KNOWLEDGE_COLLECTIONS
    )
    use_reranker: bool = True


class SearchResultItem(BaseModel):
    tool: str
    collection: str
    score: float | None
    content: str
    system_id: int | None = None
    system_name: str | None = None
    extra: dict[str, Any] = {}


class SearchVerifyResponse(BaseModel):
    # results 는 SearchResultItem 의 평탄화된 dict — frontend 가 result.file_name / result.doc_type
    # 등을 직접 접근하므로 응답 직전에 extra 키를 같은 레벨로 펼친다.
    results: list[dict[str, Any]]
    used_tools: list[str]


def _flatten_items(items: list[SearchResultItem]) -> list[dict[str, Any]]:
    """SearchResultItem 의 extra 객체를 같은 레벨로 펼쳐 평탄한 dict 로 직렬화."""
    flat: list[dict[str, Any]] = []
    for it in items:
        d = it.model_dump()
        extra = d.pop("extra", {}) or {}
        # extra 의 키가 평탄 필드와 충돌하면 평탄 필드 우선 (None 만 덮어쓰기)
        for k, v in extra.items():
            if d.get(k) is None:
                d[k] = v
        flat.append(d)
    return flat


# ── 내부 헬퍼 ──────────────────────────────────────────────────────────────────

def _base() -> str:
    return _LOG_ANALYZER_URL.rstrip("/")


async def _call_incident_search(
    query: str,
    system_ids: list[int],
    limit: int = 10,
) -> list[SearchResultItem]:
    """log-analyzer POST /incident/search → log_incidents + metric_baselines 결과."""
    payload: dict[str, Any] = {"query": query, "limit": limit}
    if system_ids:
        payload["system_ids"] = system_ids

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{_base()}/incident/search", json=payload)
            if resp.status_code >= 400:
                logger.warning("incident/search %s: %s", resp.status_code, resp.text[:200])
                return []
            data = resp.json()
    except Exception as exc:
        logger.warning("incident/search 호출 실패: %s", exc)
        return []

    items: list[SearchResultItem] = []

    for r in data.get("log_incidents") or []:
        content = "\n".join(filter(None, [
            r.get("log_pattern"),
            r.get("root_cause"),
            r.get("recommendation"),
            r.get("resolution"),
        ]))
        items.append(SearchResultItem(
            tool="qdrant_search_incident_knowledge",
            collection="log_incidents",
            score=r.get("score"),
            content=content,
            system_name=r.get("system_name"),
            extra={
                "severity": r.get("severity"),
                "resolver": r.get("resolver"),
                "timestamp": r.get("timestamp"),
                "point_id": r.get("point_id"),
            },
        ))

    for r in data.get("metric_incidents") or []:
        content = "\n".join(filter(None, [
            r.get("alertname"),
            r.get("resolution"),
        ]))
        items.append(SearchResultItem(
            tool="qdrant_search_incident_knowledge",
            collection="metric_baselines",
            score=r.get("score"),
            content=content,
            system_name=r.get("system_name"),
            extra={
                "metric_name": r.get("metric_name"),
                "severity": r.get("severity"),
                "resolver": r.get("resolver"),
                "timestamp": r.get("timestamp"),
                "point_id": r.get("point_id"),
            },
        ))

    return items


async def _call_aggregation_search(
    query: str,
    system_ids: list[int],
    collection: str = "aggregation_summaries",
    limit: int = 10,
) -> list[SearchResultItem]:
    """log-analyzer POST /aggregation/search → aggregation_summaries 또는 metric_hourly_patterns."""
    payload: dict[str, Any] = {
        "query_text": query,
        "collection": collection,
        "limit": limit,
    }
    if system_ids:
        payload["system_ids"] = system_ids

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{_base()}/aggregation/search", json=payload)
            if resp.status_code >= 400:
                logger.warning("aggregation/search %s: %s", resp.status_code, resp.text[:200])
                return []
            data = resp.json()
    except Exception as exc:
        logger.warning("aggregation/search 호출 실패: %s", exc)
        return []

    items: list[SearchResultItem] = []
    for r in data.get("results") or []:
        payload_data = r.get("payload") or {}
        raw_sid = payload_data.get("system_id")
        items.append(SearchResultItem(
            tool="qdrant_search_aggregation_summary",
            collection=collection,
            score=r.get("score"),
            content=payload_data.get("summary_text") or "",
            system_id=int(raw_sid) if raw_sid is not None else None,
            system_name=payload_data.get("system_name") or None,
            extra={
                "period_type": payload_data.get("period_type"),
                "period_start": payload_data.get("period_start"),
                "dominant_severity": payload_data.get("dominant_severity"),
                "llm_trend": payload_data.get("llm_trend"),
                "llm_prediction": payload_data.get("llm_prediction"),
                "point_id": str(r["id"]) if r.get("id") is not None else None,
            },
        ))

    return items


async def _call_knowledge_search(
    query: str,
    system_ids: list[int],
    sources: list[str] | None,
    use_reranker: bool = True,
    limit: int = 10,
) -> list[SearchResultItem]:
    """log-analyzer POST /knowledge/search → jira/confluence/documents federated 검색.

    documents 는 system_id 필터 적용 (system_ids 첫 번째 값 또는 미적용).
    jira/confluence 는 필터 미적용 (Subagent A의 federated_search 정책).
    system_ids가 1개이면 system_id로 전달, 2개 이상이면 전달하지 않음 (전체 검색).
    """
    payload: dict[str, Any] = {
        "query": query,
        "limit": limit,
        "rerank": use_reranker,
    }
    if sources:
        payload["sources"] = sources
    # documents 컬렉션: system_ids 1개면 system_id 전달
    if sources and "documents" in sources and len(system_ids) == 1:
        payload["system_id"] = system_ids[0]

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{_base()}/knowledge/search", json=payload)
            if resp.status_code >= 400:
                logger.warning("knowledge/search %s: %s", resp.status_code, resp.text[:200])
                return []
            data = resp.json()
    except Exception as exc:
        logger.warning("knowledge/search 호출 실패: %s", exc)
        return []

    items: list[SearchResultItem] = []
    # log-analyzer federated_search 응답 형식: { results: [{ collection, point_id, score, payload }], by_source }
    # 모든 도메인 필드는 payload 안에 있음. r.get("file_name") 같은 직접 접근은 None을 반환하므로 금지.
    for r in data.get("results") or []:
        payload_data = r.get("payload") or {}
        collection = r.get("collection") or "knowledge_documents"
        # collection → source 추론 (UI 분기 보조 정보)
        if collection == "knowledge_jira_issues":
            source = "jira"
        elif collection == "knowledge_confluence_pages":
            source = "confluence"
        else:
            source = "documents"

        # operator_note 와 일반 문서 청크 구분 — frontend 가 doc_type 으로 카드 분기
        doc_type = payload_data.get("doc_type")
        if doc_type == "operator_note":
            # 운영자 노트는 question/answer 구조 — 질문/답변을 합쳐 본문에 표출
            q = payload_data.get("question") or ""
            a = payload_data.get("answer") or ""
            content = "\n".join(filter(None, [
                f"Q. {q}" if q else None,
                f"A. {a}" if a else None,
            ]))
        else:
            content = (
                payload_data.get("text")
                or payload_data.get("content")
                or payload_data.get("description")
                or ""
            )

        items.append(SearchResultItem(
            tool="qdrant_search_knowledge",
            collection=collection,
            score=r.get("score"),
            content=content,
            system_id=payload_data.get("system_id"),
            system_name=payload_data.get("system_name"),
            extra={
                "doc_type": doc_type,
                "title": payload_data.get("title") or payload_data.get("page_title"),
                "tags": payload_data.get("tags"),
                "source": source,
                "file_name": payload_data.get("file_name"),
                "file_hash": payload_data.get("file_hash"),
                "page_num": payload_data.get("page_num"),
                "chunk_index": payload_data.get("chunk_index"),
                "point_id": str(r["point_id"]) if r.get("point_id") is not None else (str(r["id"]) if r.get("id") is not None else None),
                "jira_key": payload_data.get("jira_key") or payload_data.get("issue_key"),
                "confluence_id": payload_data.get("confluence_id") or payload_data.get("page_id"),
                "url": payload_data.get("url"),
                "question": payload_data.get("question"),
                "answer": payload_data.get("answer"),
                "created_at": payload_data.get("created_at"),
            },
        ))

    return items


def _sort_by_score(items: list[SearchResultItem]) -> list[SearchResultItem]:
    return sorted(items, key=lambda x: x.score if x.score is not None else 0.0, reverse=True)


# ── 챗봇 시뮬레이션 모드 ──────────────────────────────────────────────────────────

@router.post("/search-verify/chatbot", response_model=SearchVerifyResponse)
async def search_verify_chatbot(
    body: ChatbotSearchRequest,
    _user: User = Depends(get_current_user),
) -> SearchVerifyResponse:
    """챗봇 RAG 3개 도구와 동일 로직으로 검색 — LLM 호출 없음.

    - qdrant_search_incident_knowledge → /incident/search (system_ids 필터)
    - qdrant_search_aggregation_summary → /aggregation/search (system_ids 필터)
    - qdrant_search_knowledge → /knowledge/search (documents 만 system_id 필터)
    """
    query = (body.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query는 필수입니다")

    system_ids = body.system_ids or []

    # 3개 도구 병렬 호출
    incident_task = asyncio.create_task(
        _call_incident_search(query, system_ids)
    )
    aggregation_task = asyncio.create_task(
        _call_aggregation_search(query, system_ids, collection="aggregation_summaries")
    )
    knowledge_task = asyncio.create_task(
        _call_knowledge_search(
            query,
            system_ids,
            sources=["jira", "confluence", "documents"],
            use_reranker=True,
        )
    )

    incident_results, aggregation_results, knowledge_results = await asyncio.gather(
        incident_task, aggregation_task, knowledge_task
    )

    all_results = incident_results + aggregation_results + knowledge_results

    return SearchVerifyResponse(
        results=_flatten_items(_sort_by_score(all_results)),
        used_tools=[
            "qdrant_search_incident_knowledge",
            "qdrant_search_aggregation_summary",
            "qdrant_search_knowledge",
        ],
    )


# ── 컬렉션 직접 검색 모드 ───────────────────────────────────────────────────────

@router.post("/search-verify/collections", response_model=SearchVerifyResponse)
async def search_verify_collections(
    body: CollectionsSearchRequest,
    _user: User = Depends(get_current_user),
) -> SearchVerifyResponse:
    """사용자가 선택한 컬렉션을 직접 검색 — LLM 호출 없음.

    컬렉션 → log-analyzer 엔드포인트 분기:
      log_incidents / metric_baselines → /incident/search
      aggregation_summaries / metric_hourly_patterns → /aggregation/search
      knowledge_jira / knowledge_confluence / knowledge_documents → /knowledge/search
    """
    query = (body.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query는 필수입니다")

    system_ids = body.system_ids or []
    collections = set(body.collections)

    tasks: list[asyncio.Task[list[SearchResultItem]]] = []
    task_labels: list[str] = []

    # incident 컬렉션 (둘 다 하나의 호출로 통합)
    incident_cols = collections & _INCIDENT_COLLECTIONS
    if incident_cols:
        tasks.append(asyncio.create_task(
            _call_incident_search(query, system_ids)
        ))
        task_labels.append("incident")

    # aggregation 컬렉션 (각각 별도 호출 — 컬렉션명이 다름)
    for col in ("aggregation_summaries", "metric_hourly_patterns"):
        if col in collections:
            tasks.append(asyncio.create_task(
                _call_aggregation_search(query, system_ids, collection=col)
            ))
            task_labels.append(col)

    # knowledge 컬렉션 (선택된 것들만 sources로 필터)
    knowledge_cols = collections & _KNOWLEDGE_COLLECTIONS
    if knowledge_cols:
        sources = [_KNOWLEDGE_SOURCES_MAP[c] for c in knowledge_cols if c in _KNOWLEDGE_SOURCES_MAP]
        tasks.append(asyncio.create_task(
            _call_knowledge_search(query, system_ids, sources=sources, use_reranker=body.use_reranker)
        ))
        task_labels.append("knowledge")

    if not tasks:
        raise HTTPException(status_code=400, detail="검색할 컬렉션을 하나 이상 선택하세요")

    results_per_task = await asyncio.gather(*tasks)

    all_results: list[SearchResultItem] = []
    for results in results_per_task:
        all_results.extend(results)

    # 컬렉션별 필터링 (incident 통합 호출 시 선택 안 된 컬렉션 결과 제거)
    if incident_cols and incident_cols != _INCIDENT_COLLECTIONS:
        all_results = [r for r in all_results if r.collection in collections]

    used_tools = sorted({r.tool for r in all_results})

    return SearchVerifyResponse(
        results=_flatten_items(_sort_by_score(all_results)),
        used_tools=used_tools,
    )
