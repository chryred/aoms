"""
Synapse — 벡터 임베딩 & Qdrant Hybrid 유사도 검색 클라이언트 (ADR-011)

변경 이력:
- ADR-003: bge-m3 → paraphrase-multilingual (Ollama CPU 타임아웃 대응)
- ADR-011: Ollama 제거 → ONNX 인프로세스 임베딩 + Dense+Sparse Hybrid
  Dense : sentence-transformers + ONNX Runtime 으로 BAAI/bge-m3(1024dim) 로드
          (FastEmbed는 bge-m3 미지원 — GitHub Issue #107, PR #602 미머지 상태.
           Ollama는 llama.cpp 기반이라 인코더 모델인 bge-m3에 비효율 → ONNX로 해결)
  Sparse: fastembed SparseTextEmbedding(Qdrant/bm25) — BM25 IDF 가중치

임베딩 구조:
  Dense:  BAAI/bge-m3  (1024 dim, 한국어 고품질, 최대 8192 토큰)
  Sparse: Qdrant/bm25  (IDF 기반 키워드 매칭)
  Fusion: RRF (Reciprocal Rank Fusion) in Qdrant Query API

Hybrid 적용 컬렉션:
  log_incidents       (dense + sparse)
  metric_baselines    (dense + sparse)
  aggregation_summaries (dense + sparse)
  metric_hourly_patterns (dense만 — LLM 자연어 요약이라 키워드 매칭 불필요)
"""

import asyncio
import hashlib
import logging
import os
import re
from datetime import datetime, timezone
from uuid import uuid4

import httpx

logger = logging.getLogger(__name__)

QDRANT_URL        = os.getenv("QDRANT_URL", "http://server-b:6333")
# Dense: onnxruntime + transformers 토크나이저로 BAAI/bge-m3 ONNX 직접 로드
DENSE_MODEL_NAME  = os.getenv("DENSE_EMBED_MODEL", "BAAI/bge-m3")
DENSE_ONNX_FILE   = os.getenv("DENSE_ONNX_FILE",   "onnx/model.onnx")
# 캐시 경로: 미지정 시 huggingface_hub/fastembed 기본 경로(~/.cache/huggingface, ~/.cache/fastembed) 사용.
# Docker: Dockerfile에서 /app/dense-models, /app/fastembed-models 로 override.
DENSE_MODEL_CACHE  = os.getenv("DENSE_MODEL_CACHE")   or None
# Sparse: fastembed BM25
SPARSE_MODEL_NAME  = os.getenv("SPARSE_EMBED_MODEL", "Qdrant/bm25")
SPARSE_MODEL_CACHE = os.getenv("SPARSE_MODEL_CACHE") or None

COLLECTION        = "log_incidents"
METRIC_COLLECTION = "metric_baselines"

# Qdrant HTTP 클라이언트 (벡터 저장/검색 — 빠름)
_qdrant_http = httpx.AsyncClient(timeout=15.0)

ANOMALY_STYLES = {
    "new":       {"color": "FF0000", "label": "신규 이상",  "alert": True},
    "recurring": {"color": "FF8C00", "label": "반복 이상",  "alert": True},
    "related":   {"color": "FFA500", "label": "유사 이상",  "alert": True},
    "duplicate": {"color": "808080", "label": "중복 이상",  "alert": False},
}


# ── 임베딩 모델 싱글턴 (lazy-load, HF_HUB_OFFLINE=1 환경 호환) ─────────────────
#   Dense : onnxruntime InferenceSession + transformers AutoTokenizer (bge-m3)
#           모델 ONNX가 출력 `sentence_embedding`을 내장 (CLS pooling + normalize).
#   Sparse: fastembed SparseTextEmbedding (Qdrant/bm25)

_dense_session = None   # onnxruntime.InferenceSession
_dense_tokenizer = None
_dense_input_names = None
_sparse_model = None


def _resolve_dense_model_dir() -> str:
    """HF snapshot 디렉터리 경로 반환. DENSE_MODEL_CACHE 미지정 시 HF 기본 경로 사용."""
    from huggingface_hub import snapshot_download
    kwargs: dict = dict(
        repo_id=DENSE_MODEL_NAME,
        allow_patterns=[
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "sentencepiece.bpe.model",
            "special_tokens_map.json",
            f"{DENSE_ONNX_FILE}",
            f"{DENSE_ONNX_FILE}_data",
            "onnx/*.json",
        ],
    )
    if DENSE_MODEL_CACHE:
        kwargs["cache_dir"] = DENSE_MODEL_CACHE
    return snapshot_download(**kwargs)


def _get_dense_session():
    """bge-m3 ONNX InferenceSession + tokenizer를 lazy-load."""
    global _dense_session, _dense_tokenizer, _dense_input_names
    if _dense_session is None:
        import onnxruntime as ort
        from transformers import AutoTokenizer

        logger.info("Dense 모델 로딩: %s (onnxruntime 직접 호출)", DENSE_MODEL_NAME)
        model_dir = _resolve_dense_model_dir()
        onnx_path = os.path.join(model_dir, DENSE_ONNX_FILE)

        sess_opt = ort.SessionOptions()
        _dense_session = ort.InferenceSession(
            onnx_path,
            sess_options=sess_opt,
            providers=["CPUExecutionProvider"],
        )
        _dense_input_names = {i.name for i in _dense_session.get_inputs()}

        _dense_tokenizer = AutoTokenizer.from_pretrained(model_dir)
        logger.info("Dense 모델 준비 완료 (outputs=%s)",
                    [o.name for o in _dense_session.get_outputs()])
    return _dense_session, _dense_tokenizer, _dense_input_names


def _get_sparse_model():
    """BM25 Sparse 모델을 FastEmbed 로 로드."""
    global _sparse_model
    if _sparse_model is None:
        from fastembed import SparseTextEmbedding
        logger.info("Sparse(BM25) 모델 로딩: %s", SPARSE_MODEL_NAME)
        kwargs: dict = {"model_name": SPARSE_MODEL_NAME}
        if SPARSE_MODEL_CACHE:
            kwargs["cache_dir"] = SPARSE_MODEL_CACHE
        _sparse_model = SparseTextEmbedding(**kwargs)
        logger.info("Sparse 모델 준비 완료")
    return _sparse_model


# ── 로그 정규화 ──────────────────────────────────────────────────────────────

def normalize_log_for_embedding(raw_log: str) -> str:
    """
    로그에서 변수 요소(타임스탬프, IP, UUID, 큰 숫자)를 제거하여 패턴만 남김.

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


# ── 임베딩 (ONNX 인프로세스, async wrapper) ─────────────────────────────────

# bge-m3는 최대 8192 토큰 지원 → 한국어 서브워드 기준 안전 마진으로 3000자로 컷.
# 모델 내장 tokenizer가 초과분 자동 truncation을 수행하므로 필요 시 그대로 둬도 무방.
_EMBED_MAX_CHARS = 3000


def _embed_dense_sync(text: str) -> list[float]:
    """bge-m3 ONNX 세션 직접 호출. sentence_embedding 출력(CLS pooling + L2 normalize 포함)을 사용."""
    import numpy as np
    truncated = text[:_EMBED_MAX_CHARS]
    sess, tok, input_names = _get_dense_session()
    enc = tok(
        truncated,
        return_tensors="np",
        padding=True,
        truncation=True,
        max_length=512,
    )
    feed = {k: v for k, v in enc.items() if k in input_names}
    outputs = sess.run(None, feed)
    output_names = [o.name for o in sess.get_outputs()]
    if "sentence_embedding" in output_names:
        vec = outputs[output_names.index("sentence_embedding")][0]
    else:
        # fallback: token_embeddings CLS pooling + L2 normalize
        last = outputs[0][0]
        cls = last[0]
        vec = cls / np.linalg.norm(cls)
    return vec.tolist()


def _embed_sparse_sync(text: str) -> dict:
    truncated = text[:_EMBED_MAX_CHARS]
    model = _get_sparse_model()
    result = next(model.embed([truncated]))
    return {
        "indices": result.indices.tolist(),
        "values":  result.values.tolist(),
    }


async def get_embedding(text: str) -> list[float]:
    """Dense 임베딩 (bge-m3, 1024차원). ONNX 동기 호출을 executor로 래핑."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _embed_dense_sync, text)


async def get_sparse_vector(text: str) -> dict:
    """Sparse 임베딩 (BM25). {"indices": [...], "values": [...]} 반환."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _embed_sparse_sync, text)


# ── Qdrant 컬렉션 관리 ──────────────────────────────────────────────────────

_HNSW_CONFIG  = {"m": 16, "ef_construct": 200, "ef": 128}
_VECTOR_SIZE  = 1024  # bge-m3 출력 차원 (ADR-011)

# Hybrid 컬렉션 기본 스키마 (Dense + Sparse 모두 선언)
_HYBRID_VECTORS_CONFIG = {
    "dense": {"size": _VECTOR_SIZE, "distance": "Cosine"}
}
_HYBRID_SPARSE_CONFIG = {
    "sparse": {"modifier": "idf"}   # BM25 IDF 가중치
}


async def ensure_collection(collection_name: str, hybrid: bool = True) -> bool:
    """
    컬렉션 미존재 시 자동 생성. True=생성됨, False=이미 존재.

    hybrid=True  (기본): Dense(1024) + Sparse(BM25) Hybrid 스키마
    hybrid=False       : Dense 전용 (metric_hourly_patterns용)
    """
    check = await _qdrant_http.get(f"{QDRANT_URL}/collections/{collection_name}")
    if check.status_code == 200:
        return False

    body: dict = {
        "vectors":     _HYBRID_VECTORS_CONFIG,
        "hnsw_config": _HNSW_CONFIG,
    }
    if hybrid:
        body["sparse_vectors"] = _HYBRID_SPARSE_CONFIG

    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{collection_name}",
        json=body,
    )
    resp.raise_for_status()
    logger.info(
        "컬렉션 생성: %s (dense=1024, %s, m=16, ef=128)",
        collection_name,
        "hybrid+sparse" if hybrid else "dense-only",
    )
    return True


async def delete_collection(collection_name: str) -> None:
    """컬렉션 삭제. 미존재(404) 시 무시."""
    resp = await _qdrant_http.delete(f"{QDRANT_URL}/collections/{collection_name}")
    if resp.status_code not in (200, 404):
        resp.raise_for_status()
    logger.info("컬렉션 삭제: %s", collection_name)


async def reset_collection(collection_name: str, hybrid: bool = True) -> None:
    """컬렉션 삭제 후 재생성 (테스트용 초기화)."""
    await delete_collection(collection_name)
    await ensure_collection(collection_name, hybrid=hybrid)
    logger.info("컬렉션 초기화 완료: %s", collection_name)


# ── Hybrid 검색 헬퍼 ────────────────────────────────────────────────────────

async def _hybrid_search(
    collection: str,
    dense: list[float],
    sparse: dict,
    filter_must: list[dict] | None = None,
    limit: int = 5,
    dense_prefetch_threshold: float = 0.5,
) -> list[dict]:
    """
    Qdrant Query API + RRF fusion 공통 헬퍼.

    prefetch:
      - dense:  cosine >= dense_prefetch_threshold (느슨한 사전 필터)
      - sparse: BM25 (threshold 없음)
    fusion:
      - RRF (Reciprocal Rank Fusion)
    """
    body: dict = {
        "prefetch": [
            {
                "query":           dense,                              # Qdrant 1.17: dense 벡터는 배열 직접 전달
                "using":           "dense",
                "limit":           limit * 3,
                "score_threshold": dense_prefetch_threshold,
            },
            {
                "query": {"indices": sparse["indices"], "values": sparse["values"]},
                "using": "sparse",
                "limit": limit * 3,
            },
        ],
        "query":        {"fusion": "rrf"},
        "limit":        limit,
        "with_payload": True,
    }
    if filter_must:
        body["filter"] = {"must": filter_must}

    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{collection}/points/query",
        json=body,
    )
    resp.raise_for_status()
    points = resp.json().get("result", {}).get("points", [])
    return [
        {"id": p["id"], "score": p["score"], "payload": p.get("payload", {})}
        for p in points
    ]


# ── log_incidents 검색 & 저장 ──────────────────────────────────────────────

async def search_similar_incidents(
    dense: list[float],
    sparse: dict,
    system_name: str,
    limit: int = 5,
) -> list[dict]:
    """
    현재 로그와 유사한 과거 이력 Hybrid 검색 (Dense + Sparse RRF).

    Returns:
        [{"id", "score": float (RRF), "payload": {...}}, ...]
    """
    return await _hybrid_search(
        collection=COLLECTION,
        dense=dense,
        sparse=sparse,
        filter_must=[{"key": "system_name", "match": {"value": system_name}}],
        limit=limit,
    )


async def store_incident_vector(
    dense: list[float],
    sparse: dict,
    system_name: str,
    instance_role: str,
    severity: str,
    log_pattern: str,
    error_category: str | None = None,
    root_cause: str | None = None,
    recommendation: str | None = None,
) -> str:
    """분석된 로그 패턴을 Qdrant에 Dense+Sparse로 저장. point_id 반환."""
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

    await ensure_collection(COLLECTION, hybrid=True)
    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{COLLECTION}/points",
        json={
            "points": [{
                "id": point_id,
                "vector": {
                    "dense": dense,
                    "sparse": {
                        "indices": sparse["indices"],
                        "values":  sparse["values"],
                    },
                },
                "payload": payload,
            }]
        },
    )
    resp.raise_for_status()
    return point_id


async def update_resolution(point_id: str, resolution: str, resolver: str) -> None:
    """log_incidents 포인트에 해결책 추가 (피드백 등록 시)."""
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


# ── 이상 분류 (RRF 점수 기반 재설계) ─────────────────────────────────────────

# RRF 점수는 cosine과 스케일이 다르므로 순위/개수 기반 판단으로 전환.
# 기존 cosine 기반 (0.95/0.85/0.75) → 'top 결과의 최상위 prefetch cosine 점수'
# 를 활용한 heuristic 조합으로 분류한다. prefetch 내부 cosine 점수는 Qdrant
# 응답에 직접 노출되지 않아, 현재 구현은 'top 결과 RRF 점수'와 '결과 개수'로만
# 보수적으로 분류한다. 운영 관찰 후 임계값을 튜닝한다.

def classify_anomaly(similar_results: list[dict]) -> dict:
    """
    Hybrid 검색 결과로 이상 유형 분류.

    분류 기준 (RRF 점수 기반, 운영 튜닝 필요):
      - duplicate  (top RRF ≥ 0.032): 2개 이상 검색기 모두 최상위 (1위+1위에 가까움)
      - recurring  (top RRF ≥ 0.025): 둘 중 하나는 최상위
      - related    (top RRF ≥ 0.015): 둘 중 하나는 유사
      - new        (결과 없음 또는 그 미만)
    """
    if not similar_results:
        return {"type": "new", "score": 0.0, "has_solution": False, "top_results": []}

    top   = similar_results[0]
    score = top["score"]

    if score >= 0.032:
        anomaly_type = "duplicate"
    elif score >= 0.025:
        anomaly_type = "recurring"
    elif score >= 0.015:
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


# ── LLM 프롬프트 컨텍스트 강화 ──────────────────────────────────────────────

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
    log_limit_map = {"5min": 2600, "hourly": 2700, "daily": 2800}
    log_limit = log_limit_map.get(trace_tier, 3000) if trace_context else 3000
    similar      = anomaly_info.get("top_results", [])
    anomaly_type = anomaly_info["type"]
    score        = anomaly_info.get("score", 0.0)

    if similar:
        history_lines = []
        for i, r in enumerate(similar[:3], 1):
            p = r["payload"]
            history_lines.append(
                f"[이력{i}] 관련도:{r['score']:.3f} "
                f"심각도:{p.get('severity', '?')} "
                f"패턴:{p.get('log_pattern', '')[:150]}"
            )
        history_ctx = "\n".join(history_lines)
    else:
        history_ctx = "없음"

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

    type_label = {
        "new":       "신규 이상 (유사 사례 없음)",
        "recurring": f"반복 이상 (RRF {score:.3f})",
        "related":   f"유사 이상 (RRF {score:.3f})",
        "duplicate": f"중복 이상 (RRF {score:.3f})",
    }.get(anomaly_type, "미분류")

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
- analysis_type: 로그가 여러 [log_type] 섹션으로 구분되어 있을 때만 작성. 단일 원인에서 연쇄된 경우 "cascade", 서로 독립된 이상인 경우 "independent". 단일 섹션이면 생략.

{{"severity": "critical 또는 warning 또는 info", "root_cause": "원인 요약\\n근거/세부 설명", "recommendation": "1) 즉시 조치: ...\\n2) 원인 분석: ...\\n3) 재발 방지: ...", "error_category": "오류 카테고리 (예: DB_CONNECTION, MEMORY, NETWORK 등)", "estimated_impact": "예상 영향 범위 (한국어, 1문장)", "analysis_type": "cascade 또는 independent (복수 log_type 섹션일 때만)"}}"""


# ── 메트릭 벡터 유사도 분석 (metric_baselines) ──────────────────────────────

# 메트릭 RRF 임계치 (로그와 동일 기준, 운영 튜닝 필요)
_METRIC_DUPLICATE  = 0.030
_METRIC_RECURRING  = 0.022
_METRIC_RELATED    = 0.014


def build_metric_description(
    system_name: str,
    instance_role: str,
    alertname: str,
    labels: dict,
    annotations: dict,
) -> str:
    """
    Alertmanager 라벨/어노테이션으로 메트릭 상태 자연어 기술문 생성.
    이 텍스트가 임베딩 및 sparse BM25의 입력이 된다.

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
    dense: list[float],
    sparse: dict,
    system_name: str,
    metric_name: str,
    limit: int = 5,
) -> list[dict]:
    """
    metric_baselines Hybrid 검색. system_name + metric_name 이중 필터.
    """
    return await _hybrid_search(
        collection=METRIC_COLLECTION,
        dense=dense,
        sparse=sparse,
        filter_must=[
            {"key": "system_name", "match": {"value": system_name}},
            {"key": "metric_name", "match": {"value": metric_name}},
        ],
        limit=limit,
    )


def classify_metric_anomaly(similar_results: list[dict]) -> dict:
    """메트릭 Hybrid 검색 결과로 이상 유형 분류 (RRF 임계치 기반)."""
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
    dense: list[float],
    sparse: dict,
    system_name: str,
    instance_role: str,
    metric_name: str,
    alertname: str,
    severity: str,
    metric_value: str | None = None,
) -> str:
    """메트릭 이상 이력을 metric_baselines에 Dense+Sparse로 저장. point_id 반환."""
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

    await ensure_collection(METRIC_COLLECTION, hybrid=True)
    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{METRIC_COLLECTION}/points",
        json={
            "points": [{
                "id": point_id,
                "vector": {
                    "dense": dense,
                    "sparse": {
                        "indices": sparse["indices"],
                        "values":  sparse["values"],
                    },
                },
                "payload": payload,
            }]
        },
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
    메트릭 알림 벡터 유사도 분석 통합 함수.
    log-analyzer POST /metric/similarity 엔드포인트에서 호출.

    1. 자연어 기술문 생성
    2. Dense + Sparse 임베딩
    3. Qdrant Hybrid 검색 (RRF)
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
        dense  = await get_embedding(description)
        sparse = await get_sparse_vector(description)
    except Exception as exc:
        logger.warning("메트릭 임베딩 생성 실패: %s → 벡터 검색 없이 진행", exc)
        return {
            "type": "new", "score": 0.0, "has_solution": False,
            "top_results": [], "point_id": None, "description": description,
        }

    try:
        similar      = await search_similar_metrics(dense, sparse, system_name, metric_name)
        anomaly_info = classify_metric_anomaly(similar)
    except Exception as exc:
        logger.warning("Qdrant 메트릭 검색 실패: %s → 신규 이상으로 처리", exc)
        anomaly_info = {"type": "new", "score": 0.0, "has_solution": False, "top_results": []}

    point_id = None
    if anomaly_info["type"] != "duplicate":
        try:
            point_id = await store_metric_vector(
                dense, sparse, system_name, instance_role,
                metric_name, alertname, severity, metric_value,
            )
        except Exception as exc:
            logger.warning("Qdrant 메트릭 저장 실패: %s", exc)

    return {
        **anomaly_info,
        "point_id":    point_id,
        "description": description,
    }


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
