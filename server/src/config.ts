import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve project root cleanly whether running via tsx (server/src) or compiled (server/dist/server/src)
function detectProjectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name === 'mcservermanager') {
          return dir;
        }
      } catch {
        // continue climbing
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const PROJECT_ROOT = detectProjectRoot();
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const SERVERS_DIR = path.join(DATA_DIR, 'servers');
export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
export const RUNTIMES_DIR = path.join(DATA_DIR, 'runtimes');
export const STORE_FILE = path.join(DATA_DIR, 'store.json');
export const ASSETS_DIR = path.join(PROJECT_ROOT, 'assets');
export const BRIDGE_JAR_ASSET = path.join(ASSETS_DIR, 'MCServerManagerBridge.jar');
export const BRIDGE_VELOCITY_JAR_ASSET = path.join(ASSETS_DIR, 'MCServerManagerBridge-Velocity.jar');
export const BRIDGE_FABRIC_JAR_ASSET = path.join(ASSETS_DIR, 'MCServerManagerBridge-Fabric.jar');
export const BRIDGE_NEOFORGE_JAR_ASSET = path.join(ASSETS_DIR, 'MCServerManagerBridge-NeoForge.jar');
export const BRIDGE_FORGE_JAR_ASSET = path.join(ASSETS_DIR, 'MCServerManagerBridge-Forge.jar');
export const BRIDGE_FORGE_18_112_JAR_ASSET = path.join(ASSETS_DIR, 'MCServerManagerBridge-Forge-1.8-1.12.jar');
export const BRIDGE_FORGE_17_JAR_ASSET = path.join(ASSETS_DIR, 'MCServerManagerBridge-Forge-1.7.jar');
export const BRIDGE_FORGE_14_16_JAR_ASSET = path.join(ASSETS_DIR, 'MCServerManagerBridge-Forge-1.4-1.6.jar');
export const CLIENT_DIST_DIR = path.join(PROJECT_ROOT, 'client', 'dist');

export const PORT = Number(process.env.PORT || 3001);
export const USER_AGENT = 'MCServerManager/1.0.1 (https://localhost/mcservermanager)';

export function ensureAppDirs(): void {
  for (const dir of [DATA_DIR, SERVERS_DIR, BACKUPS_DIR, RUNTIMES_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getServerDir(serverId: string): string {
  const safeId = serverId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) throw new Error('Invalid server ID');
  return path.join(SERVERS_DIR, safeId);
}
