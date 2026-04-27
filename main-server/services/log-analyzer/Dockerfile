FROM python:3.11-slim AS deps

WORKDIR /app

# Python 의존성 먼저 설치 (레이어 캐시 활용)
COPY requirements/ requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt

# 모델 캐시 경로 (볼륨 마운트 대상 — model-downloader 스테이지 및 런타임 공통)
ENV DENSE_MODEL_CACHE=/app/dense-models \
    SPARSE_MODEL_CACHE=/app/fastembed-models \
    RERANKER_MODEL_CACHE=/app/reranker-models \
    DENSE_ONNX_FILE=onnx/model.onnx \
    RERANKER_ONNX_FILE=onnx/model.onnx \
    RERANKER_MODEL=onnx-community/bge-reranker-v2-m3-ONNX

# ── model-downloader: ./build-images.sh export-models 전용 ─────────────────
# 배포 이미지에는 포함되지 않음. 모델 tar.gz 추출 후 서버 볼륨에 1회 배포.
#   - Dense    : BAAI/bge-m3 ONNX                                (~1.1GB, 1024dim)
#   - Sparse   : Qdrant/bm25 (fastembed BM25)                    (~50MB)
#   - Reranker : onnx-community/bge-reranker-v2-m3-ONNX FP32     (~2.3GB)
FROM deps AS model-downloader
RUN python -c "\
from fastembed import SparseTextEmbedding; \
from huggingface_hub import snapshot_download; \
snapshot_download('BAAI/bge-m3', cache_dir='/app/dense-models', allow_patterns=['config.json', 'tokenizer.json', 'tokenizer_config.json', 'sentencepiece.bpe.model', 'special_tokens_map.json', 'onnx/model.onnx', 'onnx/model.onnx_data', 'onnx/*.json']); \
SparseTextEmbedding('Qdrant/bm25', cache_dir='/app/fastembed-models'); \
snapshot_download('onnx-community/bge-reranker-v2-m3-ONNX', cache_dir='/app/reranker-models', allow_patterns=['onnx/model.onnx', 'onnx/model.onnx_data', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'config.json']); \
print('임베딩 + reranker 모델 다운로드 완료')\
"

# ── app: 배포 이미지 (모델은 /opt/synapse/models 볼륨 마운트로 주입) ───────
FROM deps AS app
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
