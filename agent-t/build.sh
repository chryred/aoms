#!/usr/bin/env bash
# Agent-T build. Plain javac, no Gradle/Maven. Compilation always runs in Docker for reproducibility.
#   fetch              download + SHA256-verify ASM/JUnit/hamcrest, relocate ASM to com.synapsev.agentt.shaded.asm
#   test-legacy        JDK 7 (zulu, amd64), -source/-target 1.6, ASM 5.2
#   test-modern        JDK 21 (temurin), --release 8, ASM 9.7
#   jar                dist/{agent-t-legacy.jar, agent-t.jar, agent-t-attacher.jar} + SHA256SUMS
#   it-attach          Docker integration test of the attacher (needs `jar` first): zulu 7, temurin 17, JRE-only 8
#   install-artifacts  copy dist -> main-server/artifacts/agent-t/
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
TP="$HERE/third_party"
DIST="$HERE/build/dist"
LEGACY_IMAGE="azul/zulu-openjdk:7"
MODERN_IMAGE="eclipse-temurin:21-jdk"

prop() { grep -E "^$1=" "$TP/versions.properties" | head -1 | cut -d= -f2-; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

download() { # name
  local name="$1" path sha dest actual
  path="$(prop "$name.path")"; sha="$(prop "$name.sha256")"
  dest="$TP/dl/$(basename "$path")"
  mkdir -p "$TP/dl"
  if [ ! -f "$dest" ]; then
    echo "download $path" >&2
    curl -fsSL -o "$dest" "$(prop maven.base)/$path"
  fi
  actual="$(sha256_of "$dest")"
  if [ "$actual" != "$sha" ]; then
    rm -f "$dest"
    echo "SHA256 mismatch for $name: expected $sha, got $actual" >&2
    exit 1
  fi
  echo "ok  $name  $sha" >&2
  echo "$dest"
}

# relocate_tree <src-root> <dst-root> : copy .java files, org.objectweb.asm -> com.synapsev.agentt.shaded.asm
relocate_tree() {
  local src="$1" dst="$2" f rel
  while IFS= read -r f; do
    rel="${f#$src/}"
    rel="com/synapsev/agentt/shaded/asm/${rel#org/objectweb/asm/}"
    mkdir -p "$dst/$(dirname "$rel")"
    sed -e 's/org\.objectweb\.asm/com.synapsev.agentt.shaded.asm/g' \
        -e 's#org/objectweb/asm#com/synapsev/agentt/shaded/asm#g' "$f" > "$dst/$rel"
  done < <(find "$src" -name '*.java' ! -name 'module-info.java')
}

do_fetch() {
  local work out jar sub
  rm -rf "$TP/src"; mkdir -p "$TP/src" "$TP/lib"
  work="$(mktemp -d)"; trap 'rm -rf "$work"' RETURN

  # ASM 5.2: one aggregate sources jar; keep only asm, commons, signature, tree, tree/analysis
  jar="$(download asm52)"; out="$work/asm52"; mkdir -p "$out"
  unzip -q -o "$jar" -d "$out"
  rm -rf "$out/org/objectweb/asm/optimizer" "$out/org/objectweb/asm/util" "$out/org/objectweb/asm/xml"
  relocate_tree "$out" "$TP/src/asm52"

  # ASM 9.7: four separate sources jars
  out="$work/asm97"; mkdir -p "$out"
  for sub in asm97core asm97commons asm97tree asm97analysis; do
    jar="$(download $sub)"; unzip -q -o "$jar" -d "$out"
  done
  relocate_tree "$out" "$TP/src/asm97"

  cp "$(download junit)" "$TP/lib/junit.jar"
  cp "$(download hamcrest)" "$TP/lib/hamcrest-core.jar"
  echo "fetch done"
}

require_fetched() {
  [ -d "$TP/src/asm52" ] && [ -d "$TP/src/asm97" ] && [ -f "$TP/lib/junit.jar" ] || {
    echo "third_party not fetched: run agent-t/build.sh fetch" >&2; exit 1; }
}

# run_container <legacy|modern> <test|jar>
run_container() {
  local profile="$1" action="$2" image plat=() user=()
  if [ "$profile" = legacy ]; then image="$LEGACY_IMAGE"; plat=(--platform linux/amd64); else image="$MODERN_IMAGE"; fi
  [ "$(uname -s)" = Linux ] && user=(--user "$(id -u):$(id -g)")
  mkdir -p "$HERE/build"
  docker run --rm -i ${plat[@]+"${plat[@]}"} ${user[@]+"${user[@]}"} -e PROFILE="$profile" -e ACTION="$action" \
    -v "$REPO":/w -w /w/agent-t "$image" bash -s <<'CONTAINER'
set -euo pipefail
B="build/$PROFILE"
rm -rf "$B"; mkdir -p "$B/classes" "$B/test-classes"
if [ "$PROFILE" = legacy ]; then
  ASM=third_party/src/asm52
  ASM_LEVEL=ASM5
  JAVAC=(javac -nowarn -source 1.6 -target 1.6 -encoding UTF-8 -Xlint:-options)
  # Stub classes are class-file v51 (what JDK 7 apps load) so the strict split verifier checks our frames.
  STUBJAVAC=(javac -nowarn -source 1.7 -target 1.7 -encoding UTF-8 -Xlint:-options)
  VERIFY=(-Xverify:all -XX:-FailOverToOldVerifier)
else
  ASM=third_party/src/asm97
  ASM_LEVEL=ASM9
  JAVAC=(javac -nowarn --release 8 -encoding UTF-8 -Xlint:-options)
  STUBJAVAC=("${JAVAC[@]}")
  VERIFY=(-Xverify:all)
fi
# ASM API level differs per build (ASM 5.2 vs 9.7), so the instrument sources read it from a generated constant.
mkdir -p "$B/gen/com/synapsev/agentt/instrument"
cat > "$B/gen/com/synapsev/agentt/instrument/AsmApi.java" <<JAVA
package com.synapsev.agentt.instrument;

import com.synapsev.agentt.shaded.asm.Opcodes;

final class AsmApi {
    static final int LEVEL = Opcodes.$ASM_LEVEL;

    private AsmApi() { }
}
JAVA
find "$ASM" core/src/main/java bridge/src/main/java instrument/src/main/java boot/src/main/java "$B/gen" -name '*.java' > "$B/main.txt"
"${JAVAC[@]}" -d "$B/classes" @"$B/main.txt"
CP="third_party/lib/junit.jar:third_party/lib/hamcrest-core.jar"
if [ "$ACTION" = test ]; then
  find instrument/src/test/java/javax instrument/src/test/java/testapp -name '*.java' > "$B/stubs.txt"
  "${STUBJAVAC[@]}" -d "$B/test-classes" @"$B/stubs.txt"
  find core/src/test/java bridge/src/test/java instrument/src/test/java boot/src/test/java -name '*.java' \
    -not -path 'instrument/src/test/java/javax/*' -not -path 'instrument/src/test/java/testapp/*' > "$B/test.txt"
  "${JAVAC[@]}" -cp "$B/classes:$B/test-classes:$CP" -d "$B/test-classes" @"$B/test.txt"
  CLASSES=$(for d in core bridge instrument boot; do (cd $d/src/test/java && find . -name '*Test.java'); done | sed -e 's#^\./##' -e 's#\.java$##' -e 's#/#.#g' | sort | tr '\n' ' ')
  java "${VERIFY[@]}" -Dagentt.repo.root=/w -cp "$B/classes:$B/test-classes:$CP" org.junit.runner.JUnitCore $CLASSES
else
  mkdir -p build/dist
  # The bridge classes must live on the bootstrap class path, so they ship as a nested jar resource, not top-level.
  A="$B/agent-classes"
  mkdir -p "$A/bridge"
  cp -R "$B/classes/." "$A/"
  rm -rf "$A/com/synapsev/agentt/bridge"
  jar cf "$A/bridge/agent-t-bridge.jar" -C "$B/classes" com/synapsev/agentt/bridge
  printf 'Premain-Class: com.synapsev.agentt.boot.AgentMain\nAgent-Class: com.synapsev.agentt.boot.AgentMain\nCan-Retransform-Classes: true\nCan-Redefine-Classes: true\nImplementation-Title: agent-t\nImplementation-Version: 0.1.0\n' > "$B/manifest.mf"
  if [ "$PROFILE" = legacy ]; then
    jar cfm build/dist/agent-t-legacy.jar "$B/manifest.mf" -C "$A" .
    # attacher: built once with the legacy javac (-target 1.6), reflection only, runs on JDK 6-21.
    mkdir -p "$B/att-classes" "$B/it-classes"
    "${JAVAC[@]}" -d "$B/att-classes" attacher/src/main/java/com/synapsev/agentt/attacher/Attacher.java
    printf 'Main-Class: com.synapsev.agentt.attacher.Attacher\nImplementation-Title: agent-t-attacher\n' > "$B/att-manifest.mf"
    jar cfm build/dist/agent-t-attacher.jar "$B/att-manifest.mf" -C "$B/att-classes" .
    # integration-test classes (run by build.sh it-attach)
    "${JAVAC[@]}" -d "$B/it-classes" attacher/src/test/java/com/synapsev/agentt/attacher/*.java
  else
    jar cfm build/dist/agent-t.jar "$B/manifest.mf" -C "$A" .
  fi
fi
CONTAINER
}

do_jar() {
  require_fetched
  mkdir -p "$DIST"; rm -f "$DIST"/*.jar "$DIST/SHA256SUMS"
  run_container legacy jar
  run_container modern jar
  ( cd "$DIST" && for f in agent-t-legacy.jar agent-t.jar agent-t-attacher.jar; do echo "$(sha256_of "$f")  $f"; done > SHA256SUMS )
  cat "$DIST/SHA256SUMS"
}

do_install() {
  [ -f "$DIST/SHA256SUMS" ] || { echo "run build.sh jar first" >&2; exit 1; }
  local dest="$REPO/main-server/artifacts/agent-t"
  mkdir -p "$dest"
  cp "$DIST"/*.jar "$DIST/SHA256SUMS" "$dest/"
  echo "installed -> $dest"
}

do_it_attach() {
  for f in agent-t-legacy.jar agent-t.jar agent-t-attacher.jar; do
    [ -f "$DIST/$f" ] && [ -d "$HERE/build/legacy/it-classes" ] || { echo "run build.sh jar first" >&2; exit 1; }
  done
  local fail=0 user=()
  [ "$(uname -s)" = Linux ] && user=(--user "$(id -u):$(id -g)")
  # it <image> <platform|-> <mode> <agent jar or ->
  it() {
    local image="$1" plat="$2" mode="$3" agent="$4" p=()
    [ "$plat" != - ] && p=(--platform "$plat")
    echo "== it-attach: $image ($mode)"
    docker run --rm ${p[@]+"${p[@]}"} ${user[@]+"${user[@]}"} -v "$REPO":/w:ro -w /tmp "$image" \
      java -cp /w/agent-t/build/legacy/it-classes com.synapsev.agentt.attacher.AttacherIT "$mode" \
      /w/agent-t/build/dist/agent-t-attacher.jar ${agent:+/w/agent-t/build/dist/$agent} || fail=1
  }
  it "$LEGACY_IMAGE" linux/amd64 attach agent-t-legacy.jar
  it eclipse-temurin:17-jdk - attach agent-t.jar
  it eclipse-temurin:8-jre - nojdk ""
  [ "$fail" = 0 ] && echo "it-attach PASS" || { echo "it-attach FAIL" >&2; exit 1; }
}

case "${1:-}" in
  fetch) do_fetch ;;
  test-legacy) require_fetched; run_container legacy test ;;
  test-modern) require_fetched; run_container modern test ;;
  jar) do_jar ;;
  it-attach) do_it_attach ;;
  install-artifacts) do_install ;;
  *) echo "usage: $0 {fetch|test-legacy|test-modern|jar|it-attach|install-artifacts}" >&2; exit 2 ;;
esac
