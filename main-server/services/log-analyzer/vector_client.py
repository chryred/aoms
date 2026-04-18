"""
Synapse Phase 4b — 벡터 임베딩 & Qdrant 유사도 검색 클라이언트

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

# 모듈 레벨 공유 클라이언트 — lifespan에서 aclose() 호출
# bge-m3 cold-start는 60초 이상 걸리므로 120초로 여유있게 설정
_ollama_http = httpx.AsyncClient(timeout=120.0)  # Ollama 임베딩 (cold-start 대비)
_qdrant_http  = httpx.AsyncClient(timeout=10.0)   # Qdrant (빠름)

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

_EMBED_MAX_CHARS = 100  # paraphrase-multilingual max_seq_length=128 토큰
# 한국어 서브워드 토큰화 시 문자당 최대 3토큰 → 100자 ≈ 최대 300토큰 →
# 실제 모델 상한(128)에 맞추기 위해 문자 단위로 안전하게 잘라낸다.

async def get_embedding(text: str) -> list[float]:
    """단건 임베딩 생성 (paraphrase-multilingual: 768차원 float 리스트)

    paraphrase-multilingual 은 BERT 계열 모델로 max_seq_length=128 토큰 한도가 있어,
    긴 로그 묶음을 그대로 전달하면 Ollama 500 에러가 발생한다.
    _EMBED_MAX_CHARS 이후는 잘라내어 패턴 특징만 유지한다.
    """
    truncated = text[:_EMBED_MAX_CHARS]
    resp = await _ollama_http.post(
        f"{OLLAMA_URL}/api/embeddings",
        json={
            "model": EMBED_MODEL,
            "prompt": truncated,
            "keep_alive": "24h",   # 2-core CPU 환경: 모델 언로드 방지로 cold-start 회피
        },
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
    resp = await _qdrant_http.post(
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
    root_cause: str | None = None,
    recommendation: str | None = None,
) -> str:
    """분석된 로그 패턴을 Qdrant에 저장. 저장된 point_id 반환."""
    point_id = str(uuid4())
    payload = {
        "system_name":      system_name,
        "instance_role":    instance_role,
        "severity":         severity,
        "log_pattern":      log_pattern[:500],
        "error_category":   error_category,
        "root_cause":       root_cause,
        "recommendation":   recommendation,
        "timestamp":        datetime.now(timezone.utc).isoformat(),
        "occurrence_count": 1,
        "resolved":         False,
    }

    await ensure_collection(COLLECTION)
    resp = await _qdrant_http.put(
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
    resp = await _qdrant_http.post(
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
    trace_context: str = "",
    trace_tier: str = "5min",
) -> str:
    """
    유사 이력 + 해결책을 포함한 강화 프롬프트 생성.
    토큰 예산: 4,000 토큰 이내 (log_content 3,000자 기본 + 컨텍스트 1,000자)
    trace_context가 있으면 log_content를 tier별로 축소하고 trace 섹션 삽입.
    """
    # trace_context 있을 때 log_content tier별 축소
    log_limit_map = {"5min": 2600, "hourly": 2700, "daily": 2800}
    log_limit = log_limit_map.get(trace_tier, 3000) if trace_context else 3000
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

    # trace 섹션 (OTel 적용 시스템만)
    trace_section = ""
    if trace_context:
        trace_section = f"\n=== 분산 추적 요약 ({trace_tier}) ===\n{trace_context}\n"

    return f"""=== 현재 이상 분류: {type_label} ===
시스템: {system_name} / {instance_role}
{trace_section}
{log_content[:log_limit]}

=== 과거 유사 장애 이력 (상위 3건) ===
{history_ctx}

=== 검증된 해결책 ===
{solution_ctx}

위 정보를 바탕으로 반드시 아래 JSON 형식으로만 응답하세요. 추가 설명 없이 JSON만 출력하세요.

작성 규칙(가독성):
- root_cause: 한국어. 핵심 원인 한 줄 요약 + 근거 1~2줄. 각 문장은 줄바꿈(\\n)으로 구분. 마크다운(**, -, #) 사용 금지.
- recommendation: 한국어. 번호 목록 형식으로 작성하되 각 항목을 반드시 줄바꿈(\\n)으로 구분. 예:
  "1) 즉시 조치: ...\\n2) 원인 분석: ...\\n3) 재발 방지: ..."
  한 줄에 모든 항목을 이어 쓰지 말 것. 항목 내부는 한 문장으로 간결하게.

{{"severity": "critical 또는 warning 또는 info", "root_cause": "원인 요약\\n근거/세부 설명", "recommendation": "1) 즉시 조치: ...\\n2) 원인 분석: ...\\n3) 재발 방지: ...", "error_category": "오류 카테고리 (예: DB_CONNECTION, MEMORY, NETWORK 등)", "estimated_impact": "예상 영향 범위 (한국어, 1문장)"}}"""


# ── Phase 4c: 메트릭 벡터 유사도 분석 ───────────────────────────────────────

METRIC_COLLECTION = "metric_baselines"

# 메트릭용 분류 임계치 (로그: 0.95/0.85/0.75)
# 메트릭은 반복성이 높아 duplicate 기준을 낮춤 → 과도한 알림 억제 방지
_METRIC_DUPLICATE  = 0.92
_METRIC_RECURRING  = 0.82
_METRIC_RELATED    = 0.72


def build_metric_description(
    system_name: str,
    instance_role: str,
    alertname: str,
    labels: dict,
    annotations: dict,
) -> str:
    """
    Alertmanager 라벨/어노테이션으로 메트릭 상태 자연어 기술문 생성.
    이 텍스트가 임베딩의 입력이 된다.

    예: "web-server (was1) HighCPUUsage 이상 — 현재값: 87 | CPU 사용률 임계 초과"
    """
    metric_name  = labels.get("metric_name", alertname)
    metric_value = labels.get("metric_value") or annotations.get("value", "")
    summary      = annotations.get("summary", "")
    description  = annotations.get("description", "")

    parts = [system_name]
    if instance_role:
        parts.append(f"({instance_role})")
    parts.append(f"{metric_name} 이상")
    if metric_value:
        parts.append(f"— 현재값: {metric_value}")
    if summary:
        parts.append(f"| {summary[:150]}")
    elif description:
        parts.append(f"| {description[:150]}")

    return " ".join(parts)


async def search_similar_metrics(
    embedding: list[float],
    system_name: str,
    metric_name: str,
    limit: int = 5,
    score_threshold: float = _METRIC_RELATED,
) -> list[dict]:
    """
    metric_baselines 컬렉션에서 유사한 과거 메트릭 이상 이력 검색.
    system_name + metric_name 이중 필터로 무관한 메트릭 간 간섭 방지.
    """
    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{METRIC_COLLECTION}/points/search",
        json={
            "vector": embedding,
            "filter": {
                "must": [
                    {"key": "system_name", "match": {"value": system_name}},
                    {"key": "metric_name", "match": {"value": metric_name}},
                ]
            },
            "limit": limit,
            "with_payload": True,
            "score_threshold": score_threshold,
        },
    )
    resp.raise_for_status()
    return resp.json().get("result", [])


def classify_metric_anomaly(similar_results: list[dict]) -> dict:
    """
    메트릭 유사도 검색 결과로 이상 유형 분류.
    classify_anomaly()와 동일한 구조, 임계치만 다름.
    """
    if not similar_results:
        return {"type": "new", "score": 0.0, "has_solution": False, "top_results": []}

    top   = similar_results[0]
    score = top["score"]

    if score >= _METRIC_DUPLICATE:
        anomaly_type = "duplicate"
    elif score >= _METRIC_RECURRING:
        anomaly_type = "recurring"
    elif score >= _METRIC_RELATED:
        anomaly_type = "related"
    else:
        anomaly_type = "new"

    has_solution = any(r["payload"].get("resolution") for r in similar_results)

    return {
        "type":         anomaly_type,
        "score":        score,
        "has_solution": has_solution,
        "top_results":  similar_results[:3],
    }


async def store_metric_vector(
    embedding: list[float],
    system_name: str,
    instance_role: str,
    metric_name: str,
    alertname: str,
    severity: str,
    metric_value: str | None = None,
) -> str:
    """메트릭 이상 이력을 metric_baselines 컬렉션에 저장. point_id 반환."""
    point_id = str(uuid4())
    payload = {
        "system_name":   system_name,
        "instance_role": instance_role,
        "metric_name":   metric_name,
        "alertname":     alertname,
        "severity":      severity,
        "metric_value":  metric_value,
        "timestamp":     datetime.now(timezone.utc).isoformat(),
        "resolved":      False,
    }

    await ensure_collection(METRIC_COLLECTION)
    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{METRIC_COLLECTION}/points",
        json={"points": [{"id": point_id, "vector": embedding, "payload": payload}]},
    )
    resp.raise_for_status()
    return point_id


async def analyze_metric_similarity(
    system_name: str,
    instance_role: str,
    alertname: str,
    labels: dict,
    annotations: dict,
) -> dict:
    """
    메트릭 알림에 대한 벡터 유사도 분석 통합 함수.
    log-analyzer의 POST /metric/similarity 엔드포인트에서 호출.

    1. 자연어 기술문 생성
    2. Ollama 임베딩
    3. Qdrant 유사 이력 검색
    4. 이상 분류
    5. duplicate가 아닌 경우 벡터 저장

    임베딩/Qdrant 장애 시 {"type": "new", ...} 반환 → 기존 알림 흐름 유지.
    """
    metric_name  = labels.get("metric_name", alertname)
    metric_value = labels.get("metric_value") or annotations.get("value")
    severity     = labels.get("severity", "warning")

    description = build_metric_description(
        system_name, instance_role, alertname, labels, annotations
    )

    try:
        embedding = await get_embedding(description)
    except Exception as exc:
        logger.warning("메트릭 임베딩 생성 실패: %s → 벡터 검색 없이 진행", exc)
        return {
            "type": "new", "score": 0.0, "has_solution": False,
            "top_results": [], "point_id": None, "description": description,
        }

    try:
        similar      = await search_similar_metrics(embedding, system_name, metric_name)
        anomaly_info = classify_metric_anomaly(similar)
    except Exception as exc:
        logger.warning("Qdrant 메트릭 검색 실패: %s → 신규 이상으로 처리", exc)
        anomaly_info = {"type": "new", "score": 0.0, "has_solution": False, "top_results": []}

    point_id = None
    if anomaly_info["type"] != "duplicate":
        try:
            point_id = await store_metric_vector(
                embedding, system_name, instance_role,
                metric_name, alertname, severity, metric_value,
            )
        except Exception as exc:
            logger.warning("Qdrant 메트릭 저장 실패: %s", exc)

    return {
        **anomaly_info,
        "point_id":    point_id,
        "description": description,
    }


# ── 컬렉션 관리 ──────────────────────────────────────────────────────────────

_HNSW_CONFIG = {"m": 16, "ef_construct": 200, "ef": 128}
_VECTOR_SIZE  = 768  # paraphrase-multilingual 출력 차원 (bge-m3의 1024에서 축소)


async def ensure_collection(collection_name: str) -> bool:
    """
    컬렉션 미존재 시 자동 생성. True=생성됨, False=이미 존재.
    HNSW: m=16, ef_construct=200, ef=128 / 거리: Cosine
    store_* 함수에서 적재 전 항상 호출.
    """
    check = await _qdrant_http.get(f"{QDRANT_URL}/collections/{collection_name}")
    if check.status_code == 200:
        return False
    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{collection_name}",
        json={
            "vectors":     {"size": _VECTOR_SIZE, "distance": "Cosine"},
            "hnsw_config": _HNSW_CONFIG,
        },
    )
    resp.raise_for_status()
    logger.info("컬렉션 생성: %s (m=16, ef_construct=200, ef=128)", collection_name)
    return True


async def delete_collection(collection_name: str) -> None:
    """컬렉션 삭제. 미존재(404) 시 무시."""
    resp = await _qdrant_http.delete(f"{QDRANT_URL}/collections/{collection_name}")
    if resp.status_code not in (200, 404):
        resp.raise_for_status()
    logger.info("컬렉션 삭제: %s", collection_name)


async def reset_collection(collection_name: str) -> None:
    """컬렉션 삭제 후 재생성 (테스트용 초기화)."""
    await delete_collection(collection_name)
    await ensure_collection(collection_name)
    logger.info("컬렉션 초기화 완료: %s", collection_name)


async def update_metric_resolution(
    point_id: str, resolution: str, resolver: str
) -> None:
    """metric_baselines 포인트에 해결책 추가."""
    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{METRIC_COLLECTION}/points/payload",
        json={
            "payload": {
                "resolution": resolution,
                "resolver": resolver,
                "resolved": True,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            },
            "points": [point_id],
        },
    )
    resp.raise_for_status()


async def resolve_metric_vector(point_id: str) -> None:
    """
    메트릭 알림 복구(resolved) 시 Qdrant metric_baselines 포인트 상태 업데이트.
    admin-api가 Alertmanager resolved 이벤트 수신 시 호출.
    """
    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{METRIC_COLLECTION}/points/payload",
        json={
            "payload": {
                "resolved":    True,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            },
            "points": [point_id],
        },
    )
    resp.raise_for_status()
    logger.info("메트릭 벡터 복구 상태 업데이트: point_id=%s", point_id)
