"""Knowledge 서비스 — log-analyzer HTTP 호출 wrapper + DB 비즈니스 로직.

log-analyzer V1 엔드포인트(T2)가 없어도 import-time 오류 없게 설계됨.
런타임 호출 실패는 허용 (best-effort).
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")

_TIMEOUT = 30.0


# ── log-analyzer HTTP 호출 wrapper ────────────────────────────────────────────

async def call_embed_document(
    file_path: str,
    doc_type: str,
    system_id: int,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """log-analyzer POST /embed/document 호출 → job_id 반환."""
    base = LOG_ANALYZER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{base}/embed/document",
                json={
                    "file_path": file_path,
                    "doc_type": doc_type,
                    "system_id": system_id,
                    "tags": tags or [],
                },
            )
            if resp.status_code >= 400:
                logger.warning("embed/document %s: %s", resp.status_code, resp.text[:200])
                return {"error": f"log-analyzer {resp.status_code}: {resp.text[:200]}"}
            return resp.json()
    except Exception as exc:
        logger.warning("embed/document 호출 실패: %s", exc)
        return {"error": f"log-analyzer 호출 실패: {str(exc)[:200]}"}


async def call_operator_note(
    question: str,
    answer: str,
    system_id: int,
    source_reference: str | None = None,
    tags: list[str] | None = None,
) -> str | None:
    """log-analyzer POST /knowledge/operator-note 호출 → point_id 반환."""
    base = LOG_ANALYZER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{base}/knowledge/operator-note",
                json={
                    "question": question,
                    "answer": answer,
                    "system_id": system_id,
                    "source_reference": source_reference,
                    "tags": tags or [],
                },
            )
            if resp.status_code >= 400:
                logger.warning("operator-note %s: %s", resp.status_code, resp.text[:200])
                return None
            data = resp.json()
            return data.get("point_id")
    except Exception as exc:
        logger.warning("operator-note 호출 실패: %s", exc)
        return None


async def call_update_operator_note(
    point_id: str,
    question: str,
    answer: str,
    source_reference: str | None = None,
    tags: list[str] | None = None,
) -> bool:
    """log-analyzer PATCH /knowledge/operator-note/{point_id} 호출."""
    base = LOG_ANALYZER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.patch(
                f"{base}/knowledge/operator-note/{point_id}",
                json={
                    "question": question,
                    "answer": answer,
                    "source_reference": source_reference,
                    "tags": tags or [],
                },
            )
            return resp.status_code < 400
    except Exception as exc:
        logger.warning("operator-note PATCH 호출 실패: %s", exc)
        return False


async def call_delete_operator_note(point_id: str) -> bool:
    """log-analyzer DELETE /knowledge/operator-note/{point_id} 호출."""
    base = LOG_ANALYZER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.delete(f"{base}/knowledge/operator-note/{point_id}")
            return resp.status_code < 400
    except Exception as exc:
        logger.warning("operator-note DELETE 호출 실패: %s", exc)
        return False


async def call_correction(
    point_id: str,
    collection: str,
    correction_text: str,
) -> bool:
    """log-analyzer POST /knowledge/correction 호출."""
    base = LOG_ANALYZER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{base}/knowledge/correction",
                json={
                    "point_id": point_id,
                    "collection": collection,
                    "correction_text": correction_text,
                },
            )
            return resp.status_code < 400
    except Exception as exc:
        logger.warning("knowledge/correction 호출 실패: %s", exc)
        return False


async def call_federated_search(
    query: str,
    system_id: int | None = None,
    system_name: str | None = None,
    sources: list[str] | None = None,
    limit: int = 5,
    rerank: bool = True,
) -> dict[str, Any]:
    """log-analyzer POST /knowledge/search 호출."""
    base = LOG_ANALYZER_URL.rstrip("/")
    payload: dict[str, Any] = {"query": query, "limit": limit, "rerank": rerank}
    if system_id is not None:
        payload["system_id"] = system_id
    if system_name:
        payload["system_name"] = system_name
    if sources:
        payload["sources"] = sources
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{base}/knowledge/search", json=payload)
            if resp.status_code >= 400:
                logger.warning("knowledge/search %s: %s", resp.status_code, resp.text[:200])
                return {"error": f"log-analyzer {resp.status_code}: {resp.text[:200]}", "results": []}
            return resp.json()
    except Exception as exc:
        logger.warning("knowledge/search 호출 실패: %s", exc)
        return {"error": f"log-analyzer 호출 실패: {str(exc)[:200]}", "results": []}


async def call_embed_text(text: str) -> list[float] | None:
    """클러스터링용 단일 텍스트 임베딩. log-analyzer /embed/text 호출.

    엔드포인트가 없으면 None 반환 (클러스터링은 no-op 폴백).
    T2 미구현 시 cold-path 지연을 최소화하기 위해 타임아웃 3초 사용.
    """
    base = LOG_ANALYZER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(f"{base}/embed/text", json={"text": text})
            if resp.status_code >= 400:
                return None
            data = resp.json()
            return data.get("embedding")
    except Exception as exc:
        logger.debug("embed/text 호출 실패: %s", exc)
        return None


# ── 클러스터링 유틸리티 ────────────────────────────────────────────────────────

def cluster_questions_by_cosine(
    items: list[dict[str, Any]],
    threshold: float = 0.85,
) -> list[list[dict[str, Any]]]:
    """numpy 기반 단순 Greedy 클러스터링.

    각 item은 'embedding' 키(list[float])와 'content' 키를 가져야 한다.
    embedding이 없으면 각 item을 독립 클러스터로 반환 (no-op 폴백).
    """
    if not items:
        return []

    # 임베딩 없는 경우 no-op: 각 item을 독립 1-element 클러스터로 반환
    if not items[0].get("embedding"):
        return [[item] for item in items]

    try:
        import numpy as np  # noqa: PLC0415

        vecs = np.array([item["embedding"] for item in items], dtype=np.float32)
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1e-9, norms)
        vecs_norm = vecs / norms

        assigned = [False] * len(items)
        clusters: list[list[dict[str, Any]]] = []

        for i, item in enumerate(items):
            if assigned[i]:
                continue
            cluster = [item]
            assigned[i] = True
            sims = vecs_norm @ vecs_norm[i]
            for j in range(i + 1, len(items)):
                if not assigned[j] and float(sims[j]) >= threshold:
                    cluster.append(items[j])
                    assigned[j] = True
            clusters.append(cluster)

        return clusters
    except ImportError:
        logger.warning("numpy 미설치 — 클러스터링 no-op 폴백")
        return [[item] for item in items]
    except Exception as exc:
        logger.warning("클러스터링 실패: %s", exc)
        return [[item] for item in items]
