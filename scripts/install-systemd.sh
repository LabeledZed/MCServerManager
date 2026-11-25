#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RUN_USER="${SUDO_USER:-$USER}"
RUN_GROUP="$(id -gn "$RUN_USER")"
NODE_BIN="$(command -v node || true)"
PORT_VAL="${PORT:-3001}"

if [ -z "$NODE_BIN" ]; then
  echo "Error: node was not found in PATH. Install Node.js 18+ first." >&2
  exit 1
fi

if [ ! -f "$ROOT_DIR/server/dist/server/src/index.js" ] || [ ! -f "$ROOT_DIR/client/dist/index.html" ]; then
  echo "Building MCServerManager before installing systemd service..."
  npm --prefix "$ROOT_DIR/client" run build
  npm --prefix "$ROOT_DIR/server" run build
fi

UNIT_PATH="/etc/systemd/system/mcservermanager.service"
echo "Installing systemd service to $UNIT_PATH (User=$RUN_USER, Dir=$ROOT_DIR, Port=$PORT_VAL)..."

sudo tee "$UNIT_PATH" >/dev/null <<EOF
[Unit]
Description=MCServerManager - Local Minecraft Server Panel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_GROUP
WorkingDirectory=$ROOT_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT_VAL
ExecStart=$NODE_BIN $ROOT_DIR/server/dist/server/src/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mcservermanager.service
echo ""
echo "MCServerManager systemd service is enabled and running!"
echo "  Status:  sudo systemctl status mcservermanager"
echo "  Logs:    journalctl -u mcservermanager -f"
echo "  Web UI:  http://localhost:$PORT_VAL"
