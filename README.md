# MCServerManager

A web panel for Minecraft servers and Velocity proxies.

## Prerequisites

- **Node.js** 18+ and **npm**
- **Java (JDK)** 8–25 (optional — can also be downloaded from the panel's **Java Runtimes** tab; JDK `javac` is only needed if recompiling the bridge JARs)
- **Windows** (for `MCServerManager.exe` tray app) or **Linux** (via `start.sh` or `systemd`)

## Features

- **Server Management**: Create, import, start, stop, restart, and auto-start servers (**Paper**, **Purpur**, **Leaf**, **Folia**, **Spigot**, **Vanilla**, **Fabric**, **NeoForge**, **Forge**, **Velocity**, **Custom**).
- **Live Console**: Real-time WebSocket console with ANSI colors, regex/case filtering, command history, and log file search.
- **Config Studio**: Visual & raw editor for `server.properties`, `velocity.toml`, YAML, JSON, and TOML files.
- **Plugins & Mods**: `.jar` upload, enable/disable, Modrinth search & install, and nested config editing.
- **Companion Bridge (`MCServerManagerBridge`)**: Live TPS, gamerules, world environment, broadcasts, and player controls for Spigot/Paper/Folia, Velocity, Fabric, NeoForge, and Forge.
- **Realms & Multi-World**: World groups, inventory/chat/visibility isolation, colored portals, `/tpa`, `/back`, and per-world plugin rules.
- **Velocity Proxy Network**: Link managed or external backend servers, manage `try` order, forced hosts, forwarding secrets, and live proxy players.
- **Bedrock Cross-Play (Geyser & Floodgate)**: 1-click install, config editor, and managed Geyser Standalone sidecar for Vanilla/Forge.
- **Worlds, Backups & Schedules**: 26.1+ unified & pre-26.1 world layouts, `.zip` world import/export, full/world backups, and task scheduler.
- **Java & Access Control**: Portable Adoptium Java installer, optional login auth, and granular user permissions.

## Quick Start

### Windows
Double-click **`MCServerManager.exe`** or **`start.bat`**, then open `http://localhost:3001`.

### Linux
```bash
bash start.sh
```
To install as a `systemd` service: `bash scripts/install-systemd.sh`.

## Building from Source

```powershell
# Windows (Client + Server + Bridge JARs + Tray EXE)
npm.cmd run install:all
npm.cmd run build
```

```bash
# Linux (Client + Server)
npm run install:all
npm run build:linux
```
