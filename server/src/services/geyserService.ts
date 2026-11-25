import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { getServerDir, USER_AGENT } from '../config.js';
import { store } from './store.js';
import { serverManager } from './serverManager.js';
import { atomicWriteFile } from '../utils/fsSafe.js';
import type {
  FloodgateConfigValues,
  GeyserConfigValues,
  GeyserInstallMode,
  GeyserStatusResponse,
  ServerConfig,
  ServerSoftware,
} from '../../../shared/types.js';

export interface GeyserPlatformSpec {
  mode: GeyserInstallMode;
  addonDir: string;
  geyserFilePattern: RegExp;
  geyserDefaultFile: string;
  geyserConfigRel: string;
  floodgateSupported: boolean;
  floodgateFilePattern: RegExp;
  floodgateDefaultFile: string;
  floodgateConfigRel: string;
  floodgateKeyRel: string;
  floodgateNote?: string;
}

export function getGeyserPlatformSpec(software: ServerSoftware): GeyserPlatformSpec {
  switch (software) {
    case 'paper':
    case 'purpur':
    case 'leaf':
    case 'folia':
    case 'spigot':
    case 'custom':
      return {
        mode: 'plugin',
        addonDir: 'plugins',
        geyserFilePattern: /^geyser.*\.jar$/i,
        geyserDefaultFile: 'Geyser-Spigot.jar',
        geyserConfigRel: 'plugins/Geyser-Spigot/config.yml',
        floodgateSupported: true,
        floodgateFilePattern: /^floodgate.*\.jar$/i,
        floodgateDefaultFile: 'floodgate-spigot.jar',
        floodgateConfigRel: 'plugins/floodgate/config.yml',
        floodgateKeyRel: 'plugins/floodgate/key.pem',
      };
    case 'velocity':
      return {
        mode: 'plugin',
        addonDir: 'plugins',
        geyserFilePattern: /^geyser.*\.jar$/i,
        geyserDefaultFile: 'Geyser-Velocity.jar',
        geyserConfigRel: 'plugins/Geyser-Velocity/config.yml',
        floodgateSupported: true,
        floodgateFilePattern: /^floodgate.*\.jar$/i,
        floodgateDefaultFile: 'floodgate-velocity.jar',
        floodgateConfigRel: 'plugins/floodgate/config.yml',
        floodgateKeyRel: 'plugins/floodgate/key.pem',
      };
    case 'fabric':
      return {
        mode: 'mod',
        addonDir: 'mods',
        geyserFilePattern: /^geyser.*\.jar$/i,
        geyserDefaultFile: 'Geyser-Fabric.jar',
        geyserConfigRel: 'config/Geyser-Fabric/config.yml',
        floodgateSupported: true,
        floodgateFilePattern: /^floodgate.*\.jar$/i,
        floodgateDefaultFile: 'floodgate-fabric.jar',
        floodgateConfigRel: 'config/floodgate/config.yml',
        floodgateKeyRel: 'config/floodgate/key.pem',
      };
    case 'neoforge':
      return {
        mode: 'mod',
        addonDir: 'mods',
        geyserFilePattern: /^geyser.*\.jar$/i,
        geyserDefaultFile: 'Geyser-NeoForge.jar',
        geyserConfigRel: 'config/Geyser-NeoForge/config.yml',
        floodgateSupported: true,
        floodgateFilePattern: /^floodgate.*\.jar$/i,
        floodgateDefaultFile: 'floodgate-neoforge.jar',
        floodgateConfigRel: 'config/floodgate/config.yml',
        floodgateKeyRel: 'config/floodgate/key.pem',
      };
    case 'vanilla':
    case 'forge':
    default:
      return {
        mode: 'standalone',
        addonDir: 'geyser-standalone',
        geyserFilePattern: /^geyser.*\.jar$/i,
        geyserDefaultFile: 'Geyser-Standalone.jar',
        geyserConfigRel: 'geyser-standalone/config.yml',
        floodgateSupported: false,
        floodgateFilePattern: /^floodgate.*\.jar$/i,
        floodgateDefaultFile: '',
        floodgateConfigRel: '',
        floodgateKeyRel: 'geyser-standalone/key.pem',
        floodgateNote:
          'Native Floodgate is not available directly on Vanilla/Forge. Bedrock players can join using Java Microsoft login (auth-type: online), offline mode (if online-mode=false), or by placing this server behind a Velocity proxy running Geyser + Floodgate.',
      };
  }
}

async function findMatchingJar(dirFull: string, pattern: RegExp): Promise<string | null> {
  if (!fsSync.existsSync(dirFull)) return null;
  const entries = await fs.readdir(dirFull, { withFileTypes: true }).catch(() => []);
  const found = entries.find((e) => e.isFile() && pattern.test(e.name));
  return found ? found.name : null;
}

function defaultGeyserConfig(server: ServerConfig, floodgateInstalled: boolean): GeyserConfigValues {
  return {
    bedrockPort: server.geyserBedrockPort || 19132,
    cloneRemotePort: false,
    motd1: server.name || 'MCServerManager',
    motd2: 'Bedrock Cross-Play via Geyser',
    serverName: server.name || 'MCServerManager',
    authType: floodgateInstalled ? 'floodgate' : 'online',
    remoteAddress: '127.0.0.1',
    remotePort: server.port || 25565,
  };
}

async function readGeyserConfigValues(
  serverDir: string,
  configRel: string,
  defaults: GeyserConfigValues,
): Promise<GeyserConfigValues> {
  const full = path.join(serverDir, ...configRel.split('/'));
  if (!fsSync.existsSync(full)) return defaults;
  try {
    const raw = await fs.readFile(full, 'utf8');
    const parsed = (YAML.parse(raw) || {}) as Record<string, unknown>;
    const bedrock = (parsed.bedrock || {}) as Record<string, unknown>;
    const remote = (parsed.remote || {}) as Record<string, unknown>;
    const rawAuth = String(remote['auth-type'] || parsed['auth-type'] || defaults.authType).toLowerCase();
    const authType: GeyserConfigValues['authType'] =
      rawAuth === 'floodgate' || rawAuth === 'offline' ? rawAuth : 'online';

    return {
      bedrockPort: Number(bedrock.port) || defaults.bedrockPort,
      cloneRemotePort: Boolean(bedrock['clone-remote-port']),
      motd1: typeof bedrock.motd1 === 'string' ? bedrock.motd1 : defaults.motd1,
      motd2: typeof bedrock.motd2 === 'string' ? bedrock.motd2 : defaults.motd2,
      serverName: typeof bedrock['server-name'] === 'string' ? bedrock['server-name'] : defaults.serverName,
      authType,
      remoteAddress: typeof remote.address === 'string' ? remote.address : defaults.remoteAddress,
      remotePort: Number(remote.port) || defaults.remotePort,
    };
  } catch {
    return defaults;
  }
}

async function writeGeyserConfigValues(
  serverDir: string,
  configRel: string,
  values: GeyserConfigValues,
  isStandalone: boolean,
): Promise<void> {
  const full = path.join(serverDir, ...configRel.split('/'));
  await fs.mkdir(path.dirname(full), { recursive: true });

  if (fsSync.existsSync(full)) {
    try {
      const raw = await fs.readFile(full, 'utf8');
      const doc = YAML.parseDocument(raw);
      doc.setIn(['bedrock', 'port'], values.bedrockPort);
      doc.setIn(['bedrock', 'clone-remote-port'], values.cloneRemotePort);
      doc.setIn(['bedrock', 'motd1'], values.motd1);
      doc.setIn(['bedrock', 'motd2'], values.motd2);
      doc.setIn(['bedrock', 'server-name'], values.serverName);
      doc.setIn(['remote', 'auth-type'], values.authType);
      if (isStandalone) {
        doc.setIn(['remote', 'address'], values.remoteAddress || '127.0.0.1');
        doc.setIn(['remote', 'port'], values.remotePort);
      } else {
        doc.setIn(['remote', 'address'], values.remoteAddress || 'auto');
        doc.setIn(['remote', 'port'], values.remotePort);
      }
      await atomicWriteFile(full, doc.toString());
      return;
    } catch {
      // fall through to clean config generation
    }
  }

  const starter = [
    '# Geyser Configuration (initialized by MCServerManager)',
    'bedrock:',
    '  address: 0.0.0.0',
    `  port: ${values.bedrockPort}`,
    `  clone-remote-port: ${values.cloneRemotePort}`,
    `  motd1: ${JSON.stringify(values.motd1)}`,
    `  motd2: ${JSON.stringify(values.motd2)}`,
    `  server-name: ${JSON.stringify(values.serverName)}`,
    'remote:',
    `  address: ${isStandalone ? values.remoteAddress || '127.0.0.1' : 'auto'}`,
    `  port: ${values.remotePort}`,
    `  auth-type: ${values.authType}`,
    'config-version: 4',
    '',
  ].join('\n');
  await atomicWriteFile(full, starter);
}

async function downloadBinary(url: string, destPath: string, expectedSha512?: string): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Failed to download ${url} (HTTP ${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024 || buf.length > 200 * 1024 * 1024) {
    throw new Error(`Downloaded file from ${url} appears invalid (${buf.length} bytes)`);
  }
  if (expectedSha512 && /^[a-fA-F0-9]{128}$/.test(expectedSha512)) {
    const actual = crypto.createHash('sha512').update(buf).digest('hex').toLowerCase();
    if (actual !== expectedSha512.toLowerCase()) {
      throw new Error(`SHA-512 checksum mismatch for ${path.basename(destPath)}`);
    }
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);
}

async function resolveModrinthPrimaryFile(
  projectSlug: string,
  loader: string,
  mcVersion?: string,
): Promise<{ url: string; fileName: string; sha512?: string } | null> {
  const tryFetch = async (withVersion: boolean) => {
    const params = new URLSearchParams({ loaders: JSON.stringify([loader]) });
    if (withVersion && mcVersion) {
      params.set('game_versions', JSON.stringify([mcVersion]));
    }
    const res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectSlug)}/version?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) return null;
    const versions = (await res.json()) as Array<{
      files?: Array<{ url: string; filename: string; primary?: boolean; hashes?: { sha512?: string } }>;
    }>;
    if (!Array.isArray(versions) || versions.length === 0) return null;
    const files = versions[0].files || [];
    const primary = files.find((f) => f.primary) || files[0];
    if (!primary) return null;
    const safeFileName = path.basename(primary.filename).replace(/[^a-zA-Z0-9._+-]/g, '_');
    return { url: primary.url, fileName: safeFileName, sha512: primary.hashes?.sha512 };
  };

  return (await tryFetch(true)) || (await tryFetch(false));
}

export function getGeyserStandaloneJarPath(serverId: string): string {
  return path.join(getServerDir(serverId), 'geyser-standalone', 'Geyser-Standalone.jar');
}

export function getGeyserStandaloneConfigPath(serverId: string): string {
  return path.join(getServerDir(serverId), 'geyser-standalone', 'config.yml');
}

function defaultFloodgateConfig(server: ServerConfig): FloodgateConfigValues {
  return {
    usernamePrefix: '.',
    replaceSpaces: true,
    defaultLocale: 'en_US',
    sendFloodgateData: server.software === 'velocity',
    playerLinkEnabled: true,
    requireLinking: false,
    enableOwnLinking: true,
    enableGlobalLinking: true,
  };
}

async function readFloodgateConfigValues(
  serverDir: string,
  configRel: string,
  defaults: FloodgateConfigValues,
): Promise<FloodgateConfigValues> {
  if (!configRel) return defaults;
  const full = path.join(serverDir, ...configRel.split('/'));
  if (!fsSync.existsSync(full)) return defaults;
  try {
    const raw = await fs.readFile(full, 'utf8');
    const parsed = (YAML.parse(raw) || {}) as Record<string, unknown>;
    const link = (parsed['player-link'] || {}) as Record<string, unknown>;
    return {
      usernamePrefix: typeof parsed['username-prefix'] === 'string' ? parsed['username-prefix'] : defaults.usernamePrefix,
      replaceSpaces: typeof parsed['replace-spaces'] === 'boolean' ? parsed['replace-spaces'] : defaults.replaceSpaces,
      defaultLocale: typeof parsed['default-locale'] === 'string' ? parsed['default-locale'] : defaults.defaultLocale,
      sendFloodgateData:
        typeof parsed['send-floodgate-data'] === 'boolean' ? parsed['send-floodgate-data'] : defaults.sendFloodgateData,
      playerLinkEnabled: typeof link.enabled === 'boolean' ? link.enabled : defaults.playerLinkEnabled,
      requireLinking: typeof link['require-linking'] === 'boolean' ? link['require-linking'] : defaults.requireLinking,
      enableOwnLinking:
        typeof link['enable-own-linking'] === 'boolean' ? link['enable-own-linking'] : defaults.enableOwnLinking,
      enableGlobalLinking:
        typeof link['enable-global-linking'] === 'boolean' ? link['enable-global-linking'] : defaults.enableGlobalLinking,
    };
  } catch {
    return defaults;
  }
}

async function writeFloodgateConfigValues(
  serverDir: string,
  configRel: string,
  values: FloodgateConfigValues,
): Promise<void> {
  const full = path.join(serverDir, ...configRel.split('/'));
  await fs.mkdir(path.dirname(full), { recursive: true });

  if (fsSync.existsSync(full)) {
    try {
      const raw = await fs.readFile(full, 'utf8');
      const doc = YAML.parseDocument(raw);
      doc.setIn(['username-prefix'], values.usernamePrefix);
      doc.setIn(['replace-spaces'], values.replaceSpaces);
      doc.setIn(['default-locale'], values.defaultLocale);
      doc.setIn(['send-floodgate-data'], values.sendFloodgateData);
      doc.setIn(['player-link', 'enabled'], values.playerLinkEnabled);
      doc.setIn(['player-link', 'require-linking'], values.requireLinking);
      doc.setIn(['player-link', 'enable-own-linking'], values.enableOwnLinking);
      doc.setIn(['player-link', 'enable-global-linking'], values.enableGlobalLinking);
      await atomicWriteFile(full, doc.toString());
      return;
    } catch {
      // fall through to starter yaml
    }
  }

  const starter = [
    '# Floodgate Configuration (initialized by MCServerManager)',
    'key-file-name: key.pem',
    `username-prefix: ${JSON.stringify(values.usernamePrefix)}`,
    `replace-spaces: ${values.replaceSpaces}`,
    `default-locale: ${values.defaultLocale}`,
    `send-floodgate-data: ${values.sendFloodgateData}`,
    'player-link:',
    '  initialize: true',
    `  enabled: ${values.playerLinkEnabled}`,
    `  require-linking: ${values.requireLinking}`,
    `  enable-own-linking: ${values.enableOwnLinking}`,
    `  enable-global-linking: ${values.enableGlobalLinking}`,
    'config-version: 4',
    '',
  ].join('\n');
  await atomicWriteFile(full, starter);
}

export async function getGeyserStatus(server: ServerConfig): Promise<GeyserStatusResponse> {
  const spec = getGeyserPlatformSpec(server.software);
  const serverDir = getServerDir(server.id);
  const addonDirFull = path.join(serverDir, spec.addonDir);

  const geyserFileName = await findMatchingJar(addonDirFull, spec.geyserFilePattern);
  const floodgateFileName = spec.floodgateSupported
    ? await findMatchingJar(addonDirFull, spec.floodgateFilePattern)
    : null;
  const geyserConfigFull = path.join(serverDir, ...spec.geyserConfigRel.split('/'));
  const floodgateConfigFull = spec.floodgateConfigRel
    ? path.join(serverDir, ...spec.floodgateConfigRel.split('/'))
    : '';
  const floodgateKeyFull = path.join(serverDir, ...spec.floodgateKeyRel.split('/'));

  const defaults = defaultGeyserConfig(server, Boolean(floodgateFileName));
  const config = await readGeyserConfigValues(serverDir, spec.geyserConfigRel, defaults);
  const floodgateConfig = spec.floodgateSupported
    ? await readFloodgateConfigValues(serverDir, spec.floodgateConfigRel, defaultFloodgateConfig(server))
    : null;

  const pendingSet = new Set(
    (server.pendingAddonDeletions || []).map((p) => p.fileName.toLowerCase()),
  );

  return {
    software: server.software,
    installMode: spec.mode,
    geyserInstalled: Boolean(geyserFileName),
    geyserFileName,
    geyserConfigPath: fsSync.existsSync(geyserConfigFull) ? spec.geyserConfigRel : null,
    geyserPendingDeletion: Boolean(geyserFileName && pendingSet.has(geyserFileName.toLowerCase())),
    floodgateSupported: spec.floodgateSupported,
    floodgateInstalled: Boolean(floodgateFileName),
    floodgateFileName,
    floodgateConfigPath:
      spec.floodgateSupported && floodgateConfigFull && fsSync.existsSync(floodgateConfigFull)
        ? spec.floodgateConfigRel
        : null,
    floodgatePendingDeletion: Boolean(floodgateFileName && pendingSet.has(floodgateFileName.toLowerCase())),
    floodgateKeyExists: fsSync.existsSync(floodgateKeyFull),
    floodgateNote: spec.floodgateNote,
    floodgateConfig,
    standaloneEnabled: spec.mode === 'standalone' && Boolean(server.geyserStandaloneEnabled),
    standaloneRunning: spec.mode === 'standalone' && serverManager.isGeyserStandaloneRunning(server.id),
    config,
  };
}

export async function installGeyser(server: ServerConfig): Promise<GeyserStatusResponse> {
  const spec = getGeyserPlatformSpec(server.software);
  const serverDir = getServerDir(server.id);
  const addonDirFull = path.join(serverDir, spec.addonDir);
  await fs.mkdir(addonDirFull, { recursive: true });

  // Remove any older Geyser jar first
  const existing = await findMatchingJar(addonDirFull, spec.geyserFilePattern);
  if (existing && existing !== spec.geyserDefaultFile) {
    await fs.rm(path.join(addonDirFull, existing), { force: true }).catch(() => {});
  }

  let targetFile = spec.geyserDefaultFile;
  if (spec.mode === 'plugin') {
    const apiTarget = server.software === 'velocity' ? 'velocity' : 'spigot';
    const url = `https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/${apiTarget}`;
    await downloadBinary(url, path.join(addonDirFull, targetFile));
  } else if (spec.mode === 'mod') {
    const loader = server.software === 'neoforge' ? 'neoforge' : 'fabric';
    const modrinth = await resolveModrinthPrimaryFile('geyser', loader, server.mcVersion);
    if (modrinth) {
      targetFile = modrinth.fileName;
      await downloadBinary(modrinth.url, path.join(addonDirFull, targetFile), modrinth.sha512);
    } else {
      const url = `https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/${loader}`;
      await downloadBinary(url, path.join(addonDirFull, targetFile));
    }
  } else {
    // Standalone sidecar (Vanilla / Forge)
    const url = 'https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/standalone';
    await downloadBinary(url, path.join(addonDirFull, targetFile));
    server.geyserStandaloneEnabled = true;
    if (!server.geyserBedrockPort) server.geyserBedrockPort = 19132;
    store.upsertServer(server);
  }

  // Ensure initial config.yml is seeded/synced with server port & floodgate auth
  const floodgatePresent = spec.floodgateSupported && Boolean(await findMatchingJar(addonDirFull, spec.floodgateFilePattern));
  const defaults = defaultGeyserConfig(server, floodgatePresent);
  const current = await readGeyserConfigValues(serverDir, spec.geyserConfigRel, defaults);
  if (spec.mode === 'standalone') {
    current.remoteAddress = '127.0.0.1';
    current.remotePort = server.port;
  }
  await writeGeyserConfigValues(serverDir, spec.geyserConfigRel, current, spec.mode === 'standalone');
  unqueuePendingDeletion(server, targetFile);
  if (existing) unqueuePendingDeletion(server, existing);

  return getGeyserStatus(server);
}

function isFileLockError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

function queuePendingDeletion(server: ServerConfig, fileName: string): void {
  const list = server.pendingAddonDeletions || [];
  if (!list.some((p) => p.fileName.toLowerCase() === fileName.toLowerCase())) {
    server.pendingAddonDeletions = [...list, { fileName, deleteConfigs: false }];
    store.upsertServer(server);
  }
}

function unqueuePendingDeletion(server: ServerConfig, fileName: string): void {
  const list = server.pendingAddonDeletions || [];
  const next = list.filter((p) => p.fileName.toLowerCase() !== fileName.toLowerCase());
  if (next.length !== list.length) {
    server.pendingAddonDeletions = next;
    store.upsertServer(server);
  }
}

export async function uninstallGeyser(server: ServerConfig): Promise<GeyserStatusResponse> {
  const spec = getGeyserPlatformSpec(server.software);
  const serverDir = getServerDir(server.id);
  const addonDirFull = path.join(serverDir, spec.addonDir);
  if (spec.mode === 'standalone') {
    await serverManager.stopGeyserStandalone(server.id);
    server.geyserStandaloneEnabled = false;
    store.upsertServer(server);
  }
  const existing = await findMatchingJar(addonDirFull, spec.geyserFilePattern);
  if (existing) {
    const full = path.join(addonDirFull, existing);
    if (spec.mode !== 'standalone' && serverManager.isRunning(server.id)) {
      queuePendingDeletion(server, existing);
    } else {
      try {
        await fs.rm(full, { force: true });
        unqueuePendingDeletion(server, existing);
      } catch (err) {
        if (isFileLockError(err)) {
          queuePendingDeletion(server, existing);
        } else {
          throw err;
        }
      }
    }
  }
  return getGeyserStatus(server);
}

export async function installFloodgate(server: ServerConfig): Promise<GeyserStatusResponse> {
  const spec = getGeyserPlatformSpec(server.software);
  if (!spec.floodgateSupported) {
    throw new Error(spec.floodgateNote || `Floodgate is not natively supported on ${server.software}.`);
  }
  const serverDir = getServerDir(server.id);
  const addonDirFull = path.join(serverDir, spec.addonDir);
  await fs.mkdir(addonDirFull, { recursive: true });

  const existing = await findMatchingJar(addonDirFull, spec.floodgateFilePattern);
  if (existing) {
    await fs.rm(path.join(addonDirFull, existing), { force: true }).catch(() => {});
  }

  if (spec.mode === 'plugin') {
    const apiTarget = server.software === 'velocity' ? 'velocity' : 'spigot';
    const url = `https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/${apiTarget}`;
    await downloadBinary(url, path.join(addonDirFull, spec.floodgateDefaultFile));
  } else {
    const loader = server.software === 'neoforge' ? 'neoforge' : 'fabric';
    const modrinth = await resolveModrinthPrimaryFile('floodgate', loader, server.mcVersion);
    if (!modrinth) {
      throw new Error(`Could not find a Floodgate build for ${loader} on Modrinth.`);
    }
    await downloadBinary(modrinth.url, path.join(addonDirFull, modrinth.fileName), modrinth.sha512);
  }

  // Switch Geyser auth-type to floodgate if Geyser config exists
  const geyserConfigFull = path.join(serverDir, ...spec.geyserConfigRel.split('/'));
  if (fsSync.existsSync(geyserConfigFull)) {
    const defaults = defaultGeyserConfig(server, true);
    const current = await readGeyserConfigValues(serverDir, spec.geyserConfigRel, defaults);
    current.authType = 'floodgate';
    await writeGeyserConfigValues(serverDir, spec.geyserConfigRel, current, false);
  }
  if (existing) unqueuePendingDeletion(server, existing);
  const installedFg = await findMatchingJar(addonDirFull, spec.floodgateFilePattern);
  if (installedFg) unqueuePendingDeletion(server, installedFg);

  return getGeyserStatus(server);
}

export async function uninstallFloodgate(server: ServerConfig): Promise<GeyserStatusResponse> {
  const spec = getGeyserPlatformSpec(server.software);
  const serverDir = getServerDir(server.id);
  const addonDirFull = path.join(serverDir, spec.addonDir);
  const existing = await findMatchingJar(addonDirFull, spec.floodgateFilePattern);
  if (existing) {
    const full = path.join(addonDirFull, existing);
    if (serverManager.isRunning(server.id)) {
      queuePendingDeletion(server, existing);
    } else {
      try {
        await fs.rm(full, { force: true });
        unqueuePendingDeletion(server, existing);
      } catch (err) {
        if (isFileLockError(err)) {
          queuePendingDeletion(server, existing);
        } else {
          throw err;
        }
      }
    }
  }

  // Revert Geyser auth-type back to online if it was set to floodgate
  const geyserConfigFull = path.join(serverDir, ...spec.geyserConfigRel.split('/'));
  if (fsSync.existsSync(geyserConfigFull)) {
    const defaults = defaultGeyserConfig(server, false);
    const current = await readGeyserConfigValues(serverDir, spec.geyserConfigRel, defaults);
    if (current.authType === 'floodgate') {
      current.authType = 'online';
      await writeGeyserConfigValues(serverDir, spec.geyserConfigRel, current, spec.mode === 'standalone');
    }
  }

  return getGeyserStatus(server);
}

export async function cancelPendingGeyserUninstall(
  server: ServerConfig,
  target: 'geyser' | 'floodgate',
): Promise<GeyserStatusResponse> {
  const spec = getGeyserPlatformSpec(server.software);
  const serverDir = getServerDir(server.id);
  const addonDirFull = path.join(serverDir, spec.addonDir);
  const pattern = target === 'geyser' ? spec.geyserFilePattern : spec.floodgateFilePattern;
  const existing = await findMatchingJar(addonDirFull, pattern);
  if (existing) {
    unqueuePendingDeletion(server, existing);
  }
  return getGeyserStatus(server);
}

export async function updateGeyserConfig(
  server: ServerConfig,
  patch: Partial<GeyserConfigValues> & { standaloneEnabled?: boolean },
): Promise<GeyserStatusResponse> {
  const spec = getGeyserPlatformSpec(server.software);
  const serverDir = getServerDir(server.id);
  const addonDirFull = path.join(serverDir, spec.addonDir);
  const floodgatePresent = spec.floodgateSupported && Boolean(await findMatchingJar(addonDirFull, spec.floodgateFilePattern));
  const defaults = defaultGeyserConfig(server, floodgatePresent);
  const current = await readGeyserConfigValues(serverDir, spec.geyserConfigRel, defaults);

  const next: GeyserConfigValues = {
    bedrockPort:
      typeof patch.bedrockPort === 'number' && patch.bedrockPort >= 1024 && patch.bedrockPort <= 65535
        ? Math.round(patch.bedrockPort)
        : current.bedrockPort,
    cloneRemotePort: typeof patch.cloneRemotePort === 'boolean' ? patch.cloneRemotePort : current.cloneRemotePort,
    motd1: typeof patch.motd1 === 'string' ? patch.motd1 : current.motd1,
    motd2: typeof patch.motd2 === 'string' ? patch.motd2 : current.motd2,
    serverName: typeof patch.serverName === 'string' ? patch.serverName : current.serverName,
    authType:
      patch.authType === 'floodgate' || patch.authType === 'online' || patch.authType === 'offline'
        ? patch.authType
        : current.authType,
    remoteAddress:
      typeof patch.remoteAddress === 'string' && patch.remoteAddress.trim()
        ? patch.remoteAddress.trim()
        : current.remoteAddress,
    remotePort:
      typeof patch.remotePort === 'number' && patch.remotePort >= 1024 && patch.remotePort <= 65535
        ? Math.round(patch.remotePort)
        : current.remotePort,
  };

  await writeGeyserConfigValues(serverDir, spec.geyserConfigRel, next, spec.mode === 'standalone');

  let dirty = false;
  if (server.geyserBedrockPort !== next.bedrockPort) {
    server.geyserBedrockPort = next.bedrockPort;
    dirty = true;
  }
  if (spec.mode === 'standalone' && typeof patch.standaloneEnabled === 'boolean') {
    server.geyserStandaloneEnabled = patch.standaloneEnabled;
    dirty = true;
    if (!patch.standaloneEnabled) {
      await serverManager.stopGeyserStandalone(server.id);
    }
  }
  if (dirty) {
    store.upsertServer(server);
  }

  return getGeyserStatus(server);
}

export async function updateFloodgateConfig(
  server: ServerConfig,
  patch: Partial<FloodgateConfigValues>,
): Promise<GeyserStatusResponse> {
  const spec = getGeyserPlatformSpec(server.software);
  if (!spec.floodgateSupported || !spec.floodgateConfigRel) {
    throw new Error(spec.floodgateNote || `Floodgate is not natively supported on ${server.software}.`);
  }
  const serverDir = getServerDir(server.id);
  const defaults = defaultFloodgateConfig(server);
  const current = await readFloodgateConfigValues(serverDir, spec.floodgateConfigRel, defaults);

  const next: FloodgateConfigValues = {
    usernamePrefix: typeof patch.usernamePrefix === 'string' ? patch.usernamePrefix.slice(0, 16) : current.usernamePrefix,
    replaceSpaces: typeof patch.replaceSpaces === 'boolean' ? patch.replaceSpaces : current.replaceSpaces,
    defaultLocale:
      typeof patch.defaultLocale === 'string' && patch.defaultLocale.trim()
        ? patch.defaultLocale.trim()
        : current.defaultLocale,
    sendFloodgateData:
      typeof patch.sendFloodgateData === 'boolean' ? patch.sendFloodgateData : current.sendFloodgateData,
    playerLinkEnabled:
      typeof patch.playerLinkEnabled === 'boolean' ? patch.playerLinkEnabled : current.playerLinkEnabled,
    requireLinking: typeof patch.requireLinking === 'boolean' ? patch.requireLinking : current.requireLinking,
    enableOwnLinking:
      typeof patch.enableOwnLinking === 'boolean' ? patch.enableOwnLinking : current.enableOwnLinking,
    enableGlobalLinking:
      typeof patch.enableGlobalLinking === 'boolean' ? patch.enableGlobalLinking : current.enableGlobalLinking,
  };

  await writeFloodgateConfigValues(serverDir, spec.floodgateConfigRel, next);
  return getGeyserStatus(server);
}
