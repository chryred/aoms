"""bge-reranker-v2-m3 cross-encoder 재순위화 (FP32, ADR-011 후속).

Hybrid retrieval (Dense+Sparse RRF) 결과를 cross-encoder로 재정렬하여
한국어 정밀도를 극대화한다. 양자화 없는 FP32로 정확도 손실 0%.

특징:
  - 모델: BAAI/bge-reranker-v2-m3 (XLM-RoBERTa-large 기반, 568M params)
  - 다국어 cross-encoder, 한국어 포함 100+ 언어 지원
  - 입력: (query, document) 쌍 → 출력: relevance logit
  - 추론 환경: ONNX Runtime CPU + transformers fast tokenizer
  - 모델 크기 ~2.3GB (FP32, model.onnx_data external data 포함)

번들 위치 (Dockerfile):
  /app/reranker-models  ← snapshot_download 캐시 디렉터리
  - onnx-community/bge-reranker-v2-m3-ONNX 의 onnx/model.onnx + onnx/model.onnx_data
  - tokenizer.json, tokenizer_config.json, special_tokens_map.json, config.json

사용 패턴:
  results = await search_similar_aggregations(query_text="...", limit=20)
  reranked = await rerank(query_text, results, top_k=10, text_field="summary_text")
"""

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

# 환경변수 — vector_client.py 와 동일 컨벤션
RERANKER_MODEL       = os.getenv("RERANKER_MODEL", "BAAI/bge-reranker-v2-m3")
RERANKER_ONNX_FILE   = os.getenv("RERANKER_ONNX_FILE", "onnx/model.onnx")
RERANKER_MODEL_CACHE = os.getenv("RERANKER_MODEL_CACHE") or None
RERANKER_MAX_LENGTH  = int(os.getenv("RERANKER_MAX_LENGTH", "512"))

# 후보 텍스트 컷오프 (vector_client._EMBED_MAX_CHARS 와 동일 컨벤션)
_RERANK_MAX_CHARS = 3000

# ── 전역 lazy 로딩 싱글턴 ────────────────────────────────────────────────────
_reranker_session = None       # onnxruntime.InferenceSession
_reranker_tokenizer = None
_reranker_input_names = None
_reranker_output_name = None   # 보통 "logits"


def _resolve_reranker_model_dir() -> str:
    """HF snapshot 디렉터리 경로 반환. RERANKER_MODEL_CACHE 미지정 시 HF 기본 경로 사용.

    참고:
      - BAAI/bge-reranker-v2-m3 원본 repo는 ONNX 미배포(safetensors only)이므로
        Dockerfile은 onnx-community/bge-reranker-v2-m3-ONNX 에서 다운로드한다.
      - 본 함수는 환경변수 RERANKER_MODEL 값(기본 BAAI/bge-reranker-v2-m3)을 그대로 사용.
        Dockerfile에서 onnx-community 리포로 받은 경우 RERANKER_MODEL을
        onnx-community/bge-reranker-v2-m3-ONNX 로 override 할 수 있다.
    """
    from huggingface_hub import snapshot_download
    kwargs: dict = dict(
        repo_id=RERANKER_MODEL,
        allow_patterns=[
            "config.json",
            "tokenizer.json",
            "tokenizer_config.json",
            "special_tokens_map.json",
            f"{RERANKER_ONNX_FILE}",
            f"{RERANKER_ONNX_FILE}_data",
            "onnx/*.json",
        ],
    )
    if RERANKER_MODEL_CACHE:
        kwargs["cache_dir"] = RERANKER_MODEL_CACHE
    return snapshot_download(**kwargs)


def _get_reranker_session():
    """bge-reranker-v2-m3 ONNX InferenceSession + tokenizer를 lazy-load."""
    global _reranker_session, _reranker_tokenizer, _reranker_input_names, _reranker_output_name
    if _reranker_session is None:
        import onnxruntime as ort
        from transformers import AutoTokenizer

        logger.info("Reranker 모델 로딩: %s (onnxruntime 직접 호출)", RERANKER_MODEL)
        model_dir = _resolve_reranker_model_dir()
        onnx_path = os.path.join(model_dir, RERANKER_ONNX_FILE)

        sess_opt = ort.SessionOptions()
        _reranker_session = ort.InferenceSession(
            onnx_path,
            sess_options=sess_opt,
            providers=["CPUExecutionProvider"],
        )
        _reranker_input_names = {i.name for i in _reranker_session.get_inputs()}
        output_names = [o.name for o in _reranker_session.get_outputs()]
        # cross-encoder 출력은 일반적으로 "logits" — 첫 출력을 사용
        _reranker_output_name = output_names[0]

        _reranker_tokenizer = AutoTokenizer.from_pretrained(model_dir)
        logger.info(
            "bge-reranker-v2-m3 ONNX 로드 완료 (FP32, ~2.3GB) — outputs=%s",
            output_names,
        )
    return _reranker_session, _reranker_tokenizer, _reranker_input_names, _reranker_output_name


# ── 동기 추론 ────────────────────────────────────────────────────────────────

def _rerank_sync(
    query: str,
    docs: list[str],
    max_length: int = RERANKER_MAX_LENGTH,
) -> list[float]:
    """
    cross-encoder 동기 추론. (query, doc) 쌍을 배치로 토크나이즈하여 logit 반환.

    Returns:
        len(docs) 길이의 float 리스트. 값이 클수록 query와 관련성이 높다.
        (raw logit — 단조 변환 sigmoid 미적용. 정렬 목적이라면 그대로 사용 가능.)
    """
    if not docs:
        return []

    sess, tok, input_names, output_name = _get_reranker_session()

    # cross-encoder pair encoding: 첫 인자 = query 반복, 두번째 = docs
    truncated_docs = [d[:_RERANK_MAX_CHARS] for d in docs]
    queries = [query[:_RERANK_MAX_CHARS]] * len(truncated_docs)

    enc = tok(
        queries,
        truncated_docs,
        return_tensors="np",
        padding=True,
        truncation=True,
        max_length=max_length,
    )
    feed = {k: v for k, v in enc.items() if k in input_names}
    outputs = sess.run([output_name], feed)
    logits = outputs[0]
    # logits shape: (batch, 1) 또는 (batch,)
    if logits.ndim == 2 and logits.shape[1] == 1:
        scores = logits[:, 0]
    else:
        scores = logits.reshape(-1)
    return scores.astype(float).tolist()


# ── async API ───────────────────────────────────────────────────────────────

async def rerank(
    query: str,
    candidates: list[dict],
    top_k: int = 10,
    text_field: str = "text",
) -> list[dict]:
    """
    Hybrid 검색 결과 후보 리스트를 cross-encoder로 재정렬.

    Args:
        query: 사용자 질의 (자연어)
        candidates: 검색 결과 dict 리스트. 각 dict는 text_field를 포함해야 한다.
        top_k: 재정렬 후 반환할 상위 개수
        text_field: 후보 dict 안에서 reranking 대상 텍스트 필드 키 (기본 "text").
                    payload 내부 필드는 호출자가 미리 평탄화해 전달.

    Returns:
        rerank_score 내림차순 정렬된 상위 top_k 결과. 각 dict에 `rerank_score` 키 추가.
        후보가 비어 있거나 reranker 호출 실패 시 입력 그대로 (top_k 컷만 적용) 반환.
    """
    if not candidates:
        return []

    docs = [str(c.get(text_field) or "") for c in candidates]
    if not any(docs):
        # 비교할 텍스트 없음 — 원본 순서 유지
        return candidates[:top_k]

    try:
        loop = asyncio.get_event_loop()
        scores = await loop.run_in_executor(None, _rerank_sync, query, docs)
    except Exception as exc:
        logger.warning("Reranker 추론 실패: %s → 원본 순서 유지", exc)
        return candidates[:top_k]

    enriched = []
    for cand, score in zip(candidates, scores):
        merged = dict(cand)
        merged["rerank_score"] = float(score)
        enriched.append(merged)

    enriched.sort(key=lambda x: x["rerank_score"], reverse=True)
    return enriched[:top_k]
