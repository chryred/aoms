"""
incident_postmortem_client.py — log-analyzer HTTP 클라이언트 (인시던트 사후 분석용)

호출 대상:
  POST /incident-postmortem/embed   — 해결책 Qdrant 임베딩
  POST /incident-postmortem/search  — Hybrid 검색
  POST /incident-postmortem/ocr/process — OCR 처리
"""
import logging
import os

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
    query: str,
    system_id: int | None = None,
    severity: str | None = None,
    limit: int = 10,
) -> list[dict]:
    """log-analyzer /incident-postmortem/search 호출. 반환: results 목록"""
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
    """log-analyzer /incident-postmortem/ocr/process 호출. 반환: {ocr_text, ocr_status}"""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{LOG_ANALYZER_URL}/incident-postmortem/ocr/process",
            json={"file_path": file_path, "mime_type": mime_type},
        )
        resp.raise_for_status()
        return resp.json()
