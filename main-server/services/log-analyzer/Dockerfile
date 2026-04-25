FROM python:3.11-slim

WORKDIR /app

# Python 의존성 먼저 설치 (레이어 캐시 활용)
COPY requirements/ requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt

# ADR-011: 임베딩 모델을 이미지에 번들 (폐쇄망 수기 배포 불필요)
# 빌드 시점에 HuggingFace / GCS 에서 1회 다운로드 → 이미지 레이어에 캐시됨.
# 런타임은 HF_HUB_OFFLINE=1 로 로컬 캐시만 사용.
#   - Dense    : BAAI/bge-m3 ONNX                                (~1.1GB, 1024dim, 한국어 고품질)
#   - Sparse   : Qdrant/bm25 (fastembed)                          (~50MB,  BM25 IDF)
#   - Reranker : BAAI/bge-reranker-v2-m3 ONNX FP32                (~2.3GB, 한국어 cross-lingual cross-encoder, ADR-011 후속)
#                onnx-community/bge-reranker-v2-m3-ONNX 에서 model.onnx + model.onnx_data (external) 다운로드
ENV DENSE_MODEL_CACHE=/app/dense-models \
    SPARSE_MODEL_CACHE=/app/fastembed-models \
    RERANKER_MODEL_CACHE=/app/reranker-models \
    DENSE_ONNX_FILE=onnx/model.onnx \
    RERANKER_ONNX_FILE=onnx/model.onnx \
    RERANKER_MODEL=onnx-community/bge-reranker-v2-m3-ONNX
RUN python -c "\
from fastembed import SparseTextEmbedding; \
from huggingface_hub import snapshot_download; \
snapshot_download('BAAI/bge-m3', cache_dir='/app/dense-models', allow_patterns=['config.json', 'tokenizer.json', 'tokenizer_config.json', 'sentencepiece.bpe.model', 'special_tokens_map.json', 'onnx/model.onnx', 'onnx/model.onnx_data', 'onnx/*.json']); \
SparseTextEmbedding('Qdrant/bm25', cache_dir='/app/fastembed-models'); \
snapshot_download('onnx-community/bge-reranker-v2-m3-ONNX', cache_dir='/app/reranker-models', allow_patterns=['onnx/model.onnx', 'onnx/model.onnx_data', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'config.json']); \
print('임베딩 + reranker 모델 번들 완료')\
"

# 애플리케이션 코드
COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
