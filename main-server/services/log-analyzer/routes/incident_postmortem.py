"""
incident_postmortems 라우터 — Wave 1B

엔드포인트:
  POST /incident-postmortem/embed             — 인시던트 postmortem 임베딩 저장
  POST /incident-postmortem/search            — 자연어 쿼리로 Hybrid 검색
  GET  /incident-postmortem/by-incident/{id}  — incident_id 직접 조회
  POST /incident-postmortem/ocr/process       — 파일 경로 OCR 처리 (텍스트 추출)
  POST /incident-postmortem/ocr/process-stream — SSE 스트리밍 OCR (진행률 포함)
"""

import asyncio
import json
import logging
import os
import pathlib
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import vector_client
import ocr_worker

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/incident-postmortem", tags=["incident-postmortem"])

KNOWLEDGE_DOCS_DIR = os.getenv(
    "KNOWLEDGE_DOCS_DIR",
    str(pathlib.Path(__file__).parent.parent.parent / "attaches" / "knowledge-docs"),
)


# ── 요청/응답 스키마 ──────────────────────────────────────────────────────────

class EmbedPostmortemRequest(BaseModel):
    incident_id:      int
    title:            str = ""
    system_name:      str = ""
    system_id:        Optional[int] = None
    severity:         str = ""
    alert_excerpts:   str = ""
    root_cause:       str = ""
    solution:         str = ""
    ocr_text:         str = ""
    tags:             list[str] = []
    qdrant_point_id:  Optional[str] = None


class EmbedPostmortemResponse(BaseModel):
    incident_id:     int
    qdrant_point_id: str


class SearchPostmortemRequest(BaseModel):
    query:        str = ""
    system_id:    Optional[int] = None
    severity:     Optional[str] = None
    limit:        int = 5
    rerank:       bool = False
    rerank_top_k: int = 5


class SearchResultItem(BaseModel):
    id:      str
    score:   float
    payload: dict


class OcrProcessRequest(BaseModel):
    file_path: str          # KNOWLEDGE_DOCS_DIR 하위 상대 경로 또는 절대 경로
    mime_type: str          # e.g. "image/png", "application/pdf"


# ── 엔드포인트 ────────────────────────────────────────────────────────────────

@router.post("/embed", response_model=EmbedPostmortemResponse)
async def embed_postmortem(req: EmbedPostmortemRequest):
    """
    인시던트 사후분석(postmortem) 서사를 임베딩하여 incident_postmortems에 upsert.

    qdrant_point_id가 주어지면 해당 포인트 업데이트(Wave 1A admin-api 피드백 흐름),
    없으면 신규 포인트 생성.
    """
    payload = req.model_dump(exclude={"incident_id", "qdrant_point_id"})
    try:
        point_id = await vector_client.embed_postmortem(
            incident_id=req.incident_id,
            payload=payload,
            qdrant_point_id=req.qdrant_point_id,
        )
    except Exception as exc:
        logger.error("postmortem 임베딩 실패: incident_id=%s — %s", req.incident_id, exc)
        raise HTTPException(status_code=500, detail=f"임베딩 저장 실패: {exc}")

    return EmbedPostmortemResponse(
        incident_id=req.incident_id,
        qdrant_point_id=point_id,
    )


@router.post("/search", response_model=list[SearchResultItem])
async def search_postmortem(req: SearchPostmortemRequest):
    """
    incident_postmortems 검색.

    query가 비어 있으면 scroll로 전체 목록 반환 (system_id/severity 필터 적용).
    query가 있으면 Hybrid(Dense+Sparse RRF) 검색.
    """
    if not req.query.strip():
        try:
            results = await vector_client.list_postmortems(
                system_id=req.system_id,
                severity=req.severity,
                limit=req.limit,
            )
        except Exception as exc:
            logger.error("postmortem 목록 조회 실패: %s", exc)
            raise HTTPException(status_code=500, detail=f"목록 조회 실패: {exc}")
    else:
        retrieval_limit = req.limit * 4 if req.rerank else req.limit
        try:
            results = await vector_client.search_postmortem(
                query=req.query,
                system_id=req.system_id,
                severity=req.severity,
                limit=retrieval_limit,
            )
        except Exception as exc:
            logger.error("postmortem 검색 실패: %s", exc)
            raise HTTPException(status_code=500, detail=f"검색 실패: {exc}")

        if req.rerank and results:
            from reranker import rerank as _rerank

            def _pm_text(h: dict) -> str:
                p = h.get("payload") or {}
                return "\n".join(filter(None, [
                    p.get("title", ""),
                    p.get("root_cause", ""),
                    p.get("solution", ""),
                ]))

            candidates = [{**h, "_text": _pm_text(h)} for h in results]
            try:
                reranked = await _rerank(
                    req.query, candidates, top_k=req.rerank_top_k, text_field="_text"
                )
                for r in reranked:
                    r.pop("_text", None)
                results = reranked
            except Exception as exc:
                logger.warning("Reranker 실패: %s → 원본 RRF 순서 유지", exc)
                results = results[:req.rerank_top_k]

    return [
        SearchResultItem(id=str(r["id"]), score=r["score"], payload=r["payload"])
        for r in results
    ]


@router.get("/by-incident/{incident_id}", response_model=Optional[dict])
async def get_postmortem_by_incident(incident_id: int):
    """
    incident_id로 postmortem 포인트를 직접 조회.

    미존재 시 null 반환 (404 아님 — Wave 1A가 아직 postmortem을 만들지 않았을 수 있음).
    """
    try:
        result = await vector_client.get_postmortem_by_incident(incident_id)
    except Exception as exc:
        logger.error("postmortem 조회 실패: incident_id=%s — %s", incident_id, exc)
        raise HTTPException(status_code=500, detail=f"조회 실패: {exc}")

    return result


@router.post("/ocr/process")
async def ocr_process(req: OcrProcessRequest):
    """
    파일 경로에서 텍스트 추출 (Tesseract OCR / pdfplumber / python-docx 등).

    file_path는 KNOWLEDGE_DOCS_DIR 하위여야 하며 경로 탈출 공격 차단.
    Returns:
        {"text": str, "char_count": int}
    """
    # 경로 안전 확인 (절대 경로 + KNOWLEDGE_DOCS_DIR 기준 상대 경로 모두 허용)
    try:
        input_path = pathlib.Path(req.file_path)
        if not input_path.is_absolute():
            input_path = pathlib.Path(KNOWLEDGE_DOCS_DIR) / input_path
        resolved = input_path.resolve()
        base     = pathlib.Path(KNOWLEDGE_DOCS_DIR).resolve()
        resolved.relative_to(base)  # 하위 경로가 아니면 ValueError
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"file_path는 KNOWLEDGE_DOCS_DIR({KNOWLEDGE_DOCS_DIR}) 하위여야 합니다.",
        )

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"파일을 찾을 수 없습니다: {resolved}")

    loop = asyncio.get_event_loop()
    try:
        text = await loop.run_in_executor(
            None, ocr_worker.extract_text, resolved, req.mime_type
        )
    except Exception as exc:
        logger.error("OCR 처리 실패: %s — %s", resolved, exc)
        raise HTTPException(status_code=500, detail=f"OCR 실패: {exc}")

    return {"text": text, "char_count": len(text)}


@router.post("/ocr/process-stream")
async def ocr_process_stream(req: OcrProcessRequest):
    """SSE 스트리밍 OCR — 진행률 이벤트(0~100)를 포함한 text/event-stream 응답.

    이벤트 형식:
      data: {"progress": 25, "status": "processing"}
      data: {"progress": 100, "status": "done", "text": "..."}
      data: {"progress": 0, "status": "failed", "text": ""}
    """
    try:
        input_path = pathlib.Path(req.file_path)
        if not input_path.is_absolute():
            input_path = pathlib.Path(KNOWLEDGE_DOCS_DIR) / input_path
        resolved = input_path.resolve()
        base = pathlib.Path(KNOWLEDGE_DOCS_DIR).resolve()
        resolved.relative_to(base)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"file_path는 KNOWLEDGE_DOCS_DIR({KNOWLEDGE_DOCS_DIR}) 하위여야 합니다.",
        )

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"파일을 찾을 수 없습니다: {resolved}")

    mime_type = req.mime_type
    resolved_path = resolved

    async def event_generator():
        loop = asyncio.get_event_loop()
        queue: asyncio.Queue = asyncio.Queue()

        def progress_cb(pct: int) -> None:
            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"progress": pct, "status": "processing"},
            )

        async def run_ocr():
            try:
                text = await loop.run_in_executor(
                    None,
                    ocr_worker.extract_text_with_progress,
                    resolved_path,
                    mime_type,
                    progress_cb,
                )
                await queue.put({"progress": 100, "status": "done", "text": text})
            except Exception as exc:
                logger.error("SSE OCR 처리 실패: %s — %s", resolved_path, exc)
                await queue.put({"progress": 0, "status": "failed", "text": ""})
            finally:
                await queue.put(None)  # sentinel

        task = asyncio.create_task(run_ocr())
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        finally:
            task.cancel()

    return StreamingResponse(event_generator(), media_type="text/event-stream")
