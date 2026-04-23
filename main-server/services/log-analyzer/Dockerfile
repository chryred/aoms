FROM python:3.11-slim

WORKDIR /app

# Python 의존성 먼저 설치 (레이어 캐시 활용)
COPY requirements/ requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt

# ADR-011: 임베딩 모델을 이미지에 번들 (폐쇄망 수기 배포 불필요)
# 빌드 시점에 HuggingFace / GCS 에서 1회 다운로드 → 이미지 레이어에 캐시됨.
# 런타임은 HF_HUB_OFFLINE=1 로 로컬 캐시만 사용.
#   - Dense : BAAI/bge-m3 ONNX              (~1.1GB, 1024dim, 한국어 고품질)
#   - Sparse: Qdrant/bm25 (fastembed)       (~50MB, BM25 IDF)
ENV DENSE_MODEL_CACHE=/app/dense-models \
    SPARSE_MODEL_CACHE=/app/fastembed-models \
    DENSE_ONNX_FILE=onnx/model.onnx
RUN python -c "\
from sentence_transformers import SentenceTransformer; \
from fastembed import SparseTextEmbedding; \
SentenceTransformer('BAAI/bge-m3', backend='onnx', cache_folder='/app/dense-models', model_kwargs={'file_name':'onnx/model.onnx'}); \
SparseTextEmbedding('Qdrant/bm25', cache_dir='/app/fastembed-models'); \
print('임베딩 모델 번들 완료')\
"

# 애플리케이션 코드
COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
