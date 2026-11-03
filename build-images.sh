#!/bin/bash
# ============================================================
# Synapse Docker 이미지 빌드 스크립트
# 사용법:
#   ./build-images.sh           # 빌드 (태그 자동 증가: IMAGE_VERSION 2.0 → 2.1)
#   ./build-images.sh clean     # 현재 IMAGE_VERSION 태그 이미지·tar.gz 삭제
#   ./build-images.sh rebuild   # 현재 버전 삭제 후 다음 버전으로 재빌드
#   TAG=2.5 ./build-images.sh   # 태그 직접 지정 (형식: 숫자.숫자, 그대로 사용)
#
# 버전 관리:
#   - IMAGE_VERSION (리포 루트, git 추적) = 현재 배포된 버전
#   - build 는 minor+1 (2.1 → 2.2) 을 다음 태그로 사용
#   - 빌드·저장이 모두 성공한 뒤에만 IMAGE_VERSION 과 main-server/docker-compose.yml
#     의 image 태그를 갱신한다 (실패 시 버전 유지)
#   - 빌드 후 IMAGE_VERSION 과 main-server/docker-compose.yml 을 함께 커밋할 것
# ============================================================

set -eo pipefail

PLATFORM="linux/amd64"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION_FILE="$SCRIPT_DIR/IMAGE_VERSION"
COMPOSE_FILE="$SCRIPT_DIR/main-server/docker-compose.yml"
SERVICES_DIR="$SCRIPT_DIR/main-server/services"
OUTPUT_DIR="$SCRIPT_DIR/main-server"

# admin-api는 멀티스테이지 빌드 — 컨텍스트가 프로젝트 루트
ADMIN_API_DOCKERFILE="$SERVICES_DIR/admin-api/Dockerfile"

# 외부 이미지 — 빌드 없이 pull 후 save (폐쇄망 반입용). docker-compose.yml 의 image 와 동일 태그.
CLICKHOUSE_IMAGE="clickhouse/clickhouse-server:24.8"
CLICKHOUSE_TARFILE="$OUTPUT_DIR/clickhouse-server-24.8.tar.gz"

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

# ── 버전 관리 ────────────────────────────────────────────────
VERSION_RE='^[0-9]+\.[0-9]+$'

# 태그 기준으로 빌드 대상 목록 구성 (name:tag:context)
set_images() {
  TAG="$1"
  IMAGES_STANDARD=(
    "synapse-log-analyzer:$TAG:$SERVICES_DIR/log-analyzer"
    "synapse-frontend:$TAG:$SERVICES_DIR/frontend"
    "synapse-agent-t-gateway:$TAG:$SCRIPT_DIR/agent-t-gateway"
  )
}

# IMAGE_VERSION (현재 배포 버전) 읽기
read_current_version() {
  [ -f "$VERSION_FILE" ] || error "버전 파일 없음: $VERSION_FILE"
  CURRENT_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
  [[ "$CURRENT_VERSION" =~ $VERSION_RE ]] \
    || error "IMAGE_VERSION 형식 오류: '$CURRENT_VERSION' (예: 2.0)"
}

# 다음 태그 결정: 환경변수 TAG 가 있으면 그대로, 없으면 minor+1 (2.1 → 2.2)
resolve_next_version() {
  if [ -n "${TAG:-}" ]; then
    [[ "$TAG" =~ $VERSION_RE ]] || error "TAG 형식 오류: '$TAG' (예: 3.0)"
    NEXT_VERSION="$TAG"
    info "TAG 환경변수 지정 사용: $NEXT_VERSION"
  else
    NEXT_VERSION="${CURRENT_VERSION%%.*}.$(( 10#${CURRENT_VERSION#*.} + 1 ))"
  fi
}

# 빌드·저장 성공 후 IMAGE_VERSION 및 docker-compose.yml 이미지 태그 갱신
# (sed -i 는 BSD/GNU 옵션이 달라 임시 파일 경유 — macOS/Linux 공통 동작)
commit_version() {
  local new="$1" tmp img
  echo "$new" > "$VERSION_FILE"
  success "IMAGE_VERSION 갱신: $new"

  [ -f "$COMPOSE_FILE" ] || { warn "compose 파일 없음 (태그 갱신 스킵): $COMPOSE_FILE"; return 0; }
  tmp="$(mktemp)"
  cp "$COMPOSE_FILE" "$tmp"
  for img in synapse-admin-api synapse-log-analyzer synapse-frontend synapse-agent-t-gateway; do
    sed -E "s|(image:[[:space:]]*${img}:)[0-9]+\.[0-9]+|\1${new}|" "$tmp" > "$tmp.new" && mv "$tmp.new" "$tmp"
    grep -qE "image:[[:space:]]*${img}:${new//./\.}([[:space:]]|$)" "$tmp" \
      || { rm -f "$tmp"; warn "compose 에서 ${img} image 태그 갱신 실패 — 수동 확인 필요: $COMPOSE_FILE"; return 0; }
  done
  cat "$tmp" > "$COMPOSE_FILE"   # 권한·inode 유지
  rm -f "$tmp"
  success "docker-compose.yml 이미지 태그 갱신: $new"
}

# ── 빌드 ────────────────────────────────────────────────────
do_build() {
  info "플랫폼: $PLATFORM"
  info "태그: $CURRENT_VERSION → $TAG"
  echo ""

  # ── 빌드 (순차) ─────────────────────────────────────────────
  # agent-v 바이너리 / Agent-T jar 는 이미지에 COPY 만 된다 — 현재 소스로 빌드된 산출물인지 확인
  # (스탬프는 make build-agent-v / build-agent-t 가 기록. scripts/agent-build-stamp.sh 참조)
  STALE=()
  for comp in agent-v agent-t; do
    if ! reason=$("$SCRIPT_DIR/scripts/agent-build-stamp.sh" check "$comp"); then
      warn "$reason"
      STALE+=("$comp")
    fi
  done
  if [ ${#STALE[@]} -gt 0 ]; then
    echo ""
    warn "소스와 빌드 산출물이 일치하지 않아 이미지 빌드를 중단합니다. 먼저 아래를 실행하세요:"
    for comp in "${STALE[@]}"; do echo "    make build-$comp"; done
    echo "  (둘 다 필요하면: make build-agents) — 재빌드한 dist/ 는 함께 커밋"
    exit 1
  fi
  success "agent-v / agent-t 산출물이 현재 소스와 일치"

  AGENT_T_ARTIFACTS="$SCRIPT_DIR/agent-t/dist"
  for f in agent-t.jar agent-t-legacy.jar agent-t-attacher.jar SHA256SUMS; do
    [ -f "$AGENT_T_ARTIFACTS/$f" ] || error "Agent-T 아티팩트 없음: $AGENT_T_ARTIFACTS/$f — 먼저 'agent-t/build.sh jar' 실행"
  done
  (cd "$AGENT_T_ARTIFACTS" && shasum -a 256 -c SHA256SUMS >/dev/null) \
    || error "Agent-T SHA256SUMS 불일치: $AGENT_T_ARTIFACTS"

  info "admin-api 멀티스테이지 빌드 시작 (agent-v + synapse CLI + Agent-T jar 포함)..."
  docker build \
    --platform "$PLATFORM" \
    -f "$ADMIN_API_DOCKERFILE" \
    -t "synapse-admin-api:$TAG" \
    "$SCRIPT_DIR" \
    || error "synapse-admin-api:$TAG 빌드 실패"
  success "빌드 완료: synapse-admin-api:$TAG"
  echo ""

  for entry in "${IMAGES_STANDARD[@]}"; do
    IFS=':' read -r name tag context <<< "$entry"
    info "빌드 시작: $name:$tag"
    docker build --platform "$PLATFORM" -t "$name:$tag" "$context" \
      || error "$name:$tag 빌드 실패"
    success "빌드 완료: $name:$tag"
    echo ""
  done

  info "ClickHouse 이미지 pull: $CLICKHOUSE_IMAGE"
  docker pull --platform "$PLATFORM" "$CLICKHOUSE_IMAGE" \
    || error "$CLICKHOUSE_IMAGE pull 실패"
  success "pull 완료: $CLICKHOUSE_IMAGE"
  echo ""

  # ── 저장 (병렬) ─────────────────────────────────────────────
  info "모든 이미지 병렬 저장 시작..."
  SAVE_PIDS=()

  (
    # 멀티아키 이미지는 --platform 없이 save 하면 빌드 머신(Mac arm64) 아키텍처가 저장된다
    docker save --platform "$PLATFORM" "$CLICKHOUSE_IMAGE" | pigz -p 2 > "$CLICKHOUSE_TARFILE"
    success "저장 완료: $CLICKHOUSE_IMAGE  ($(du -sh "$CLICKHOUSE_TARFILE" | cut -f1))"
  ) &
  SAVE_PIDS+=($!)

  (
    tarfile="$OUTPUT_DIR/synapse-admin-api-${TAG}.tar.gz"
    docker save --platform "$PLATFORM" "synapse-admin-api:$TAG" | pigz -p 2 > "$tarfile"
    success "저장 완료: synapse-admin-api:$TAG  ($(du -sh "$tarfile" | cut -f1))"
  ) &
  SAVE_PIDS+=($!)

  for entry in "${IMAGES_STANDARD[@]}"; do
    IFS=':' read -r name tag context <<< "$entry"
    (
      tarfile="$OUTPUT_DIR/${name}-${tag}.tar.gz"
      docker save --platform "$PLATFORM" "$name:$tag" | pigz -p 4 > "$tarfile"
      success "저장 완료: $name:$tag  ($(du -sh "$tarfile" | cut -f1))"
    ) &
    SAVE_PIDS+=($!)
  done

  # 개별 저장 실패 감지 (인자 없는 wait 는 항상 0 을 반환하므로 PID 별로 확인)
  SAVE_FAILED=0
  for pid in "${SAVE_PIDS[@]}"; do
    wait "$pid" || SAVE_FAILED=1
  done
  [ "$SAVE_FAILED" -eq 0 ] || error "이미지 저장 실패 — IMAGE_VERSION 은 갱신하지 않습니다 ($CURRENT_VERSION 유지)"

  commit_version "$TAG"
  echo ""
  echo -e "${GREEN}============================================${NC}"
  echo -e "${GREEN}  빌드 완료${NC}"
  echo -e "${GREEN}============================================${NC}"
  echo ""
  echo "생성된 파일:"
  echo "  - $OUTPUT_DIR/synapse-admin-api-${TAG}.tar.gz"
  for entry in "${IMAGES_STANDARD[@]}"; do
    IFS=':' read -r name tag context <<< "$entry"
    echo "  - $OUTPUT_DIR/${name}-${tag}.tar.gz"
  done
  echo ""
  echo "  - $CLICKHOUSE_TARFILE"
  echo ""
  echo "다음 단계: IMAGE_VERSION 과 main-server/docker-compose.yml 을 함께 커밋"
  echo "  (서버의 docker-compose.yml image 태그도 $TAG 로 맞춰야 함)"
  echo ""
  echo "Linux 서버 배포 명령어:"
  echo "  docker load < synapse-admin-api-${TAG}.tar.gz"
  echo "  docker load < synapse-log-analyzer-${TAG}.tar.gz"
  echo "  docker load < synapse-frontend-${TAG}.tar.gz"
  echo "  docker load < synapse-agent-t-gateway-${TAG}.tar.gz"
  echo "  docker load < clickhouse-server-24.8.tar.gz"
}

# ── 모델 export ─────────────────────────────────────────────
do_export_models() {
  info "model-downloader 스테이지 빌드 중 (최초 1회, 시간이 걸립니다)..."
  docker build \
    --platform "$PLATFORM" \
    --target model-downloader \
    -t synapse-models-export:tmp \
    "$SERVICES_DIR/log-analyzer" \
    || error "model-downloader 빌드 실패"
  success "model-downloader 빌드 완료"

  MODEL_TAR="$OUTPUT_DIR/synapse-models.tar.gz"
  info "모델 추출 중: $MODEL_TAR"

  if command -v pigz &>/dev/null; then
    COMPRESS="pigz -p 4"
  else
    warn "pigz 없음 — gzip 사용 (느릴 수 있음)"
    COMPRESS="gzip"
  fi

  docker run --rm synapse-models-export:tmp \
    tar -cf - -C /app dense-models fastembed-models reranker-models \
    | $COMPRESS > "$MODEL_TAR" \
    || { rm -f "$MODEL_TAR"; error "모델 추출 실패"; }

  docker rmi synapse-models-export:tmp
  success "모델 추출 완료: $MODEL_TAR  ($(du -sh "$MODEL_TAR" | cut -f1))"

  echo ""
  echo "서버 배포 명령어 (최초 1회):"
  echo "  mkdir -p /app/synapse/models"
  echo "  pigz -d -c synapse-models.tar.gz | tar -xf - -C /app/synapse/models"
  echo "  # pigz 없으면: tar -xzf synapse-models.tar.gz -C /app/synapse/models"
}

# ── 삭제 ────────────────────────────────────────────────────
do_clean() {
  set_images "$1"
  warn "이미지 삭제를 시작합니다. (태그: $TAG)"
  echo ""

  # admin-api 정리
  image="synapse-admin-api:$TAG"
  if docker image inspect "$image" > /dev/null 2>&1; then
    docker rmi "$image"
    success "삭제 완료: $image"
  else
    warn "이미지 없음 (스킵): $image"
  fi
  tarfile="$OUTPUT_DIR/synapse-admin-api-${TAG}.tar.gz"
  if [ -f "$tarfile" ]; then
    rm -f "$tarfile"
    success "파일 삭제: $tarfile"
  fi

  for entry in "${IMAGES_STANDARD[@]}"; do
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

  if [ -f "$CLICKHOUSE_TARFILE" ]; then
    rm -f "$CLICKHOUSE_TARFILE"
    success "파일 삭제: $CLICKHOUSE_TARFILE"
  fi

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
read_current_version

case "${1:-build}" in
  build)
    resolve_next_version
    set_images "$NEXT_VERSION"
    do_build
    ;;
  export-models)
    do_export_models
    ;;
  clean)
    do_clean "$CURRENT_VERSION"
    ;;
  rebuild)
    resolve_next_version
    do_clean "$CURRENT_VERSION"
    set_images "$NEXT_VERSION"
    echo ""
    do_build
    ;;
  *)
    echo "사용법: $0 [build|export-models|clean|rebuild]"
    echo ""
    echo "  build          이미지 빌드 및 tar.gz 저장, 태그 자동 증가 (기본값)"
    echo "  export-models  모델만 별도 tar.gz 추출 (서버 최초 1회 배포용)"
    echo "  clean          현재 IMAGE_VERSION 태그의 이미지 및 tar.gz 파일 삭제"
    echo "  rebuild        현재 버전 삭제 후 다음 버전으로 재빌드"
    echo "  (TAG=x.y 환경변수로 태그 직접 지정)"
    exit 1
    ;;
esac
