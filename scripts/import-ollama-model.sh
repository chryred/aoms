#!/usr/bin/env bash
# 폐쇄망 서버에서 Ollama 모델 tar.gz 파일 import
#
# 사용법:
#   ./import-ollama-model.sh <ollama-container-name> <tar-gz-path>
#
# 예:
#   ./import-ollama-model.sh prod-ollama /tmp/paraphrase-multilingual.tar.gz
set -euo pipefail

CONTAINER="${1:-prod-ollama}"
TAR_PATH="${2:?tar.gz 경로를 지정하세요}"

[[ -f "$TAR_PATH" ]] || { echo "ERROR: $TAR_PATH 파일 없음"; exit 1; }

echo "[1/4] 컨테이너 $CONTAINER 존재 확인"
docker ps --filter "name=${CONTAINER}" --format '{{.Names}}' | grep -q "^${CONTAINER}$" || {
    echo "ERROR: 컨테이너 $CONTAINER 가 실행 중이지 않습니다."
    exit 1
}

TAR_NAME=$(basename "$TAR_PATH")
echo "[2/4] 컨테이너 내부로 tar 복사"
docker cp "$TAR_PATH" "${CONTAINER}:/tmp/${TAR_NAME}"

echo "[3/4] /root/.ollama/models/ 에 압축 해제 (기존 blob은 sha256 기반이라 덮어쓰기 안전)"
docker exec "$CONTAINER" bash -c "
    cd /root/.ollama/models
    tar -xzf /tmp/${TAR_NAME}
    rm -f /tmp/${TAR_NAME}
"

echo "[4/4] 모델 등록 확인"
docker exec "$CONTAINER" ollama list

echo ""
echo "✅ 완료"
echo "다음 단계: .env.local 의 EMBED_MODEL 값을 적절히 변경하고 서비스 재기동"
