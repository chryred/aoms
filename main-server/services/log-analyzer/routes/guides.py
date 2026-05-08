"""
knowledge_guides 라우터 — log-analyzer 측 Hybrid 임베딩·검색 엔드포인트.

엔드포인트:
  POST   /guides/embed          — 가이드 Hybrid 임베딩 upsert
  DELETE /guides/{guide_id}     — 가이드 포인트 삭제
  POST   /guides/search         — 자연어 쿼리 Hybrid 검색 (system_id OR NULL 필터)
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import guides_vector_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/guides", tags=["guides"])


# ── 요청/응답 스키마 ──────────────────────────────────────────────────────────

class EmbedGuideRequest(BaseModel):
    guide_id:    str   # admin-api KnowledgeGuide.id (UUID 문자열)
    system_id:   Optional[int] = None
    title:       str = ""
    content:     str = ""
    attachments: Optional[str] = None


class EmbedGuideResponse(BaseModel):
    point_id: str
    status:   str = "ok"


class DeleteGuideResponse(BaseModel):
    deleted: bool


class SearchGuidesRequest(BaseModel):
    query:      str = ""
    system_ids: Optional[list[int]] = None
    limit:      int = 5


class SearchResultItem(BaseModel):
    id:      str
    score:   float
    payload: dict


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.post("/embed", response_model=EmbedGuideResponse)
async def embed_guide(req: EmbedGuideRequest):
    """가이드를 Hybrid 임베딩하여 knowledge_guides에 upsert.

    guide_id (UUID 문자열)를 Qdrant point ID로 직접 사용.
    재호출 시 upsert이므로 내용 업데이트에도 사용 가능.
    """
    try:
        point_id = await guides_vector_client.embed_guide(
            guide_id=req.guide_id,
            system_id=req.system_id,
            title=req.title,
            content=req.content,
            attachments=req.attachments,
        )
    except Exception as exc:
        logger.error("가이드 임베딩 실패: guide_id=%s — %s", req.guide_id, exc)
        raise HTTPException(status_code=500, detail=f"임베딩 저장 실패: {exc}")

    return EmbedGuideResponse(point_id=point_id, status="ok")


@router.delete("/{guide_id}", response_model=DeleteGuideResponse)
async def delete_guide(guide_id: str):
    """knowledge_guides에서 guide_id 포인트 삭제. guide_id는 UUID 문자열."""
    try:
        deleted = await guides_vector_client.delete_guide(guide_id)
    except Exception as exc:
        logger.error("가이드 삭제 실패: guide_id=%s — %s", guide_id, exc)
        raise HTTPException(status_code=500, detail=f"삭제 실패: {exc}")

    return DeleteGuideResponse(deleted=deleted)


@router.post("/search", response_model=list[SearchResultItem])
async def search_guides(req: SearchGuidesRequest):
    """knowledge_guides Hybrid 검색.

    query가 비어 있으면 빈 목록 반환.
    system_ids 지정 시 해당 시스템 또는 전체 공용(system_id IS NULL) 가이드만 반환.
    """
    if not req.query.strip():
        return []

    try:
        results = await guides_vector_client.search_guides(
            query=req.query,
            system_ids=req.system_ids,
            limit=req.limit,
        )
    except Exception as exc:
        logger.error("가이드 검색 실패: %s", exc)
        raise HTTPException(status_code=500, detail=f"검색 실패: {exc}")

    return [
        SearchResultItem(id=r["id"], score=r["score"], payload=r["payload"])
        for r in results
    ]
