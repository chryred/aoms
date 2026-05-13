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

from prompts import build_enhanced_prompt  # noqa: F401 — re-export for analyzer.py

logger = logging.getLogger(__name__)

QDRANT_URL        = os.getenv("QDRANT_URL", "http://server-b:6333")
# Dense: onnxruntime + tokenizers.Tokenizer 로 BAAI/bge-m3 ONNX 직접 로드
DENSE_MODEL_NAME  = os.getenv("DENSE_EMBED_MODEL", "BAAI/bge-m3")
DENSE_ONNX_FILE   = os.getenv("DENSE_ONNX_FILE",   "onnx/model.onnx")
# 캐시 경로: 미지정 시 huggingface_hub/fastembed 기본 경로(~/.cache/huggingface, ~/.cache/fastembed) 사용.
# Docker: Dockerfile에서 /app/dense-models, /app/fastembed-models 로 override.
DENSE_MODEL_CACHE  = os.getenv("DENSE_MODEL_CACHE")   or None
# Sparse: fastembed BM25
SPARSE_MODEL_NAME  = os.getenv("SPARSE_EMBED_MODEL", "Qdrant/bm25")
SPARSE_MODEL_CACHE = os.getenv("SPARSE_MODEL_CACHE") or None

COLLECTION            = "log_incidents"
METRIC_COLLECTION     = "metric_baselines"
POSTMORTEM_COLLECTION = "incident_postmortems"

# Qdrant HTTP 클라이언트 (벡터 저장/검색 — 빠름)
_qdrant_http = httpx.AsyncClient(timeout=15.0)

ANOMALY_STYLES = {
    "new":       {"color": "FF0000", "label": "신규 이상",  "alert": True},
    "recurring": {"color": "FF8C00", "label": "반복 이상",  "alert": True},
    "related":   {"color": "FFA500", "label": "유사 이상",  "alert": True},
    "duplicate": {"color": "808080", "label": "중복 이상",  "alert": False},
}


# ── 임베딩 모델 싱글턴 (lazy-load, HF_HUB_OFFLINE=1 환경 호환) ─────────────────
#   Dense : onnxruntime InferenceSession + tokenizers.Tokenizer (bge-m3)
#           transformers 대신 tokenizers(Rust) 직접 사용 — PyTorch 불필요
#           모델 ONNX가 출력 `sentence_embedding`을 내장 (CLS pooling + normalize).
#   Sparse: fastembed SparseTextEmbedding (Qdrant/bm25)

_dense_session = None   # onnxruntime.InferenceSession
_dense_tokenizer = None
_dense_input_names = None
_sparse_model = None


def _resolve_dense_model_dir() -> str:
    """HF snapshot 디렉터리 경로 반환. DENSE_MODEL_CACHE 미지정 시 HF 기본 경로 사용.

    캐시 디렉터리에 ONNX 파일이 이미 존재하면 local_files_only=True로 네트워크 확인 생략.
    HF_HUB_OFFLINE=1 환경(폐쇄망)에서는 HF 라이브러리가 자동으로 오프라인 동작.
    """
    from huggingface_hub import snapshot_download
    allow = [
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "sentencepiece.bpe.model",
        "special_tokens_map.json",
        f"{DENSE_ONNX_FILE}",
        f"{DENSE_ONNX_FILE}_data",
        "onnx/*.json",
    ]
    kwargs: dict = dict(repo_id=DENSE_MODEL_NAME, allow_patterns=allow)
    if DENSE_MODEL_CACHE:
        kwargs["cache_dir"] = DENSE_MODEL_CACHE

    # 캐시에 ONNX 파일이 있으면 네트워크 체크 없이 로컬 경로 반환
    if DENSE_MODEL_CACHE and os.path.isfile(os.path.join(DENSE_MODEL_CACHE, DENSE_ONNX_FILE)):
        kwargs["local_files_only"] = True

    return snapshot_download(**kwargs)


def _get_dense_session():
    """bge-m3 ONNX InferenceSession + tokenizer를 lazy-load."""
    global _dense_session, _dense_tokenizer, _dense_input_names
    if _dense_session is None:
        import onnxruntime as ort
        from tokenizers import Tokenizer  # PyTorch 불필요 — Rust 기반 tokenizers 직접 사용

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

        raw_tok = Tokenizer.from_file(os.path.join(model_dir, "tokenizer.json"))
        raw_tok.enable_padding()
        raw_tok.enable_truncation(max_length=8192)
        _dense_tokenizer = raw_tok
        logger.info("Dense 모델 준비 완료 (outputs=%s)",
                    [o.name for o in _dense_session.get_outputs()])
    return _dense_session, _dense_tokenizer, _dense_input_names


def _get_sparse_model():
    """BM25 Sparse 모델을 FastEmbed 로 로드."""
    global _sparse_model
    if _sparse_model is None:
        from fastembed import SparseTextEmbedding
        # tqdm이 스레드 executor에서 호출될 때 _lock 미초기화 문제 방지
        try:
            import tqdm as _tqdm
            _tqdm.tqdm.get_lock()
        except Exception:
            pass
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
    encoding = tok.encode(truncated)
    feed: dict = {}
    if "input_ids" in input_names:
        feed["input_ids"] = np.array([encoding.ids], dtype=np.int64)
    if "attention_mask" in input_names:
        feed["attention_mask"] = np.array([encoding.attention_mask], dtype=np.int64)
    if "token_type_ids" in input_names:
        feed["token_type_ids"] = np.array([encoding.type_ids], dtype=np.int64)
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
    # fastembed가 내부적으로 tqdm을 사용하는데, run_in_executor 스레드에서
    # tqdm._lock 미초기화 경고가 발생할 수 있어 호출 전 보장
    try:
        import tqdm as _tqdm
        _tqdm.tqdm.get_lock()
    except Exception:
        pass
    result = next(model.embed([truncated]))
    return {
        "indices": result.indices.tolist(),
        "values":  result.values.tolist(),
    }


def _embed_dense_batch_sync(texts: list[str]) -> list[list[float] | None]:
    """bge-m3 ONNX 배치 추론. encode_batch로 패딩 후 1회 session.run.

    실패 시 texts 길이만큼 None 배열 반환 (호출부 no-op 폴백).
    """
    import numpy as np
    try:
        truncated = [t[:_EMBED_MAX_CHARS] for t in texts]
        sess, tok, input_names = _get_dense_session()
        encodings = tok.encode_batch(truncated)
        feed: dict = {}
        if "input_ids" in input_names:
            feed["input_ids"] = np.array([e.ids for e in encodings], dtype=np.int64)
        if "attention_mask" in input_names:
            feed["attention_mask"] = np.array([e.attention_mask for e in encodings], dtype=np.int64)
        if "token_type_ids" in input_names:
            feed["token_type_ids"] = np.array([e.type_ids for e in encodings], dtype=np.int64)
        outputs = sess.run(None, feed)
        output_names = [o.name for o in sess.get_outputs()]
        if "sentence_embedding" in output_names:
            vecs = outputs[output_names.index("sentence_embedding")]  # (batch, 1024)
        else:
            last = outputs[0]  # (batch, seq_len, 1024)
            cls = last[:, 0, :]
            norms = np.linalg.norm(cls, axis=1, keepdims=True)
            vecs = cls / norms
        return [v.tolist() for v in vecs]
    except Exception as exc:
        logger.warning("배치 ONNX 추론 실패 (batch_size=%d): %s", len(texts), exc)
        return [None] * len(texts)


async def get_embedding(text: str) -> list[float]:
    """Dense 임베딩 (bge-m3, 1024차원). ONNX 동기 호출을 executor로 래핑."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _embed_dense_sync, text)


_BATCH_CHUNK_SIZE = 16  # 청크당 ONNX 추론 한 번. executor 블로킹을 짧게 유지.


async def get_embedding_batch(texts: list[str]) -> list[list[float]]:
    """Dense 배치 임베딩. _BATCH_CHUNK_SIZE 단위로 쪼개 executor를 짧게 점유.

    청크 사이에 이벤트 루프가 돌아 search-verify 등 다른 ONNX 호출이 끼어들 수 있다.
    """
    if not texts:
        return []
    loop = asyncio.get_event_loop()
    results: list[list[float]] = []
    for i in range(0, len(texts), _BATCH_CHUNK_SIZE):
        chunk = texts[i : i + _BATCH_CHUNK_SIZE]
        chunk_results = await loop.run_in_executor(None, _embed_dense_batch_sync, chunk)
        results.extend(chunk_results)
    return results


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
    with_scores: bool = False,
) -> list[dict]:
    """
    Qdrant Query API + RRF fusion 공통 헬퍼.

    prefetch:
      - dense:  cosine >= dense_prefetch_threshold (느슨한 사전 필터)
      - sparse: BM25 (threshold 없음)
    fusion:
      - RRF (Reciprocal Rank Fusion)

    with_scores=True 시 dense/sparse 개별 점수를 추가 Qdrant 쿼리로 수집해
    각 결과 dict에 dense_score, sparse_score, dense_rank, sparse_rank 필드를 병합.
    (Track C 점수 분해 디버그용 — 자동 분석 파이프라인에서는 항상 False)
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
    results = [
        {"id": p["id"], "score": p["score"], "payload": p.get("payload", {})}
        for p in points
    ]

    if not with_scores or not results:
        return results

    # ── 점수 분해: dense/sparse 개별 쿼리 (Track C) ──────────────────────────
    score_fetch_limit = limit * 3

    dense_body: dict = {
        "query":        dense,
        "using":        "dense",
        "limit":        score_fetch_limit,
        "score_threshold": 0,   # 필터 없이 raw ranking 획득
        "with_payload": False,
    }
    sparse_body: dict = {
        "query":        {"indices": sparse["indices"], "values": sparse["values"]},
        "using":        "sparse",
        "limit":        score_fetch_limit,
        "with_payload": False,
    }
    if filter_must:
        dense_body["filter"] = {"must": filter_must}
        sparse_body["filter"] = {"must": filter_must}

    dense_resp, sparse_resp = await asyncio.gather(
        _qdrant_http.post(
            f"{QDRANT_URL}/collections/{collection}/points/query",
            json=dense_body,
        ),
        _qdrant_http.post(
            f"{QDRANT_URL}/collections/{collection}/points/query",
            json=sparse_body,
        ),
        return_exceptions=True,
    )

    dense_score_map: dict = {}   # point_id → float
    dense_rank_map: dict = {}    # point_id → int (0-based)
    sparse_score_map: dict = {}
    sparse_rank_map: dict = {}

    if not isinstance(dense_resp, Exception):
        try:
            dense_resp.raise_for_status()
            for rank, p in enumerate(dense_resp.json().get("result", {}).get("points", [])):
                pid = p["id"]
                dense_score_map[pid] = p["score"]
                dense_rank_map[pid] = rank
        except Exception as exc:
            logger.debug("점수 분해 dense 쿼리 실패 (무시): %s", exc)

    if not isinstance(sparse_resp, Exception):
        try:
            sparse_resp.raise_for_status()
            for rank, p in enumerate(sparse_resp.json().get("result", {}).get("points", [])):
                pid = p["id"]
                sparse_score_map[pid] = p["score"]
                sparse_rank_map[pid] = rank
        except Exception as exc:
            logger.debug("점수 분해 sparse 쿼리 실패 (무시): %s", exc)

    for hit in results:
        pid = hit["id"]
        hit["dense_score"] = dense_score_map.get(pid)    # None if not in top-N
        hit["dense_rank"] = dense_rank_map.get(pid)
        hit["sparse_score"] = sparse_score_map.get(pid)
        hit["sparse_rank"] = sparse_rank_map.get(pid)

    return results


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
    is_notification: bool = False,
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
        "is_notification":  is_notification,
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


# ── incident_postmortems 컬렉션 (Wave 1B) ────────────────────────────────────

async def ensure_postmortem_collection() -> bool:
    """incident_postmortems 컬렉션 Hybrid(Dense+Sparse) 자동 보증."""
    return await ensure_collection(POSTMORTEM_COLLECTION, hybrid=True)


async def embed_postmortem(
    incident_id: int,
    payload: dict,
    qdrant_point_id: str | None = None,
) -> str:
    """
    인시던트 사후분석(postmortem) 서사를 Hybrid 임베딩하여 incident_postmortems에 upsert.

    payload 필드 (Wave 1A admin-api가 전달):
      title, system_name, system_id, severity, alert_excerpts,
      root_cause, solution, ocr_text (선택), tags (선택)

    Returns:
        Qdrant point_id (신규 생성 또는 기존 qdrant_point_id)
    """
    # 서사 텍스트 구성 (임베딩 품질을 위해 의미 있는 필드만 결합)
    parts = [
        payload.get("title", ""),
        payload.get("system_name", ""),
        f"심각도:{payload.get('severity', '')}" if payload.get("severity") else "",
        payload.get("alert_excerpts", ""),
        payload.get("root_cause", ""),
        payload.get("solution", ""),
        payload.get("ocr_text", ""),
    ]
    narrative = " | ".join(p for p in parts if p)

    dense  = await get_embedding(narrative)
    sparse = await get_sparse_vector(narrative)

    point_id = qdrant_point_id or str(uuid4())

    store_payload = {
        "incident_id":    incident_id,
        "title":          payload.get("title", ""),
        "system_name":    payload.get("system_name", ""),
        "system_id":      payload.get("system_id"),
        "severity":       payload.get("severity", ""),
        "alert_excerpts": (payload.get("alert_excerpts") or "")[:500],
        "root_cause":     payload.get("root_cause", ""),
        "solution":       payload.get("solution", ""),
        "ocr_text":       (payload.get("ocr_text") or "")[:1000],
        "tags":           payload.get("tags", []),
        "timestamp":      datetime.now(timezone.utc).isoformat(),
    }

    await ensure_postmortem_collection()
    resp = await _qdrant_http.put(
        f"{QDRANT_URL}/collections/{POSTMORTEM_COLLECTION}/points",
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
                "payload": store_payload,
            }]
        },
    )
    resp.raise_for_status()
    logger.info("postmortem 임베딩 저장: incident_id=%s point_id=%s", incident_id, point_id)
    return point_id


async def search_postmortem(
    query: str,
    system_ids: list[int] | None = None,
    system_id: int | None = None,  # deprecated, kept for BC
    severity: str | None = None,
    limit: int = 5,
) -> list[dict]:
    """
    incident_postmortems Hybrid 검색 (Dense + Sparse RRF).

    system_ids (IN list) / system_id (단일, BC fallback) / severity 필터는 선택적.
    Returns:
        [{"id", "score": float, "payload": {...}}, ...]
    """
    dense  = await get_embedding(query)
    sparse = await get_sparse_vector(query)

    filter_must: list[dict] = []
    if system_ids:
        filter_must.append({"key": "system_id", "match": {"any": system_ids}})
    elif system_id is not None:
        filter_must.append({"key": "system_id", "match": {"value": system_id}})
    if severity:
        filter_must.append({"key": "severity", "match": {"value": severity}})

    return await _hybrid_search(
        collection=POSTMORTEM_COLLECTION,
        dense=dense,
        sparse=sparse,
        filter_must=filter_must or None,
        limit=limit,
    )


async def list_postmortems(
    system_ids: list[int] | None = None,
    system_id: int | None = None,  # deprecated, kept for BC
    severity: str | None = None,
    limit: int = 20,
) -> list[dict]:
    """
    incident_postmortems 전체 스크롤 조회 (쿼리 없이 필터만 사용).
    빈 검색어로 전체 보기 시 사용. score는 1.0 고정.
    """
    filter_must: list[dict] = []
    if system_ids:
        filter_must.append({"key": "system_id", "match": {"any": system_ids}})
    elif system_id is not None:
        filter_must.append({"key": "system_id", "match": {"value": system_id}})
    if severity:
        filter_must.append({"key": "severity", "match": {"value": severity}})

    body: dict = {
        "limit": limit,
        "with_payload": True,
        "with_vector": False,
    }
    if filter_must:
        body["filter"] = {"must": filter_must}

    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{POSTMORTEM_COLLECTION}/points/scroll",
        json=body,
    )
    if resp.status_code == 404:
        return []
    resp.raise_for_status()
    points = resp.json().get("result", {}).get("points", [])
    return [{"id": p["id"], "score": 0.0, "payload": p.get("payload", {})} for p in points]


async def get_postmortem_by_incident(incident_id: int) -> dict | None:
    """
    incident_id로 postmortem 포인트를 직접 조회 (Qdrant /points/scroll).

    Returns:
        payload dict (id 포함) 또는 None (미존재)
    """
    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{POSTMORTEM_COLLECTION}/points/scroll",
        json={
            "filter": {
                "must": [{"key": "incident_id", "match": {"value": incident_id}}]
            },
            "limit":        1,
            "with_payload": True,
            "with_vector":  False,
        },
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    points = resp.json().get("result", {}).get("points", [])
    if not points:
        return None
    p = points[0]
    return {"id": p["id"], **p.get("payload", {})}


async def delete_postmortem_point(point_id: str) -> bool:
    """
    incident_postmortems 컬렉션에서 단일 포인트를 삭제.

    idempotent: 포인트가 없어도 True 반환 (이미 삭제됨).
    Returns:
        True if deleted (or not found), False on unexpected error.
    """
    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{POSTMORTEM_COLLECTION}/points/delete",
        json={"points": [point_id]},
    )
    if resp.status_code in (200, 404):
        logger.info("postmortem 포인트 삭제: point_id=%s", point_id)
        return True
    resp.raise_for_status()
    return True
