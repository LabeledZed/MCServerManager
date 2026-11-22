import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface PidMetrics {
  cpuPercent: number;
  memoryMb: number;
}

interface CpuSample {
  cpuSeconds: number;
  ts: number;
}

const previousCpuSamples = new Map<number, CpuSample>();
const cpuCores = Math.max(1, os.cpus().length);

/**
 * Fetches CPU % and working-set RAM (MB) for a batch of active PIDs in a single lightweight OS call.
 */
export async function sampleProcessMetrics(pids: number[]): Promise<Map<number, PidMetrics>> {
  const result = new Map<number, PidMetrics>();
  const validPids = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (validPids.length === 0) return result;

  // Clean up stale samples
  const activeSet = new Set(validPids);
  for (const key of previousCpuSamples.keys()) {
    if (!activeSet.has(key)) previousCpuSamples.delete(key);
  }

  if (process.platform === 'win32') {
    const pidList = validPids.join(',');
    const psCmd = `Get-Process -Id ${pidList} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)|$($_.CPU)|$($_.WorkingSet64)" }`;
    const stdout = await new Promise<string>((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', psCmd],
        { timeout: 4000, windowsHide: true },
        (err, out) => resolve(err ? '' : out),
      );
    });

    const now = Date.now();
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const [pidStr, cpuStr, memStr] = line.split('|');
      const pid = Number(pidStr);
      const cpuSeconds = Number(cpuStr?.replace(',', '.')) || 0;
      const memBytes = Number(memStr) || 0;
      if (!pid) continue;

      let cpuPercent = 0;
      const prev = previousCpuSamples.get(pid);
      if (prev && now > prev.ts) {
        const dtSec = (now - prev.ts) / 1000;
        const dCpu = Math.max(0, cpuSeconds - prev.cpuSeconds);
        cpuPercent = Math.min(100, (dCpu / (dtSec * cpuCores)) * 100);
      }
      previousCpuSamples.set(pid, { cpuSeconds, ts: now });
      result.set(pid, {
        cpuPercent: Math.round(cpuPercent * 10) / 10,
        memoryMb: Math.round(memBytes / (1024 * 1024)),
      });
    }
    return result;
  }

  // POSIX fallback (Linux/macOS)
  const stdout = await new Promise<string>((resolve) => {
    execFile(
      'ps',
      ['-p', validPids.join(','), '-o', 'pid=,pcpu=,rss='],
      { timeout: 3000 },
      (err, out) => resolve(err ? '' : out),
    );
  });

  for (const rawLine of stdout.split(/\r?\n/)) {
    const parts = rawLine.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const pid = Number(parts[0]);
    const cpuPercent = Math.min(100, Math.round((Number(parts[1]) || 0) * 10) / 10);
    const rssKb = Number(parts[2]) || 0;
    if (pid) {
      result.set(pid, { cpuPercent, memoryMb: Math.round(rssKb / 1024) });
    }
  }
  return result;
}

export interface OrphanProcessQuery {
  serverId: string;
  serverDir: string;
  jarFile: string;
  port: number;
  lastPid?: number | null;
  excludePids?: number[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function execFileStdout(file: string, args: string[], timeout = 4000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (err, out) => resolve(err ? '' : out));
  });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Finds running Java processes that appear to belong to a specific Minecraft server
 * (for example, an orphaned JVM left behind after an ungraceful manager restart).
 */
export async function findOrphanedServerPids(query: OrphanProcessQuery): Promise<number[]> {
  const excluded = new Set<number>([process.pid, ...(query.excludePids || [])]);
  const markerRe = new RegExp(`(?:^|\\s)["']?-Dmcsm\\.serverId=${escapeRegex(query.serverId)}["']?(?:\\s|$)`);
  const resolvedDir = path.resolve(query.serverDir);
  const jarToken = query.jarFile === '@' || query.jarFile === '@args' ? '@' : query.jarFile;
  const safePort = Number.isInteger(query.port) && query.port > 0 && query.port <= 65535 ? query.port : 0;

  if (process.platform === 'win32') {
    const portPart = safePort
      ? `try { $portPids = @(Get-NetTCPConnection -LocalPort ${safePort} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess) } catch {}`
      : '';
    const psCmd = [
      `$procs = @(Get-CimInstance Win32_Process -Filter "Name='java.exe' OR Name='javaw.exe'" -ErrorAction SilentlyContinue | Select-Object ProcessId,CommandLine)`,
      `$portPids = @()`,
      portPart,
      `[PSCustomObject]@{ procs = $procs; portPids = $portPids } | ConvertTo-Json -Compress`,
    ]
      .filter(Boolean)
      .join('; ');

    const stdout = await execFileStdout('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], 6000);
    if (!stdout.trim()) return [];

    let parsed: {
      procs?: Array<{ ProcessId?: number; CommandLine?: string | null }> | { ProcessId?: number; CommandLine?: string | null };
      portPids?: number[] | number;
    };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return [];
    }

    const procsRaw = Array.isArray(parsed.procs) ? parsed.procs : parsed.procs ? [parsed.procs] : [];
    const portPidList = Array.isArray(parsed.portPids)
      ? parsed.portPids
      : typeof parsed.portPids === 'number'
        ? [parsed.portPids]
        : [];
    const portPidSet = new Set(portPidList.map(Number).filter((p) => Number.isInteger(p) && p > 0));

    const dirLower = resolvedDir.toLowerCase();
    const dirSlashLower = dirLower.replace(/\\/g, '/');
    const jarLower = jarToken.toLowerCase();

    const matched: number[] = [];
    for (const proc of procsRaw) {
      const pid = Number(proc.ProcessId);
      if (!Number.isInteger(pid) || pid <= 0 || excluded.has(pid)) continue;
      const cmd = String(proc.CommandLine || '');
      const cmdLower = cmd.toLowerCase();
      const cmdSlashLower = cmdLower.replace(/\\/g, '/');

      const hasMarker = markerRe.test(cmd);
      const hasServerDir = cmdLower.includes(dirLower) || cmdSlashLower.includes(dirSlashLower);
      const matchesLastPid = Boolean(query.lastPid && pid === query.lastPid && cmdLower.includes(jarLower));
      const matchesPort = portPidSet.has(pid);

      if (hasMarker || hasServerDir || matchesLastPid || matchesPort) {
        matched.push(pid);
      }
    }
    return [...new Set(matched)];
  }

  // POSIX (Linux / macOS)
  const stdout = await execFileStdout('ps', ['-eo', 'pid=,comm=,args='], 4000);
  if (!stdout.trim()) return [];

  let portPidSet = new Set<number>();
  if (safePort) {
    const lsofOut = await execFileStdout('lsof', [`-iTCP:${safePort}`, '-sTCP:LISTEN', '-t'], 3000);
    portPidSet = new Set(
      lsofOut
        .split(/\s+/)
        .map(Number)
        .filter((p) => Number.isInteger(p) && p > 0),
    );
  }

  const matched: number[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const lineMatch = rawLine.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!lineMatch) continue;
    const pid = Number(lineMatch[1]);
    const comm = lineMatch[2];
    const cmd = lineMatch[3];
    if (!Number.isInteger(pid) || pid <= 0 || excluded.has(pid)) continue;
    if (!/java/i.test(comm) && !/(?:^|\/)java(?:\s|$)/i.test(cmd)) continue;

    const hasMarker = markerRe.test(cmd);
    const hasServerDir = cmd.includes(resolvedDir);
    const matchesLastPid = Boolean(query.lastPid && pid === query.lastPid && cmd.includes(jarToken));
    const matchesPort = portPidSet.has(pid);

    let matchesCwd = false;
    if (!hasMarker && !hasServerDir && !matchesLastPid && !matchesPort) {
      try {
        const cwd = await fs.readlink(`/proc/${pid}/cwd`);
        matchesCwd = path.resolve(cwd) === resolvedDir;
      } catch {
        // /proc/<pid>/cwd not available (e.g. macOS or permission denied)
      }
    }

    if (hasMarker || hasServerDir || matchesLastPid || matchesPort || matchesCwd) {
      matched.push(pid);
    }
  }
  return [...new Set(matched)];
}

/**
 * Terminates a process by PID and waits until it exits so file locks and ports are released.
 */
export async function terminateProcessAndWait(pid: number, timeoutMs = 5000): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0 || !isPidAlive(pid)) return;

  if (process.platform === 'win32') {
    await execFileStdout('taskkill', ['/F', '/PID', String(pid), '/T'], 4000);
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already exited
      }
    }
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
    const gracefulDeadline = Date.now() + Math.min(3500, timeoutMs);
    while (Date.now() < gracefulDeadline && isPidAlive(pid)) {
      await delay(150);
    }
    if (isPidAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already exited
      }
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isPidAlive(pid)) {
    await delay(150);
  }
}
