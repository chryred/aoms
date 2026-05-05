"""knowledge_guides Qdrant 컬렉션 관리 및 검색.

admin-api는 FastEmbed ONNX 모델 없음 → Dense 임베딩은 log-analyzer /embed/text 경유.
컬렉션: Dense-only (bge-m3 1024차원, Cosine) — metric_hourly_patterns 선례와 동일.
Sparse 미지원 이유: admin-api에 SparseTextEmbedding 미설치.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

COLLECTION_NAME = "knowledge_guides"
VECTOR_SIZE = 1024
SCORE_THRESHOLD = 0.6

QDRANT_URL = os.getenv("QDRANT_URL", "http://server-b:6333")
LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")

# 재사용 클라이언트 (연결 풀)
_qdrant_http = httpx.AsyncClient(base_url=QDRANT_URL, timeout=15.0)
_log_analyzer_http = httpx.AsyncClient(base_url=LOG_ANALYZER_URL, timeout=20.0)


# ── 임베딩 ───────────────────────────────────────────────────────────────────

async def _get_embedding(text: str) -> Optional[list[float]]:
    """log-analyzer /embed/text 호출 → dense vector 반환."""
    try:
        resp = await _log_analyzer_http.post(
            "/embed/text",
            json={"text": text[:2000]},  # 과도한 입력 방지
        )
        if resp.status_code >= 400:
            logger.warning("embed/text 오류 %d: %s", resp.status_code, resp.text[:200])
            return None
        return resp.json().get("embedding")
    except Exception as exc:
        logger.warning("embed/text 요청 실패: %s", str(exc)[:200])
        return None


# ── 컬렉션 관리 ─────────────────────────────────────────────────────────────

async def ensure_collection() -> None:
    """knowledge_guides 컬렉션이 없으면 Dense-only로 생성.

    이미 존재하면 noop. Qdrant 미연결 시 경고만 출력하고 무시.
    """
    try:
        # 존재 여부 확인
        resp = await _qdrant_http.get(f"/collections/{COLLECTION_NAME}")
        if resp.status_code == 200:
            return  # 이미 존재

        if resp.status_code != 404:
            logger.warning(
                "knowledge_guides 컬렉션 확인 실패 %d: %s",
                resp.status_code,
                resp.text[:200],
            )
            return

        # 신규 생성 (Dense-only)
        create_resp = await _qdrant_http.put(
            f"/collections/{COLLECTION_NAME}",
            json={
                "vectors": {
                    "dense": {
                        "size": VECTOR_SIZE,
                        "distance": "Cosine",
                    }
                },
                "hnsw_config": {
                    "m": 16,
                    "ef_construct": 100,
                },
            },
        )
        if create_resp.status_code in (200, 201):
            logger.info("knowledge_guides 컬렉션 생성 완료 (Dense 1024, Cosine)")
        else:
            logger.warning(
                "knowledge_guides 컬렉션 생성 실패 %d: %s",
                create_resp.status_code,
                create_resp.text[:200],
            )
    except Exception as exc:
        logger.warning("knowledge_guides ensure_collection 오류: %s", str(exc)[:200])


# ── 인덱싱 ──────────────────────────────────────────────────────────────────

async def index_guide(
    guide_id: str,
    title: str,
    content: str,
    system_id: Optional[int],
    category: Optional[str],
    tags: list[str],
    image_count: int,
) -> None:
    """가이드를 Qdrant knowledge_guides 컬렉션에 upsert.

    guide_id를 point id로 사용. 실패 시 경고만 출력 (graceful).
    """
    embed_text = f"{title}\n{content[:1000]}"
    vector = await _get_embedding(embed_text)
    if vector is None:
        logger.warning("guide %s 임베딩 실패 — 인덱싱 생략", guide_id)
        return

    payload: dict[str, Any] = {
        "guide_id": guide_id,
        "title": title,
        "category": category or "",
        "tags": tags or [],
        "image_count": image_count,
    }
    if system_id is not None:
        payload["system_id"] = system_id

    try:
        resp = await _qdrant_http.put(
            f"/collections/{COLLECTION_NAME}/points",
            json={
                "points": [
                    {
                        "id": guide_id,
                        "vector": {"dense": vector},
                        "payload": payload,
                    }
                ]
            },
        )
        if resp.status_code >= 400:
            logger.warning(
                "guide %s Qdrant upsert 실패 %d: %s",
                guide_id,
                resp.status_code,
                resp.text[:200],
            )
        else:
            logger.debug("guide %s Qdrant 인덱싱 완료", guide_id)
    except Exception as exc:
        logger.warning("guide %s Qdrant upsert 오류: %s", guide_id, str(exc)[:200])


# ── payload 부분 업데이트 ───────────────────────────────────────────────────

async def update_image_count(guide_id: str, image_count: int) -> None:
    """Qdrant payload의 image_count만 업데이트 (재임베딩 없음)."""
    try:
        resp = await _qdrant_http.post(
            f"/collections/{COLLECTION_NAME}/points/payload",
            json={"payload": {"image_count": image_count}, "points": [guide_id]},
        )
        if resp.status_code >= 400:
            logger.warning(
                "guide %s image_count 업데이트 실패 %d: %s",
                guide_id,
                resp.status_code,
                resp.text[:200],
            )
        else:
            logger.debug("guide %s image_count=%d 업데이트 완료", guide_id, image_count)
    except Exception as exc:
        logger.warning("guide %s image_count 업데이트 오류: %s", guide_id, str(exc)[:200])


# ── 삭제 ────────────────────────────────────────────────────────────────────

async def delete_guide_index(guide_id: str) -> None:
    """Qdrant에서 해당 guide_id 포인트 삭제. 실패 시 경고만 출력."""
    try:
        resp = await _qdrant_http.post(
            f"/collections/{COLLECTION_NAME}/points/delete",
            json={"points": [guide_id]},
        )
        if resp.status_code >= 400:
            logger.warning(
                "guide %s Qdrant 삭제 실패 %d: %s",
                guide_id,
                resp.status_code,
                resp.text[:200],
            )
        else:
            logger.debug("guide %s Qdrant 인덱스 삭제 완료", guide_id)
    except Exception as exc:
        logger.warning("guide %s Qdrant 삭제 오류: %s", guide_id, str(exc)[:200])


# ── 검색 ────────────────────────────────────────────────────────────────────

async def search_guides(
    query: str,
    system_id: Optional[int] = None,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """knowledge_guides Dense 유사도 검색.

    system_id가 주어지면 (system_id == X OR system_id is null) 필터 적용.
    실패 시 빈 리스트 반환 (graceful).

    반환 형식:
        [{"guide_id": str, "score": float, "system_id": int|None,
          "title": str, "category": str}]
    """
    if not query or not query.strip():
        return []

    vector = await _get_embedding(query.strip())
    if vector is None:
        return []

    # Qdrant 필터 구성
    qdrant_filter: Optional[dict[str, Any]] = None
    if system_id is not None:
        qdrant_filter = {
            "should": [
                {
                    "key": "system_id",
                    "match": {"value": system_id},
                },
                {
                    "is_null": {"key": "system_id"},
                },
            ]
        }

    query_body: dict[str, Any] = {
        "vector": {"name": "dense", "vector": vector},
        "limit": limit,
        "score_threshold": SCORE_THRESHOLD,
        "with_payload": True,
    }
    if qdrant_filter:
        query_body["filter"] = qdrant_filter

    try:
        resp = await _qdrant_http.post(
            f"/collections/{COLLECTION_NAME}/points/search",
            json=query_body,
        )
        if resp.status_code >= 400:
            logger.warning(
                "knowledge_guides 검색 실패 %d: %s",
                resp.status_code,
                resp.text[:200],
            )
            return []
        data = resp.json()
    except Exception as exc:
        logger.warning("knowledge_guides 검색 오류: %s", str(exc)[:200])
        return []

    results = []
    for hit in data.get("result") or []:
        payload = hit.get("payload") or {}
        results.append(
            {
                "guide_id": payload.get("guide_id") or hit.get("id"),
                "score": hit.get("score", 0.0),
                "system_id": payload.get("system_id"),
                "title": payload.get("title", ""),
                "category": payload.get("category", ""),
            }
        )
    return results
