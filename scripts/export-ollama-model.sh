#!/usr/bin/env bash
# Ollama 모델을 단일 tar.gz으로 내보내기 (폐쇄망 서버 전송용)
#
# 사용법:
#   ./export-ollama-model.sh <ollama-container-name> <model-name> <output-path>
#
# 예:
#   ./export-ollama-model.sh dev-ollama paraphrase-multilingual ~/paraphrase-multilingual.tar.gz
set -euo pipefail

CONTAINER="${1:-dev-ollama}"
MODEL="${2:-paraphrase-multilingual}"
OUTPUT="${3:-$HOME/${MODEL}.tar.gz}"

MODELS_DIR="/root/.ollama/models"
MANIFEST_REL="manifests/registry.ollama.ai/library/${MODEL}/latest"
MANIFEST_PATH="${MODELS_DIR}/${MANIFEST_REL}"

echo "[1/4] manifest 확인: ${CONTAINER}:${MANIFEST_PATH}"
docker exec "$CONTAINER" test -f "$MANIFEST_PATH" || {
    echo "ERROR: 모델 '$MODEL' 이 $CONTAINER 에 없습니다. 먼저 'ollama pull $MODEL' 을 실행하세요."
    exit 1
}

echo "[2/4] manifest에서 필요한 blob 목록 추출"
BLOBS=$(docker exec "$CONTAINER" cat "$MANIFEST_PATH" | python3 -c '
import sys, json
m = json.load(sys.stdin)
digests = [m["config"]["digest"]]
digests.extend(l["digest"] for l in m.get("layers", []))
# sha256: prefix 제거
for d in digests:
    print("blobs/" + d.replace(":", "-"))
')
echo "$BLOBS"

echo "[3/4] 컨테이너 내부에서 tar.gz 생성"
FILES_IN_TAR=$(echo "$BLOBS" | tr '\n' ' ')
docker exec "$CONTAINER" bash -c "
    cd ${MODELS_DIR}
    tar -czf /tmp/${MODEL}.tar.gz \
        '${MANIFEST_REL}' \
        ${FILES_IN_TAR}
    ls -lh /tmp/${MODEL}.tar.gz
"

echo "[4/4] 호스트로 복사: ${OUTPUT}"
docker cp "${CONTAINER}:/tmp/${MODEL}.tar.gz" "${OUTPUT}"
docker exec "$CONTAINER" rm -f "/tmp/${MODEL}.tar.gz"

echo ""
echo "✅ 완료: $(ls -lh "$OUTPUT" | awk '{print $5, $9}')"
echo ""
echo "다음 단계:"
echo "  scp $OUTPUT user@폐쇄망서버:/tmp/"
echo "  ssh user@폐쇄망서버 bash $(dirname $0)/import-ollama-model.sh <container> /tmp/$(basename $OUTPUT)"
