"""
AOMS Phase 4b — 벡터 임베딩 & Qdrant 유사도 검색 클라이언트

T4.10: 로그 정규화 및 Ollama 임베딩
T4.11: Qdrant 유사도 검색 및 저장
T4.12: 이상 분류 로직
T4.13: LLM 프롬프트 컨텍스트 강화
"""

import hashlib
import logging
import os
import re
from datetime import datetime, timezone
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://server-b:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "bge-m3")
QDRANT_URL  = os.getenv("QDRANT_URL",  "http://server-b:6333")
COLLECTION  = "log_incidents"

ANOMALY_STYLES = {
    "new":       {"color": "FF0000", "label": "신규 이상",  "alert": True},
    "recurring": {"color": "FF8C00", "label": "반복 이상",  "alert": True},
    "related":   {"color": "FFA500", "label": "유사 이상",  "alert": True},
    "duplicate": {"color": "808080", "label": "중복 이상",  "alert": False},
}


# ── T4.10: 로그 정규화 ────────────────────────────────────────────────────

def normalize_log_for_embedding(raw_log: str) -> str:
    """
    로그에서 변수 요소(타임스탬프, IP, UUID, 숫자)를 제거하여
    패턴만 남김 → 임베딩 품질 향상

    예: "2026-03-15T10:00:00 ORA-00060 from 10.0.1.5"
        → "<TS> ORA-00060 from <IP>"
    """
    text = re.sub(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*', '<TS>', raw_log)
    text = re.sub(r'\b\d{1,3}(?:\.\d{1,3}){3}\b', '<IP>', text)
    text = re.sub(
        r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
        '<UUID>', text, flags=re.IGNORECASE,
    )
    text = re.sub(r'\b\d{5,}\b', '<NUM>', text)
    return text.strip()


def compute_fingerprint(text: str) -> str:
    """완전 동일 패턴 중복 방지용 SHA-256 해시 (앞 16자리)"""
    return hashlib.sha256(text.encode()).hexdigest()[:16]


# ── T4.10: Ollama 임베딩 ──────────────────────────────────────────────────

async def get_embedding(text: str) -> list[float]:
    """단건 임베딩 생성 (1024차원 float 리스트 반환)"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
        )
        resp.raise_for_status()
        return resp.json()["embedding"]


# ── T4.11: Qdrant 유사도 검색 & 저장 ──────────────────────────────────────

async def search_similar_incidents(
    embedding: list[float],
    system_name: str,
    limit: int = 5,
    score_threshold: float = 0.75,
) -> list[dict]:
    """
    현재 로그와 유사한 과거 이력 검색

    Returns:
        [{"score": float, "payload": {"log_pattern", "severity", "resolution", ...}}, ...]
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{QDRANT_URL}/collections/{COLLECTION}/points/search",
            json={
                "vector": embedding,
                "filter": {
                    "must": [
                        {"key": "system_name", "match": {"value": system_name}}
                    ]
                },
                "limit": limit,
                "with_payload": True,
                "score_threshold": score_threshold,
            },
        )
        resp.raise_for_status()
        return resp.json().get("result", [])


async def store_incident_vector(
    embedding: list[float],
    system_name: str,
    instance_role: str,
    severity: str,
    log_pattern: str,
    error_category: str | None = None,
) -> str:
    """분석된 로그 패턴을 Qdrant에 저장. 저장된 point_id 반환."""
    point_id = str(uuid4())
    payload = {
        "system_name":      system_name,
        "instance_role":    instance_role,
        "severity":         severity,
        "log_pattern":      log_pattern[:500],
        "error_category":   error_category,
        "timestamp":        datetime.now(timezone.utc).isoformat(),
        "occurrence_count": 1,
        "resolved":         False,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.put(
            f"{QDRANT_URL}/collections/{COLLECTION}/points",
            json={"points": [{"id": point_id, "vector": embedding, "payload": payload}]},
        )
        resp.raise_for_status()
    return point_id


async def update_resolution(point_id: str, resolution: str, resolver: str) -> None:
    """
    피드백 등록 시 해당 벡터 포인트에 해결책 추가.
    phase4-llm.md T4.8 피드백 서버와 연동하여 호출.
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{QDRANT_URL}/collections/{COLLECTION}/points/payload",
            json={
                "payload": {
                    "resolution":  resolution,
                    "resolver":    resolver,
                    "resolved":    True,
                    "resolved_at": datetime.now(timezone.utc).isoformat(),
                },
                "points": [point_id],
            },
        )
        resp.raise_for_status()


# ── T4.12: 이상 분류 ──────────────────────────────────────────────────────

def classify_anomaly(similar_results: list[dict]) -> dict:
    """
    유사도 검색 결과로 이상 유형을 분류

    분류 기준:
      - duplicate  (score ≥ 0.95): 동일 패턴 반복 → 알림 억제
      - recurring  (score ≥ 0.85): 이전에 본 패턴의 재발 → 높은 우선순위
      - related    (score ≥ 0.75): 유사하지만 다른 패턴 → 중간 우선순위
      - new        (score < 0.75 또는 결과 없음): 신규 이상 → 즉시 에스컬레이션

    Returns:
        {"type": "new"|"recurring"|"related"|"duplicate",
         "score": float, "has_solution": bool, "top_results": list}
    """
    if not similar_results:
        return {"type": "new", "score": 0.0, "has_solution": False, "top_results": []}

    top   = similar_results[0]
    score = top["score"]

    if score >= 0.95:
        anomaly_type = "duplicate"
    elif score >= 0.85:
        anomaly_type = "recurring"
    elif score >= 0.75:
        anomaly_type = "related"
    else:
        anomaly_type = "new"

    has_solution = any(r["payload"].get("resolution") for r in similar_results)

    return {
        "type":        anomaly_type,
        "score":       score,
        "has_solution": has_solution,
        "top_results": similar_results[:3],
    }


# ── T4.13: LLM 프롬프트 컨텍스트 강화 ────────────────────────────────────

def build_enhanced_prompt(
    log_content: str,
    system_name: str,
    instance_role: str,
    anomaly_info: dict,
) -> str:
    """
    유사 이력 + 해결책을 포함한 강화 프롬프트 생성.
    토큰 예산: 4,000 토큰 이내 (log_content 3,000자 + 컨텍스트 1,000자)
    """
    similar      = anomaly_info.get("top_results", [])
    anomaly_type = anomaly_info["type"]
    score        = anomaly_info.get("score", 0.0)

    # 유사 이력 섹션 (최대 3건 × 150자)
    if similar:
        history_lines = []
        for i, r in enumerate(similar[:3], 1):
            p = r["payload"]
            history_lines.append(
                f"[이력{i}] 유사도:{r['score']:.0%} "
                f"심각도:{p.get('severity', '?')} "
                f"패턴:{p.get('log_pattern', '')[:150]}"
            )
        history_ctx = "\n".join(history_lines)
    else:
        history_ctx = "없음"

    # 검증된 해결책 섹션 (최대 2건 × 200자)
    solutions = [r for r in similar if r["payload"].get("resolution")]
    if solutions:
        sol_lines = []
        for s in solutions[:2]:
            p = s["payload"]
            sol_lines.append(
                f"- 해결: {p['resolution'][:200]}\n"
                f"  처리자: {p.get('resolver', '미기재')}"
            )
        solution_ctx = "\n".join(sol_lines)
    else:
        solution_ctx = "등록된 해결책 없음"

    # 이상 분류 레이블
    type_label = {
        "new":       "신규 이상 (유사 사례 없음)",
        "recurring": f"반복 이상 (유사도 {score:.0%})",
        "related":   f"유사 이상 (유사도 {score:.0%})",
        "duplicate": f"중복 이상 (유사도 {score:.0%})",
    }.get(anomaly_type, "미분류")

    return f"""=== 현재 이상 분류: {type_label} ===
시스템: {system_name} / {instance_role}

{log_content[:3000]}

=== 과거 유사 장애 이력 (상위 3건) ===
{history_ctx}

=== 검증된 해결책 ===
{solution_ctx}

위 정보를 바탕으로 반드시 아래 JSON 형식으로만 응답하세요. 추가 설명 없이 JSON만 출력하세요.
{{"severity": "critical 또는 warning 또는 info", "root_cause": "오류의 근본 원인 (한국어, 1~2문장)", "recommendation": "해결 방법 및 권고사항 (한국어, 구체적으로)", "error_category": "오류 카테고리 (예: DB_CONNECTION, MEMORY, NETWORK 등)", "estimated_impact": "예상 영향 범위 (한국어, 1문장)"}}"""
