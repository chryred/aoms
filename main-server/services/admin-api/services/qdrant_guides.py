"""knowledge_guides Qdrant 컬렉션 — log-analyzer 프록시 클라이언트.

ADR-011 Hybrid 통일에 따라 admin-api는 더 이상 Qdrant를 직접 호출하지 않는다.
인덱싱·검색·삭제 모두 log-analyzer `/guides/*` 엔드포인트로 위임한다.

**호환성**: 기존 시그니처(index_guide, search_guides 등)를 유지하여 이미 사용
중인 라우트(routes/guides.py 등)가 코드 변경 없이 동작하도록 한다.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")

_log_analyzer_http = httpx.AsyncClient(base_url=LOG_ANALYZER_URL, timeout=30.0)


# ── 컬렉션 관리 (no-op) ─────────────────────────────────────────────────────

async def ensure_collection() -> None:
    """이전엔 admin-api가 직접 컬렉션을 만들었지만 ADR-011 Hybrid 통일 이후
    log-analyzer 부팅 lifespan이 ensure_guides_collection()을 호출한다.
    호환성을 위해 함수는 유지하되 noop으로 둔다.
    """
    return None


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
    """가이드를 log-analyzer로 임베딩 위임.

    category / tags / image_count는 현 시점에 LLM 검색 품질에 영향이 적어
    log-analyzer 측 payload에 포함하지 않는다 (필요 시 attachments 텍스트로 합침).
    실패 시 경고만 출력 (graceful — 가이드 등록 자체를 막지 않는다).
    """
    payload: dict[str, Any] = {
        "guide_id": guide_id,
        "system_id": system_id,
        "title": title,
        "content": content,
    }
    try:
        resp = await _log_analyzer_http.post("/guides/embed", json=payload)
        if resp.status_code >= 400:
            logger.warning(
                "guide %s log-analyzer embed 실패 %d: %s",
                guide_id,
                resp.status_code,
                resp.text[:200],
            )
        else:
            logger.debug("guide %s log-analyzer 인덱싱 완료", guide_id)
    except Exception as exc:
        logger.warning("guide %s log-analyzer embed 오류: %s", guide_id, str(exc)[:200])


# ── payload 부분 업데이트 ───────────────────────────────────────────────────

async def update_image_count(guide_id: str, image_count: int) -> None:
    """이미지 개수만 변경 시 재임베딩이 의미 없으므로 noop.

    log-analyzer 측 payload에 image_count가 없어 동기화 대상이 아님.
    가이드 본문이 바뀐 경우엔 index_guide()가 다시 호출된다.
    """
    return None


# ── 삭제 ────────────────────────────────────────────────────────────────────

async def delete_guide_index(guide_id: str) -> None:
    """log-analyzer를 통해 knowledge_guides 포인트 삭제."""
    try:
        resp = await _log_analyzer_http.delete(f"/guides/{guide_id}")
        if resp.status_code >= 400:
            logger.warning(
                "guide %s log-analyzer delete 실패 %d: %s",
                guide_id,
                resp.status_code,
                resp.text[:200],
            )
        else:
            logger.debug("guide %s log-analyzer 삭제 완료", guide_id)
    except Exception as exc:
        logger.warning("guide %s log-analyzer delete 오류: %s", guide_id, str(exc)[:200])


# ── 검색 (호환 유지용 — 신규 코드는 chat_tools/executors/qdrant.py 사용) ──

async def search_guides(
    query: str,
    system_id: Optional[int] = None,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """log-analyzer /guides/search 호출.

    system_id 단건 인터페이스(레거시)를 system_ids 리스트로 변환.
    `system_id IN [x] OR system_id IS NULL` 필터가 log-analyzer 측에서 적용됨.
    """
    if not query or not query.strip():
        return []

    body: dict[str, Any] = {"query": query.strip(), "limit": limit}
    if system_id is not None:
        body["system_ids"] = [int(system_id)]

    try:
        resp = await _log_analyzer_http.post("/guides/search", json=body)
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

    if not isinstance(data, list):
        return []

    results: list[dict[str, Any]] = []
    for hit in data:
        payload = hit.get("payload") or {}
        results.append(
            {
                "guide_id": payload.get("guide_id") or hit.get("id"),
                "score": hit.get("score", 0.0),
                "system_id": payload.get("system_id"),
                "title": payload.get("title", ""),
                "category": "",  # 호환 필드 — 더 이상 저장하지 않음
            }
        )
    return results
