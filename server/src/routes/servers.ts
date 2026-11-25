import { Router } from 'express';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { getServerDir } from '../config.js';
import { store } from '../services/store.js';
import {
  serverManager,
  validateCustomJvmArgs,
  validateServerJarFile,
} from '../services/serverManager.js';
import { validateAndResolveJavaPath } from '../services/javaService.js';
import { installServerSoftware } from '../services/catalogService.js';
import { installBridgePlugin, supportsBridgePlugin, uninstallBridgePlugin } from '../services/bridgeService.js';
import { readVelocityBindPort, seedStarterVelocityFiles, syncVelocityBindPort } from '../services/velocityService.js';
import {
  inspectExistingServerFolder,
  pickLocalFolderDialog,
  transferServerFolder,
} from '../services/importService.js';
import { isLoopbackAddress, requireAuth, requirePermission } from '../services/authService.js';
import { atomicWriteFile, getDirectorySize } from '../utils/fsSafe.js';
import type { JvmPreset, ServerConfig, ServerSoftware, ServerSummary, UserAccount } from '../../../shared/types.js';

export const serversRouter = Router();

function canUserViewSettings(user?: UserAccount | null): boolean {
  if (!user) return false;
  return user.role === 'owner' || user.permissions.includes('settings');
}

function assertLocalOwnerForImport(req: { socket: { remoteAddress?: string }; user?: UserAccount | null }): void {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    throw new Error('Local folder import is restricted to localhost connections');
  }
  if (!req.user || req.user.role !== 'owner') {
    throw new Error('Only the owner account can import local filesystem folders');
  }
}

const DEFAULT_START_PORT = 25560;
const SKIPPED_SCANNER_PORT = 25565;

function getNextAvailablePort(): number {
  const used = new Set(store.getServers().map((s) => s.port));
  let port = DEFAULT_START_PORT;
  while (port <= 65535) {
    if (port !== SKIPPED_SCANNER_PORT && !used.has(port)) {
      return port;
    }
    port++;
  }
  return DEFAULT_START_PORT;
}

function makeServerId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${slug || 'server'}-${crypto.randomBytes(3).toString('hex')}`;
}

async function buildSummary(
  srv: ServerConfig,
  includeDiskSize = false,
  canViewSettings = true,
): Promise<ServerSummary> {
  const dir = getServerDir(srv.id);
  if (srv.software === 'velocity' && fsSync.existsSync(dir)) {
    const tomlPort = await readVelocityBindPort(dir);
    if (tomlPort !== null && tomlPort !== srv.port) {
      srv.port = tomlPort;
      store.upsertServer(srv);
    }
  }
  const diskSizeBytes = includeDiskSize && fsSync.existsSync(dir) ? await getDirectorySize(dir, 7) : undefined;
  const { bridgeToken: _omitBridgeToken, ...publicConfig } = srv;
  return {
    ...publicConfig,
    javaPath: canViewSettings ? srv.javaPath : 'auto',
    bridgePort: canViewSettings ? srv.bridgePort : undefined,
    directory: canViewSettings ? dir : srv.id,
    runtime: serverManager.getRuntime(srv.id),
    diskSizeBytes,
  };
}

serversRouter.get('/host/stats', requireAuth, (_req, res) => {
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
  const freeMemMb = Math.round(os.freemem() / (1024 * 1024));
  const cpus = os.cpus();
  res.json({
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    cpuModel: cpus[0]?.model || 'CPU',
    cpuCores: cpus.length,
    totalMemMb,
    usedMemMb: totalMemMb - freeMemMb,
    freeMemMb,
    uptimeSeconds: Math.floor(os.uptime()),
  });
});

serversRouter.get('/next-port', requireAuth, (_req, res) => {
  res.json({ port: getNextAvailablePort() });
});

serversRouter.get('/', requireAuth, async (req, res) => {
  const viewSettings = canUserViewSettings(req.user);
  const summaries = await Promise.all(store.getServers().map((s) => buildSummary(s, false, viewSettings)));
  res.json(summaries);
});

serversRouter.post('/import/pick-folder', requirePermission('settings'), async (req, res) => {
  try {
    assertLocalOwnerForImport(req);
    const selectedPath = await pickLocalFolderDialog();
    res.json({ path: selectedPath });
  } catch (err) {
    res.status(403).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

serversRouter.post('/import/inspect', requirePermission('settings'), async (req, res) => {
  const sourcePath = String((req.body as { sourcePath?: string }).sourcePath || '');
  try {
    assertLocalOwnerForImport(req);
    const info = await inspectExistingServerFolder(sourcePath);
    res.json(info);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

serversRouter.post('/import', requirePermission('settings'), async (req, res) => {
  const body = req.body as {
    sourcePath?: string;
    transferMode?: 'move' | 'copy';
    name?: string;
    software?: ServerSoftware;
    mcVersion?: string;
    jarFile?: string;
    port?: number;
    minRamMb?: number;
    maxRamMb?: number;
    javaPath?: string;
    jvmPreset?: JvmPreset;
    installBridge?: boolean;
  };

  if (!body.sourcePath?.trim()) {
    res.status(400).json({ error: 'sourcePath is required' });
    return;
  }

  try {
    assertLocalOwnerForImport(req);
    const inspected = await inspectExistingServerFolder(body.sourcePath);
    const name = (body.name || inspected.suggestedName).trim();
    const software: ServerSoftware = body.software || inspected.software;
    const mcVersion = (body.mcVersion || inspected.mcVersion).trim();
    const rawJarFile = (body.jarFile || inspected.jarFile).trim() || 'server.jar';
    const port = Math.min(65535, Math.max(1024, Number(body.port) || inspected.port || 25565));
    const minRamMb = Math.max(256, Number(body.minRamMb) || 1024);
    const maxRamMb = Math.max(minRamMb, Number(body.maxRamMb) || 4096);
    const transferMode = body.transferMode === 'move' ? 'move' : 'copy';
    const validatedJavaPath = await validateAndResolveJavaPath(body.javaPath || 'auto');

    const id = makeServerId(name);
    const destDir = getServerDir(id);
    const jarFile = validateServerJarFile(destDir, rawJarFile);
    await transferServerFolder(inspected.sourcePath, destDir, transferMode);

    const shouldInstallBridge =
      body.installBridge !== false &&
      (inspected.isSpigotCompatible || supportsBridgePlugin(software));

    const server: ServerConfig = {
      id,
      name,
      software,
      mcVersion,
      jarFile,
      port,
      minRamMb,
      maxRamMb,
      javaPath: validatedJavaPath,
      jvmPreset: body.jvmPreset || 'aikar',
      customJvmArgs: '',
      autoStart: false,
      autoRestart: false,
      maxRestartAttempts: 3,
      stopCommand: software === 'velocity' ? 'end' : 'stop',
      eulaAccepted: inspected.eulaAccepted,
      bridgeEnabled: shouldInstallBridge,
      createdAt: new Date().toISOString(),
    };

    store.upsertServer(server);

    if (software === 'velocity') {
      await syncVelocityBindPort(destDir, port).catch(() => {});
    }

    if (shouldInstallBridge) {
      await installBridgePlugin(server).catch(() => {});
    }

    res.status(201).json(await buildSummary(server, true, true));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

serversRouter.get('/:id', requireAuth, async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  res.json(await buildSummary(srv, true, canUserViewSettings(req.user)));
});

serversRouter.post('/', requirePermission('settings'), async (req, res) => {
  const body = req.body as {
    name?: string;
    software?: ServerSoftware;
    mcVersion?: string;
    port?: number;
    minRamMb?: number;
    maxRamMb?: number;
    javaPath?: string;
    jvmPreset?: JvmPreset;
    eulaAccepted?: boolean;
    autoStart?: boolean;
    motd?: string;
    skipDownload?: boolean;
  };

  const name = (body.name || '').trim();
  if (!name) {
    res.status(400).json({ error: 'Server name is required' });
    return;
  }

  const software: ServerSoftware = body.software || 'paper';
  const mcVersion = (body.mcVersion || '1.21.4').trim();
  const port = Math.min(65535, Math.max(1024, Number(body.port) || getNextAvailablePort()));
  const minRamMb = Math.max(256, Number(body.minRamMb) || 1024);
  const maxRamMb = Math.max(minRamMb, Number(body.maxRamMb) || 2048);

  let validatedJavaPath = 'auto';
  try {
    validatedJavaPath = await validateAndResolveJavaPath(body.javaPath || 'auto');
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const id = makeServerId(name);
  const serverDir = getServerDir(id);
  await fs.mkdir(serverDir, { recursive: true });

  const server: ServerConfig = {
    id,
    name,
    software,
    mcVersion,
    jarFile: 'server.jar',
    port,
    minRamMb,
    maxRamMb,
    javaPath: validatedJavaPath,
    jvmPreset: body.jvmPreset || 'aikar',
    customJvmArgs: '',
    autoStart: Boolean(body.autoStart),
    autoRestart: false,
    maxRestartAttempts: 3,
    stopCommand: software === 'velocity' ? 'end' : 'stop',
    eulaAccepted: body.eulaAccepted !== false,
    bridgeEnabled: supportsBridgePlugin(software),
    createdAt: new Date().toISOString(),
  };

  // Seed initial server.properties & eula.txt right away so the user can configure before first launch!
  if (software !== 'velocity') {
    const platformLabelMap: Record<ServerSoftware, string> = {
      paper: 'Paper',
      purpur: 'Purpur',
      leaf: 'Leaf',
      spigot: 'Spigot',
      folia: 'Folia',
      vanilla: 'Vanilla',
      fabric: 'Fabric',
      neoforge: 'NeoForge',
      forge: 'Forge',
      velocity: 'Velocity',
      custom: 'Custom',
    };
    const defaultMotd = `${mcVersion} ${platformLabelMap[software] || software} server`;
    const motd = (body.motd || defaultMotd).replace(/\r?\n/g, ' ');
    const starterProps = [
      '# Minecraft server properties (initialized by MCServerManager)',
      `motd=${motd}`,
      `server-port=${port}`,
      'max-players=20',
      'gamemode=survival',
      'difficulty=normal',
      'pvp=true',
      'online-mode=true',
      'white-list=false',
      'enforce-whitelist=false',
      'allow-flight=false',
      'allow-nether=true',
      'enable-command-block=false',
      'spawn-protection=16',
      'view-distance=10',
      'simulation-distance=10',
      'level-name=world',
      'level-seed=',
      'level-type=minecraft\\:normal',
      'generate-structures=true',
      '',
    ].join('\n');
    await atomicWriteFile(path.join(serverDir, 'server.properties'), starterProps);
    await atomicWriteFile(
      path.join(serverDir, 'eula.txt'),
      `# By changing the setting below to TRUE you are indicating your agreement to Minecraft EULA (https://aka.ms/MinecraftEULA).\neula=${server.eulaAccepted ? 'true' : 'false'}\n`,
    );
    await atomicWriteFile(path.join(serverDir, 'whitelist.json'), '[]\n');
    await atomicWriteFile(path.join(serverDir, 'ops.json'), '[]\n');
    await atomicWriteFile(path.join(serverDir, 'banned-players.json'), '[]\n');
    await atomicWriteFile(path.join(serverDir, 'banned-ips.json'), '[]\n');
  } else {
    await seedStarterVelocityFiles(serverDir, port, name, body.motd || 'A Velocity proxy');
  }

  store.upsertServer(server);

  // Automatically install the companion management bridge plugin/mod for all supported platforms
  if (server.bridgeEnabled && supportsBridgePlugin(software)) {
    await installBridgePlugin(server).catch(() => {});
  }

  if (body.skipDownload || software === 'custom' || software === 'spigot') {
    res.status(201).json(await buildSummary(server, false));
    return;
  }

  // Kick off software download/installation asynchronously while returning 201 immediately
  serverManager.setInstallProgress(id, {
    stage: 'downloading',
    percent: 2,
    message: `Preparing ${software} ${mcVersion}...`,
  });

  res.status(201).json(await buildSummary(server, false));

  installServerSoftware(
    serverDir,
    software,
    mcVersion,
    server.javaPath,
    (percent, message) => {
      serverManager.setInstallProgress(id, { stage: 'installing', percent, message });
    },
    (line, stream) => {
      serverManager.appendInstallLog(id, line, stream);
    },
  )
    .then((result) => {
      const current = store.getServer(id);
      if (current) {
        current.jarFile = result.jarFile;
        current.build = result.build;
        store.upsertServer(current);
      }
      serverManager.setInstallProgress(id, null);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[CreateServer] Failed to install ${software} ${mcVersion}:`, err);
      serverManager.appendInstallLog(id, `Installation failed: ${msg}`, 'stderr');
      serverManager.setInstallProgress(id, {
        stage: 'error',
        percent: 0,
        message: msg,
      });
      setTimeout(() => serverManager.setInstallProgress(id, null), 12000);
    });
});

serversRouter.patch('/:id', requirePermission('settings'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const updates = req.body as Partial<ServerConfig>;
  if (typeof updates.name === 'string' && updates.name.trim()) srv.name = updates.name.trim();
  if (typeof updates.port === 'number' && updates.port >= 1024 && updates.port <= 65535) {
    srv.port = updates.port;
    if (srv.software === 'velocity') {
      await syncVelocityBindPort(getServerDir(srv.id), srv.port).catch(() => {});
    } else {
      // Keep server.properties port synchronized
      const propsPath = path.join(getServerDir(srv.id), 'server.properties');
      if (fsSync.existsSync(propsPath)) {
        try {
          let raw = await fs.readFile(propsPath, 'utf8');
          if (/^server-port=/m.test(raw)) {
            raw = raw.replace(/^server-port=.*$/m, `server-port=${srv.port}`);
          } else {
            raw = `${raw.trimEnd()}\nserver-port=${srv.port}\n`;
          }
          await atomicWriteFile(propsPath, raw);
        } catch {
          // ignore
        }
      }
    }
  }
  if (typeof updates.minRamMb === 'number' && updates.minRamMb >= 256) srv.minRamMb = Math.round(updates.minRamMb);
  if (typeof updates.maxRamMb === 'number' && updates.maxRamMb >= srv.minRamMb) srv.maxRamMb = Math.round(updates.maxRamMb);
  try {
    if (typeof updates.javaPath === 'string') {
      srv.javaPath = await validateAndResolveJavaPath(updates.javaPath);
    }
    if (updates.jvmPreset) srv.jvmPreset = updates.jvmPreset;
    if (typeof updates.customJvmArgs === 'string') {
      validateCustomJvmArgs(updates.customJvmArgs);
      srv.customJvmArgs = updates.customJvmArgs.trim();
    }
    if (typeof updates.jarFile === 'string' && updates.jarFile.trim()) {
      srv.jarFile = validateServerJarFile(getServerDir(srv.id), updates.jarFile);
    }
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  if (typeof updates.autoStart === 'boolean') srv.autoStart = updates.autoStart;
  if (typeof updates.autoRestart === 'boolean') srv.autoRestart = updates.autoRestart;
  if (typeof updates.maxRestartAttempts === 'number') srv.maxRestartAttempts = Math.min(10, Math.max(1, updates.maxRestartAttempts));
  if (typeof updates.stopCommand === 'string' && updates.stopCommand.trim()) {
    srv.stopCommand = updates.stopCommand.replace(/[\r\n\0]+/g, ' ').trim();
  }
  if (typeof updates.eulaAccepted === 'boolean') {
    srv.eulaAccepted = updates.eulaAccepted;
    if (srv.software !== 'velocity') {
      await atomicWriteFile(
        path.join(getServerDir(srv.id), 'eula.txt'),
        `# Updated via MCServerManager\neula=${srv.eulaAccepted ? 'true' : 'false'}\n`,
      ).catch(() => {});
    }
  }

  store.upsertServer(srv);
  res.json(await buildSummary(srv, false));
});

serversRouter.post('/:id/reinstall', requirePermission('settings'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  if (serverManager.isRunning(srv.id)) {
    res.status(409).json({ error: 'Stop the server before switching software or version' });
    return;
  }
  const { software, mcVersion } = req.body as { software?: ServerSoftware; mcVersion?: string };
  const targetSoftware = software || srv.software;
  const targetVersion = (mcVersion || srv.mcVersion).trim();
  const serverDir = getServerDir(srv.id);

  serverManager.setInstallProgress(srv.id, {
    stage: 'installing',
    percent: 5,
    message: `Switching to ${targetSoftware} ${targetVersion}...`,
  });
  res.status(202).json({ ok: true });

  installServerSoftware(
    serverDir,
    targetSoftware,
    targetVersion,
    srv.javaPath,
    (percent, message) => {
      serverManager.setInstallProgress(srv.id, { stage: 'installing', percent, message });
    },
    (line, stream) => {
      serverManager.appendInstallLog(srv.id, line, stream);
    },
  )
    .then(async (result) => {
      srv.software = targetSoftware;
      srv.mcVersion = targetVersion;
      srv.jarFile = result.jarFile;
      srv.build = result.build;
      srv.stopCommand = targetSoftware === 'velocity' ? 'end' : 'stop';
      srv.bridgeEnabled = supportsBridgePlugin(targetSoftware);
      store.upsertServer(srv);
      if (targetSoftware === 'velocity') {
        await seedStarterVelocityFiles(serverDir, srv.port, srv.name).catch(() => {});
      }
      if (srv.bridgeEnabled) {
        await installBridgePlugin(srv).catch(() => {});
      } else {
        await uninstallBridgePlugin(srv).catch(() => {});
      }
      serverManager.setInstallProgress(srv.id, null);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      serverManager.appendInstallLog(srv.id, `Version switch failed: ${msg}`, 'stderr');
      serverManager.setInstallProgress(srv.id, {
        stage: 'error',
        percent: 0,
        message: msg,
      });
      setTimeout(() => serverManager.setInstallProgress(srv.id, null), 12000);
    });
});

serversRouter.delete('/:id', requirePermission('settings'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  if (serverManager.isRunning(srv.id)) {
    await serverManager.stopServer(srv.id, true);
    await new Promise((r) => setTimeout(r, 800));
  }
  const deleteFiles = req.query.deleteFiles !== 'false';
  store.deleteServer(srv.id);
  serverManager.clearServerState(srv.id);
  if (deleteFiles) {
    await fs.rm(getServerDir(srv.id), { recursive: true, force: true }).catch(() => {});
  }
  res.json({ ok: true });
});

serversRouter.post('/:id/power', requirePermission('power'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const action = (req.body as { action?: string }).action;
  try {
    if (action === 'start') {
      await serverManager.startServer(srv.id);
    } else if (action === 'stop') {
      await serverManager.stopServer(srv.id, false);
    } else if (action === 'kill') {
      await serverManager.stopServer(srv.id, true);
    } else if (action === 'restart') {
      await serverManager.restartServer(srv.id);
    } else {
      res.status(400).json({ error: 'Invalid power action (start | stop | restart | kill)' });
      return;
    }
    res.json({ ok: true, runtime: serverManager.getRuntime(srv.id) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

serversRouter.post('/:id/command', requirePermission('console'), (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const command = String((req.body as { command?: string }).command || '');
  try {
    serverManager.sendCommand(srv.id, command);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

serversRouter.get('/:id/console', requirePermission('console'), (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  res.json({ lines: serverManager.getConsoleHistory(srv.id) });
});
