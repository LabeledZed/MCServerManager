#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "[MCServerManager] Error: Node.js (v18+) is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[MCServerManager] Error: npm is required but was not found in PATH." >&2
  exit 1
fi

FORCE_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build|-b) FORCE_BUILD=1 ;;
  esac
done

if [ ! -d "$ROOT_DIR/server/node_modules" ] || [ ! -d "$ROOT_DIR/client/node_modules" ]; then
  echo "[MCServerManager] Installing Node.js dependencies..."
  npm --prefix "$ROOT_DIR/server" install
  npm --prefix "$ROOT_DIR/client" install
fi

if [ "$FORCE_BUILD" -eq 1 ] || [ ! -f "$ROOT_DIR/server/dist/server/src/index.js" ] || [ ! -f "$ROOT_DIR/client/dist/index.html" ]; then
  echo "[MCServerManager] Building client and server..."
  npm --prefix "$ROOT_DIR/client" run build
  npm --prefix "$ROOT_DIR/server" run build
fi

echo "[MCServerManager] Starting on http://0.0.0.0:${PORT:-3001} ..."
exec node "$ROOT_DIR/server/dist/server/src/index.js"
