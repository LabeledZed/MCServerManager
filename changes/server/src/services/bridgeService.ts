import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {
  BRIDGE_FABRIC_JAR_ASSET,
  BRIDGE_FORGE_14_16_JAR_ASSET,
  BRIDGE_FORGE_17_JAR_ASSET,
  BRIDGE_FORGE_18_112_JAR_ASSET,
  BRIDGE_FORGE_JAR_ASSET,
  BRIDGE_JAR_ASSET,
  BRIDGE_NEOFORGE_JAR_ASSET,
  BRIDGE_VELOCITY_JAR_ASSET,
  getServerDir,
} from '../config.js';
import { store } from './store.js';
import { listInstalledAddons } from './pluginService.js';
import { isMcVersion26OrNewer, listWorlds } from './worldService.js';
import { atomicWriteFile, resolveInside } from '../utils/fsSafe.js';
import type {
  BridgeGamerule,
  BridgePlayerInfo,
  BridgePluginRuntimeInfo,
  BridgeStatusResponse,
  BridgeWorldInfo,
  ManagedWorldConfig,
  RealmsConfig,
  RealmsStateResponse,
  SeparationOptions,
  ServerConfig,
  ServerSoftware,
  TrackedPortalInfo,
  VelocityBridgeServerInfo,
  WorldGroup,
} from '../../../shared/types.js';

export const BRIDGE_JAR_FILENAME = 'MCServerManagerBridge.jar';
export const BRIDGE_PLUGIN_FOLDER = 'MCServerManagerBridge';

const ALL_BRIDGE_JAR_TARGETS: Array<{ addonDir: 'plugins' | 'mods'; jarFileName: string }> = [
  { addonDir: 'plugins', jarFileName: 'MCServerManagerBridge.jar' },
  { addonDir: 'plugins', jarFileName: 'MCServerManagerBridge-Velocity.jar' },
  { addonDir: 'mods', jarFileName: 'MCServerManagerBridge-Fabric.jar' },
  { addonDir: 'mods', jarFileName: 'MCServerManagerBridge-NeoForge.jar' },
  { addonDir: 'mods', jarFileName: 'MCServerManagerBridge-Forge.jar' },
  { addonDir: 'mods', jarFileName: 'MCServerManagerBridge-Forge-1.8-1.12.jar' },
  { addonDir: 'mods', jarFileName: 'MCServerManagerBridge-Forge-1.7.jar' },
  { addonDir: 'mods', jarFileName: 'MCServerManagerBridge-Forge-1.4-1.6.jar' },
];

export async function removeStaleBridgeJars(
  serverDir: string,
  keepSpec?: BridgePlatformSpec | null,
): Promise<void> {
  for (const target of ALL_BRIDGE_JAR_TARGETS) {
    const isKept =
      Boolean(keepSpec) &&
      keepSpec!.addonDir === target.addonDir &&
      keepSpec!.jarFileName.toLowerCase() === target.jarFileName.toLowerCase();
    const dirFull = path.join(serverDir, target.addonDir);
    if (!isKept) {
      await fs.rm(path.join(dirFull, target.jarFileName), { force: true }).catch(() => {});
    }
    await fs.rm(path.join(dirFull, `${target.jarFileName}.disabled`), { force: true }).catch(() => {});
  }
}

export interface BridgePlatformSpec {
  assetPath: string;
  addonDir: 'plugins' | 'mods';
  jarFileName: string;
  configSubDir: string;
  supportsRealms: boolean;
}

function parseMcVersionParts(mcVersion?: string): { major: number; minor: number; patch: number } | null {
  if (!mcVersion) return null;
  const m = mcVersion.trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10) || 0,
    minor: parseInt(m[2], 10) || 0,
    patch: parseInt(m[3] || '0', 10) || 0,
  };
}

export function getBridgePlatformSpec(software: ServerSoftware, mcVersion?: string): BridgePlatformSpec | null {
  const ver = parseMcVersionParts(mcVersion);
  switch (software) {
    case 'paper':
    case 'purpur':
    case 'leaf':
    case 'spigot':
    case 'folia':
    case 'custom':
      return {
        assetPath: BRIDGE_JAR_ASSET,
        addonDir: 'plugins',
        jarFileName: 'MCServerManagerBridge.jar',
        configSubDir: path.join('plugins', 'MCServerManagerBridge'),
        supportsRealms: true,
      };
    case 'velocity':
      return {
        assetPath: BRIDGE_VELOCITY_JAR_ASSET,
        addonDir: 'plugins',
        jarFileName: 'MCServerManagerBridge-Velocity.jar',
        configSubDir: path.join('plugins', 'mcservermanagerbridge'),
        supportsRealms: false,
      };
    case 'fabric':
      return {
        assetPath: BRIDGE_FABRIC_JAR_ASSET,
        addonDir: 'mods',
        jarFileName: 'MCServerManagerBridge-Fabric.jar',
        configSubDir: path.join('config', 'mcservermanagerbridge'),
        supportsRealms: false,
      };
    case 'neoforge':
      // NeoForge 1.20.1 (47.1.x) used the net.minecraftforge package & mods.toml
      if (ver && ver.major === 1 && ver.minor === 20 && ver.patch === 1) {
        return {
          assetPath: BRIDGE_FORGE_JAR_ASSET,
          addonDir: 'mods',
          jarFileName: 'MCServerManagerBridge-Forge.jar',
          configSubDir: path.join('config', 'mcservermanagerbridge'),
          supportsRealms: false,
        };
      }
      return {
        assetPath: BRIDGE_NEOFORGE_JAR_ASSET,
        addonDir: 'mods',
        jarFileName: 'MCServerManagerBridge-NeoForge.jar',
        configSubDir: path.join('config', 'mcservermanagerbridge'),
        supportsRealms: false,
      };
    case 'forge':
      if (ver && ver.major === 1 && ver.minor >= 3 && ver.minor <= 6) {
        return {
          assetPath: BRIDGE_FORGE_14_16_JAR_ASSET,
          addonDir: 'mods',
          jarFileName: 'MCServerManagerBridge-Forge-1.4-1.6.jar',
          configSubDir: path.join('config', 'mcservermanagerbridge'),
          supportsRealms: false,
        };
      }
      if (ver && ver.major === 1 && ver.minor === 7) {
        return {
          assetPath: BRIDGE_FORGE_17_JAR_ASSET,
          addonDir: 'mods',
          jarFileName: 'MCServerManagerBridge-Forge-1.7.jar',
          configSubDir: path.join('config', 'mcservermanagerbridge'),
          supportsRealms: false,
        };
      }
      if (ver && ver.major === 1 && ver.minor >= 8 && ver.minor <= 12) {
        return {
          assetPath: BRIDGE_FORGE_18_112_JAR_ASSET,
          addonDir: 'mods',
          jarFileName: 'MCServerManagerBridge-Forge-1.8-1.12.jar',
          configSubDir: path.join('config', 'mcservermanagerbridge'),
          supportsRealms: false,
        };
      }
      return {
        assetPath: BRIDGE_FORGE_JAR_ASSET,
        addonDir: 'mods',
        jarFileName: 'MCServerManagerBridge-Forge.jar',
        configSubDir: path.join('config', 'mcservermanagerbridge'),
        supportsRealms: false,
      };
    case 'vanilla':
    default:
      return null;
  }
}

export function supportsBridgePlugin(software: ServerSoftware): boolean {
  return getBridgePlatformSpec(software) !== null;
}

export function supportsRealmsEngine(software: ServerSoftware): boolean {
  return Boolean(getBridgePlatformSpec(software)?.supportsRealms);
}

function allocateBridgePort(server: ServerConfig): number {
  const used = new Set(
    store
      .getServers()
      .filter((s) => s.id !== server.id && s.bridgePort)
      .map((s) => s.bridgePort as number),
  );
  let candidate = Math.min(60000, Math.max(30000, (server.port || 25565) + 10000));
  while (used.has(candidate) && candidate < 62000) {
    candidate++;
  }
  return candidate;
}

export function isBridgeJarPresent(serverId: string, software?: ServerSoftware, mcVersion?: string): boolean {
  const stored = store.getServer(serverId);
  const resolvedSoftware = software || stored?.software || 'paper';
  const resolvedMcVersion = mcVersion ?? stored?.mcVersion;
  const spec = getBridgePlatformSpec(resolvedSoftware, resolvedMcVersion);
  if (!spec) return false;
  const jarPath = path.join(getServerDir(serverId), spec.addonDir, spec.jarFileName);
  return fsSync.existsSync(jarPath);
}

export function needsBridgeJarUpdate(serverId: string, software?: ServerSoftware, mcVersion?: string): boolean {
  const stored = store.getServer(serverId);
  const resolvedSoftware = software || stored?.software || 'paper';
  const resolvedMcVersion = mcVersion ?? stored?.mcVersion;
  const spec = getBridgePlatformSpec(resolvedSoftware, resolvedMcVersion);
  if (!spec || !fsSync.existsSync(spec.assetPath)) return false;
  const installedPath = path.join(getServerDir(serverId), spec.addonDir, spec.jarFileName);
  if (!fsSync.existsSync(installedPath)) return true;
  try {
    const assetStat = fsSync.statSync(spec.assetPath);
    const installedStat = fsSync.statSync(installedPath);
    return assetStat.size !== installedStat.size || assetStat.mtimeMs > installedStat.mtimeMs;
  } catch {
    return true;
  }
}

/**
 * Installs or refreshes the platform-specific MCServerManagerBridge JAR + its loopback bridge.properties secret.
 */
export async function installBridgePlugin(server: ServerConfig): Promise<{ port: number }> {
  const spec = getBridgePlatformSpec(server.software, server.mcVersion);
  if (!spec) {
    throw new Error(`Server platform "${server.software}" does not support a companion bridge plugin/mod.`);
  }
  if (!fsSync.existsSync(spec.assetPath)) {
    throw new Error(`Bundled ${spec.jarFileName} asset not found. Run npm run build:bridge.`);
  }

  let dirty = false;
  if (!server.bridgePort) {
    server.bridgePort = allocateBridgePort(server);
    dirty = true;
  }
  if (!server.bridgeToken) {
    server.bridgeToken = crypto.randomBytes(24).toString('hex');
    dirty = true;
  }
  if (server.bridgeEnabled !== true) {
    server.bridgeEnabled = true;
    dirty = true;
  }
  if (dirty) {
    store.upsertServer(server);
  }

  const serverDir = getServerDir(server.id);
  const targetAddonDir = path.join(serverDir, spec.addonDir);
  const dataDir = path.join(serverDir, spec.configSubDir);
  await fs.mkdir(targetAddonDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });

  // Remove bridge JARs belonging to other platforms (e.g. after switching Fabric -> Forge) and stale .disabled copies
  await removeStaleBridgeJars(serverDir, spec);

  // Copy platform-appropriate bundled JAR into plugins/ or mods/
  await fs.copyFile(spec.assetPath, path.join(targetAddonDir, spec.jarFileName));

  // Write secure loopback config (127.0.0.1 only + per-server random secret)
  const props = [
    '# Managed automatically by MCServerManager — do not share token',
    `port=${server.bridgePort}`,
    `token=${server.bridgeToken}`,
    '',
  ].join('\n');
  await atomicWriteFile(path.join(dataDir, 'bridge.properties'), props);

  return { port: server.bridgePort };
}

export async function uninstallBridgePlugin(server: ServerConfig): Promise<void> {
  await removeStaleBridgeJars(getServerDir(server.id), null);
  server.bridgeEnabled = false;
  store.upsertServer(server);
}

async function bridgeRequest<T>(
  server: ServerConfig,
  endpoint: string,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
  timeoutMs = 2500,
): Promise<T> {
  if (!server.bridgePort || !server.bridgeToken) {
    throw new Error('Bridge plugin is not configured for this server');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${server.bridgePort}${endpoint}`, {
      method,
      headers: {
        'X-Bridge-Token': server.bridgeToken,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || `Bridge HTTP ${res.status}`);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getBridgeStatus(server: ServerConfig): Promise<BridgeStatusResponse> {
  const supported = supportsBridgePlugin(server.software);
  const installed = supported && isBridgeJarPresent(server.id, server.software, server.mcVersion);
  const enabled = Boolean(server.bridgeEnabled);

  if (!supported || !installed || !enabled || !server.bridgePort || !server.bridgeToken) {
    return {
      supported,
      installed,
      enabled,
      connected: false,
      bridgePort: server.bridgePort,
      worlds: [],
      players: [],
    };
  }

  try {
    const live = await bridgeRequest<{
      serverName: string;
      bukkitVersion: string;
      tps: number[] | null;
      heapUsedMb: number;
      heapMaxMb: number;
      pluginCount: number;
      worlds: BridgeStatusResponse['worlds'];
      players: BridgeStatusResponse['players'];
      proxyServers?: VelocityBridgeServerInfo[];
      plugins?: BridgePluginRuntimeInfo[];
    }>(server, '/status', 'GET', undefined, 1500);

    return {
      supported: true,
      installed: true,
      enabled: true,
      connected: true,
      bridgePort: server.bridgePort,
      serverName: live.serverName,
      bukkitVersion: live.bukkitVersion,
      tps: live.tps,
      heapUsedMb: live.heapUsedMb,
      heapMaxMb: live.heapMaxMb,
      pluginCount: live.pluginCount,
      worlds: live.worlds || [],
      players: live.players || [],
      proxyServers: live.proxyServers,
      plugins: live.plugins,
    };
  } catch (err) {
    return {
      supported: true,
      installed: true,
      enabled: true,
      connected: false,
      bridgePort: server.bridgePort,
      worlds: [],
      players: [],
      error: err instanceof Error ? err.message : 'Bridge unreachable',
    };
  }
}

export async function getWorldGamerules(
  server: ServerConfig,
  worldName: string,
): Promise<{ world: string; gamerules: BridgeGamerule[] }> {
  return bridgeRequest(server, `/worlds/${encodeURIComponent(worldName)}/gamerules`, 'GET');
}

export async function setWorldGamerule(
  server: ServerConfig,
  worldName: string,
  name: string,
  value: string | number | boolean,
): Promise<{ ok: boolean; name: string; value: string }> {
  return bridgeRequest(server, `/worlds/${encodeURIComponent(worldName)}/gamerules`, 'PUT', {
    name,
    value: String(value),
  });
}

export async function updateWorldEnvironment(
  server: ServerConfig,
  worldName: string,
  patch: {
    time?: number;
    weather?: 'clear' | 'rain' | 'thunder';
    difficulty?: 'PEACEFUL' | 'EASY' | 'NORMAL' | 'HARD';
    pvp?: boolean;
    borderSize?: number;
    save?: boolean;
  },
): Promise<{ ok: boolean }> {
  return bridgeRequest(server, `/worlds/${encodeURIComponent(worldName)}/environment`, 'PUT', patch);
}

export async function runBridgePlayerAction(
  server: ServerConfig,
  playerName: string,
  payload: {
    action: 'gamemode' | 'heal' | 'spawn' | 'tp' | 'xp' | 'message' | 'kick' | 'send';
    value?: string | number;
    x?: number;
    y?: number;
    z?: number;
    world?: string;
  },
): Promise<{ ok: boolean }> {
  return bridgeRequest(server, `/players/${encodeURIComponent(playerName)}/action`, 'POST', payload);
}

export async function sendBridgeBroadcast(server: ServerConfig, message: string): Promise<{ ok: boolean }> {
  return bridgeRequest(server, '/broadcast', 'POST', { message });
}

// ---------- Native Multiverse / Realms / Colored Portals / Per-World Plugins ----------

const WORLD_NAME_RE = /^(?:[a-z0-9_.-]+:)?[a-zA-Z0-9_.-]{1,64}$/;

export function normalizeWorldNameForVersion(raw: string, is26Plus: boolean): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (is26Plus) {
    if (lower === 'world' || lower === 'overworld' || lower === 'minecraft:overworld' || lower === 'minecraft:world') {
      return 'minecraft:overworld';
    }
    if (
      lower === 'world_nether' ||
      lower === 'the_nether' ||
      lower === 'minecraft:the_nether' ||
      lower === 'minecraft:world_nether'
    ) {
      return 'minecraft:the_nether';
    }
    if (
      lower === 'world_the_end' ||
      lower === 'the_end' ||
      lower === 'minecraft:the_end' ||
      lower === 'minecraft:world_the_end'
    ) {
      return 'minecraft:the_end';
    }
    if (lower.startsWith('minecraft:')) {
      return trimmed.slice('minecraft:'.length);
    }
    return trimmed;
  }

  if (lower === 'minecraft:overworld' || lower === 'overworld') return 'world';
  if (lower === 'minecraft:the_nether' || lower === 'the_nether') return 'world_nether';
  if (lower === 'minecraft:the_end' || lower === 'the_end') return 'world_the_end';
  if (lower.startsWith('minecraft:')) return trimmed.slice('minecraft:'.length);
  return trimmed;
}

export function createDefaultWorldGroup(is26Plus = false): WorldGroup {
  return {
    id: 'default',
    name: 'Default World',
    color: '#10b981',
    overworld: is26Plus ? 'minecraft:overworld' : 'world',
    nether: is26Plus ? 'minecraft:the_nether' : 'world_nether',
    end: is26Plus ? 'minecraft:the_end' : 'world_the_end',
    extraWorlds: [],
    defaultGameMode: '',
    players: [],
    allowedTpaGroups: [],
    separation: {
      inventory: true,
      chat: true,
      visibility: true,
      portalsAndRespawn: true,
    },
  };
}

export function createDefaultRealmsConfig(is26Plus = false): RealmsConfig {
  return {
    enabled: true,
    defaultJoinWorld: is26Plus ? 'minecraft:overworld' : 'world',
    forceDefaultJoinForUnassigned: false,
    ownedColoredPortals: true,
    tpaEnabled: true,
    tpaTimeoutSeconds: 60,
    backEnabled: true,
    worlds: [],
    groups: [createDefaultWorldGroup(is26Plus)],
    pluginRules: {},
  };
}

function getRealmsFilePath(serverId: string): string {
  return path.join(getServerDir(serverId), 'plugins', BRIDGE_PLUGIN_FOLDER, 'realms.json');
}

function getPortalsFilePath(serverId: string): string {
  return path.join(getServerDir(serverId), 'plugins', BRIDGE_PLUGIN_FOLDER, 'portals.json');
}

function sanitizeSeparation(raw: Partial<SeparationOptions> | undefined, defaults: SeparationOptions): SeparationOptions {
  return {
    inventory: raw?.inventory !== undefined ? Boolean(raw.inventory) : defaults.inventory,
    chat: raw?.chat !== undefined ? Boolean(raw.chat) : defaults.chat,
    visibility: raw?.visibility !== undefined ? Boolean(raw.visibility) : defaults.visibility,
    portalsAndRespawn:
      raw?.portalsAndRespawn !== undefined ? Boolean(raw.portalsAndRespawn) : defaults.portalsAndRespawn,
  };
}

function isServer26OrNewer(serverId: string): boolean {
  const srv = store.getServer(serverId);
  return isMcVersion26OrNewer(srv?.mcVersion);
}

function normalizeRealmsConfig(raw: Partial<RealmsConfig> | null | undefined, is26Plus = false): RealmsConfig {
  const base = createDefaultRealmsConfig(is26Plus);
  if (!raw || typeof raw !== 'object') return base;

  const worlds: ManagedWorldConfig[] = Array.isArray(raw.worlds)
    ? raw.worlds
        .filter((w): w is ManagedWorldConfig => Boolean(w && typeof w.name === 'string' && WORLD_NAME_RE.test(w.name.trim())))
        .map((w) => ({
          name: normalizeWorldNameForVersion(w.name.trim(), is26Plus),
          environment: w.environment === 'NETHER' || w.environment === 'THE_END' ? w.environment : 'NORMAL',
          worldType:
            w.worldType === 'FLAT' || w.worldType === 'LARGE_BIOMES' || w.worldType === 'AMPLIFIED'
              ? w.worldType
              : 'NORMAL',
          seed: typeof w.seed === 'string' ? w.seed.trim() : '',
          generateStructures: w.generateStructures !== false,
          generator: typeof w.generator === 'string' ? w.generator.trim() : '',
          autoLoad: w.autoLoad !== false,
          defaultGameMode: w.defaultGameMode || '',
          standaloneSeparation: sanitizeSeparation(w.standaloneSeparation, {
            inventory: false,
            chat: false,
            visibility: false,
            portalsAndRespawn: false,
          }),
          color: typeof w.color === 'string' ? w.color.trim() : '',
        }))
    : [];

  const groups: WorldGroup[] = Array.isArray(raw.groups)
    ? raw.groups
        .filter((g): g is WorldGroup => Boolean(g && typeof g.id === 'string' && g.id.trim()))
        .map((g) => ({
          id: g.id.trim(),
          name: (g.name || g.id).trim(),
          color: typeof g.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(g.color.trim()) ? g.color.trim().toLowerCase() : '#37abc8',
          overworld: typeof g.overworld === 'string' ? normalizeWorldNameForVersion(g.overworld.trim(), is26Plus) : '',
          nether: typeof g.nether === 'string' ? normalizeWorldNameForVersion(g.nether.trim(), is26Plus) : '',
          end: typeof g.end === 'string' ? normalizeWorldNameForVersion(g.end.trim(), is26Plus) : '',
          extraWorlds: Array.isArray(g.extraWorlds)
            ? g.extraWorlds.map((x) => normalizeWorldNameForVersion(String(x).trim(), is26Plus)).filter(Boolean)
            : [],
          defaultGameMode: g.defaultGameMode || '',
          players: Array.isArray(g.players)
            ? Array.from(new Set(g.players.map((x) => String(x).trim()).filter(Boolean)))
            : [],
          allowedTpaGroups: Array.isArray(g.allowedTpaGroups)
            ? Array.from(new Set(g.allowedTpaGroups.map((x) => String(x).trim()).filter(Boolean)))
            : [],
          separation: sanitizeSeparation(g.separation, {
            inventory: true,
            chat: true,
            visibility: true,
            portalsAndRespawn: true,
          }),
        }))
    : [];

  if (groups.length === 0) {
    groups.push(createDefaultWorldGroup(is26Plus));
  }

  const pluginRules: RealmsConfig['pluginRules'] = {};
  if (raw.pluginRules && typeof raw.pluginRules === 'object') {
    for (const [pluginName, rule] of Object.entries(raw.pluginRules)) {
      if (!pluginName.trim() || !rule || typeof rule !== 'object') continue;
      const mode = rule.mode === 'allow' || rule.mode === 'deny' ? rule.mode : 'all';
      pluginRules[pluginName.trim()] = {
        mode,
        worlds: Array.isArray(rule.worlds)
          ? rule.worlds.map((w) => normalizeWorldNameForVersion(String(w).trim(), is26Plus)).filter(Boolean)
          : [],
        groups: Array.isArray(rule.groups) ? rule.groups.map((g) => String(g).trim()).filter(Boolean) : [],
      };
    }
  }

  const rawDefaultWorld =
    typeof raw.defaultJoinWorld === 'string' && raw.defaultJoinWorld.trim()
      ? raw.defaultJoinWorld.trim()
      : is26Plus
        ? 'minecraft:overworld'
        : 'world';

  return {
    enabled: raw.enabled !== false,
    defaultJoinWorld: normalizeWorldNameForVersion(rawDefaultWorld, is26Plus),
    forceDefaultJoinForUnassigned: Boolean(raw.forceDefaultJoinForUnassigned),
    ownedColoredPortals: raw.ownedColoredPortals !== false,
    tpaEnabled: raw.tpaEnabled !== false,
    tpaTimeoutSeconds: Number.isFinite(Number(raw.tpaTimeoutSeconds))
      ? Math.max(10, Math.min(300, Math.floor(Number(raw.tpaTimeoutSeconds))))
      : 60,
    backEnabled: raw.backEnabled !== false,
    worlds,
    groups,
    pluginRules,
  };
}

export async function readRealmsConfigFromDisk(serverId: string): Promise<RealmsConfig> {
  const is26Plus = isServer26OrNewer(serverId);
  const file = getRealmsFilePath(serverId);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return normalizeRealmsConfig(JSON.parse(raw) as Partial<RealmsConfig>, is26Plus);
  } catch {
    return createDefaultRealmsConfig(is26Plus);
  }
}

export async function writeRealmsConfigToDisk(serverId: string, config: RealmsConfig): Promise<RealmsConfig> {
  const is26Plus = isServer26OrNewer(serverId);
  const normalized = normalizeRealmsConfig(config, is26Plus);
  const file = getRealmsFilePath(serverId);
  await atomicWriteFile(file, JSON.stringify(normalized, null, 2));
  return normalized;
}

async function readPortalsFromDisk(serverId: string): Promise<TrackedPortalInfo[]> {
  try {
    const raw = await fs.readFile(getPortalsFilePath(serverId), 'utf8');
    const parsed = JSON.parse(raw) as { portals?: TrackedPortalInfo[] };
    return Array.isArray(parsed.portals) ? parsed.portals : [];
  } catch {
    return [];
  }
}

async function discoverOfflineWorldNames(serverDir: string, is26Plus: boolean): Promise<string[]> {
  const found = new Set<string>();

  if (is26Plus) {
    // Paper / Leaf 26.1+ unified dimension storage: world/dimensions/minecraft/<name>
    found.add('minecraft:overworld');
    found.add('minecraft:the_nether');
    found.add('minecraft:the_end');
    const modernDir = path.join(serverDir, 'world', 'dimensions', 'minecraft');
    const modernEntries = await fs.readdir(modernDir, { withFileTypes: true }).catch(() => []);
    for (const e of modernEntries) {
      if (!e.isDirectory()) continue;
      if (e.name === 'overworld') found.add('minecraft:overworld');
      else if (e.name === 'the_nether') found.add('minecraft:the_nether');
      else if (e.name === 'the_end') found.add('minecraft:the_end');
      else found.add(e.name);
    }
    return Array.from(found).sort((a, b) => a.localeCompare(b));
  }

  const classic = await listWorlds(serverDir).catch(() => []);
  for (const w of classic) found.add(w.name);
  return Array.from(found).sort((a, b) => a.localeCompare(b));
}

export async function getRealmsState(server: ServerConfig): Promise<RealmsStateResponse> {
  const supported = supportsRealmsEngine(server.software);
  const installed = supported && isBridgeJarPresent(server.id, server.software, server.mcVersion);
  const is26Plus = isMcVersion26OrNewer(server.mcVersion);
  const diskConfig = await readRealmsConfigFromDisk(server.id);

  if (supported && installed && server.bridgeEnabled && server.bridgePort && server.bridgeToken) {
    try {
      const live = await bridgeRequest<{
        config?: Partial<RealmsConfig>;
        loadedWorlds?: BridgeWorldInfo[];
        unloadedFolders?: string[];
        plugins?: BridgePluginRuntimeInfo[];
        onlinePlayers?: BridgePlayerInfo[];
        portals?: TrackedPortalInfo[];
      }>(server, '/realms/state', 'GET', undefined, 3000);

      const loadedWorlds = (live.loadedWorlds || []).map((w) => ({
        ...w,
        name: normalizeWorldNameForVersion(w.name, is26Plus),
      }));
      const unloadedFolders = (live.unloadedFolders || [])
        .filter((f) => !(is26Plus && f.toLowerCase() === 'world'))
        .map((f) => normalizeWorldNameForVersion(f, is26Plus));
      const onlinePlayers = (live.onlinePlayers || []).map((p) => ({
        ...p,
        world: normalizeWorldNameForVersion(p.world, is26Plus),
      }));

      return {
        supported: true,
        installed: true,
        connected: true,
        config: normalizeRealmsConfig(live.config || diskConfig, is26Plus),
        loadedWorlds,
        unloadedFolders,
        plugins: live.plugins || [],
        onlinePlayers,
        portals: live.portals || [],
      };
    } catch (err) {
      // Fall back to offline disk view so admin can still edit config while server is stopped
      const serverDir = getServerDir(server.id);
      const [diskWorlds, addons, portals] = await Promise.all([
        discoverOfflineWorldNames(serverDir, is26Plus),
        listInstalledAddons(serverDir, server.software).catch(() => ({ addons: [] })),
        readPortalsFromDisk(server.id),
      ]);
      const offlinePlugins: BridgePluginRuntimeInfo[] = addons.addons.map((a) => ({
        name: a.manifest.name || a.fileName.replace(/\.jar(\.disabled)?$/i, ''),
        version: a.manifest.version || '',
        enabled: a.enabled,
      }));
      return {
        supported: true,
        installed: true,
        connected: false,
        config: diskConfig,
        loadedWorlds: [],
        unloadedFolders: diskWorlds,
        plugins: offlinePlugins,
        onlinePlayers: [],
        portals,
        error: err instanceof Error ? err.message : 'Bridge offline',
      };
    }
  }

  const serverDir = getServerDir(server.id);
  const [diskWorlds, addons, portals] = await Promise.all([
    discoverOfflineWorldNames(serverDir, is26Plus),
    listInstalledAddons(serverDir, server.software).catch(() => ({ addons: [] })),
    readPortalsFromDisk(server.id),
  ]);
  const offlinePlugins: BridgePluginRuntimeInfo[] = addons.addons.map((a) => ({
    name: a.manifest.name || a.fileName.replace(/\.jar(\.disabled)?$/i, ''),
    version: a.manifest.version || '',
    enabled: a.enabled,
  }));

  return {
    supported,
    installed,
    connected: false,
    config: diskConfig,
    loadedWorlds: [],
    unloadedFolders: diskWorlds,
    plugins: offlinePlugins,
    onlinePlayers: [],
    portals,
  };
}

export async function saveRealmsConfig(server: ServerConfig, config: RealmsConfig): Promise<RealmsStateResponse> {
  const normalized = await writeRealmsConfigToDisk(server.id, config);

  if (supportsBridgePlugin(server.software) && isBridgeJarPresent(server.id) && server.bridgeEnabled && server.bridgePort && server.bridgeToken) {
    try {
      await bridgeRequest(server, '/realms/reload', 'POST', normalized, 30000);
    } catch {
      // Server offline or restarting; disk config is saved and will apply on startup
    }
  }
  return getRealmsState(server);
}

export interface CreateRealmWorldPayload {
  bundle?: boolean;
  name: string;
  environment?: 'NORMAL' | 'NETHER' | 'THE_END';
  worldType?: 'NORMAL' | 'FLAT' | 'LARGE_BIOMES' | 'AMPLIFIED';
  seed?: string;
  generateStructures?: boolean;
  generator?: string;
  defaultGameMode?: ManagedWorldConfig['defaultGameMode'];
  standaloneSeparation?: SeparationOptions;
  color?: string;
  createNether?: boolean;
  createEnd?: boolean;
  netherName?: string;
  endName?: string;
  createGroup?: boolean;
  groupName?: string;
  groupColor?: string;
  groupSeparation?: SeparationOptions;
}

export async function createRealmWorld(
  server: ServerConfig,
  payload: CreateRealmWorldPayload,
): Promise<{ ok: boolean; created: string[]; live: boolean; state: RealmsStateResponse }> {
  const name = (payload.name || '').trim();
  if (!WORLD_NAME_RE.test(name)) {
    throw new Error('World name must be 1-64 characters using letters, numbers, underscores, or hyphens.');
  }

  const config = await readRealmsConfigFromDisk(server.id);
  const createdNames: string[] = [];

  const upsertWorld = (w: ManagedWorldConfig) => {
    const idx = config.worlds.findIndex((x) => x.name.toLowerCase() === w.name.toLowerCase());
    if (idx >= 0) config.worlds[idx] = w;
    else config.worlds.push(w);
    createdNames.push(w.name);
  };

  if (payload.bundle) {
    const netherName = (payload.netherName || `${name}_nether`).trim();
    const endName = (payload.endName || `${name}_the_end`).trim();
    if (payload.createNether !== false && !WORLD_NAME_RE.test(netherName)) {
      throw new Error('Invalid Nether world name');
    }
    if (payload.createEnd !== false && !WORLD_NAME_RE.test(endName)) {
      throw new Error('Invalid End world name');
    }

    upsertWorld({
      name,
      environment: 'NORMAL',
      worldType: payload.worldType || 'NORMAL',
      seed: payload.seed?.trim() || '',
      generateStructures: payload.generateStructures !== false,
      generator: payload.generator?.trim() || '',
      autoLoad: true,
      defaultGameMode: payload.defaultGameMode || '',
    });

    if (payload.createNether !== false) {
      upsertWorld({
        name: netherName,
        environment: 'NETHER',
        worldType: 'NORMAL',
        seed: payload.seed?.trim() || '',
        generateStructures: payload.generateStructures !== false,
        autoLoad: true,
      });
    }

    if (payload.createEnd !== false) {
      upsertWorld({
        name: endName,
        environment: 'THE_END',
        worldType: 'NORMAL',
        seed: payload.seed?.trim() || '',
        generateStructures: payload.generateStructures !== false,
        autoLoad: true,
      });
    }

    if (payload.createGroup) {
      const groupId = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const uniqueId = config.groups.some((g) => g.id === groupId)
        ? `${groupId}_${Date.now().toString(36).slice(-4)}`
        : groupId;
      config.groups.push({
        id: uniqueId,
        name: (payload.groupName || name).trim(),
        color: payload.groupColor || '#3b82f6',
        overworld: name,
        nether: payload.createNether !== false ? netherName : '',
        end: payload.createEnd !== false ? endName : '',
        extraWorlds: [],
        defaultGameMode: payload.defaultGameMode || '',
        players: [],
        separation: sanitizeSeparation(payload.groupSeparation, {
          inventory: true,
          chat: true,
          visibility: true,
          portalsAndRespawn: true,
        }),
      });
    }
  } else {
    upsertWorld({
      name,
      environment: payload.environment || 'NORMAL',
      worldType: payload.worldType || 'NORMAL',
      seed: payload.seed?.trim() || '',
      generateStructures: payload.generateStructures !== false,
      generator: payload.generator?.trim() || '',
      autoLoad: true,
      defaultGameMode: payload.defaultGameMode || '',
      standaloneSeparation: sanitizeSeparation(payload.standaloneSeparation, {
        inventory: false,
        chat: false,
        visibility: false,
        portalsAndRespawn: false,
      }),
      color: payload.color || '',
    });
  }

  await writeRealmsConfigToDisk(server.id, config);

  let live = false;
  if (supportsBridgePlugin(server.software) && isBridgeJarPresent(server.id) && server.bridgeEnabled && server.bridgePort && server.bridgeToken) {
    try {
      await bridgeRequest(server, '/realms/worlds/create', 'POST', payload, 45000);
      await bridgeRequest(server, '/realms/reload', 'POST', config, 20000);
      live = true;
    } catch {
      live = false;
    }
  }

  const state = await getRealmsState(server);
  return { ok: true, created: createdNames, live, state };
}

export async function loadRealmWorld(
  server: ServerConfig,
  worldName: string,
  environment?: 'NORMAL' | 'NETHER' | 'THE_END',
): Promise<RealmsStateResponse> {
  if (!WORLD_NAME_RE.test(worldName)) throw new Error('Invalid world name');

  const config = await readRealmsConfigFromDisk(server.id);
  const existing = config.worlds.find((w) => w.name.toLowerCase() === worldName.toLowerCase());
  if (existing) {
    existing.autoLoad = true;
    if (environment) existing.environment = environment;
  } else {
    const inferredEnv =
      environment ||
      (worldName.toLowerCase().includes('nether')
        ? 'NETHER'
        : worldName.toLowerCase().endsWith('_end') || worldName.toLowerCase().includes('the_end')
          ? 'THE_END'
          : 'NORMAL');
    config.worlds.push({
      name: worldName,
      environment: inferredEnv,
      worldType: 'NORMAL',
      generateStructures: true,
      autoLoad: true,
    });
  }
  await writeRealmsConfigToDisk(server.id, config);

  try {
    await bridgeRequest(
      server,
      `/realms/worlds/${encodeURIComponent(worldName)}/load`,
      'POST',
      environment ? { environment } : {},
      30000,
    );
  } catch {
    // If offline, autoLoad=true is already saved in realms.json
  }
  return getRealmsState(server);
}

export async function unloadRealmWorld(server: ServerConfig, worldName: string, save = true): Promise<RealmsStateResponse> {
  if (!WORLD_NAME_RE.test(worldName)) throw new Error('Invalid world name');
  await bridgeRequest(server, `/realms/worlds/${encodeURIComponent(worldName)}/unload`, 'POST', { save }, 20000);
  const config = await readRealmsConfigFromDisk(server.id);
  const mw = config.worlds.find((w) => w.name.toLowerCase() === worldName.toLowerCase());
  if (mw) {
    mw.autoLoad = false;
    await writeRealmsConfigToDisk(server.id, config);
  }
  return getRealmsState(server);
}

export async function deleteRealmWorld(server: ServerConfig, worldName: string): Promise<RealmsStateResponse> {
  if (!WORLD_NAME_RE.test(worldName)) throw new Error('Invalid world name');
  const is26Plus = isMcVersion26OrNewer(server.mcVersion);
  const normalizedTarget = normalizeWorldNameForVersion(worldName, is26Plus);
  if (normalizedTarget === 'minecraft:overworld' || (!is26Plus && normalizedTarget.toLowerCase() === 'world')) {
    throw new Error('Cannot delete the primary Overworld from Realms.');
  }

  let deletedLive = false;
  if (supportsBridgePlugin(server.software) && isBridgeJarPresent(server.id) && server.bridgeEnabled && server.bridgePort && server.bridgeToken) {
    try {
      await bridgeRequest(server, `/realms/worlds/${encodeURIComponent(worldName)}`, 'DELETE', undefined, 25000);
      deletedLive = true;
    } catch (err) {
      // If bridge returned an explicit 400 error (e.g. primary default world), rethrow it!
      if (err instanceof Error && !err.message.includes('fetch failed') && !err.message.includes('aborted')) {
        throw err;
      }
    }
  }

  if (!deletedLive) {
    const serverDir = getServerDir(server.id);
    if (is26Plus) {
      const dimFolder =
        normalizedTarget === 'minecraft:the_nether'
          ? 'the_nether'
          : normalizedTarget === 'minecraft:the_end'
            ? 'the_end'
            : normalizedTarget.replace(/^minecraft:/i, '').toLowerCase();
      const modernPath = resolveInside(serverDir, path.join('world', 'dimensions', 'minecraft', dimFolder));
      await fs.rm(modernPath, { recursive: true, force: true }).catch(() => {});
    } else {
      const classicPath = resolveInside(serverDir, worldName);
      await fs.rm(classicPath, { recursive: true, force: true }).catch(() => {});
    }
  }

  const config = await readRealmsConfigFromDisk(server.id);
  config.worlds = config.worlds.filter(
    (w) => normalizeWorldNameForVersion(w.name, is26Plus).toLowerCase() !== normalizedTarget.toLowerCase(),
  );
  await writeRealmsConfigToDisk(server.id, config);
  return getRealmsState(server);
}

export async function moveRealmPlayer(
  server: ServerConfig,
  playerName: string,
  payload: { world?: string; groupId?: string; assignToGroup?: boolean },
): Promise<RealmsStateResponse> {
  if (payload.assignToGroup && payload.groupId !== undefined) {
    const config = await readRealmsConfigFromDisk(server.id);
    const lower = playerName.toLowerCase();
    for (const g of config.groups) {
      g.players = g.players.filter((p) => p.toLowerCase() !== lower);
      if (payload.groupId && g.id === payload.groupId) {
        g.players.push(playerName);
      }
    }
    await writeRealmsConfigToDisk(server.id, config);
    try {
      await bridgeRequest(server, '/realms/reload', 'POST', config, 15000);
    } catch {
      // Ignore if offline
    }
  }

  if (payload.world || payload.groupId) {
    await bridgeRequest(
      server,
      `/realms/players/${encodeURIComponent(playerName)}/move`,
      'POST',
      { world: payload.world, groupId: payload.groupId },
      10000,
    );
  }
  return getRealmsState(server);
}

export async function clearTrackedPortals(server: ServerConfig, portalId?: string): Promise<RealmsStateResponse> {
  const endpoint = portalId ? `/realms/portals/${encodeURIComponent(portalId)}` : '/realms/portals';
  let doneLive = false;
  try {
    await bridgeRequest(server, endpoint, 'DELETE', undefined, 8000);
    doneLive = true;
  } catch {
    doneLive = false;
  }
  if (!doneLive) {
    const portals = await readPortalsFromDisk(server.id);
    const next = portalId ? portals.filter((p) => p.id !== portalId) : [];
    await atomicWriteFile(getPortalsFilePath(server.id), JSON.stringify({ portals: next }, null, 2));
  }
  return getRealmsState(server);
}
