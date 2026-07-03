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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from uuid import UUID, uuid4, uuid5

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
    로그에서 변수 요소(타임스탬프, IP, UUID, URL, 라인번호, 할당값, 큰 숫자)를
    제거하여 패턴만 남김. 같은 논리 에러가 URL 쿼리스트링·소스 라인번호·가변 ID
    차이로 여러 template으로 갈리는 것을 방지한다(고카디널리티 완화).

    예: "2026-03-15T10:00:00 ORA-00060 from 10.0.1.5"
        → "<TS> ORA-00060 from <IP>"
        "[Foo.bar:248] referer = https://x/y?id=633"
        → "[Foo.bar:<N>] referer = <URL>"

    주의(과병합 금지): 공백으로 분리된 단독 에러코드/상태코드(예: "code 404")는
    묶지 않는다. 치환은 URL 토큰·`:NNN]` 라인번호·`=NNN` 할당값 등 가변 요소로 한정.
    """
    text = re.sub(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.\d]*', '<TS>', raw_log)
    # URL 토큰 통째 치환 (쿼리스트링·경로·스킴 차이 흡수) — =NNN 치환보다 먼저
    text = re.sub(r'https?://\S+', '<URL>', text)
    text = re.sub(r'\b\d{1,3}(?:\.\d{1,3}){3}\b', '<IP>', text)
    text = re.sub(
        r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
        '<UUID>', text, flags=re.IGNORECASE,
    )
    # 소스 라인번호 [Class.method:248] → [Class.method:<N>]
    text = re.sub(r':\d+\]', ':<N>]', text)
    # 할당/쿼리 값 (가변 ID·카운트) key=123 → key=<N>
    text = re.sub(r'=\d+', '=<N>', text)
    text = re.sub(r'\b\d{5,}\b', '<NUM>', text)
    return text.strip()


def compute_fingerprint(text: str) -> str:
    """완전 동일 패턴 중복 방지용 SHA-256 해시 (앞 16자리)"""
    return hashlib.sha256(text.encode()).hexdigest()[:16]


# template 단위 결정적 point_id 구분자 (system/role/template 경계 — 일반 텍스트에 안 나오는 제어문자)
_PID_SEP = "\x1f"
# template 단위 결정적 point_id 네임스페이스 (uuid5 — 고정 상수, 변경 시 기존 id 전부 바뀜)
_TEMPLATE_PID_NS = UUID("a1b2c3d4-e5f6-4a5b-8c7d-000000000001")


def template_point_id(system_name: str, instance_role: str, normalized_template: str) -> str:
    """template 단위 Qdrant point의 결정적 id (UUID 문자열).

    같은 (system, role, 정규화 template)은 항상 같은 id → upsert 멱등.
    uuid4 무한 증식·#1 순위 분산을 제거한다. UUID 문자열로 통일해 store/retrieve/delete/DB
    전 구간 타입 일관성 유지(Qdrant는 정수 또는 UUID id 허용 — 정수 문자열은 불가).
    """
    key = f"{system_name}{_PID_SEP}{instance_role}{_PID_SEP}{normalized_template}"
    return str(uuid5(_TEMPLATE_PID_NS, key))


async def retrieve_point(point_id) -> dict | None:
    """log_incidents 에서 단일 포인트 조회 (payload 포함). 미존재 시 None.

    template 단위 인식 tier-1(exact): 임베딩·검색 없이 결정적 id 직접 조회.
    """
    try:
        resp = await _qdrant_http.post(
            f"{QDRANT_URL}/collections/{COLLECTION}/points",
            json={"ids": [point_id], "with_payload": True, "with_vector": False},
        )
        resp.raise_for_status()
    except Exception as e:
        logger.warning("Qdrant 포인트 조회 실패 (None 처리): %s", e)
        return None
    pts = resp.json().get("result", [])
    return pts[0] if pts else None


async def retrieve_points_batch(point_ids: list[str]) -> dict[str, dict | None]:
    """여러 point_id를 단일 Qdrant 호출로 조회 (tier-1 배치 인식).

    반환: {point_id: point_dict | None}. 미존재 id는 None. 조회 실패 시 전부 None.
    전체 distinct template의 인식 여부를 N회 왕복 없이 1회로 판별하기 위함(Phase B).
    """
    result: dict[str, dict | None] = {pid: None for pid in point_ids}
    if not point_ids:
        return result
    try:
        resp = await _qdrant_http.post(
            f"{QDRANT_URL}/collections/{COLLECTION}/points",
            json={"ids": point_ids, "with_payload": True, "with_vector": False},
        )
        resp.raise_for_status()
    except Exception as e:
        logger.warning("Qdrant 배치 포인트 조회 실패 (전체 None 처리): %s", e)
        return result
    for pt in resp.json().get("result", []):
        pid = pt.get("id")
        if pid in result:
            result[pid] = pt
    return result


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


# 임베딩 전용 경계 executor — 기본(공유·무제한 큐) executor 대신 워커 수를 고정한다.
# 분석 사이클이 타임아웃으로 취소돼도 임베딩 스레드 수가 폭증하지 않도록 상한을 둬
# (cpus=1.0 컨테이너에서 ONNX는 사실상 직렬) 스트랜딩·메모리 누증을 억제.
_EMBED_WORKERS = int(os.getenv("EMBED_EXECUTOR_WORKERS", "2"))
_embed_executor = ThreadPoolExecutor(max_workers=_EMBED_WORKERS, thread_name_prefix="embed")


async def get_embedding(text: str) -> list[float]:
    """Dense 임베딩 (bge-m3, 1024차원). ONNX 동기 호출을 경계 executor로 래핑."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_embed_executor, _embed_dense_sync, text)


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
        chunk_results = await loop.run_in_executor(_embed_executor, _embed_dense_batch_sync, chunk)
        results.extend(chunk_results)
    return results


async def get_sparse_vector(text: str) -> dict:
    """Sparse 임베딩 (BM25). {"indices": [...], "values": [...]} 반환."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_embed_executor, _embed_sparse_sync, text)


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
    score_threshold: float | None = None,
    with_scores: bool = False,
) -> list[dict]:
    """
    Qdrant Query API + RRF fusion 공통 헬퍼.

    prefetch:
      - dense:  cosine >= dense_prefetch_threshold (느슨한 사전 필터)
      - sparse: BM25 (threshold 없음)
    fusion:
      - RRF (Reciprocal Rank Fusion)

    score_threshold: RRF fusion 최종 점수 하한. 미만 포인트는 Qdrant가 반환하지 않음.
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
    if score_threshold is not None:
        body["score_threshold"] = score_threshold

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


async def search_notification_incidents(
    dense: list[float],
    sparse: dict,
    system_name: str,
    score_threshold: float = 0.9,
) -> list[dict]:
    """is_notification=True 포인트 중 score_threshold 이상인 건만 검색 (알림성 인식용).

    dense 단독 cosine 검색 사용 — RRF rank 경쟁으로 동일 에러 변형이 rank 37+ 로 밀려
    0.026 점수를 받는 문제 해결. cosine 0.9+ = 같은 에러 패턴 변형.
    `sparse` 파라미터는 하위 호환 시그니처 유지용 (내부에서 미사용).
    limit=1: 1건이라도 알림성 패턴이 있으면 skip 판정으로 충분.
    """
    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{COLLECTION}/points/query",
        json={
            "query":           dense,
            "using":           "dense",
            "filter":          {"must": [
                {"key": "system_name",   "match": {"value": system_name}},
                {"key": "is_notification", "match": {"value": True}},
            ]},
            "limit":           1,
            "score_threshold": score_threshold,
            "with_payload":    True,
        },
    )
    resp.raise_for_status()
    return [
        {"id": p["id"], "score": p["score"], "payload": p.get("payload", {})}
        for p in resp.json().get("result", {}).get("points", [])
    ]



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
    point_key: str | None = None,
    occurrence_count: int = 1,
) -> str:
    """분석된 로그 패턴을 Qdrant에 Dense+Sparse로 저장. point_id 반환.

    point_key 지정 시 template 단위 결정적 id로 upsert(멱등) — 같은 패턴은 제자리 갱신.
    미지정 시 uuid4 (하위 호환).
    """
    if point_key is not None:
        point_id = template_point_id(system_name, instance_role, point_key)
    else:
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
        "occurrence_count": occurrence_count,
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


async def bump_occurrence(point_id, occurrence_count: int) -> None:
    """recognized 포인트의 occurrence_count + last_seen 갱신 (벡터 재전송 없이 payload만)."""
    try:
        resp = await _qdrant_http.post(
            f"{QDRANT_URL}/collections/{COLLECTION}/points/payload",
            json={
                "payload": {
                    "occurrence_count": occurrence_count,
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                },
                "points": [point_id],
            },
        )
        resp.raise_for_status()
    except Exception as e:
        logger.warning("occurrence 갱신 실패 (무시): %s", e)


_SIMILAR_PAGE_SIZE = 500  # 페이지당 조회 건수. 정확히 500이면 다음 페이지 존재 가능 → 반복.


async def find_similar_incidents(
    point_id,
    system_name: str,
    is_notification: bool,
    score_threshold: float = 0.9,
) -> list[dict]:
    """주어진 포인트와 유사한 포인트 검색 (일괄 relabel 전체 수집).

    is_notification=False → 실에러 검색 (warning→info 방향, goal #3)
    is_notification=True  → 알림성 검색 (info→warning/critical 역방향)
    자기 자신은 제외.

    dense 단독 cosine 검색 — RRF rank 경쟁 문제 해결(동일 에러 변형이 많을 때 rank 37+ → 0.026).
    cosine 0.9+ = 같은 에러 패턴.

    페이지네이션: 한 페이지가 정확히 PAGE_SIZE건이면 다음 페이지 존재 가능 → offset 증가 후 반복.
    500건 미만이면 마지막 페이지로 종료. 모든 point_id를 모아 반환 (bulk update 호출부에서 1회 처리).
    """
    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{COLLECTION}/points",
        json={"ids": [point_id], "with_payload": False, "with_vector": True},
    )
    resp.raise_for_status()
    pts = resp.json().get("result", [])
    if not pts:
        return []
    dense = (pts[0].get("vector") or {}).get("dense")
    if not dense:
        return []

    filter_must = [
        {"key": "system_name",    "match": {"value": system_name}},
        {"key": "is_notification", "match": {"value": is_notification}},
    ]

    all_hits: list[dict] = []
    offset = 0
    while True:
        r = await _qdrant_http.post(
            f"{QDRANT_URL}/collections/{COLLECTION}/points/query",
            json={
                "query":           dense,
                "using":           "dense",
                "filter":          {"must": filter_must},
                "limit":           _SIMILAR_PAGE_SIZE,
                "offset":          offset,
                "score_threshold": score_threshold,
                "with_payload":    True,
            },
        )
        r.raise_for_status()
        page = [
            {"id": p["id"], "score": p["score"], "payload": p.get("payload", {})}
            for p in r.json().get("result", {}).get("points", [])
        ]
        all_hits.extend(page)

        if len(page) < _SIMILAR_PAGE_SIZE:
            break  # 마지막 페이지 — 다음 건 없음
        offset += _SIMILAR_PAGE_SIZE
        logger.debug("find_similar_incidents: page offset=%d, 누적=%d건", offset, len(all_hits))

    return [h for h in all_hits if str(h["id"]) != str(point_id)]


async def bulk_relabel_notification(point_ids: list, severity: str = "info") -> list:
    """여러 포인트를 is_notification=True/severity 로 일괄 전환 (goal #3 적용). 갱신 성공 id 반환."""
    updated: list = []
    for pid in point_ids:
        try:
            await update_notification_severity(pid, severity)
            updated.append(pid)
        except Exception as e:
            logger.warning("bulk relabel 실패 (계속) %s: %s", pid, e)
    return updated


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


async def update_notification_severity(point_id: str, new_severity: str) -> None:
    """log_incidents 포인트의 severity + is_notification 변경 (일괄 심각도 변경 시)."""
    is_notification = new_severity == "info"
    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{COLLECTION}/points/payload",
        json={
            "payload": {
                "severity": new_severity,
                "is_notification": is_notification,
            },
            "points": [point_id],
        },
    )
    resp.raise_for_status()


async def update_log_incident_ids(point_ids: list[str], incident_id: int) -> None:
    """log_incidents 포인트들에 incident_id payload 추가 (피드백 승인 역방향 업데이트)."""
    if not point_ids:
        return
    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{COLLECTION}/points/payload",
        json={"payload": {"incident_id": incident_id}, "points": point_ids},
    )
    resp.raise_for_status()


async def update_metric_incident_ids(point_ids: list[str], incident_id: int) -> None:
    """metric_baselines 포인트들에 incident_id payload 추가 (피드백 승인 역방향 업데이트)."""
    if not point_ids:
        return
    resp = await _qdrant_http.post(
        f"{QDRANT_URL}/collections/{METRIC_COLLECTION}/points/payload",
        json={"payload": {"incident_id": incident_id}, "points": point_ids},
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
    Hybrid 검색 결과로 이상 유형 분류 (Qdrant k=2 RRF 스케일 기준).

    Qdrant DEFAULT_RRF_K=2, score = Σ 1/(rank+2), rank 0-based, 최대 1.0.
    두 prefetch(dense+sparse) 기준 주요 점수:
      dense·sparse 둘 다 1위 = 1.0   /  1위+2위 = 0.833  /  둘 다 2위 = 0.667
      dense 1위 단독            = 0.5   /  둘 다 5위 = 0.333 /  둘 다 10위 = 0.208

    분류 기준 (k=2 보정):
      - duplicate  (top RRF ≥ 0.8): dense·sparse 양쪽 최상위권 — 사실상 동일 패턴
      - recurring  (top RRF ≥ 0.5): 최소 한 쪽 1위 — 명확히 본 적 있음
      - related    (top RRF ≥ 0.3): 한 쪽에서 중간 순위 — 유사 패턴 존재
      - new        (그 미만 또는 결과 없음)
    """
    if not similar_results:
        return {"type": "new", "score": 0.0, "has_solution": False, "top_results": []}

    top   = similar_results[0]
    score = top["score"]

    if score >= 0.8:
        anomaly_type = "duplicate"
    elif score >= 0.5:
        anomaly_type = "recurring"
    elif score >= 0.3:
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

# 메트릭 RRF 임계치 — 로그 classify_anomaly와 동일 k=2 스케일
_METRIC_DUPLICATE  = 0.8
_METRIC_RECURRING  = 0.5
_METRIC_RELATED    = 0.3


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
