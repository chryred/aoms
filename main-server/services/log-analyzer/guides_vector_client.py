"""knowledge_guides 컬렉션 — Hybrid(Dense+Sparse) 임베딩 + 청크 기반 인덱싱.

admin-api의 Dense-only qdrant_guides.py 를 대체하는 log-analyzer 측 구현.
FastEmbed ONNX(bge-m3 + BM25)를 인프로세스로 사용하며 ADR-011 Hybrid Search 적용.

컬렉션: knowledge_guides
  Dense(1024) + Sparse(BM25) Hybrid, RRF fusion

청킹 전략 (chunking.py:chunk_text 재사용):
  - 한 가이드 → 1500자 청크 N개 (overlap 200자)
  - 각 청크가 별도 Qdrant 포인트
  - 같은 guide_id의 청크는 payload.guide_id로 묶이고 chunk_index로 순서 식별

Point ID 전략:
  - 청크: sha256("guide:{guide_id}:{chunk_index}")[:8] → uint64 (knowledge_documents 와 동일 패턴)
  - 동일 guide 재인덱싱 시 같은 point_id로 덮어쓰기
  - 레거시 UUID 단일 포인트도 payload.guide_id를 갖고 있어 filter 기반 삭제로 함께 제거됨

Payload 필드:
  guide_id      — keyword (UUID 문자열, 필터용·삭제용)
  system_id     — integer | null (null = 전체 시스템 공용 가이드)
  title         — keyword
  content       — text (해당 청크 내용)
  chunk_index   — integer
  total_chunks  — integer
  attachments   — text (첨부 OCR 텍스트, 선택)
  indexed_at    — datetime (UTC ISO-8601)

시스템 필터:
  system_ids 지정 시 "system_id IN list OR system_id IS NULL" 조건.
  Qdrant should 절을 직접 사용 (must 절로는 표현 불가).
"""

import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional

from chunking import chunk_text
from vector_client import (
    QDRANT_URL,
    _qdrant_http,
    ensure_collection,
    get_embedding,
    get_sparse_vector,
)

logger = logging.getLogger(__name__)

GUIDES_COLLECTION = "knowledge_guides"

# payload 인덱스 (필드명, 타입)
_PAYLOAD_INDEXES = [
    ("guide_id",    "keyword"),
    ("system_id",   "integer"),
    ("title",       "keyword"),
    ("chunk_index", "integer"),
    ("indexed_at",  "datetime"),
]

# 청킹 파라미터 (chunking.py 기본값과 동일 — 한국어 1500자 ≈ 800-1000 토큰)
_CHUNK_MAX_CHARS = 1500
_CHUNK_OVERLAP   = 200


# ── 컬렉션 보장 ──────────────────────────────────────────────────────────────

async def _ensure_payload_indexes() -> None:
    """payload 인덱스 생성. 이미 존재해도 오류 없음."""
    for field_name, field_type in _PAYLOAD_INDEXES:
        body: dict = {"field_name": field_name, "field_schema": field_type}
        try:
            resp = await _qdrant_http.put(
                f"{QDRANT_URL}/collections/{GUIDES_COLLECTION}/index",
                json=body,
            )
            if resp.status_code not in (200, 201):
                logger.warning(
                    "payload 인덱스 생성 응답 %d: %s/%s",
                    resp.status_code,
                    GUIDES_COLLECTION,
                    field_name,
                )
        except Exception as exc:
            logger.warning("payload 인덱스 생성 실패 %s/%s: %s", GUIDES_COLLECTION, field_name, exc)


async def ensure_guides_collection() -> None:
    """knowledge_guides 컬렉션 + payload 인덱스 보장. lifespan에서 호출.

    컬렉션이 없으면(404) Hybrid(Dense+Sparse)로 새로 생성.
    이미 존재하면(200) 스키마를 건드리지 않고 인덱스만 보장.
    기존 Dense-only 컬렉션이 있어도 자동 재생성하지 않음
    (마이그레이션은 별도 작업 필요 — 로그 WARNING으로 안내).
    """
    # 컬렉션 존재 여부 확인
    resp = await _qdrant_http.get(f"{QDRANT_URL}/collections/{GUIDES_COLLECTION}")
    if resp.status_code == 404:
        # 신규 생성 — Hybrid
        logger.info("knowledge_guides 컬렉션 없음 → Hybrid로 새로 생성")
        await ensure_collection(GUIDES_COLLECTION, hybrid=True)
    elif resp.status_code == 200:
        info = resp.json().get("result", {})
        config = info.get("config", {})
        vectors_config = config.get("params", {}).get("vectors", {})
        # Hybrid 여부: "dense" 키가 있으면 named-vector(Hybrid) 스키마
        if "dense" not in vectors_config:
            logger.warning(
                "knowledge_guides 컬렉션이 Dense-only 스키마로 존재합니다. "
                "Hybrid 마이그레이션이 필요하면 컬렉션을 수동으로 삭제 후 재시작하세요."
            )
        else:
            logger.info("knowledge_guides 컬렉션 이미 존재 (Hybrid 스키마 확인됨)")
    else:
        resp.raise_for_status()

    # payload 인덱스는 항상 보장
    await _ensure_payload_indexes()


# ── point_id 생성 ────────────────────────────────────────────────────────────

def _make_chunk_point_id(guide_id: str, chunk_index: int) -> int:
    """sha256("guide:{guide_id}:{chunk_index}")의 첫 8바이트 → uint64.

    knowledge_documents 의 make_document_point_id 와 동일 패턴.
    같은 (guide_id, chunk_index) 입력은 항상 같은 point_id → 재인덱싱 시 덮어쓰기.
    """
    key = f"guide:{guide_id}:{chunk_index}".encode()
    digest = hashlib.sha256(key).digest()
    return int.from_bytes(digest[:8], "big", signed=False)


# ── 기존 포인트 일괄 삭제 ────────────────────────────────────────────────────

async def _delete_by_guide_id(guide_id: str) -> int:
    """payload.guide_id 필터로 일괄 삭제. 청크와 레거시 단일 포인트 모두 정리.

    Returns:
        int — 삭제된 포인트 수 (count 조회 실패 시 0)
    """
    filter_body = {"must": [{"key": "guide_id", "match": {"value": guide_id}}]}

    count = 0
    try:
        count_resp = await _qdrant_http.post(
            f"{QDRANT_URL}/collections/{GUIDES_COLLECTION}/points/count",
            json={"filter": filter_body, "exact": True},
        )
        count_resp.raise_for_status()
        count = count_resp.json().get("result", {}).get("count", 0)
    except Exception as exc:
        logger.warning("guide 청크 count 조회 실패 guide_id=%s: %s", guide_id, exc)

    if count == 0:
        return 0

    try:
        del_resp = await _qdrant_http.post(
            f"{QDRANT_URL}/collections/{GUIDES_COLLECTION}/points/delete",
            json={"filter": filter_body},
        )
        del_resp.raise_for_status()
        logger.info("guide 포인트 %d개 삭제 (filter): guide_id=%s", count, guide_id)
    except Exception as exc:
        logger.warning("guide 포인트 삭제 실패 guide_id=%s: %s", guide_id, exc)
        return 0

    return count


# ── 임베딩 저장 (청킹) ───────────────────────────────────────────────────────

async def embed_guide(
    guide_id: str,
    system_id: Optional[int],
    title: str,
    content: str,
    attachments: Optional[str] = None,
) -> int:
    """가이드를 청킹 후 Hybrid 임베딩으로 N개 포인트 upsert.

    동작 순서:
      1. content (+ attachments)를 1500자 청크로 분할 (overlap 200)
      2. payload.guide_id 필터로 기존 포인트 일괄 삭제 (재인덱싱 대비)
      3. 각 청크 임베딩 (dense+sparse 병렬) → batch upsert

    각 청크의 임베딩 입력은 `f"{title}\\n{chunk_text}"` — title은 모든 청크에서
    공통 컨텍스트로 사용해 짧은 청크의 의미 매칭을 보강한다.

    Returns:
        int — 생성된 청크 수 (0 = 빈 가이드, 기존 포인트만 정리됨)
    """
    full_content = (content or "").strip()
    if attachments:
        full_content += f"\n\n{attachments}"

    if not full_content:
        # 빈 가이드 — 기존 포인트 정리만
        await _delete_by_guide_id(guide_id)
        logger.info("guide %s 본문 비어있음 — 포인트 정리만 수행", guide_id)
        return 0

    chunks = chunk_text(
        full_content,
        max_chars=_CHUNK_MAX_CHARS,
        overlap=_CHUNK_OVERLAP,
    )
    if not chunks:
        await _delete_by_guide_id(guide_id)
        return 0

    # 기존 포인트 (레거시 UUID 단일 포인트 + 이전 청크) 모두 삭제 후 재생성
    await _delete_by_guide_id(guide_id)

    indexed_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    points: list[dict] = []
    total_chunks = len(chunks)

    for chunk in chunks:
        chunk_text_value = chunk["text"]
        chunk_index = chunk["metadata"]["chunk_index"]

        embed_input = f"{title}\n{chunk_text_value}" if title else chunk_text_value
        dense, sparse = await asyncio.gather(
            get_embedding(embed_input),
            get_sparse_vector(embed_input),
        )

        payload: dict = {
            "guide_id":     guide_id,
            "title":        title,
            "content":      chunk_text_value,
            "chunk_index":  chunk_index,
            "total_chunks": total_chunks,
            "indexed_at":   indexed_at,
        }
        if system_id is not None:
            payload["system_id"] = system_id
        if attachments:
            # 첫 청크에만 첨부 메타 표시 (검색 결과 재구성 용도)
            if chunk_index == 0:
                payload["attachments"] = attachments

        points.append({
            "id": _make_chunk_point_id(guide_id, chunk_index),
            "vector": {
                "dense":  dense,
                "sparse": {
                    "indices": sparse["indices"],
                    "values":  sparse["values"],
                },
            },
            "payload": payload,
        })

    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{GUIDES_COLLECTION}/points",
        json={"points": points},
    )
    resp.raise_for_status()
    logger.info("guide %s: %d개 청크 upsert 완료", guide_id, total_chunks)
    return total_chunks


# ── 삭제 ─────────────────────────────────────────────────────────────────────

async def delete_guide(guide_id: str) -> bool:
    """knowledge_guides에서 guide_id 의 모든 청크를 일괄 삭제.

    payload.guide_id 필터 기반 — 청크 수와 무관하게 한 번의 호출로 정리.
    레거시 UUID 단일 포인트도 같은 필터로 함께 정리됨.

    Returns:
        True — 삭제 시도 성공 (count=0이어도 True)
        False — Qdrant 호출 자체 실패
    """
    try:
        await _delete_by_guide_id(guide_id)
        return True
    except Exception as exc:
        logger.error("guide 삭제 실패 guide_id=%s: %s", guide_id, exc)
        return False


# ── 전체 청크 조회 ───────────────────────────────────────────────────────────

async def get_guide_chunks(
    guide_id: str,
    chunk_indexes: Optional[list[int]] = None,
    max_chunks: int = 50,
) -> list[dict]:
    """guide_id의 청크를 chunk_index 순서로 반환.

    chunk_indexes가 주어지면 해당 인덱스 청크만 반환 (surgical fetch).
    생략 시 모든 청크 반환 (full fetch, max_chunks 한도).

    LLM 사용 흐름:
      1. qdrant_search_guide 결과로 받은 chunk_index/total_chunks 비교
      2. 빠진 부분만 chunk_indexes=[2,4,5]로 명시 → 컨텍스트 절약
      3. 사용자가 "전부 보여줘"라면 chunk_indexes 생략

    Returns:
        list of {"id", "chunk_index", "total_chunks", "title", "content", "system_id", ...}
        가이드/요청 인덱스 미존재 시 빈 리스트.
    """
    filter_must: list[dict] = [{"key": "guide_id", "match": {"value": guide_id}}]
    if chunk_indexes:
        filter_must.append({"key": "chunk_index", "match": {"any": list(chunk_indexes)}})
    filter_body: dict = {"must": filter_must}

    all_points: list[dict] = []
    next_offset: str | int | None = None
    while True:
        body: dict = {
            "filter":       filter_body,
            "limit":        min(100, max_chunks - len(all_points)),
            "with_payload": True,
            "with_vector":  False,
        }
        if next_offset is not None:
            body["offset"] = next_offset

        try:
            resp = await _qdrant_http.post(
                f"{QDRANT_URL}/collections/{GUIDES_COLLECTION}/points/scroll",
                json=body,
            )
            resp.raise_for_status()
            data = resp.json().get("result", {})
            all_points.extend(data.get("points", []))
            next_offset = data.get("next_page_offset")
            if next_offset is None or len(all_points) >= max_chunks:
                break
        except Exception as exc:
            logger.warning("guide chunks scroll 실패 guide_id=%s: %s", guide_id, exc)
            break

    all_points.sort(key=lambda p: (p.get("payload") or {}).get("chunk_index", 0))
    return [
        {
            "id":           str(p["id"]),
            "chunk_index":  (p.get("payload") or {}).get("chunk_index"),
            "total_chunks": (p.get("payload") or {}).get("total_chunks"),
            "title":        (p.get("payload") or {}).get("title", ""),
            "content":      (p.get("payload") or {}).get("content", ""),
            "system_id":    (p.get("payload") or {}).get("system_id"),
            "indexed_at":   (p.get("payload") or {}).get("indexed_at"),
        }
        for p in all_points
    ]


# ── 검색 ─────────────────────────────────────────────────────────────────────

async def search_guides(
    query: str,
    system_ids: Optional[list[int]] = None,
    limit: int = 5,
) -> list[dict]:
    """knowledge_guides Hybrid 검색.

    system_ids 지정 시 "system_id IN list OR system_id IS NULL" 필터 적용.
    Qdrant should 절 직접 사용 (_hybrid_search는 must만 지원하므로
    /points/query를 직접 호출).

    검색 결과는 청크 단위 — 같은 guide_id의 여러 청크가 결과에 함께 들어올 수 있다.
    LLM이 여러 청크를 컨텍스트로 사용해 답변을 작성한다.

    Returns:
        list of {"id": str, "score": float, "payload": dict}
    """
    dense, sparse = await asyncio.gather(
        get_embedding(query),
        get_sparse_vector(query),
    )

    body: dict = {
        "prefetch": [
            {
                "query":           dense,
                "using":           "dense",
                "limit":           limit * 3,
                "score_threshold": 0.5,
            },
            {
                "query": {"indices": sparse["indices"], "values": sparse["values"]},
                "using": "sparse",
                "limit": limit * 3,
            },
        ],
        "query":        {"fusion": "rrf"},
        "limit":        limit,
        "with_payload": True,
    }

    if system_ids:
        # system_id IN system_ids OR system_id IS NULL
        should_clauses: list[dict] = [
            {"key": "system_id", "match": {"any": system_ids}},
            {"is_null": {"key": "system_id"}},
        ]
        body["filter"] = {"should": should_clauses}

    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{GUIDES_COLLECTION}/points/query",
        json=body,
    )
    resp.raise_for_status()
    points = resp.json().get("result", {}).get("points", [])
    return [
        {"id": str(p["id"]), "score": p["score"], "payload": p.get("payload", {})}
        for p in points
    ]
