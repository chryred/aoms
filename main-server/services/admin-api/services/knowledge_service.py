"""Knowledge 서비스 — log-analyzer HTTP 호출 wrapper + DB 비즈니스 로직.

log-analyzer V1 엔드포인트(T2)가 없어도 import-time 오류 없게 설계됨.
런타임 호출 실패는 허용 (best-effort).
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")

_TIMEOUT = 30.0
_EMBED_POLL_INTERVAL = 3.0   # 폴링 간격(초)
_EMBED_POLL_MAX = 200         # 최대 시도 횟수 (200 × 3s = 600s = 10분)


# ── log-analyzer HTTP 호출 wrapper ────────────────────────────────────────────

async def call_embed_document(
    file_path: str,
    doc_type: str,
    system_id: int,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """log-analyzer POST /embed/document → job_id 반환 → 완료까지 폴링.

    log-analyzer는 즉시 job_id를 반환하고 백그라운드에서 임베딩을 수행한다.
    이 함수는 완료(done/error)까지 폴링 후 최종 결과를 반환한다.
    """
    base = LOG_ANALYZER_URL.rstrip("/")

    # 1) 임베딩 Job 등록 (즉시 반환)
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
            job = resp.json()
    except Exception as exc:
        logger.warning("embed/document 호출 실패: %s", exc)
        return {"error": f"log-analyzer 호출 실패: {str(exc)[:200]}"}

    log_job_id = job.get("job_id")
    if not log_job_id:
        # 구버전 호환: 즉시 결과 반환 형태
        return job

    # 2) 완료까지 폴링
    for _ in range(_EMBED_POLL_MAX):
        await asyncio.sleep(_EMBED_POLL_INTERVAL)
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                status_resp = await client.get(f"{base}/embed/jobs/{log_job_id}")
                if status_resp.status_code == 200:
                    status = status_resp.json()
                    if status.get("status") == "done":
                        return status
                    if status.get("status") == "error":
                        return {"error": status.get("error", "임베딩 실패")}
        except Exception as exc:
            logger.warning("embed/jobs 폴링 실패: %s", exc)

    return {"error": "임베딩 타임아웃 (10분 초과)"}


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


async def call_list_operator_notes(
    system_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """log-analyzer GET /knowledge/operator-notes 호출 → 목록 반환.

    실패 시 빈 목록 반환 (best-effort).
    """
    base = LOG_ANALYZER_URL.rstrip("/")
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if system_id is not None:
        params["system_id"] = system_id
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{base}/knowledge/operator-notes", params=params)
            if resp.status_code >= 400:
                logger.warning("operator-notes list %s: %s", resp.status_code, resp.text[:200])
                return {"items": [], "total": 0}
            return resp.json()
    except Exception as exc:
        logger.warning("operator-notes list 호출 실패: %s", exc)
        return {"items": [], "total": 0}


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


async def call_trigger_sync(source: str) -> dict[str, Any]:
    """log-analyzer POST /knowledge/sync/{source}/trigger 호출."""
    base = LOG_ANALYZER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(f"{base}/knowledge/sync/{source}/trigger")
            if resp.status_code >= 400:
                logger.warning("sync trigger %s %s: %s", source, resp.status_code, resp.text[:200])
                return {"queued": False}
            return {"queued": True}
    except Exception as exc:
        logger.warning("sync trigger 호출 실패: %s", exc)
        return {"queued": False}


async def call_force_sync_jira_raw(issue_key: str) -> dict[str, Any]:
    """log-analyzer POST /knowledge/sync/jira/{issue_key}/force 동기 호출 (백그라운드 Job 내부용).

    완료까지 대기. 성공 시 {"synced": True, ...}, 실패 시 {"synced": False, "error": ...}.
    """
    base = LOG_ANALYZER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(f"{base}/knowledge/sync/jira/{issue_key}/force")
            if resp.status_code >= 400:
                logger.warning("force sync jira %s %s: %s", issue_key, resp.status_code, resp.text[:200])
                return {"synced": False, "error": f"{resp.status_code}: {resp.text[:200]}"}
            return resp.json()
    except Exception as exc:
        logger.warning("force sync jira 호출 실패 [%s]: %s", issue_key, exc)
        return {"synced": False, "error": str(exc)[:200]}


async def call_force_sync_confluence_raw(page_id: str) -> dict[str, Any]:
    """log-analyzer POST /knowledge/sync/confluence/{page_id}/force 동기 호출 (백그라운드 Job 내부용)."""
    base = LOG_ANALYZER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(f"{base}/knowledge/sync/confluence/{page_id}/force")
            if resp.status_code >= 400:
                logger.warning("force sync confluence %s %s: %s", page_id, resp.status_code, resp.text[:200])
                return {"synced": False, "error": f"{resp.status_code}: {resp.text[:200]}"}
            return resp.json()
    except Exception as exc:
        logger.warning("force sync confluence 호출 실패 [%s]: %s", page_id, exc)
        return {"synced": False, "error": str(exc)[:200]}


async def call_trigger_cleanup(source: str, dry_run: bool = False) -> dict[str, Any]:
    """log-analyzer POST /knowledge/cleanup/{source}/trigger 호출."""
    base = LOG_ANALYZER_URL.rstrip("/")
    params: dict[str, Any] = {}
    if dry_run:
        params["dry_run"] = "true"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{base}/knowledge/cleanup/{source}/trigger",
                params=params,
            )
            if resp.status_code >= 400:
                logger.warning("cleanup trigger %s %s: %s", source, resp.status_code, resp.text[:200])
                return {"queued": False}
            return {"queued": True}
    except Exception as exc:
        logger.warning("cleanup trigger 호출 실패: %s", exc)
        return {"queued": False}


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


async def call_embed_batch(texts: list[str]) -> list[list[float] | None]:
    """복수 텍스트 배치 임베딩. log-analyzer /embed/batch 1회 호출.

    실패 시 texts 길이만큼 None 배열 반환 (클러스터링 no-op 폴백).
    """
    if not texts:
        return []
    base = LOG_ANALYZER_URL.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{base}/embed/batch", json={"texts": texts})
            if resp.status_code >= 400:
                return [None] * len(texts)
            data = resp.json()
            return data.get("embeddings", [None] * len(texts))
    except Exception as exc:
        logger.debug("embed/batch 호출 실패: %s", exc)
        return [None] * len(texts)


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
