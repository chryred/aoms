#!/usr/bin/env bash
# agent-v / agent-t 빌드 산출물이 현재 소스로 만들어졌는지 기록·검증한다.
#   write <agent-v|agent-t>   빌드 직후 dist/SOURCE_STAMP 기록 (make build-agent-v / build-agent-t 가 호출)
#   check <agent-v|agent-t>   현재 소스·산출물 해시와 스탬프 비교 (build-images.sh 가 호출). 불일치 시 exit 1
# 스탬프 = 빌드 입력 소스 해시 + 산출물 해시. 소스를 고치고 재빌드하지 않았거나,
# make 를 거치지 않고 산출물만 바뀐 경우 모두 불일치로 판정한다.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

sha() { shasum -a 256 | cut -d' ' -f1; }

case "${2:-}" in
  agent-v)
    # agent/build.sh 의 빌더 Dockerfile 이 COPY 하는 입력과 동일
    SOURCES=(agent/Cargo.toml agent/Cargo.lock agent/build.rs agent/proto agent/src)
    ARTIFACT=agent/dist/agent-v
    ;;
  agent-t)
    # agent-t/build.sh jar 가 컴파일하는 입력 (테스트 소스 제외)
    SOURCES=(agent-t/third_party/versions.properties agent-t/attacher/src/main
             agent-t/boot/src/main agent-t/bridge/src/main agent-t/core/src/main agent-t/instrument/src/main)
    ARTIFACT=agent-t/dist/SHA256SUMS
    ;;
  *) echo "usage: $0 {write|check} {agent-v|agent-t}" >&2; exit 2 ;;
esac
STAMP="$(dirname "$ARTIFACT")/SOURCE_STAMP"

source_hash() {
  find "${SOURCES[@]}" -type f ! -name .DS_Store -print0 | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256 | sha
}

case "$1" in
  write)
    [ -f "$ARTIFACT" ] || { echo "산출물 없음: $ARTIFACT" >&2; exit 1; }
    printf 'source=%s\nartifact=%s\n' "$(source_hash)" "$(sha < "$ARTIFACT")" > "$STAMP"
    echo "스탬프 기록: $STAMP"
    ;;
  check)
    [ -f "$ARTIFACT" ] || { echo "$2: 산출물 없음 ($ARTIFACT)"; exit 1; }
    [ -f "$STAMP" ] || { echo "$2: 빌드 스탬프 없음 ($STAMP)"; exit 1; }
    [ "$(grep '^source=' "$STAMP" | cut -d= -f2)" = "$(source_hash)" ] \
      || { echo "$2: 마지막 빌드 이후 소스가 변경됨"; exit 1; }
    [ "$(grep '^artifact=' "$STAMP" | cut -d= -f2)" = "$(sha < "$ARTIFACT")" ] \
      || { echo "$2: 산출물이 스탬프 기록과 다름 (make 를 거치지 않은 빌드)"; exit 1; }
    ;;
  *) echo "usage: $0 {write|check} {agent-v|agent-t}" >&2; exit 2 ;;
esac
