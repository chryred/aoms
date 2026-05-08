"""knowledge_guides 컬렉션 — Hybrid(Dense+Sparse) 임베딩 + 검색.

admin-api의 Dense-only qdrant_guides.py 를 대체하는 log-analyzer 측 구현.
FastEmbed ONNX(bge-m3 + BM25)를 인프로세스로 사용하며 ADR-011 Hybrid Search 적용.

컬렉션: knowledge_guides
  Dense(1024) + Sparse(BM25) Hybrid, RRF fusion

Point ID 전략:
  guide_id(UUID 문자열)를 Qdrant point ID로 직접 사용.
  Qdrant는 UUID 형식 문자열을 native point ID로 지원.

Payload 필드:
  guide_id      — keyword (UUID 문자열, 필터용 중복 저장)
  system_id     — integer | null (null = 전체 시스템 공용 가이드)
  title         — keyword
  content       — text (최초 2000자)
  attachments   — text (첨부 OCR 텍스트, 선택)
  indexed_at    — datetime (UTC ISO-8601)

시스템 필터:
  system_ids 지정 시 "system_id IN list OR system_id IS NULL" 조건.
  Qdrant should 절을 직접 사용 (must 절로는 표현 불가).
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

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
    ("guide_id",   "keyword"),
    ("system_id",  "integer"),
    ("title",      "keyword"),
    ("indexed_at", "datetime"),
]

# 임베딩에 사용할 content 최대 길이 (bge-m3 8192 토큰 한도 내 안전 마진)
_CONTENT_MAX_CHARS = 2000


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


# ── 임베딩 저장 ──────────────────────────────────────────────────────────────

async def embed_guide(
    guide_id: str,
    system_id: Optional[int],
    title: str,
    content: str,
    attachments: Optional[str] = None,
) -> str:
    """가이드를 임베딩하여 knowledge_guides에 upsert.

    guide_id는 admin-api 측 KnowledgeGuide.id (UUID 문자열).
    Qdrant point ID로 UUID 문자열 그대로 사용.

    Returns:
        str — point_id (guide_id 그대로 반환)
    """
    embed_text = f"{title}\n{content[:_CONTENT_MAX_CHARS]}"
    if attachments:
        embed_text += f"\n{attachments[:500]}"

    dense, sparse = await asyncio.gather(
        get_embedding(embed_text),
        get_sparse_vector(embed_text),
    )

    payload: dict = {
        "guide_id":   guide_id,
        "title":      title,
        "content":    content[:_CONTENT_MAX_CHARS],
        "indexed_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
    }
    if system_id is not None:
        payload["system_id"] = system_id
    if attachments:
        payload["attachments"] = attachments

    body = {
        "points": [
            {
                "id": guide_id,
                "vector": {
                    "dense":  dense,
                    "sparse": {
                        "indices": sparse["indices"],
                        "values":  sparse["values"],
                    },
                },
                "payload": payload,
            }
        ]
    }

    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{GUIDES_COLLECTION}/points",
        json=body,
    )
    resp.raise_for_status()
    return guide_id


# ── 삭제 ─────────────────────────────────────────────────────────────────────

async def delete_guide(guide_id: str) -> bool:
    """knowledge_guides에서 guide_id 포인트 삭제.

    guide_id는 UUID 문자열.

    Returns:
        True — 삭제 요청 성공 (포인트 미존재도 200 반환하므로 True)
        False — HTTP 오류 발생
    """
    try:
        resp = await _qdrant_http.post(
            f"{QDRANT_URL}/collections/{GUIDES_COLLECTION}/points/delete",
            json={"points": [guide_id]},
        )
        resp.raise_for_status()
        return True
    except Exception as exc:
        logger.error("guide 삭제 실패 guide_id=%s: %s", guide_id, exc)
        return False


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
