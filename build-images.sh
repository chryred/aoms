#!/bin/bash
# ============================================================
# Synapse Docker 이미지 빌드 스크립트
# 사용법:
#   ./build-images.sh           # 빌드
#   ./build-images.sh clean     # 이미지 삭제
#   ./build-images.sh rebuild   # 삭제 후 재빌드
# ============================================================

set -e

PLATFORM="linux/amd64"
TAG="1.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICES_DIR="$SCRIPT_DIR/main-server/services"
OUTPUT_DIR="$SCRIPT_DIR/main-server"

# admin-api는 멀티스테이지 빌드 — 컨텍스트가 프로젝트 루트
ADMIN_API_DOCKERFILE="$SERVICES_DIR/admin-api/Dockerfile"

IMAGES_STANDARD=(
  "synapse-log-analyzer:$TAG:$SERVICES_DIR/log-analyzer"
  "synapse-frontend:$TAG:$SERVICES_DIR/frontend"
)

# ── 색상 출력 ────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC}   $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERR]${NC}  $1"; exit 1; }

# ── 빌드 ────────────────────────────────────────────────────
do_build() {
  info "플랫폼: $PLATFORM / 태그: $TAG"
  echo ""

  # ── admin-api: 멀티스테이지 빌드 (agent-v + synapse CLI 자동 빌드) ─────────
  # 빌드 컨텍스트 = 프로젝트 루트 (agent/, synapse-cli/ 접근 필요)
  info "admin-api 멀티스테이지 빌드 시작 (agent-v + synapse CLI 포함)..."
  docker build \
    --platform "$PLATFORM" \
    -f "$ADMIN_API_DOCKERFILE" \
    -t "synapse-admin-api:$TAG" \
    "$SCRIPT_DIR" \
    || error "synapse-admin-api:$TAG 빌드 실패"
  success "빌드 완료: synapse-admin-api:$TAG"

  tarfile="$OUTPUT_DIR/synapse-admin-api-${TAG}.tar.gz"
  info "저장 중:  $tarfile"
  docker save "synapse-admin-api:$TAG" | gzip > "$tarfile"
  success "저장 완료: $tarfile  ($(du -sh "$tarfile" | cut -f1))"
  echo ""

  # ── 나머지 이미지: 기존 방식 ─────────────────────────────────────────────
  for entry in "${IMAGES_STANDARD[@]}"; do
    IFS=':' read -r name tag context <<< "$entry"
    image="$name:$tag"

    info "빌드 시작: $image"
    docker build --platform "$PLATFORM" -t "$image" "$context" \
      || error "$image 빌드 실패"
    success "빌드 완료: $image"

    tarfile="$OUTPUT_DIR/${name}-${tag}.tar.gz"
    info "저장 중:  $tarfile"
    docker save "$image" | gzip > "$tarfile"
    success "저장 완료: $tarfile  ($(du -sh "$tarfile" | cut -f1))"
    echo ""
  done

  echo -e "${GREEN}============================================${NC}"
  echo -e "${GREEN}  빌드 완료${NC}"
  echo -e "${GREEN}============================================${NC}"
  echo ""
  echo "생성된 파일:"
  for entry in "${IMAGES[@]}"; do
    IFS=':' read -r name tag context <<< "$entry"
    echo "  - $OUTPUT_DIR/${name}-${tag}.tar.gz"
  done
  echo ""
  echo "Linux 서버 배포 명령어:"
  echo "  docker load < synapse-admin-api-${TAG}.tar.gz"
  echo "  docker load < synapse-log-analyzer-${TAG}.tar.gz"
  echo "  docker load < synapse-frontend-${TAG}.tar.gz"
}

# ── 삭제 ────────────────────────────────────────────────────
do_clean() {
  warn "이미지 삭제를 시작합니다."
  echo ""

  for entry in "${IMAGES[@]}"; do
    IFS=':' read -r name tag context <<< "$entry"
    image="$name:$tag"

    if docker image inspect "$image" > /dev/null 2>&1; then
      docker rmi "$image"
      success "삭제 완료: $image"
    else
      warn "이미지 없음 (스킵): $image"
    fi

    tarfile="$OUTPUT_DIR/${name}-${tag}.tar.gz"
    if [ -f "$tarfile" ]; then
      rm -f "$tarfile"
      success "파일 삭제: $tarfile"
    fi
  done

  # 바이너리 임시 복사본 정리 (빌드 실패 시 잔류할 수 있음)
  BIN_DIR="$SERVICES_DIR/admin-api/bin"
  if [ -d "$BIN_DIR" ]; then
    rm -rf "$BIN_DIR"
    success "임시 바이너리 디렉터리 삭제: $BIN_DIR"
  fi

  # dangling 이미지 정리
  DANGLING=$(docker images -f "dangling=true" -q)
  if [ -n "$DANGLING" ]; then
    info "dangling 이미지 정리 중..."
    docker rmi $DANGLING 2>/dev/null || true
    success "dangling 이미지 정리 완료"
  fi

  echo ""
  success "삭제 완료"
}

# ── 메인 ────────────────────────────────────────────────────
case "${1:-build}" in
  build)
    do_build
    ;;
  clean)
    do_clean
    ;;
  rebuild)
    do_clean
    echo ""
    do_build
    ;;
  *)
    echo "사용법: $0 [build|clean|rebuild]"
    echo ""
    echo "  build    이미지 빌드 및 tar.gz 저장 (기본값)"
    echo "  clean    이미지 및 tar.gz 파일 삭제"
    echo "  rebuild  삭제 후 재빌드"
    exit 1
    ;;
esac
