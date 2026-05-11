"""챗봇 검색 검증 API — LLM 없이 RAG 도구 결과를 그대로 노출.

두 가지 모드:
  POST /search-verify/chatbot     — 챗봇이 실제 사용하는 4개 RAG 도구 로직 그대로 호출
  POST /search-verify/collections — 사용자가 선택한 컬렉션을 직접 검색

응답 스키마 (v2 — 그룹 기반):
  groups:  컬렉션별 결과 그룹. 컬렉션 내 점수 순 정렬. 컬렉션 간 교차 정렬 없음
  errors:  부분 실패 목록 (컬렉션 단위)
  used_tools: 호출된 도구 이름 목록
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
_POSTMORTEM_COLLECTIONS = {"incident_postmortems"}
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

# 컬렉션 표준 순서 (chatbot 모드 고정 순서)
_CANONICAL_ORDER = [
    "log_incidents",
    "metric_baselines",
    "incident_postmortems",
    "aggregation_summaries",
    "metric_hourly_patterns",
    "knowledge_jira_issues",
    "knowledge_confluence_pages",
    "knowledge_documents",
]


# ── Pydantic 스키마 ─────────────────────────────────────────────────────────────

class ChatbotSearchRequest(BaseModel):
    query: str
    system_ids: list[int] = []


class CollectionsSearchRequest(BaseModel):
    query: str
    system_ids: list[int] = []
    collections: list[str] = list(
        _INCIDENT_COLLECTIONS | _AGGREGATION_COLLECTIONS | _POSTMORTEM_COLLECTIONS | _KNOWLEDGE_COLLECTIONS
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


class CollectionGroup(BaseModel):
    collection: str
    tool: str
    reranked: bool = False
    results: list[dict[str, Any]]    # extra 필드가 같은 레벨로 평탄화된 dict


class ToolError(BaseModel):
    tool: str
    collection: str
    reason: str


class SearchVerifyResponse(BaseModel):
    groups: list[CollectionGroup]
    used_tools: list[str]
    errors: list[ToolError] = []


def _flatten_item(it: SearchResultItem) -> dict[str, Any]:
    """SearchResultItem 의 extra 객체를 같은 레벨로 펼쳐 평탄한 dict 로 직렬화."""
    d = it.model_dump()
    extra = d.pop("extra", {}) or {}
    for k, v in extra.items():
        if d.get(k) is None:
            d[k] = v
    return d


def _build_groups(
    items: list[SearchResultItem],
    selected_collections: set[str] | None,
    reranked_collections: set[str] | None = None,
) -> list[CollectionGroup]:
    """SearchResultItem 목록을 컬렉션별로 묶어 CollectionGroup 목록으로 반환.

    - selected_collections: 응답에 포함할 컬렉션 집합 (None이면 items에 있는 것만)
    - reranked_collections: 해당 컬렉션 그룹에 reranked=True 설정
    - 그룹 내 점수 내림차순 정렬
    - _CANONICAL_ORDER 기준으로 그룹 순서 정렬
    """
    if reranked_collections is None:
        reranked_collections = set()

    # 컬렉션별 버킷
    buckets: dict[str, list[SearchResultItem]] = {}
    for it in items:
        buckets.setdefault(it.collection, []).append(it)

    # 활성 컬렉션 집합
    active_cols = selected_collections if selected_collections is not None else set(buckets)

    groups: list[CollectionGroup] = []
    for col in _CANONICAL_ORDER:
        if col not in active_cols:
            continue
        col_items = buckets.get(col, [])
        # 그룹 내 점수 내림차순 정렬
        col_items.sort(key=lambda x: x.score if x.score is not None else 0.0, reverse=True)
        # tool 이름: 첫 번째 아이템에서 가져오거나 빈 문자열
        tool = col_items[0].tool if col_items else _collection_to_tool(col)
        groups.append(CollectionGroup(
            collection=col,
            tool=tool,
            reranked=col in reranked_collections,
            results=[_flatten_item(it) for it in col_items],
        ))

    # _CANONICAL_ORDER에 없는 컬렉션 처리 (예비)
    for col in sorted(active_cols - set(_CANONICAL_ORDER)):
        col_items = buckets.get(col, [])
        col_items.sort(key=lambda x: x.score if x.score is not None else 0.0, reverse=True)
        tool = col_items[0].tool if col_items else _collection_to_tool(col)
        groups.append(CollectionGroup(
            collection=col,
            tool=tool,
            reranked=col in reranked_collections,
            results=[_flatten_item(it) for it in col_items],
        ))

    return groups


def _collection_to_tool(collection: str) -> str:
    """컬렉션 이름으로 기본 tool 이름 추론."""
    if collection in _INCIDENT_COLLECTIONS:
        return "qdrant_search_incident_knowledge"
    if collection in _POSTMORTEM_COLLECTIONS:
        return "qdrant_search_incident_postmortem"
    if collection in _AGGREGATION_COLLECTIONS:
        return "qdrant_search_aggregation_summary"
    if collection in _KNOWLEDGE_COLLECTIONS:
        return "qdrant_search_knowledge"
    return "unknown"


# ── 내부 헬퍼 ──────────────────────────────────────────────────────────────────

def _base() -> str:
    return _LOG_ANALYZER_URL.rstrip("/")


async def _call_incident_search(
    query: str,
    system_ids: list[int],
    limit: int = 10,
    use_reranker: bool = False,
) -> tuple[list[SearchResultItem], str | None]:
    """log-analyzer POST /incident/search → log_incidents + metric_baselines 결과."""
    payload: dict[str, Any] = {"query": query, "limit": limit}
    if use_reranker:
        payload["rerank"] = True
    if system_ids:
        payload["system_ids"] = system_ids

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{_base()}/incident/search", json=payload)
            if resp.status_code >= 400:
                msg = f"HTTP {resp.status_code}: {resp.text[:200]}"
                logger.warning("incident/search %s", msg)
                return [], msg
            data = resp.json()
    except Exception as exc:
        logger.warning("incident/search 호출 실패: %s", exc)
        return [], str(exc)

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

    return items, None


async def _call_postmortem_search(
    query: str,
    system_ids: list[int],
    limit: int = 10,
    use_reranker: bool = False,
) -> tuple[list[SearchResultItem], str | None]:
    """log-analyzer POST /incident-postmortem/search → incident_postmortems 결과.

    system_ids: IN list 필터 — 1개든 복수든 항상 system_ids로 전달 (P2-A).
    """
    payload: dict[str, Any] = {"query": query, "limit": limit}
    if use_reranker:
        payload["rerank"] = True
        payload["rerank_top_k"] = limit
    if system_ids:
        payload["system_ids"] = system_ids

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{_base()}/incident-postmortem/search", json=payload)
            if resp.status_code >= 400:
                msg = f"HTTP {resp.status_code}: {resp.text[:200]}"
                logger.warning("incident-postmortem/search %s", msg)
                return [], msg
            data = resp.json()
    except Exception as exc:
        logger.warning("incident-postmortem/search 호출 실패: %s", exc)
        return [], str(exc)

    # log-analyzer returns a list directly; tolerate both list and {"results": [...]}
    raw_list: list = data if isinstance(data, list) else (data.get("results") or [])

    items: list[SearchResultItem] = []
    for r in raw_list:
        payload_data = r.get("payload", r) if isinstance(r, dict) else {}
        title = payload_data.get("title") or ""
        root_cause = payload_data.get("root_cause") or ""
        solution = payload_data.get("solution") or ""
        attachment_text = (payload_data.get("ocr_text") or payload_data.get("attachment_text") or "")[:500]
        content = "\n".join(filter(None, [
            title,
            f"원인: {root_cause}" if root_cause else None,
            f"해결: {solution}" if solution else None,
            f"첨부: {attachment_text}" if attachment_text else None,
        ]))
        raw_sid = payload_data.get("system_id")
        items.append(SearchResultItem(
            tool="qdrant_search_incident_postmortem",
            collection="incident_postmortems",
            score=r.get("score"),
            content=content,
            system_id=int(raw_sid) if raw_sid is not None else None,
            system_name=payload_data.get("system_name"),
            extra={
                "doc_type": "incident_postmortem",
                "incident_id": payload_data.get("incident_id"),
                "severity": payload_data.get("severity"),
                "alert_count": payload_data.get("alert_count"),
                "resolved_at": payload_data.get("resolved_at"),
                "point_id": str(r["id"]) if r.get("id") is not None else None,
            },
        ))

    return items, None


async def _call_aggregation_search(
    query: str,
    system_ids: list[int],
    collection: str = "aggregation_summaries",
    limit: int = 10,
    use_reranker: bool = False,
) -> tuple[list[SearchResultItem], str | None]:
    """log-analyzer POST /aggregation/search → aggregation_summaries 또는 metric_hourly_patterns."""
    payload: dict[str, Any] = {
        "query_text": query,
        "collection": collection,
        "limit": limit,
    }
    if use_reranker:
        payload["rerank"] = True
        payload["rerank_top_k"] = limit
    if system_ids:
        payload["system_ids"] = system_ids

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{_base()}/aggregation/search", json=payload)
            if resp.status_code >= 400:
                msg = f"HTTP {resp.status_code}: {resp.text[:200]}"
                logger.warning("aggregation/search(%s) %s", collection, msg)
                return [], msg
            data = resp.json()
    except Exception as exc:
        logger.warning("aggregation/search 호출 실패: %s", exc)
        return [], str(exc)

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

    return items, None


async def _call_knowledge_search(
    query: str,
    system_ids: list[int],
    sources: list[str] | None,
    use_reranker: bool = True,
    limit: int = 10,
) -> tuple[list[SearchResultItem], str | None]:
    """log-analyzer POST /knowledge/search → jira/confluence/documents federated 검색.

    documents 는 system_ids IN list 필터 적용 (P2-A).
    jira/confluence 는 필터 미적용 (federated_search V1 정책).
    """
    payload: dict[str, Any] = {
        "query": query,
        "limit": limit,
        "rerank": use_reranker,
    }
    if sources:
        payload["sources"] = sources
    if system_ids:
        payload["system_ids"] = system_ids

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{_base()}/knowledge/search", json=payload)
            if resp.status_code >= 400:
                msg = f"HTTP {resp.status_code}: {resp.text[:200]}"
                logger.warning("knowledge/search %s", msg)
                return [], msg
            data = resp.json()
    except Exception as exc:
        logger.warning("knowledge/search 호출 실패: %s", exc)
        return [], str(exc)

    items: list[SearchResultItem] = []
    for r in data.get("results") or []:
        payload_data = r.get("payload") or {}
        collection = r.get("collection") or "knowledge_documents"
        if collection == "knowledge_jira_issues":
            source = "jira"
        elif collection == "knowledge_confluence_pages":
            source = "confluence"
        else:
            source = "documents"

        doc_type = payload_data.get("doc_type")
        if doc_type == "operator_note":
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

    return items, None


# ── 챗봇 시뮬레이션 모드 ──────────────────────────────────────────────────────────

@router.post("/search-verify/chatbot", response_model=SearchVerifyResponse)
async def search_verify_chatbot(
    body: ChatbotSearchRequest,
    _user: User = Depends(get_current_user),
) -> SearchVerifyResponse:
    """챗봇 RAG 4개 도구와 동일 로직으로 검색 — LLM 호출 없음.

    - qdrant_search_incident_knowledge → /incident/search (system_ids 필터)
    - qdrant_search_incident_postmortem → /incident-postmortem/search (system_id 단일 필터)
    - qdrant_search_aggregation_summary → /aggregation/search (system_ids 필터)
    - qdrant_search_knowledge → /knowledge/search (rerank=True, 챗봇 동일)

    chatbot 모드: knowledge만 rerank (실제 챗봇 동작 일치).
    응답: groups (컬렉션별 독립 정렬) + errors (부분 실패).
    """
    query = (body.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query는 필수입니다")

    system_ids = body.system_ids or []

    # 4개 도구 병렬 호출
    (
        (incident_items, incident_err),
        (postmortem_items, postmortem_err),
        (aggregation_items, aggregation_err),
        (knowledge_items, knowledge_err),
    ) = await asyncio.gather(
        _call_incident_search(query, system_ids, use_reranker=False),
        _call_postmortem_search(query, system_ids, use_reranker=False),
        _call_aggregation_search(query, system_ids, collection="aggregation_summaries", use_reranker=False),
        _call_knowledge_search(query, system_ids, sources=["jira", "confluence", "documents"], use_reranker=True),
    )

    all_items = incident_items + postmortem_items + aggregation_items + knowledge_items

    # 에러 수집 — 각 도구의 실패를 관련 컬렉션에 매핑
    errors: list[ToolError] = []
    if incident_err:
        for col in ("log_incidents", "metric_baselines"):
            errors.append(ToolError(
                tool="qdrant_search_incident_knowledge",
                collection=col,
                reason=incident_err,
            ))
    if postmortem_err:
        errors.append(ToolError(
            tool="qdrant_search_incident_postmortem",
            collection="incident_postmortems",
            reason=postmortem_err,
        ))
    if aggregation_err:
        errors.append(ToolError(
            tool="qdrant_search_aggregation_summary",
            collection="aggregation_summaries",
            reason=aggregation_err,
        ))
    if knowledge_err:
        for col in ("knowledge_jira_issues", "knowledge_confluence_pages", "knowledge_documents"):
            errors.append(ToolError(
                tool="qdrant_search_knowledge",
                collection=col,
                reason=knowledge_err,
            ))

    # chatbot 모드 활성 컬렉션 (모두 표시)
    active_cols = (
        _INCIDENT_COLLECTIONS
        | _POSTMORTEM_COLLECTIONS
        | {"aggregation_summaries"}
        | _KNOWLEDGE_COLLECTIONS
    )
    # knowledge만 rerank
    reranked_cols = _KNOWLEDGE_COLLECTIONS

    groups = _build_groups(all_items, selected_collections=active_cols, reranked_collections=reranked_cols)

    return SearchVerifyResponse(
        groups=groups,
        used_tools=[
            "qdrant_search_incident_knowledge",
            "qdrant_search_incident_postmortem",
            "qdrant_search_aggregation_summary",
            "qdrant_search_knowledge",
        ],
        errors=errors,
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
      incident_postmortems → /incident-postmortem/search
      knowledge_jira / knowledge_confluence / knowledge_documents → /knowledge/search

    collections 모드: use_reranker=True 이면 모든 컬렉션에 rerank 적용.
    응답: groups (컬렉션별 독립 정렬) + errors (부분 실패).
    """
    query = (body.query or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query는 필수입니다")

    system_ids = body.system_ids or []
    collections = set(body.collections)
    rerank = body.use_reranker

    # 비동기 작업 목록: (awaitable, label)
    coros: list[Any] = []
    labels: list[str] = []

    incident_cols = collections & _INCIDENT_COLLECTIONS
    if incident_cols:
        coros.append(_call_incident_search(query, system_ids, use_reranker=rerank))
        labels.append("incident")

    if "incident_postmortems" in collections:
        coros.append(_call_postmortem_search(query, system_ids, use_reranker=rerank))
        labels.append("incident_postmortems")

    for col in ("aggregation_summaries", "metric_hourly_patterns"):
        if col in collections:
            coros.append(_call_aggregation_search(query, system_ids, collection=col, use_reranker=rerank))
            labels.append(col)

    knowledge_cols = collections & _KNOWLEDGE_COLLECTIONS
    if knowledge_cols:
        sources = [_KNOWLEDGE_SOURCES_MAP[c] for c in knowledge_cols if c in _KNOWLEDGE_SOURCES_MAP]
        coros.append(_call_knowledge_search(query, system_ids, sources=sources, use_reranker=rerank))
        labels.append("knowledge")

    if not coros:
        raise HTTPException(status_code=400, detail="검색할 컬렉션을 하나 이상 선택하세요")

    results_with_errors: list[tuple[list[SearchResultItem], str | None]] = await asyncio.gather(*coros)

    all_items: list[SearchResultItem] = []
    errors: list[ToolError] = []

    for label, (items, err) in zip(labels, results_with_errors):
        all_items.extend(items)
        if err:
            if label == "incident":
                for col in sorted(incident_cols):
                    errors.append(ToolError(
                        tool="qdrant_search_incident_knowledge",
                        collection=col,
                        reason=err,
                    ))
            elif label == "incident_postmortems":
                errors.append(ToolError(
                    tool="qdrant_search_incident_postmortem",
                    collection="incident_postmortems",
                    reason=err,
                ))
            elif label == "knowledge":
                for col in sorted(knowledge_cols):
                    errors.append(ToolError(
                        tool="qdrant_search_knowledge",
                        collection=col,
                        reason=err,
                    ))
            else:
                # aggregation_summaries / metric_hourly_patterns (label == col)
                errors.append(ToolError(
                    tool="qdrant_search_aggregation_summary",
                    collection=label,
                    reason=err,
                ))

    # incident 통합 호출 시 선택 안 된 컬렉션 결과 제거
    if incident_cols and incident_cols != _INCIDENT_COLLECTIONS:
        all_items = [r for r in all_items if r.collection in collections]

    # rerank 적용된 컬렉션 집합 (use_reranker=True이면 모든 선택 컬렉션)
    reranked_cols = collections if rerank else set()

    groups = _build_groups(all_items, selected_collections=collections, reranked_collections=reranked_cols)

    used_tools = sorted({_collection_to_tool(col) for col in collections})

    return SearchVerifyResponse(
        groups=groups,
        used_tools=used_tools,
        errors=errors,
    )
