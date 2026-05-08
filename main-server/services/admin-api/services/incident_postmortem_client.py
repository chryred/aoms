"""
incident_postmortem_client.py — log-analyzer HTTP 클라이언트 (인시던트 사후 분석용)

호출 대상:
  POST /incident-postmortem/embed             — 해결책 Qdrant 임베딩
  POST /incident-postmortem/search            — Hybrid 검색
  POST /incident-postmortem/ocr/process       — OCR 처리 (단순 동기)
  POST /incident-postmortem/ocr/process-stream — SSE 스트리밍 OCR (진행률 포함)
"""
import json
import logging
import os
from typing import Callable, Awaitable

import httpx

logger = logging.getLogger(__name__)
LOG_ANALYZER_URL = os.getenv("LOG_ANALYZER_URL", "http://log-analyzer:8000")


async def embed_postmortem(payload: dict, qdrant_point_id: str | None = None) -> str:
    """log-analyzer /incident-postmortem/embed 호출. 반환: qdrant_point_id (str)"""
    body: dict = {**payload}
    if qdrant_point_id:
        body["qdrant_point_id"] = qdrant_point_id
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(f"{LOG_ANALYZER_URL}/incident-postmortem/embed", json=body)
        resp.raise_for_status()
        return resp.json()["qdrant_point_id"]


async def search_postmortem(
    query: str = "",
    system_id: int | None = None,
    severity: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """log-analyzer /incident-postmortem/search 호출. 반환: results 목록.
    query가 빈 문자열이면 log-analyzer가 scroll 전체 목록 반환."""
    body: dict = {"query": query, "limit": limit}
    if system_id is not None:
        body["system_id"] = system_id
    if severity:
        body["severity"] = severity
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{LOG_ANALYZER_URL}/incident-postmortem/search", json=body)
        resp.raise_for_status()
        data = resp.json()
        # log-analyzer returns a list directly
        if isinstance(data, list):
            return data
        return data.get("results", [])


async def get_by_incident(incident_id: int) -> dict | None:
    """log-analyzer /incident-postmortem/by-incident/{incident_id} 호출.
    반환: payload dict (없으면 None).
    log-analyzer는 payload 필드를 top-level로 펼쳐서 반환하므로 응답 dict 전체를 그대로 사용."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.get(
                f"{LOG_ANALYZER_URL}/incident-postmortem/by-incident/{incident_id}"
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            if not isinstance(data, dict):
                return None
            # log-analyzer가 {"payload": {...}}로 감싸 보내는 케이스도 폴백 지원
            if "payload" in data and isinstance(data["payload"], dict):
                return data["payload"]
            # 기본: top-level dict이 곧 payload
            return data
        except Exception as exc:
            logger.warning("postmortem by-incident 조회 실패 (incident_id=%s): %s", incident_id, exc)
            return None


async def trigger_ocr(file_path: str, mime_type: str) -> dict:
    """log-analyzer /incident-postmortem/ocr/process 호출. 반환: {text, char_count}"""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{LOG_ANALYZER_URL}/incident-postmortem/ocr/process",
            json={"file_path": file_path, "mime_type": mime_type},
        )
        resp.raise_for_status()
        return resp.json()


async def trigger_ocr_streaming(
    file_path: str,
    mime_type: str,
    on_progress: Callable[[int], Awaitable[None]] | None = None,
) -> dict:
    """SSE 스트리밍 OCR — 진행률 콜백을 받아 각 progress 이벤트마다 호출.

    반환: {"text": str, "ocr_status": "done"|"failed"}
    """
    _timeout = httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0)
    async with httpx.AsyncClient(timeout=_timeout) as client:
        async with client.stream(
            "POST",
            f"{LOG_ANALYZER_URL}/incident-postmortem/ocr/process-stream",
            json={"file_path": file_path, "mime_type": mime_type},
        ) as response:
            response.raise_for_status()
            ocr_text = ""
            ocr_status = "failed"
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                try:
                    data = json.loads(line[5:].strip())
                except Exception:
                    continue
                status = data.get("status", "")
                if status == "processing" and on_progress is not None:
                    await on_progress(int(data.get("progress", 0)))
                elif status in ("done", "failed"):
                    ocr_text = data.get("text", "")
                    ocr_status = status
    return {"text": ocr_text, "ocr_status": ocr_status}
