#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_ROOT="$ROOT_DIR/plugin"
PLATFORMS_ROOT="$PLUGIN_ROOT/platforms"
BUILD_DIR="$PLUGIN_ROOT/build"
ASSETS_DIR="$ROOT_DIR/assets"
JSON_UTIL_SRC="$PLUGIN_ROOT/src/com/mcservermanager/bridge/JsonUtil.java"
MOD_COMMON_SRC="$PLATFORMS_ROOT/mod-common/src/com/mcservermanager/bridge/mod/ReflectiveMinecraftServerBridge.java"

# Locate javac and jar
JAVAC_BIN=""
JAR_BIN=""
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ]; then
  JAVAC_BIN="$JAVA_HOME/bin/javac"
  JAR_BIN="$JAVA_HOME/bin/jar"
elif command -v javac >/dev/null 2>&1; then
  JAVAC_BIN="$(command -v javac)"
  JAR_BIN="$(command -v jar)"
else
  FOUND_JAVAC="$(find "$ROOT_DIR/jdk" /usr/lib/jvm -maxdepth 4 -name javac -type f 2>/dev/null | head -n 1 || true)"
  if [ -n "$FOUND_JAVAC" ]; then
    JAVAC_BIN="$FOUND_JAVAC"
    JAR_BIN="$(dirname "$FOUND_JAVAC")/jar"
  fi
fi

if [ -z "$JAVAC_BIN" ] || [ ! -x "$JAVAC_BIN" ] || [ -z "$JAR_BIN" ] || [ ! -x "$JAR_BIN" ]; then
  echo "Error: No JDK (javac + jar) found to compile MCServerManagerBridge JARs." >&2
  exit 1
fi

build_bridge_jar() {
  local label="$1"
  local out_jar_name="$2"
  local release="$3"
  local stubs_dir="$4"
  local src_dir="$5"
  local resources_dir="$6"
  shift 6
  local extra_srcs=("$@")

  local work="$BUILD_DIR/$label"
  local stubs_out="$work/stubs"
  local classes_out="$work/classes"
  local stage_dir="$work/stage"
  mkdir -p "$stubs_out" "$classes_out" "$stage_dir/META-INF"

  mapfile -t stub_files < <(find "$stubs_dir" -type f -name '*.java' | sort)
  mapfile -t src_files < <(find "$src_dir" -type f -name '*.java' | sort)
  src_files=("${extra_srcs[@]}" "${src_files[@]}")

  echo "Compiling $out_jar_name ($label, --release $release)..."
  if [ "${#stub_files[@]}" -gt 0 ]; then
    "$JAVAC_BIN" --release "$release" -Xlint:-options -d "$stubs_out" "${stub_files[@]}"
    "$JAVAC_BIN" --release "$release" -Xlint:-options -cp "$stubs_out" -d "$classes_out" "${src_files[@]}"
  else
    "$JAVAC_BIN" --release "$release" -Xlint:-options -d "$classes_out" "${src_files[@]}"
  fi

  printf 'Manifest-Version: 1.0\r\nCreated-By: MCServerManager\r\n\r\n' > "$stage_dir/META-INF/MANIFEST.MF"
  if [ -n "$resources_dir" ] && [ -d "$resources_dir" ]; then
    cp -a "$resources_dir/." "$stage_dir/"
  fi
  cp -a "$classes_out/." "$stage_dir/"

  local out_jar="$ASSETS_DIR/$out_jar_name"
  rm -f "$out_jar"
  "$JAR_BIN" cfm "$out_jar" "$stage_dir/META-INF/MANIFEST.MF" -C "$stage_dir" .
  echo "  Built $out_jar ($(wc -c < "$out_jar") bytes)"
}

echo "Building all MCServerManagerBridge platform JARs using $JAVAC_BIN..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$ASSETS_DIR"

# 1. Spigot / Paper / Purpur / Leaf / Folia / Custom
build_bridge_jar \
  "spigot-folia" \
  "MCServerManagerBridge.jar" \
  "8" \
  "$PLUGIN_ROOT/stubs" \
  "$PLUGIN_ROOT/src" \
  "$PLUGIN_ROOT/resources"

# 2. Velocity Proxy
build_bridge_jar \
  "velocity" \
  "MCServerManagerBridge-Velocity.jar" \
  "17" \
  "$PLATFORMS_ROOT/velocity/stubs" \
  "$PLATFORMS_ROOT/velocity/src" \
  "$PLATFORMS_ROOT/velocity/resources" \
  "$JSON_UTIL_SRC"

# 3. Fabric Mod
build_bridge_jar \
  "fabric" \
  "MCServerManagerBridge-Fabric.jar" \
  "17" \
  "$PLATFORMS_ROOT/fabric/stubs" \
  "$PLATFORMS_ROOT/fabric/src" \
  "$PLATFORMS_ROOT/fabric/resources" \
  "$JSON_UTIL_SRC" \
  "$MOD_COMMON_SRC"

# 4. NeoForge Mod
build_bridge_jar \
  "neoforge" \
  "MCServerManagerBridge-NeoForge.jar" \
  "17" \
  "$PLATFORMS_ROOT/neoforge/stubs" \
  "$PLATFORMS_ROOT/neoforge/src" \
  "$PLATFORMS_ROOT/neoforge/resources" \
  "$JSON_UTIL_SRC" \
  "$MOD_COMMON_SRC"

# 5. Forge Mod
build_bridge_jar \
  "forge" \
  "MCServerManagerBridge-Forge.jar" \
  "17" \
  "$PLATFORMS_ROOT/forge/stubs" \
  "$PLATFORMS_ROOT/forge/src" \
  "$PLATFORMS_ROOT/forge/resources" \
  "$JSON_UTIL_SRC" \
  "$MOD_COMMON_SRC"

rm -rf "$BUILD_DIR"
echo "All 5 MCServerManagerBridge platform JARs built successfully."
