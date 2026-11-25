import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { getServerDir } from '../config.js';
import { store } from './store.js';
import { resolveJavaForServer } from './javaService.js';
import {
  getBridgePlatformSpec,
  getBridgeStatus,
  installBridgePlugin,
  needsBridgeJarUpdate,
  removeStaleBridgeJars,
  supportsBridgePlugin,
} from './bridgeService.js';
import { deleteAddon } from './pluginService.js';
import {
  findOrphanedServerPids,
  sampleProcessMetrics,
  terminateProcessAndWait,
} from '../utils/processStats.js';
import { pingMinecraftServer } from '../utils/mcPing.js';
import type {
  ConsoleLine,
  JvmPreset,
  ServerConfig,
  ServerRuntimeState,
  TelemetryPoint,
} from '../../../shared/types.js';

const MAX_CONSOLE_LINES = 1500;
const MAX_HISTORY_POINTS = 60;

interface ManagedProcess {
  child: ChildProcess;
  manualStop: boolean;
  killTimer?: NodeJS.Timeout;
  restartTimer?: NodeJS.Timeout;
}

const AIKAR_FLAGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32',
  '-XX:+PerfDisableSharedMem',
  '-XX:MaxTenuringThreshold=1',
];

const G1GC_FLAGS = ['-XX:+UseG1GC', '-XX:MaxGCPauseMillis=100'];
const ZGC_FLAGS = ['-XX:+UseZGC', '-XX:+ZGenerational'];

function buildJvmPresetArgs(preset: JvmPreset, customArgs: string): string[] {
  if (preset === 'aikar') return [...AIKAR_FLAGS];
  if (preset === 'g1gc') return [...G1GC_FLAGS];
  if (preset === 'zgc') return [...ZGC_FLAGS];
  if (!customArgs.trim()) return [];
  return customArgs.trim().split(/\s+/).filter(Boolean);
}

function classifyLogLevel(text: string, stream: 'stdout' | 'stderr'): ConsoleLine['level'] {
  if (stream === 'stderr') return 'error';
  const clean = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
  if (/\[[^\]]*\/ERROR\]|ERROR:|Exception|Caused by:|FATAL/i.test(clean)) return 'error';
  if (/\[[^\]]*\/WARN\]|WARN:|WARNING/i.test(clean)) return 'warn';
  if (/\]:\s*<[^>]+>\s/.test(clean)) return 'chat';
  return 'info';
}

function createInitialRuntime(id: string): ServerRuntimeState {
  return {
    id,
    status: 'offline',
    pid: null,
    startedAt: null,
    uptimeSeconds: 0,
    cpuPercent: 0,
    memoryMb: 0,
    playersOnline: 0,
    maxPlayers: 20,
    onlinePlayerNames: [],
    tps: null,
    motd: '',
    lastExitCode: null,
    restartAttempts: 0,
    history: [],
    installProgress: null,
  };
}

/**
 * Finds modern Forge/NeoForge args file (libraries/net/minecraftforge/.../win_args.txt or neoforged/.../win_args.txt).
 */
async function findModloaderArgsFile(serverDir: string): Promise<string | null> {
  const targetFile = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
  const libsDir = path.join(serverDir, 'libraries');
  if (!fsSync.existsSync(libsDir)) return null;

  async function walk(dir: string, depth: number): Promise<string | null> {
    if (depth > 6) return null;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === targetFile) {
        return path.relative(serverDir, full);
      }
      if (e.isDirectory()) {
        const found = await walk(full, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(libsDir, 0);
}

export class ServerManagerService extends EventEmitter {
  private processes = new Map<string, ManagedProcess>();
  private geyserProcesses = new Map<string, ChildProcess>();
  private startingServers = new Set<string>();
  private runtimes = new Map<string, ServerRuntimeState>();
  private consoleBuffers = new Map<string, ConsoleLine[]>();
  private lineSeq = 1;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    for (const srv of store.getServers()) {
      this.runtimes.set(srv.id, createInitialRuntime(srv.id));
      this.consoleBuffers.set(srv.id, []);
    }
    this.startTelemetryLoop();
  }

  getRuntime(serverId: string): ServerRuntimeState {
    let rt = this.runtimes.get(serverId);
    if (!rt) {
      rt = createInitialRuntime(serverId);
      this.runtimes.set(serverId, rt);
    }
    return rt;
  }

  getAllRuntimes(): Record<string, ServerRuntimeState> {
    const out: Record<string, ServerRuntimeState> = {};
    for (const srv of store.getServers()) {
      out[srv.id] = this.getRuntime(srv.id);
    }
    return out;
  }

  getConsoleHistory(serverId: string): ConsoleLine[] {
    return this.consoleBuffers.get(serverId) || [];
  }

  setInstallProgress(
    serverId: string,
    progress: { stage: string; percent: number; message: string; recentLines?: string[] } | null,
  ): void {
    const rt = this.getRuntime(serverId);
    if (progress) {
      const prevLines = rt.installProgress?.recentLines || [];
      rt.installProgress = {
        ...progress,
        recentLines: progress.recentLines ?? prevLines,
      };
      rt.status = 'installing';
    } else {
      rt.installProgress = null;
      if (rt.status === 'installing') {
        rt.status = 'offline';
      }
    }
    this.emitState(serverId);
  }

  appendInstallLog(
    serverId: string,
    line: string,
    stream: 'stdout' | 'stderr' | 'system' = 'stdout',
  ): void {
    const clean = line.replace(/\r/g, '').trimEnd();
    if (!clean.trim()) return;
    this.pushConsoleLine(serverId, `[Installer] ${clean}`, stream);
    const rt = this.getRuntime(serverId);
    if (rt.installProgress) {
      const prev = rt.installProgress.recentLines || [];
      rt.installProgress = {
        ...rt.installProgress,
        recentLines: [...prev.slice(-7), clean],
      };
      this.emitState(serverId);
    }
  }

  clearServerState(serverId: string): void {
    this.runtimes.delete(serverId);
    this.consoleBuffers.delete(serverId);
  }

  private emitState(serverId: string): void {
    const rt = this.getRuntime(serverId);
    this.emit('state', serverId, rt);
  }

  private pushConsoleLine(
    serverId: string,
    text: string,
    stream: ConsoleLine['stream'],
    levelOverride?: ConsoleLine['level'],
  ): void {
    const line: ConsoleLine = {
      id: this.lineSeq++,
      ts: Date.now(),
      stream,
      level: levelOverride || (stream === 'system' ? 'system' : stream === 'command' ? 'command' : classifyLogLevel(text, stream)),
      text,
    };
    let buf = this.consoleBuffers.get(serverId);
    if (!buf) {
      buf = [];
      this.consoleBuffers.set(serverId, buf);
    }
    buf.push(line);
    if (buf.length > MAX_CONSOLE_LINES) {
      buf.splice(0, buf.length - MAX_CONSOLE_LINES);
    }
    this.emit('console', serverId, line);
  }

  private parseServerOutput(serverId: string, line: string): void {
    const rt = this.getRuntime(serverId);
    const clean = line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');

    // Detect server ready
    if (
      this.processes.has(serverId) &&
      rt.status !== 'online' &&
      rt.status !== 'stopping' &&
      (/Done \([0-9.,]+s\)! For help, type "help"/i.test(clean) ||
        /Done \([0-9.,]+s\)!/i.test(clean) ||
        /Listening on \//i.test(clean))
    ) {
      rt.status = 'online';
      rt.restartAttempts = 0;
      this.emitState(serverId);
    }

    // Detect player joined
    const joinMatch = clean.match(/\]:\s*([A-Za-z0-9_]{2,16}) joined the game/);
    if (joinMatch) {
      const name = joinMatch[1];
      if (!rt.onlinePlayerNames.includes(name)) {
        rt.onlinePlayerNames = [...rt.onlinePlayerNames, name];
        rt.playersOnline = rt.onlinePlayerNames.length;
        this.emitState(serverId);
      }
    }

    // Detect player left
    const leftMatch = clean.match(/\]:\s*([A-Za-z0-9_]{2,16}) left the game/);
    if (leftMatch) {
      const name = leftMatch[1];
      rt.onlinePlayerNames = rt.onlinePlayerNames.filter((p) => p !== name);
      rt.playersOnline = rt.onlinePlayerNames.length;
      this.emitState(serverId);
    }

    // Detect TPS output from Paper/Spigot/Purpur (/tps)
    const tpsMatch = clean.match(/TPS from last 1m, 5m, 15m:\s*\*?([0-9.]+)/i);
    if (tpsMatch) {
      const val = parseFloat(tpsMatch[1]);
      if (!Number.isNaN(val)) {
        rt.tps = Math.min(20, Math.round(val * 10) / 10);
        this.emitState(serverId);
      }
    }
  }

  async startServer(serverId: string): Promise<void> {
    const server = store.getServer(serverId);
    if (!server) throw new Error('Server not found');
    if (this.processes.has(serverId)) {
      throw new Error('Server is already running');
    }
    if (this.startingServers.has(serverId)) {
      throw new Error('Server is already starting');
    }

    this.startingServers.add(serverId);
    let spawned = false;
    const rt = this.getRuntime(serverId);
    rt.status = 'starting';
    rt.startedAt = Date.now();
    rt.uptimeSeconds = 0;
    rt.onlinePlayerNames = [];
    rt.playersOnline = 0;
    rt.lastExitCode = null;
    rt.tps = null;
    this.emitState(serverId);
    this.pushConsoleLine(
      serverId,
      `[MCServerManager] Preparing to start ${server.name} (${server.software} ${server.mcVersion})...`,
      'system',
    );

    try {
      const serverDir = getServerDir(serverId);
      await fs.mkdir(serverDir, { recursive: true });

      // If the manager previously crashed/restarted and left this server's JVM running unlinked,
      // terminate the orphaned Java process so we can cleanly re-attach stdin/stdout on restart.
      const trackedPids = Array.from(this.processes.values())
        .map((p) => p.child.pid)
        .filter((p): p is number => typeof p === 'number' && p > 0);
      const orphanPids = await findOrphanedServerPids({
        serverId,
        serverDir,
        jarFile: server.jarFile,
        port: server.port,
        lastPid: server.lastPid,
        excludePids: trackedPids,
      });
      if (orphanPids.length > 0) {
        this.pushConsoleLine(
          serverId,
          `[MCServerManager] Found unlinked Java process (PID ${orphanPids.join(', ')}) running this server; terminating it before starting to re-link console stdin...`,
          'system',
          'warn',
        );
        for (const pid of orphanPids) {
          await terminateProcessAndWait(pid);
        }
      }

      // Remove any plugins/mods that were queued for deletion while locked previously
      await this.flushPendingAddonDeletions(serverId);

      // Ensure eula.txt matches user setting (except proxy servers like Velocity)
      if (server.software !== 'velocity' && server.eulaAccepted) {
        await fs.writeFile(
          path.join(serverDir, 'eula.txt'),
          `# Accepted via MCServerManager\neula=true\n`,
          'utf8',
        );
      }

      // Clean up any leftover bridge JARs from other platforms or Forge eras (e.g. Fabric -> Forge or Forge 1.12 -> 1.20)
      await removeStaleBridgeJars(
        serverDir,
        server.bridgeEnabled !== false ? getBridgePlatformSpec(server.software, server.mcVersion) : null,
      );

      // Auto-install or refresh companion bridge plugin/mod on all supported platforms (except vanilla)
      if (
        server.bridgeEnabled !== false &&
        supportsBridgePlugin(server.software) &&
        needsBridgeJarUpdate(server.id, server.software, server.mcVersion)
      ) {
        await installBridgePlugin(server).catch(() => {});
      }

      const javaBin = await resolveJavaForServer(server.javaPath, server.mcVersion);
      const minRam = Math.max(256, server.minRamMb || 1024);
      const maxRam = Math.max(minRam, server.maxRamMb || 2048);

      const args: string[] = [
        `-Dmcsm.serverId=${serverId}`,
        '-Dterminal.jline=false',
        '-Dterminal.ansi=true',
        '-Djline.terminal=jline.UnsupportedTerminal',
        `-Xms${minRam}M`,
        `-Xmx${maxRam}M`,
        ...buildJvmPresetArgs(server.jvmPreset, server.customJvmArgs),
      ];

      if (server.jarFile === '@args') {
        const argsFile = await findModloaderArgsFile(serverDir);
        if (!argsFile) {
          throw new Error('Could not find Forge/NeoForge win_args.txt / unix_args.txt in libraries/');
        }
        args.push(`@${argsFile}`, 'nogui');
      } else {
        const jarPath = path.join(serverDir, server.jarFile);
        if (!fsSync.existsSync(jarPath)) {
          throw new Error(`Server JAR not found: ${server.jarFile}. Re-download or upload a JAR in Settings.`);
        }
        args.push('-jar', server.jarFile);
        if (server.software !== 'velocity') {
          args.push('nogui');
        }
      }

      this.pushConsoleLine(
        serverId,
        `[MCServerManager] Launching ${server.name} (${server.software} ${server.mcVersion}) with ${javaBin}`,
        'system',
      );

      const child = spawn(javaBin, args, {
        cwd: serverDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          FORCE_COLOR: '1',
        },
      });

      const managed: ManagedProcess = { child, manualStop: false };
      this.processes.set(serverId, managed);
      spawned = true;

      rt.pid = child.pid ?? null;
      server.lastStartedAt = new Date().toISOString();
      server.lastPid = child.pid ?? null;
      store.upsertServer(server);
      this.emitState(serverId);

      // Start Geyser Standalone sidecar automatically for Vanilla / Forge servers when enabled
      if ((server.software === 'vanilla' || server.software === 'forge') && server.geyserStandaloneEnabled) {
        void this.startGeyserStandalone(server, javaBin);
      }

    const attachLineReader = (stream: NodeJS.ReadableStream | null, kind: 'stdout' | 'stderr') => {
      if (!stream) return;
      let remainder = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        remainder += chunk;
        const lines = remainder.split(/\r?\n/);
        remainder = lines.pop() ?? '';
        for (const rawLine of lines) {
          if (rawLine.length === 0) continue;
          this.pushConsoleLine(serverId, rawLine, kind);
          this.parseServerOutput(serverId, rawLine);
        }
      });
      stream.on('end', () => {
        if (remainder.trim()) {
          this.pushConsoleLine(serverId, remainder, kind);
          this.parseServerOutput(serverId, remainder);
        }
      });
    };

    attachLineReader(child.stdout, 'stdout');
    attachLineReader(child.stderr, 'stderr');

    child.on('error', (err) => {
      this.pushConsoleLine(serverId, `[MCServerManager] Process error: ${err.message}`, 'stderr', 'error');
    });

    child.on('close', (code, signal) => {
      if (managed.killTimer) clearTimeout(managed.killTimer);
      this.processes.delete(serverId);
      void this.stopGeyserStandalone(serverId);

      const currentRt = this.getRuntime(serverId);
      currentRt.pid = null;
      currentRt.startedAt = null;
      currentRt.uptimeSeconds = 0;
      currentRt.cpuPercent = 0;
      currentRt.memoryMb = 0;
      currentRt.playersOnline = 0;
      currentRt.onlinePlayerNames = [];
      currentRt.tps = null;
      currentRt.lastExitCode = code ?? (signal ? -1 : 0);

      const crashed = !managed.manualStop && code !== 0 && code !== null;
      currentRt.status = crashed ? 'crashed' : 'offline';

      this.pushConsoleLine(
        serverId,
        crashed
          ? `[MCServerManager] Server crashed unexpectedly (exit code ${code}).`
          : `[MCServerManager] Server stopped cleanly (exit code ${code ?? 0}).`,
        'system',
        crashed ? 'error' : 'system',
      );
      this.emitState(serverId);

      // Flush any plugins/mods queued for deletion once Windows releases JVM file handles
      setTimeout(() => {
        void this.flushPendingAddonDeletions(serverId);
      }, 450);

      // Auto-restart logic on crash
      const latestServer = store.getServer(serverId);
      if (latestServer && latestServer.lastPid) {
        latestServer.lastPid = null;
        store.upsertServer(latestServer);
      }
      if (crashed && latestServer?.autoRestart) {
        const maxRetries = latestServer.maxRestartAttempts || 3;
        if (currentRt.restartAttempts < maxRetries) {
          currentRt.restartAttempts += 1;
          this.pushConsoleLine(
            serverId,
            `[MCServerManager] Auto-restart scheduled in 5s (attempt ${currentRt.restartAttempts}/${maxRetries})...`,
            'system',
          );
          this.emitState(serverId);
          setTimeout(() => {
            if (!this.processes.has(serverId) && store.getServer(serverId)) {
              this.startServer(serverId).catch((e) => {
                this.pushConsoleLine(serverId, `[MCServerManager] Auto-restart failed: ${e.message}`, 'stderr', 'error');
              });
            }
          }, 5000);
        } else {
          this.pushConsoleLine(
            serverId,
            `[MCServerManager] Auto-restart paused after ${maxRetries} consecutive crashes.`,
            'system',
            'warn',
          );
        }
      }
    });
    } catch (err) {
      if (!spawned) {
        rt.status = 'offline';
        rt.startedAt = null;
        rt.pid = null;
        this.emitState(serverId);
        this.pushConsoleLine(
          serverId,
          `[MCServerManager] Failed to start server: ${err instanceof Error ? err.message : String(err)}`,
          'stderr',
          'error',
        );
      }
      throw err;
    } finally {
      this.startingServers.delete(serverId);
    }
  }

  async stopServer(serverId: string, force = false): Promise<void> {
    void this.stopGeyserStandalone(serverId);
    const managed = this.processes.get(serverId);
    if (!managed) return;
    const server = store.getServer(serverId);
    managed.manualStop = true;

    const rt = this.getRuntime(serverId);
    rt.status = 'stopping';
    this.emitState(serverId);

    if (force) {
      this.pushConsoleLine(serverId, '[MCServerManager] Force-killing server process...', 'system', 'warn');
      managed.child.kill('SIGKILL');
      return;
    }

    const stopCmd = server?.stopCommand || (server?.software === 'velocity' ? 'end' : 'stop');
    this.pushConsoleLine(serverId, `[MCServerManager] Sending graceful "${stopCmd}" command...`, 'system');
    try {
      managed.child.stdin?.write(`${stopCmd}\n`);
    } catch {
      managed.child.kill('SIGTERM');
    }

    // Safety fallback: force kill after 30s if server hangs on shutdown
    managed.killTimer = setTimeout(() => {
      if (this.processes.has(serverId)) {
        this.pushConsoleLine(serverId, '[MCServerManager] Shutdown timed out after 30s; forcing termination.', 'system', 'warn');
        managed.child.kill('SIGKILL');
      }
    }, 30000);
  }

  async restartServer(serverId: string): Promise<void> {
    if (this.processes.has(serverId)) {
      const waitClosed = new Promise<void>((resolve) => {
        const proc = this.processes.get(serverId);
        if (!proc) return resolve();
        proc.child.once('close', () => resolve());
      });
      await this.stopServer(serverId, false);
      await waitClosed;
    }
    await this.startServer(serverId);
  }

  sendCommand(serverId: string, command: string): void {
    const trimmed = command.trim();
    if (!trimmed) return;
    const managed = this.processes.get(serverId);
    if (!managed || !managed.child.stdin) {
      throw new Error('Server is not running');
    }
    const cleanCmd = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    this.pushConsoleLine(serverId, `> ${cleanCmd}`, 'command', 'command');
    managed.child.stdin.write(`${cleanCmd}\n`);
  }

  isRunning(serverId: string): boolean {
    return this.processes.has(serverId);
  }

  async flushPendingAddonDeletions(serverId: string): Promise<void> {
    if (this.processes.has(serverId)) return;
    const srv = store.getServer(serverId);
    if (!srv || !srv.pendingAddonDeletions?.length) return;

    const serverDir = getServerDir(serverId);
    const remaining = [];
    for (const item of srv.pendingAddonDeletions) {
      try {
        const res = await deleteAddon(
          serverDir,
          srv.software,
          item.fileName,
          item.deleteConfigs,
          item.configFolder,
        );
        if (res.locked) {
          remaining.push(item);
        } else {
          this.pushConsoleLine(
            serverId,
            `[MCServerManager] Removed queued plugin/mod: ${item.fileName}`,
            'system',
          );
        }
      } catch {
        // Already gone or removed
      }
    }
    srv.pendingAddonDeletions = remaining;
    store.upsertServer(srv);
  }

  getRunningServers(): Array<{ id: string; name: string; status: string; playersOnline: number }> {
    const running: Array<{ id: string; name: string; status: string; playersOnline: number }> = [];
    for (const serverId of this.processes.keys()) {
      const srv = store.getServer(serverId);
      const rt = this.getRuntime(serverId);
      running.push({
        id: serverId,
        name: srv?.name || serverId,
        status: rt.status,
        playersOnline: rt.playersOnline,
      });
    }
    return running;
  }

  async stopAllServers(force = false): Promise<void> {
    const ids = Array.from(this.processes.keys());
    await Promise.all(
      ids.map(async (id) => {
        const proc = this.processes.get(id);
        if (!proc) return;
        const done = new Promise<void>((resolve) => {
          proc.child.once('close', () => resolve());
          setTimeout(resolve, force ? 3000 : 25000);
        });
        await this.stopServer(id, force);
        await done;
      }),
    );
  }

  private startTelemetryLoop(): void {
    this.pollTimer = setInterval(async () => {
      const activeEntries: Array<{ serverId: string; pid: number; server: ServerConfig }> = [];
      for (const [serverId, proc] of this.processes.entries()) {
        const srv = store.getServer(serverId);
        if (srv && proc.child.pid) {
          activeEntries.push({ serverId, pid: proc.child.pid, server: srv });
        }
      }
      if (activeEntries.length === 0) return;

      const metrics = await sampleProcessMetrics(activeEntries.map((e) => e.pid));

      await Promise.all(
        activeEntries.map(async ({ serverId, pid, server }) => {
          const rt = this.getRuntime(serverId);
          const proc = this.processes.get(serverId);
          if (proc && proc.child.exitCode === null && !proc.child.killed && rt.status === 'offline') {
            rt.status = 'starting';
          }
          const stat = metrics.get(pid);
          if (stat) {
            rt.cpuPercent = stat.cpuPercent;
            rt.memoryMb = stat.memoryMb;
          }
          if (rt.startedAt) {
            rt.uptimeSeconds = Math.floor((Date.now() - rt.startedAt) / 1000);
          }

          // Ping Minecraft server over local TCP SLP for live player count, max players, and MOTD
          if (rt.status === 'online' || rt.status === 'starting') {
            const ping = await pingMinecraftServer('127.0.0.1', server.port, 1000);
            if (ping) {
              if (rt.status === 'starting') rt.status = 'online';
              rt.playersOnline = ping.playersOnline;
              rt.maxPlayers = ping.maxPlayers;
              if (ping.motd) rt.motd = ping.motd;
              if (ping.playerNames.length > 0) {
                rt.onlinePlayerNames = ping.playerNames;
              } else if (ping.playersOnline === 0) {
                rt.onlinePlayerNames = [];
              }
            }
          }

          // Pull live TPS & players from MCServerManagerBridge plugin when available
          if (
            (rt.status === 'online' || rt.status === 'starting') &&
            server.bridgeEnabled &&
            supportsBridgePlugin(server.software)
          ) {
            const bridge = await getBridgeStatus(server).catch(() => null);
            if (bridge?.connected) {
              if (rt.status === 'starting') rt.status = 'online';
              if (Array.isArray(bridge.tps) && bridge.tps.length > 0 && Number.isFinite(bridge.tps[0])) {
                rt.tps = Math.min(20, Math.round(bridge.tps[0] * 10) / 10);
              }
              if (bridge.players.length > 0) {
                rt.onlinePlayerNames = bridge.players.map((p) => p.name);
                rt.playersOnline = bridge.players.length;
              }
            }
          }

          const point: TelemetryPoint = {
            ts: Date.now(),
            cpuPercent: rt.cpuPercent,
            memoryMb: rt.memoryMb,
            playersOnline: rt.playersOnline,
            tps: rt.tps,
          };
          rt.history = [...rt.history.slice(-(MAX_HISTORY_POINTS - 1)), point];
          this.emitState(serverId);
        }),
      );
    }, 3000);
  }

  isGeyserStandaloneRunning(serverId: string): boolean {
    const proc = this.geyserProcesses.get(serverId);
    return Boolean(proc && !proc.killed && proc.exitCode === null);
  }

  async startGeyserStandalone(server: ServerConfig, javaBinOverride?: string): Promise<void> {
    if (this.isGeyserStandaloneRunning(server.id)) return;
    const serverDir = getServerDir(server.id);
    const geyserDir = path.join(serverDir, 'geyser-standalone');
    const geyserJar = path.join(geyserDir, 'Geyser-Standalone.jar');
    if (!fsSync.existsSync(geyserJar)) return;

    try {
      const javaBin = javaBinOverride || (await resolveJavaForServer(server.javaPath, '1.21.4'));
      this.pushConsoleLine(
        server.id,
        `[Geyser] Starting Geyser Standalone sidecar (Bedrock UDP port ${server.geyserBedrockPort || 19132} -> 127.0.0.1:${server.port})...`,
        'system',
      );
      const child = spawn(javaBin, ['-Xms128M', '-Xmx512M', '-jar', 'Geyser-Standalone.jar', '--nogui'], {
        cwd: geyserDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.geyserProcesses.set(server.id, child);

      const attachGeyserStream = (stream: NodeJS.ReadableStream | null, kind: 'stdout' | 'stderr') => {
        if (!stream) return;
        let rem = '';
        stream.setEncoding('utf8');
        stream.on('data', (chunk: string) => {
          rem += chunk;
          const lines = rem.split(/\r?\n/);
          rem = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            this.pushConsoleLine(server.id, `[Geyser] ${line}`, kind);
          }
        });
      };
      attachGeyserStream(child.stdout, 'stdout');
      attachGeyserStream(child.stderr, 'stderr');

      child.on('close', (code) => {
        if (this.geyserProcesses.get(server.id) === child) {
          this.geyserProcesses.delete(server.id);
        }
        this.pushConsoleLine(server.id, `[Geyser] Standalone sidecar exited (code ${code ?? 0}).`, 'system');
      });
    } catch (err) {
      this.pushConsoleLine(
        server.id,
        `[Geyser] Failed to launch Standalone sidecar: ${err instanceof Error ? err.message : String(err)}`,
        'stderr',
        'error',
      );
    }
  }

  async stopGeyserStandalone(serverId: string): Promise<void> {
    const proc = this.geyserProcesses.get(serverId);
    if (!proc) return;
    this.geyserProcesses.delete(serverId);
    if (proc.exitCode !== null || proc.killed) return;
    try {
      proc.stdin?.write('geyser stop\n');
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      }, 4000);
      proc.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async startAutoStartServers(): Promise<void> {
    const targets = store.getServers().filter((s) => s.autoStart === true);
    if (targets.length === 0) return;
    console.log(
      `[MCServerManager] Auto-starting ${targets.length} server${targets.length === 1 ? '' : 's'}: ${targets.map((s) => s.name).join(', ')}`,
    );
    for (const srv of targets) {
      if (this.isRunning(srv.id) || this.startingServers.has(srv.id)) continue;
      try {
        await this.startServer(srv.id);
      } catch (err) {
        console.error(
          `[MCServerManager] Failed to auto-start "${srv.name}" (${srv.id}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}

export const serverManager = new ServerManagerService();
