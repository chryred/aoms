"""V1 Knowledge 컬렉션 (Jira/Confluence/Documents) 임베딩 + 검색 + 동기화.

vector_client.py 의 dense/sparse/Qdrant 클라이언트를 재사용.
3종 hybrid 컬렉션과 federated search 제공.

컬렉션 구성:
  knowledge_jira_issues       — Jira 이슈 (Dense+Sparse Hybrid)
  knowledge_confluence_pages  — Confluence 페이지 청크 (Dense+Sparse Hybrid)
  knowledge_documents         — 문서 청크 + 운영자 노트 (Dense+Sparse Hybrid)

Point ID 전략:
  - Jira: sha256("jira:{project}:{issue_id}")[:8] → uint64
  - Confluence: sha256("conf:{page_id}:{chunk_index}")[:8] → uint64
  - Document: sha256("doc:{file_hash}:{chunk_index}")[:8] → uint64
  - OperatorNote: sha256("note:{question[:100]}:{created_at}")[:8] → uint64

RRF cross-collection 병합:
  각 컬렉션의 _hybrid_search 결과 내 RRF 점수는 코퍼스마다 스케일이 다르므로
  각 소스 내 순위(rank)를 기준으로 2차 RRF(k=60) 융합.
  corrected=True 보너스(+0.2)는 병합 후, reranker 이전에 적용.
"""

import asyncio
import hashlib
import logging
from datetime import datetime, timezone

from vector_client import (
    QDRANT_URL,
    _hybrid_search,
    _qdrant_http,
    ensure_collection,
    get_embedding,
    get_sparse_vector,
)

logger = logging.getLogger(__name__)

# ── 컬렉션 상수 ─────────────────────────────────────────────────────────────
JIRA_COLLECTION       = "knowledge_jira_issues"
CONFLUENCE_COLLECTION = "knowledge_confluence_pages"
DOCUMENTS_COLLECTION  = "knowledge_documents"

# Payload 인덱스 정의 (필드명, 타입)
JIRA_PAYLOAD_INDEXES       = [("project", "keyword"), ("status", "keyword"), ("system_name", "keyword")]
CONFLUENCE_PAYLOAD_INDEXES = [("space", "keyword"), ("system_name", "keyword")]
DOCUMENTS_PAYLOAD_INDEXES  = [("doc_type", "keyword"), ("system_id", "integer"), ("tags", "keyword")]

# cross-collection RRF 파라미터
_RRF_K = 60
# corrected 보너스 (2차 RRF 후 적용)
_CORRECTED_BONUS = 0.2


# ── 컬렉션 보장 ─────────────────────────────────────────────────────────────

async def _ensure_payload_indexes(collection: str, indexes: list[tuple[str, str]]) -> None:
    """payload 인덱스를 생성. 이미 존재해도 오류 없음."""
    for field_name, field_type in indexes:
        body: dict = {
            "field_name": field_name,
            "field_schema": field_type,
        }
        try:
            resp = await _qdrant_http.put(
                f"{QDRANT_URL}/collections/{collection}/index",
                json=body,
            )
            # 200/201 모두 성공
            if resp.status_code not in (200, 201):
                logger.warning("payload 인덱스 생성 응답 %d: %s/%s", resp.status_code, collection, field_name)
        except Exception as exc:
            logger.warning("payload 인덱스 생성 실패 %s/%s: %s", collection, field_name, exc)


async def ensure_knowledge_collections() -> None:
    """3종 hybrid 컬렉션 + payload 인덱스 보장. lifespan에서 호출."""
    specs = [
        (JIRA_COLLECTION,       JIRA_PAYLOAD_INDEXES),
        (CONFLUENCE_COLLECTION, CONFLUENCE_PAYLOAD_INDEXES),
        (DOCUMENTS_COLLECTION,  DOCUMENTS_PAYLOAD_INDEXES),
    ]
    for collection, indexes in specs:
        try:
            created = await ensure_collection(collection, hybrid=True)
            if created:
                logger.info("Knowledge 컬렉션 생성: %s", collection)
            await _ensure_payload_indexes(collection, indexes)
        except Exception as exc:
            logger.warning("Knowledge 컬렉션 초기화 실패 %s: %s", collection, exc)


# ── Point ID 생성 (충돌 방지, 결정적 uint64) ──────────────────────────────────

def _sha256_uint64(key: str) -> int:
    """sha256(key)의 첫 8바이트를 big-endian unsigned int64로 반환.

    Python hash()는 프로세스 간 불안정하므로 사용하지 않는다.
    """
    digest = hashlib.sha256(key.encode()).digest()
    return int.from_bytes(digest[:8], "big")


def make_jira_point_id(project_key: str, issue_id: str) -> int:
    """Jira 이슈 Point ID (project_key + issue_id 결합으로 충돌 방지)."""
    return _sha256_uint64(f"jira:{project_key}:{issue_id}")


def make_confluence_point_id(page_id: str, chunk_index: int) -> int:
    """Confluence 페이지 청크 Point ID."""
    return _sha256_uint64(f"conf:{page_id}:{chunk_index}")


def make_document_point_id(file_hash: str, chunk_index: int) -> int:
    """문서 청크 Point ID."""
    return _sha256_uint64(f"doc:{file_hash}:{chunk_index}")


def _make_note_point_id(question: str, created_at: str) -> int:
    """운영자 노트 Point ID (질문 앞 100자 + 생성 시각 결합)."""
    return _sha256_uint64(f"note:{question[:100]}:{created_at}")


# ── Upsert 함수들 ────────────────────────────────────────────────────────────

async def upsert_jira_issue(
    *,
    project: str,
    issue_id: str,
    title: str,
    description: str,
    status: str,
    comments: list[str] | None = None,
    system_name: str | None = None,
    url: str | None = None,
) -> int:
    """Jira 이슈를 knowledge_jira_issues에 upsert. point_id 반환.

    텍스트 = title + description + comments 합산으로 임베딩.
    동일 project/issue_id는 항상 같은 point_id → 재실행 시 덮어쓰기.
    """
    point_id = make_jira_point_id(project, issue_id)

    # 임베딩 대상 텍스트 구성
    text_parts = [f"[{project}] {title}", description or ""]
    if comments:
        text_parts.extend(comments)
    embed_text = "\n".join(p for p in text_parts if p)

    dense, sparse = await asyncio.gather(
        get_embedding(embed_text),
        get_sparse_vector(embed_text),
    )

    payload: dict = {
        "project":      project,
        "issue_id":     issue_id,
        "title":        title,
        "description":  (description or "")[:2000],
        "status":       status,
        "comments":     (comments or [])[:10],  # 최대 10개 보존
        "stored_at":    datetime.now(timezone.utc).isoformat(),
    }
    if system_name:
        payload["system_name"] = system_name
    if url:
        payload["url"] = url

    await ensure_collection(JIRA_COLLECTION, hybrid=True)
    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{JIRA_COLLECTION}/points",
        json={
            "points": [{
                "id": point_id,
                "vector": {
                    "dense": dense,
                    "sparse": {
                        "indices": sparse["indices"],
                        "values":  sparse["values"],
                    },
                },
                "payload": payload,
            }]
        },
    )
    resp.raise_for_status()
    logger.info("Jira 이슈 upsert: %s-%s (point_id=%d)", project, issue_id, point_id)
    return point_id


async def upsert_confluence_chunks(
    *,
    page_id: str,
    page_title: str,
    space: str,
    chunks: list[dict],
    system_name: str | None = None,
    url: str | None = None,
) -> int:
    """Confluence 페이지 청크들을 knowledge_confluence_pages에 upsert.

    chunks: chunking.chunk_confluence_page() 반환값
    저장된 포인트 수 반환.
    """
    if not chunks:
        return 0

    await ensure_collection(CONFLUENCE_COLLECTION, hybrid=True)

    points = []
    for chunk in chunks:
        chunk_index = chunk["metadata"].get("chunk_index", 0)
        point_id = make_confluence_point_id(page_id, chunk_index)
        embed_text = chunk["text"]

        dense, sparse = await asyncio.gather(
            get_embedding(embed_text),
            get_sparse_vector(embed_text),
        )

        payload: dict = {
            "page_id":    page_id,
            "page_title": page_title,
            "space":      space,
            "text":       embed_text[:2000],
            "chunk_index": chunk_index,
            "heading":    chunk["metadata"].get("heading", ""),
            "stored_at":  datetime.now(timezone.utc).isoformat(),
        }
        if system_name:
            payload["system_name"] = system_name
        if url:
            payload["url"] = url

        points.append({
            "id": point_id,
            "vector": {
                "dense": dense,
                "sparse": {
                    "indices": sparse["indices"],
                    "values":  sparse["values"],
                },
            },
            "payload": payload,
        })

    # 배치 upsert (100개씩)
    batch_size = 100
    for i in range(0, len(points), batch_size):
        batch = points[i:i + batch_size]
        resp = await _qdrant_http.put(
            f"{QDRANT_URL}/collections/{CONFLUENCE_COLLECTION}/points",
            json={"points": batch},
        )
        resp.raise_for_status()

    logger.info("Confluence 청크 upsert: page_id=%s, %d 청크", page_id, len(points))
    return len(points)


async def upsert_document_chunks(
    *,
    file_name: str,
    doc_type: str,
    system_id: int,
    chunks: list[dict],
    tags: list[str] | None = None,
) -> int:
    """문서 청크들을 knowledge_documents에 upsert.

    chunks: chunking.chunk_docx/pdf/xlsx/pptx() 반환값
    file_hash는 file_name + doc_type + chunk 텍스트 결합으로 생성.
    저장된 포인트 수 반환.
    """
    if not chunks:
        return 0

    await ensure_collection(DOCUMENTS_COLLECTION, hybrid=True)

    # 파일 레벨 해시: file_name + doc_type + 첫 청크 텍스트로 결정
    file_hash = hashlib.sha256(
        f"{file_name}:{doc_type}:{chunks[0]['text'][:200]}".encode()
    ).hexdigest()[:16]

    points = []
    for chunk in chunks:
        chunk_index = chunk["metadata"].get("chunk_index", 0)
        point_id = make_document_point_id(file_hash, chunk_index)
        embed_text = chunk["text"]

        dense, sparse = await asyncio.gather(
            get_embedding(embed_text),
            get_sparse_vector(embed_text),
        )

        payload: dict = {
            "file_name":   file_name,
            "file_hash":   file_hash,
            "doc_type":    doc_type,
            "system_id":   system_id,
            "text":        embed_text[:2000],
            "chunk_index": chunk_index,
            "stored_at":   datetime.now(timezone.utc).isoformat(),
        }
        if tags:
            payload["tags"] = tags
        # 포맷별 추가 메타 보존 (page_no, sheet_name 등)
        for meta_key in ("page_no", "sheet_name", "slide_no", "slide_title", "heading"):
            if meta_key in chunk["metadata"]:
                payload[meta_key] = chunk["metadata"][meta_key]

        points.append({
            "id": point_id,
            "vector": {
                "dense": dense,
                "sparse": {
                    "indices": sparse["indices"],
                    "values":  sparse["values"],
                },
            },
            "payload": payload,
        })

    # 배치 upsert (100개씩)
    batch_size = 100
    for i in range(0, len(points), batch_size):
        batch = points[i:i + batch_size]
        resp = await _qdrant_http.put(
            f"{QDRANT_URL}/collections/{DOCUMENTS_COLLECTION}/points",
            json={"points": batch},
        )
        resp.raise_for_status()

    logger.info("문서 청크 upsert: file=%s, doc_type=%s, %d 청크", file_name, doc_type, len(points))
    return len(points)


async def upsert_operator_note(
    *,
    question: str,
    answer: str,
    system_id: int,
    source_reference: str | None = None,
    tags: list[str] | None = None,
    created_by: str | None = None,
) -> int:
    """운영자 노트를 knowledge_documents에 upsert. point_id(int) 반환.

    운영자 노트는 doc_type="operator_note"로 저장.
    point_id = sha256("note:{question[:100]}:{created_at}")[:8] → uint64.
    """
    await ensure_collection(DOCUMENTS_COLLECTION, hybrid=True)

    created_at = datetime.now(timezone.utc).isoformat()
    point_id = _make_note_point_id(question, created_at)

    embed_text = f"Q: {question}\nA: {answer}"
    dense, sparse = await asyncio.gather(
        get_embedding(embed_text),
        get_sparse_vector(embed_text),
    )

    payload: dict = {
        "doc_type":         "operator_note",
        "system_id":        system_id,
        "question":         question[:1000],
        "answer":           answer[:2000],
        "text":             embed_text[:2000],
        "stored_at":        created_at,
    }
    if source_reference:
        payload["source_reference"] = source_reference
    if tags:
        payload["tags"] = tags
    if created_by:
        payload["created_by"] = created_by

    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{DOCUMENTS_COLLECTION}/points",
        json={
            "points": [{
                "id": point_id,
                "vector": {
                    "dense": dense,
                    "sparse": {
                        "indices": sparse["indices"],
                        "values":  sparse["values"],
                    },
                },
                "payload": payload,
            }]
        },
    )
    resp.raise_for_status()
    logger.info("운영자 노트 upsert: system_id=%d, point_id=%d", system_id, point_id)
    return point_id


# ── 피드백 / 노트 관리 ────────────────────────────────────────────────────────

async def apply_correction(
    *,
    point_id: int,
    collection: str,
    correction_text: str,
) -> bool:
    """Qdrant set_payload (병합)로 corrected=True + correction_text 저장."""
    try:
        resp = await _qdrant_http.post(
            f"{QDRANT_URL}/collections/{collection}/points/payload",
            json={
                "payload": {
                    "corrected":       True,
                    "correction_text": correction_text,
                    "corrected_at":    datetime.now(timezone.utc).isoformat(),
                },
                "points": [point_id],
            },
        )
        resp.raise_for_status()
        logger.info("correction 적용: collection=%s, point_id=%d", collection, point_id)
        return True
    except Exception as exc:
        logger.warning("correction 적용 실패: %s", exc)
        return False


async def update_operator_note(*, point_id: int, **fields) -> bool:
    """운영자 노트 페이로드 부분 업데이트."""
    if not fields:
        return True
    try:
        resp = await _qdrant_http.post(
            f"{QDRANT_URL}/collections/{DOCUMENTS_COLLECTION}/points/payload",
            json={
                "payload": fields,
                "points":  [point_id],
            },
        )
        resp.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("운영자 노트 업데이트 실패 point_id=%d: %s", point_id, exc)
        return False


async def delete_operator_note(*, point_id: int) -> bool:
    """운영자 노트 포인트 삭제.

    Qdrant ID 기반 삭제: POST /collections/{name}/points/delete
    (httpx .delete()는 request body를 지원하지 않으므로 .post() 사용)
    """
    try:
        resp = await _qdrant_http.post(
            f"{QDRANT_URL}/collections/{DOCUMENTS_COLLECTION}/points/delete",
            json={"points": [point_id]},
        )
        resp.raise_for_status()
        logger.info("운영자 노트 삭제: point_id=%d", point_id)
        return True
    except Exception as exc:
        logger.warning("운영자 노트 삭제 실패 point_id=%d: %s", point_id, exc)
        return False


# ── Federated 검색 (3종 컬렉션 → 2차 RRF 병합) ─────────────────────────────

def _rrf_score(rank: int, k: int = _RRF_K) -> float:
    """Reciprocal Rank Fusion 점수. rank는 0-indexed."""
    return 1.0 / (k + rank + 1)


def _cross_collection_rrf(
    results_by_source: dict[str, list[dict]],
) -> list[dict]:
    """3종 컬렉션 결과를 cross-collection RRF로 병합.

    각 소스 내 순위(rank within source)를 기준으로 2차 RRF(k=60) 적용.
    동일 point_id가 여러 컬렉션에 존재하는 경우는 없으므로 단순 합산.
    """
    # point_id → merged entry
    merged: dict[int | str, dict] = {}

    for source, results in results_by_source.items():
        for rank, hit in enumerate(results):
            pid = hit["id"]
            rrf = _rrf_score(rank)
            if pid not in merged:
                merged[pid] = {
                    "point_id":   pid,
                    "collection": _source_to_collection(source),
                    "score":      rrf,
                    "payload":    hit["payload"],
                }
            else:
                merged[pid]["score"] += rrf

    sorted_results = sorted(merged.values(), key=lambda x: x["score"], reverse=True)
    return sorted_results


def _source_to_collection(source: str) -> str:
    return {
        "jira":       JIRA_COLLECTION,
        "confluence": CONFLUENCE_COLLECTION,
        "documents":  DOCUMENTS_COLLECTION,
    }.get(source, source)


async def federated_search(
    query: str,
    *,
    system_id: int | None = None,
    system_name: str | None = None,
    sources: list[str] | None = None,
    limit: int = 10,
    rerank: bool = False,
    rerank_top_k: int = 10,
) -> dict:
    """병렬로 3종 컬렉션 검색 → 2차 RRF 병합 → corrected 보너스 → (옵션) reranker → 결과.

    Args:
        query:       자연어 질의
        system_id:   knowledge_documents 필터 (정수 ID). None이면 전체
        system_name: knowledge_jira_issues / knowledge_confluence_pages 필터
        sources:     검색 대상 컬렉션 선택 ("jira", "confluence", "documents"). None이면 전체
        limit:       최종 반환 개수
        rerank:      cross-encoder(bge-reranker-v2-m3) 재정렬 여부
        rerank_top_k: reranker 반환 개수

    Returns:
        {
            "results": [...],  # 각 항목: {collection, point_id, score, payload, ...}
            "by_source": {"jira": N, "confluence": N, "documents": N}
        }
    """
    active_sources = sources or ["jira", "confluence", "documents"]

    # 임베딩 (공통 쿼리)
    try:
        dense, sparse = await asyncio.gather(
            get_embedding(query),
            get_sparse_vector(query),
        )
    except Exception as exc:
        logger.warning("Knowledge 임베딩 실패: %s", exc)
        return {"results": [], "by_source": {s: 0 for s in active_sources}}

    retrieval_limit = limit * 4 if rerank else limit * 2

    # 컬렉션별 필터 구성
    async def _search_source(source: str) -> tuple[str, list[dict]]:
        collection = _source_to_collection(source)
        filter_must: list[dict] = []

        if source == "jira" and system_name:
            filter_must.append({"key": "system_name", "match": {"value": system_name}})
        elif source == "confluence" and system_name:
            filter_must.append({"key": "system_name", "match": {"value": system_name}})
        elif source == "documents" and system_id is not None:
            filter_must.append({"key": "system_id", "match": {"value": system_id}})

        try:
            hits = await _hybrid_search(
                collection=collection,
                dense=dense,
                sparse=sparse,
                filter_must=filter_must if filter_must else None,
                limit=retrieval_limit,
            )
        except Exception as exc:
            logger.warning("Knowledge 검색 실패 [%s]: %s", collection, exc)
            hits = []
        return source, hits

    # 병렬 검색
    search_tasks = [_search_source(s) for s in active_sources]
    results_pairs = await asyncio.gather(*search_tasks)

    results_by_source: dict[str, list[dict]] = dict(results_pairs)

    # 2차 cross-collection RRF 병합
    merged = _cross_collection_rrf(results_by_source)

    # corrected 보너스 (+0.2) 적용 (reranker 이전)
    for item in merged:
        if item["payload"].get("corrected"):
            item["score"] += _CORRECTED_BONUS

    # 보너스 반영 후 재정렬
    merged.sort(key=lambda x: x["score"], reverse=True)

    # (옵션) reranker
    if rerank and merged:
        from reranker import rerank as _rerank

        def _result_text(r: dict) -> str:
            p = r["payload"]
            parts = []
            # 컬렉션별 대표 텍스트 필드 (page_title은 Confluence 신호 강화)
            for field in ("title", "page_title", "text", "description", "question", "answer", "log_pattern"):
                v = p.get(field)
                if v:
                    parts.append(str(v)[:500])
            return " | ".join(parts)

        candidates = [{**r, "_rt": _result_text(r)} for r in merged]
        try:
            reranked = await _rerank(query, candidates, top_k=rerank_top_k, text_field="_rt")
            for r in reranked:
                r.pop("_rt", None)
            merged = reranked
        except Exception as exc:
            logger.warning("Knowledge Reranker 실패: %s → RRF 순서 유지", exc)
            merged = merged[:rerank_top_k]
    else:
        merged = merged[:limit]

    # by_source 카운트
    by_source: dict[str, int] = {s: 0 for s in active_sources}
    for item in merged:
        coll = item.get("collection", "")
        for source, col_name in [
            ("jira",       JIRA_COLLECTION),
            ("confluence", CONFLUENCE_COLLECTION),
            ("documents",  DOCUMENTS_COLLECTION),
        ]:
            if coll == col_name and source in by_source:
                by_source[source] += 1

    return {
        "results":   merged,
        "by_source": by_source,
    }
