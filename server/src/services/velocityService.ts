import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import YAML from 'yaml';
import { getServerDir } from '../config.js';
import { store } from './store.js';
import { serverManager } from './serverManager.js';
import { getBridgeStatus } from './bridgeService.js';
import { getGeyserPlatformSpec } from './geyserService.js';
import { atomicWriteFile } from '../utils/fsSafe.js';
import type {
  ServerConfig,
  VelocityBackendEntry,
  VelocityForwardingMode,
  VelocityManagedCandidate,
  VelocityNetworkState,
} from '../../../shared/types.js';

function sanitizeServerAlias(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'server';
}

function generateForwardingSecret(): string {
  return crypto.randomBytes(12).toString('hex');
}

export async function seedStarterVelocityFiles(
  serverDir: string,
  port: number,
  _serverName: string,
  motd?: string,
): Promise<void> {
  await fs.mkdir(serverDir, { recursive: true });
  const secretPath = path.join(serverDir, 'forwarding.secret');
  if (!fsSync.existsSync(secretPath)) {
    await atomicWriteFile(secretPath, generateForwardingSecret());
  }
  const tomlPath = path.join(serverDir, 'velocity.toml');
  if (!fsSync.existsSync(tomlPath)) {
    const cleanMotd = (motd || 'A Velocity proxy').replace(/"/g, '').replace(/\r?\n/g, ' ').trim() || 'A Velocity proxy';
    const starter = [
      '# Velocity Proxy Configuration (initialized by MCServerManager)',
      'config-version = "2.7"',
      `bind = "0.0.0.0:${port}"`,
      `motd = "${cleanMotd}"`,
      'show-max-players = 500',
      'online-mode = true',
      'force-key-authentication = true',
      'prevent-client-proxy-connections = false',
      'player-info-forwarding-mode = "modern"',
      'forwarding-secret-file = "forwarding.secret"',
      'announce-forge = false',
      'kick-existing-players = false',
      'ping-passthrough = "DISABLED"',
      'enable-player-address-logging = true',
      '',
      '[servers]',
      '# Link managed MCServerManager servers or external servers in the Proxy & Network tab',
      'try = []',
      '',
      '[forced-hosts]',
      '',
      '[advanced]',
      'compression-threshold = 256',
      'compression-level = -1',
      'login-ratelimit = 3000',
      'connection-timeout = 5000',
      'read-timeout = 30000',
      'haproxy-protocol = false',
      'tcp-fast-open = false',
      'bungee-plugin-message-channel = true',
      'show-ping-requests = false',
      'failover-on-unexpected-server-disconnect = true',
      'announce-proxy-commands = true',
      'log-command-executions = false',
      'log-player-connections = true',
      '',
      '[query]',
      'enabled = false',
      'port = 25577',
      'map = "Velocity"',
      'show-plugins = false',
      '',
    ].join('\n');
    await atomicWriteFile(tomlPath, starter);
  }
}

export function extractVelocityBindPort(raw: string): number | null {
  const match = raw.match(/^\s*bind\s*=\s*["']([^"']+)["']/m);
  if (!match) return null;
  const portMatch = match[1].trim().match(/:(\d+)$/);
  if (!portMatch) return null;
  const port = Number(portMatch[1]);
  return Number.isFinite(port) && port >= 1024 && port <= 65535 ? port : null;
}

export async function readVelocityBindPort(serverDir: string): Promise<number | null> {
  const tomlPath = path.join(serverDir, 'velocity.toml');
  if (!fsSync.existsSync(tomlPath)) return null;
  try {
    const raw = await fs.readFile(tomlPath, 'utf8');
    return extractVelocityBindPort(raw);
  } catch {
    return null;
  }
}

export async function syncVelocityBindPort(serverDir: string, port: number): Promise<void> {
  const tomlPath = path.join(serverDir, 'velocity.toml');
  if (!fsSync.existsSync(tomlPath)) return;
  try {
    let raw = await fs.readFile(tomlPath, 'utf8');
    if (/^\s*bind\s*=\s*["'][^"']*["']/m.test(raw)) {
      raw = raw.replace(/^(\s*bind\s*=\s*["'])(.*?)(:\d+)?(["'])/m, (_m, prefix, hostPart, _oldPort, quote) => {
        const cleanHost = String(hostPart || '').replace(/:\d*$/, '') || '0.0.0.0';
        return `${prefix}${cleanHost}:${port}${quote}`;
      });
    } else {
      raw = `bind = "0.0.0.0:${port}"\n${raw}`;
    }
    await atomicWriteFile(tomlPath, raw);
  } catch {
    // ignore
  }
}

async function readVelocityTomlDoc(serverDir: string): Promise<{ exists: boolean; parsed: Record<string, unknown> }> {
  const tomlPath = path.join(serverDir, 'velocity.toml');
  if (!fsSync.existsSync(tomlPath)) {
    return { exists: false, parsed: {} };
  }
  try {
    const raw = await fs.readFile(tomlPath, 'utf8');
    const parsed = parseToml(raw) as Record<string, unknown>;
    return { exists: true, parsed };
  } catch {
    return { exists: true, parsed: {} };
  }
}

async function readOrEnsureForwardingSecret(serverDir: string, secretFileName = 'forwarding.secret'): Promise<string> {
  const safeName = path.basename(secretFileName) || 'forwarding.secret';
  const full = path.join(serverDir, safeName);
  if (fsSync.existsSync(full)) {
    const existing = (await fs.readFile(full, 'utf8').catch(() => '')).trim();
    if (existing) return existing;
  }
  const generated = generateForwardingSecret();
  await atomicWriteFile(full, generated);
  return generated;
}

function extractPortFromAddress(address: string): number | null {
  const m = address.trim().match(/^(?:127\.0\.0\.1|localhost|0\.0\.0\.0):(\d+)$/i);
  if (!m) return null;
  const p = Number(m[1]);
  return Number.isFinite(p) ? p : null;
}

export async function getVelocityNetworkState(server: ServerConfig): Promise<VelocityNetworkState> {
  const serverDir = getServerDir(server.id);
  const { exists, parsed } = await readVelocityTomlDoc(serverDir);
  const secretFile = typeof parsed['forwarding-secret-file'] === 'string' ? parsed['forwarding-secret-file'] : 'forwarding.secret';
  const secretFull = path.join(serverDir, path.basename(secretFile) || 'forwarding.secret');
  const forwardingSecret = fsSync.existsSync(secretFull)
    ? (await fs.readFile(secretFull, 'utf8').catch(() => '')).trim()
    : '';

  const rawServers = (parsed.servers || {}) as Record<string, unknown>;
  const tryOrder = Array.isArray(rawServers.try)
    ? rawServers.try.map((x) => String(x).trim()).filter(Boolean)
    : [];

  const rawForced = (parsed['forced-hosts'] || {}) as Record<string, unknown>;
  const forcedHosts: Record<string, string[]> = {};
  for (const [host, targets] of Object.entries(rawForced)) {
    if (Array.isArray(targets)) {
      forcedHosts[host] = targets.map((t) => String(t).trim()).filter(Boolean);
    } else if (typeof targets === 'string' && targets.trim()) {
      forcedHosts[host] = [targets.trim()];
    }
  }

  const allManaged = store.getServers().filter((s) => s.id !== server.id && s.software !== 'velocity');
  const managedByPort = new Map<number, ServerConfig>();
  for (const m of allManaged) {
    managedByPort.set(m.port, m);
  }

  // Pull live connected players & server populations from MCServerManagerBridge-Velocity.jar when online
  const bridge = await getBridgeStatus(server).catch(() => null);
  const livePlayersByServer = new Map<string, string[]>();
  if (bridge?.connected && Array.isArray(bridge.proxyServers)) {
    for (const ps of bridge.proxyServers) {
      livePlayersByServer.set(ps.name.toLowerCase(), ps.players || []);
    }
  }

  const linkedAliasByServerId = new Map<string, string>();
  const servers: VelocityBackendEntry[] = [];
  for (const [key, val] of Object.entries(rawServers)) {
    if (key === 'try' || typeof val !== 'string') continue;
    const addr = val.trim();
    const localPort = extractPortFromAddress(addr);
    const matched = localPort !== null ? managedByPort.get(localPort) || null : null;
    if (matched) {
      linkedAliasByServerId.set(matched.id, key);
    }
    servers.push({
      alias: key,
      address: addr,
      inTryOrder: tryOrder.includes(key),
      managedServerId: matched?.id ?? null,
      managedServerName: matched?.name ?? null,
      managedServerSoftware: matched?.software ?? null,
      managedServerStatus: matched ? serverManager.getRuntime(matched.id).status : null,
      livePlayers: livePlayersByServer.get(key.toLowerCase()) || [],
    });
  }

  const managedCandidates: VelocityManagedCandidate[] = allManaged.map((m) => ({
    id: m.id,
    name: m.name,
    software: m.software,
    mcVersion: m.mcVersion,
    port: m.port,
    status: serverManager.getRuntime(m.id).status,
    alreadyLinkedAs: linkedAliasByServerId.get(m.id) ?? null,
  }));

  const rawFwd = String(parsed['player-info-forwarding-mode'] || 'modern').toLowerCase();
  const forwardingMode: VelocityForwardingMode =
    rawFwd === 'modern' || rawFwd === 'bungeeguard' || rawFwd === 'legacy' || rawFwd === 'none'
      ? rawFwd
      : 'modern';

  const floodgateKeyFull = path.join(serverDir, 'plugins', 'floodgate', 'key.pem');
  const bindVal = typeof parsed.bind === 'string' ? parsed.bind : `0.0.0.0:${server.port}`;

  // Keep ServerConfig.port synchronized with velocity.toml's bind port
  if (exists && typeof parsed.bind === 'string') {
    const portMatch = parsed.bind.trim().match(/:(\d+)$/);
    if (portMatch) {
      const bindPort = Number(portMatch[1]);
      if (bindPort >= 1024 && bindPort <= 65535 && server.port !== bindPort) {
        server.port = bindPort;
        store.upsertServer(server);
      }
    }
  }

  return {
    configExists: exists,
    bind: bindVal,
    motd: typeof parsed.motd === 'string' ? parsed.motd : `<#37abc8>${server.name}`,
    showMaxPlayers: Number(parsed['show-max-players']) || 500,
    onlineMode: parsed['online-mode'] !== false,
    forwardingMode,
    forwardingSecret,
    servers,
    tryOrder,
    forcedHosts,
    managedCandidates,
    floodgateKeyAvailable: fsSync.existsSync(floodgateKeyFull),
    bridgeConnected: Boolean(bridge?.connected),
    livePlayers: bridge?.connected ? bridge.players : [],
  };
}

export async function updateVelocitySettings(
  server: ServerConfig,
  patch: {
    bind?: string;
    motd?: string;
    showMaxPlayers?: number;
    onlineMode?: boolean;
    forwardingMode?: VelocityForwardingMode;
    servers?: Array<{ alias: string; address: string }>;
    tryOrder?: string[];
    forcedHosts?: Record<string, string[]>;
  },
): Promise<VelocityNetworkState> {
  const serverDir = getServerDir(server.id);
  const tomlPath = path.join(serverDir, 'velocity.toml');
  if (!fsSync.existsSync(tomlPath)) {
    await seedStarterVelocityFiles(serverDir, server.port, server.name);
  }

  const { parsed } = await readVelocityTomlDoc(serverDir);
  const nextDoc: Record<string, unknown> = { ...parsed };

  if (typeof patch.bind === 'string' && patch.bind.trim()) {
    nextDoc.bind = patch.bind.trim();
    const portMatch = patch.bind.trim().match(/:(\d+)$/);
    if (portMatch) {
      const p = Number(portMatch[1]);
      if (p >= 1024 && p <= 65535 && server.port !== p) {
        server.port = p;
        store.upsertServer(server);
      }
    }
  }
  if (typeof patch.motd === 'string') nextDoc.motd = patch.motd;
  if (typeof patch.showMaxPlayers === 'number' && patch.showMaxPlayers >= 1) {
    nextDoc['show-max-players'] = Math.round(patch.showMaxPlayers);
  }
  if (typeof patch.onlineMode === 'boolean') nextDoc['online-mode'] = patch.onlineMode;
  if (patch.forwardingMode) {
    nextDoc['player-info-forwarding-mode'] = patch.forwardingMode;
    if (patch.forwardingMode === 'modern' || patch.forwardingMode === 'bungeeguard') {
      const secretFile =
        typeof nextDoc['forwarding-secret-file'] === 'string'
          ? nextDoc['forwarding-secret-file']
          : 'forwarding.secret';
      nextDoc['forwarding-secret-file'] = secretFile;
      await readOrEnsureForwardingSecret(serverDir, secretFile);
    }
  }

  if (Array.isArray(patch.servers)) {
    const nextServers: Record<string, unknown> = {};
    const validAliases = new Set<string>();
    for (const entry of patch.servers) {
      const alias = sanitizeServerAlias(entry.alias);
      const addr = entry.address.trim();
      if (!alias || !addr) continue;
      nextServers[alias] = addr;
      validAliases.add(alias);
    }
    const existingTry = Array.isArray((parsed.servers as Record<string, unknown> | undefined)?.try)
      ? ((parsed.servers as Record<string, unknown>).try as unknown[]).map((x) => String(x))
      : [];
    const desiredTry = Array.isArray(patch.tryOrder) ? patch.tryOrder : existingTry;
    nextServers.try = desiredTry.filter((a) => validAliases.has(a));
    nextDoc.servers = nextServers;
  } else if (Array.isArray(patch.tryOrder)) {
    const curServers = { ...((nextDoc.servers || {}) as Record<string, unknown>) };
    curServers.try = patch.tryOrder.filter((a) => typeof curServers[a] === 'string');
    nextDoc.servers = curServers;
  }

  if (patch.forcedHosts && typeof patch.forcedHosts === 'object') {
    const cleanHosts: Record<string, string[]> = {};
    for (const [host, targets] of Object.entries(patch.forcedHosts)) {
      const h = host.trim();
      if (!h) continue;
      const list = Array.isArray(targets) ? targets.map((t) => String(t).trim()).filter(Boolean) : [];
      if (list.length > 0) cleanHosts[h] = list;
    }
    nextDoc['forced-hosts'] = cleanHosts;
  }

  await atomicWriteFile(tomlPath, stringifyToml(nextDoc) + '\n');
  return getVelocityNetworkState(server);
}

export async function regenerateVelocitySecret(server: ServerConfig): Promise<VelocityNetworkState> {
  const serverDir = getServerDir(server.id);
  const { parsed } = await readVelocityTomlDoc(serverDir);
  const secretFile = typeof parsed['forwarding-secret-file'] === 'string' ? parsed['forwarding-secret-file'] : 'forwarding.secret';
  const full = path.join(serverDir, path.basename(secretFile) || 'forwarding.secret');
  await atomicWriteFile(full, generateForwardingSecret());
  return getVelocityNetworkState(server);
}

async function configureBackendForVelocity(
  targetServer: ServerConfig,
  forwardingMode: VelocityForwardingMode,
  secret: string,
): Promise<string[]> {
  const targetDir = getServerDir(targetServer.id);
  const notes: string[] = [];

  // 1. Set online-mode=false in backend server.properties
  const propsPath = path.join(targetDir, 'server.properties');
  if (fsSync.existsSync(propsPath)) {
    let raw = await fs.readFile(propsPath, 'utf8');
    if (/^online-mode=/m.test(raw)) {
      raw = raw.replace(/^online-mode=.*$/m, 'online-mode=false');
    } else {
      raw = `${raw.trimEnd()}\nonline-mode=false\n`;
    }
    await atomicWriteFile(propsPath, raw);
    notes.push('Set online-mode=false in server.properties');
  }

  // 2. Configure Paper / Purpur / Leaf / Folia velocity forwarding in config/paper-global.yml
  if (['paper', 'purpur', 'leaf', 'folia'].includes(targetServer.software) && forwardingMode === 'modern') {
    const paperGlobalPath = path.join(targetDir, 'config', 'paper-global.yml');
    await fs.mkdir(path.dirname(paperGlobalPath), { recursive: true });
    if (fsSync.existsSync(paperGlobalPath)) {
      try {
        const doc = YAML.parseDocument(await fs.readFile(paperGlobalPath, 'utf8'));
        doc.setIn(['proxies', 'velocity', 'enabled'], true);
        doc.setIn(['proxies', 'velocity', 'online-mode'], true);
        doc.setIn(['proxies', 'velocity', 'secret'], secret);
        await atomicWriteFile(paperGlobalPath, doc.toString());
        notes.push('Enabled Velocity modern forwarding + synced secret in config/paper-global.yml');
      } catch {
        // ignore malformed yaml
      }
    } else {
      const minimal = YAML.stringify({
        proxies: {
          velocity: {
            enabled: true,
            'online-mode': true,
            secret,
          },
        },
      });
      await atomicWriteFile(paperGlobalPath, minimal);
      notes.push('Created config/paper-global.yml with Velocity modern forwarding enabled');
    }
  } else if (forwardingMode === 'legacy' && ['paper', 'purpur', 'leaf', 'folia', 'spigot'].includes(targetServer.software)) {
    const spigotYmlPath = path.join(targetDir, 'spigot.yml');
    if (fsSync.existsSync(spigotYmlPath)) {
      try {
        const doc = YAML.parseDocument(await fs.readFile(spigotYmlPath, 'utf8'));
        doc.setIn(['settings', 'bungeecord'], true);
        await atomicWriteFile(spigotYmlPath, doc.toString());
        notes.push('Enabled settings.bungeecord=true in spigot.yml for legacy forwarding');
      } catch {
        // ignore
      }
    }
  }

  return notes;
}

export async function syncFloodgateKeyToBackend(
  velocityServer: ServerConfig,
  targetServerId: string,
): Promise<{ copiedTo: string }> {
  const target = store.getServer(targetServerId);
  if (!target) throw new Error('Target backend server not found');

  const velDir = getServerDir(velocityServer.id);
  const srcKey = path.join(velDir, 'plugins', 'floodgate', 'key.pem');
  if (!fsSync.existsSync(srcKey)) {
    throw new Error('Velocity does not have plugins/floodgate/key.pem yet. Install Floodgate on Velocity and start it once to generate key.pem.');
  }

  const targetSpec = getGeyserPlatformSpec(target.software);
  const destKey = path.join(getServerDir(target.id), ...targetSpec.floodgateKeyRel.split('/'));
  await fs.mkdir(path.dirname(destKey), { recursive: true });
  await fs.copyFile(srcKey, destKey);
  return { copiedTo: `${target.name}/${targetSpec.floodgateKeyRel}` };
}

export async function linkManagedBackendServer(
  velocityServer: ServerConfig,
  payload: {
    targetServerId: string;
    alias?: string;
    addToTry?: boolean;
    autoConfigureForwarding?: boolean;
    syncFloodgateKey?: boolean;
  },
): Promise<{ state: VelocityNetworkState; notes: string[] }> {
  const target = store.getServer(payload.targetServerId);
  if (!target) throw new Error('Managed backend server not found');
  if (target.software === 'velocity') throw new Error('Cannot link another Velocity proxy as a backend server');

  const velDir = getServerDir(velocityServer.id);
  await seedStarterVelocityFiles(velDir, velocityServer.port, velocityServer.name);

  const cur = await getVelocityNetworkState(velocityServer);
  const alias = sanitizeServerAlias(payload.alias || target.name);
  const address = `127.0.0.1:${target.port}`;

  const nextServers = cur.servers.filter((s) => s.alias !== alias && s.managedServerId !== target.id);
  nextServers.push({ alias, address, inTryOrder: payload.addToTry !== false });

  const nextTry = [...cur.tryOrder.filter((a) => nextServers.some((s) => s.alias === a))];
  if (payload.addToTry !== false && !nextTry.includes(alias)) {
    nextTry.push(alias);
  }

  await updateVelocitySettings(velocityServer, {
    servers: nextServers.map((s) => ({ alias: s.alias, address: s.address })),
    tryOrder: nextTry,
  });

  const notes: string[] = [`Linked "${alias}" → ${address} in velocity.toml`];

  if (payload.autoConfigureForwarding !== false) {
    const secret = await readOrEnsureForwardingSecret(velDir);
    const cfgNotes = await configureBackendForVelocity(target, cur.forwardingMode, secret);
    notes.push(...cfgNotes);
  }

  if (payload.syncFloodgateKey && cur.floodgateKeyAvailable) {
    const synced = await syncFloodgateKeyToBackend(velocityServer, target.id);
    notes.push(`Copied Floodgate key.pem to ${synced.copiedTo}`);
  }

  return {
    state: await getVelocityNetworkState(velocityServer),
    notes,
  };
}
