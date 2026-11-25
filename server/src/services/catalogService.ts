import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { USER_AGENT } from '../config.js';
import type { ServerSoftware } from '../../../shared/types.js';
import { resolveJavaForServer } from './javaService.js';

const MAX_SERVER_JAR_BYTES = 300 * 1024 * 1024;

interface ExpectedDigest {
  algorithm: 'sha256' | 'sha1';
  hex: string;
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const versionCache = new Map<string, CacheEntry<string[]>>();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Upstream API error ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

async function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number, message: string) => void,
  expectedDigest?: ExpectedDigest,
): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url} (HTTP ${res.status})`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > MAX_SERVER_JAR_BYTES) {
    throw new Error(`Download size (${total} bytes) exceeds safety limit`);
  }
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    if (loaded > MAX_SERVER_JAR_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('Download exceeded maximum allowed file size');
    }
    chunks.push(value);
    if (total > 0) {
      const pct = Math.min(92, 10 + Math.round((loaded / total) * 80));
      onProgress?.(pct, `Downloading server JAR (${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB)`);
    }
  }
  const fullBuf = Buffer.concat(chunks);
  if (expectedDigest && expectedDigest.hex) {
    const actual = crypto.createHash(expectedDigest.algorithm).update(fullBuf).digest('hex').toLowerCase();
    if (actual !== expectedDigest.hex.trim().toLowerCase()) {
      throw new Error(
        `Integrity check failed (${expectedDigest.algorithm.toUpperCase()} mismatch for ${path.basename(destPath)})`,
      );
    }
  }
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, fullBuf);
}

function sortMcVersionsDesc(versions: string[]): string[] {
  return [...versions].sort((a, b) => {
    const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
    const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
    }
    return b.localeCompare(a);
  });
}

export async function listSoftwareVersions(software: ServerSoftware): Promise<string[]> {
  const cached = versionCache.get(software);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  let versions: string[] = [];

  if (software === 'paper' || software === 'folia' || software === 'velocity') {
    const data = await fetchJson<{ versions: Record<string, string[]> }>(
      `https://fill.papermc.io/v3/projects/${software}`,
    );
    const flat = Object.values(data.versions || {}).flat();
    versions = sortMcVersionsDesc(Array.from(new Set(flat)));
  } else if (software === 'purpur') {
    const data = await fetchJson<{ versions: string[] }>('https://api.purpurmc.org/v2/purpur');
    versions = [...(data.versions || [])].reverse();
  } else if (software === 'leaf') {
    const data = await fetchJson<{ versions: string[] }>('https://api.leafmc.one/v2/projects/leaf');
    versions = sortMcVersionsDesc(data.versions || []);
  } else if (software === 'vanilla') {
    const data = await fetchJson<{ versions: Array<{ id: string; type: string }> }>(
      'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    );
    versions = data.versions.filter((v) => v.type === 'release').map((v) => v.id);
  } else if (software === 'fabric') {
    const data = await fetchJson<Array<{ version: string; stable: boolean }>>(
      'https://meta.fabricmc.net/v2/versions/game',
    );
    versions = data.filter((v) => v.stable).map((v) => v.version);
  } else if (software === 'neoforge') {
    const data = await fetchJson<{ versions: string[] }>(
      'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge',
    );
    // Map NeoForge version prefixes (e.g. 21.1.x -> 1.21.1, 21.4.x -> 1.21.4, 20.4.x -> 1.20.4)
    const mcSet = new Set<string>();
    for (const v of data.versions || []) {
      const m = v.match(/^(\d+)\.(\d+)\./);
      if (m) {
        const major = parseInt(m[1], 10);
        const minor = parseInt(m[2], 10);
        if (major >= 26) {
          mcSet.add(`${major}.${minor}`);
        } else {
          mcSet.add(minor === 0 ? `1.${major}` : `1.${major}.${minor}`);
        }
      }
    }
    versions = sortMcVersionsDesc(Array.from(mcSet));
  } else if (software === 'forge') {
    const data = await fetchJson<{ promos: Record<string, string> }>(
      'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
    );
    const mcSet = new Set<string>();
    for (const key of Object.keys(data.promos || {})) {
      const m = key.match(/^(.+?)-(recommended|latest)$/);
      if (m) mcSet.add(m[1]);
    }
    versions = sortMcVersionsDesc(Array.from(mcSet));
  } else {
    versions = ['1.21.4', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2'];
  }

  versionCache.set(software, { data: versions, expiresAt: Date.now() + CACHE_TTL_MS });
  return versions;
}

export interface InstallResult {
  jarFile: string;
  build?: string;
}

async function runInstallerJar(
  serverDir: string,
  installerJar: string,
  mcVersion: string,
  javaPathSetting: string,
  onProgress?: (percent: number, message: string) => void,
  onLog?: (line: string, stream?: 'stdout' | 'stderr' | 'system') => void,
): Promise<string> {
  const javaBin = await resolveJavaForServer(javaPathSetting, mcVersion);
  onProgress?.(65, 'Running modloader --installServer (this may take a moment)...');
  onLog?.(`Running: "${javaBin}" -jar ${installerJar} --installServer`, 'system');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(javaBin, ['-jar', installerJar, '--installServer'], {
      cwd: serverDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const tail: string[] = [];
    let stdoutBuf = '';
    let stderrBuf = '';

    const handleChunk = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') {
        stdoutBuf += text;
        const lines = stdoutBuf.split(/\r?\n/);
        stdoutBuf = lines.pop() ?? '';
        for (const l of lines) {
          const trimmed = l.trimEnd();
          if (!trimmed) continue;
          tail.push(trimmed);
          if (tail.length > 20) tail.shift();
          onLog?.(trimmed, 'stdout');
        }
      } else {
        stderrBuf += text;
        const lines = stderrBuf.split(/\r?\n/);
        stderrBuf = lines.pop() ?? '';
        for (const l of lines) {
          const trimmed = l.trimEnd();
          if (!trimmed) continue;
          tail.push(trimmed);
          if (tail.length > 20) tail.shift();
          onLog?.(trimmed, 'stderr');
        }
      }
    };

    child.stdout?.on('data', (d: Buffer) => handleChunk(d, 'stdout'));
    child.stderr?.on('data', (d: Buffer) => handleChunk(d, 'stderr'));
    child.on('error', (err) => {
      onLog?.(`Installer spawn error: ${err.message}`, 'stderr');
      reject(err);
    });
    child.on('close', (code) => {
      if (stdoutBuf.trim()) {
        tail.push(stdoutBuf.trim());
        onLog?.(stdoutBuf.trim(), 'stdout');
      }
      if (stderrBuf.trim()) {
        tail.push(stderrBuf.trim());
        onLog?.(stderrBuf.trim(), 'stderr');
      }
      if (code === 0) {
        onLog?.('Modloader installer finished successfully.', 'system');
        resolve();
      } else {
        const snippet = tail.slice(-6).join(' | ').slice(0, 500);
        reject(new Error(`Installer exited with code ${code}${snippet ? `: ${snippet}` : ''}`));
      }
    });
  });

  // Remove the installer jar after installation
  await fs.rm(path.join(serverDir, installerJar), { force: true }).catch(() => {});

  // Detect modern Forge/NeoForge unix_args / win_args or legacy universal jar
  const entries = await fs.readdir(serverDir);
  if (entries.includes('run.bat') || entries.includes('run.sh')) {
    return '@args'; // Sentinel telling serverManager to boot via libraries/.../win_args.txt or unix_args.txt
  }
  const serverJar = entries.find((f) => f.endsWith('.jar') && !f.includes('installer'));
  return serverJar || 'server.jar';
}

export async function installServerSoftware(
  serverDir: string,
  software: ServerSoftware,
  mcVersion: string,
  javaPathSetting: string,
  onProgress?: (percent: number, message: string) => void,
  onLog?: (line: string, stream?: 'stdout' | 'stderr' | 'system') => void,
): Promise<InstallResult> {
  await fs.mkdir(serverDir, { recursive: true });
  onLog?.(`Starting installation of ${software} ${mcVersion}...`, 'system');

  if (software === 'paper' || software === 'folia' || software === 'velocity') {
    onProgress?.(5, `Fetching ${software} ${mcVersion} builds from PaperMC Fill v3...`);
    const builds = await fetchJson<
      Array<{
        id: number;
        channel: string;
        downloads: Record<string, { name: string; url: string; checksums?: { sha256?: string } }>;
      }>
    >(`https://fill.papermc.io/v3/projects/${software}/versions/${encodeURIComponent(mcVersion)}/builds`);

    if (!Array.isArray(builds) || builds.length === 0) {
      throw new Error(`No builds available for ${software} ${mcVersion}`);
    }
    // Prefer latest STABLE/RECOMMENDED, otherwise newest build
    const preferred =
      builds.find((b) => b.channel === 'STABLE' || b.channel === 'RECOMMENDED') || builds[0];
    const dl = preferred.downloads?.['server:default'] || Object.values(preferred.downloads || {})[0];
    if (!dl?.url) {
      throw new Error(`Could not find download URL for ${software} build #${preferred.id}`);
    }

    const jarName = `${software}-${mcVersion}-${preferred.id}.jar`;
    const sha256 = dl.checksums?.sha256;
    await downloadToFile(
      dl.url,
      path.join(serverDir, jarName),
      onProgress,
      sha256 && /^[a-fA-F0-9]{64}$/.test(sha256) ? { algorithm: 'sha256', hex: sha256 } : undefined,
    );
    onProgress?.(100, `Installed ${jarName}`);
    return { jarFile: jarName, build: String(preferred.id) };
  }

  if (software === 'purpur') {
    onProgress?.(5, `Fetching Purpur ${mcVersion} latest build...`);
    const meta = await fetchJson<{ builds: { latest: string } }>(
      `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mcVersion)}`,
    );
    const build = meta.builds?.latest || 'latest';
    const jarName = `purpur-${mcVersion}-${build}.jar`;
    const url = `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mcVersion)}/${encodeURIComponent(build)}/download`;
    await downloadToFile(url, path.join(serverDir, jarName), onProgress);
    onProgress?.(100, `Installed ${jarName}`);
    return { jarFile: jarName, build };
  }

  if (software === 'leaf') {
    onProgress?.(5, `Fetching Leaf ${mcVersion} builds from LeafMC API...`);
    const data = await fetchJson<{
      builds: Array<{
        build: number;
        downloads: Record<string, { name: string; sha256?: string }>;
      }>;
    }>(`https://api.leafmc.one/v2/projects/leaf/versions/${encodeURIComponent(mcVersion)}/builds`);
    if (!Array.isArray(data.builds) || data.builds.length === 0) {
      throw new Error(`No Leaf builds available for Minecraft ${mcVersion}`);
    }
    const latest = data.builds[data.builds.length - 1];
    const dl = latest.downloads?.primary || latest.downloads?.application || Object.values(latest.downloads || {})[0];
    if (!dl?.name) {
      throw new Error(`Could not resolve Leaf download filename for build #${latest.build}`);
    }
    const safeLeafName = path.basename(dl.name).replace(/[^a-zA-Z0-9._+-]/g, '_');
    const url = `https://api.leafmc.one/v2/projects/leaf/versions/${encodeURIComponent(mcVersion)}/builds/${latest.build}/downloads/${encodeURIComponent(dl.name)}`;
    await downloadToFile(
      url,
      path.join(serverDir, safeLeafName),
      onProgress,
      dl.sha256 && /^[a-fA-F0-9]{64}$/.test(dl.sha256) ? { algorithm: 'sha256', hex: dl.sha256 } : undefined,
    );
    onProgress?.(100, `Installed ${safeLeafName}`);
    return { jarFile: safeLeafName, build: String(latest.build) };
  }

  if (software === 'vanilla') {
    onProgress?.(5, `Fetching Mojang manifest for Vanilla ${mcVersion}...`);
    const manifest = await fetchJson<{ versions: Array<{ id: string; url: string }> }>(
      'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
    );
    const verMeta = manifest.versions.find((v) => v.id === mcVersion);
    if (!verMeta) throw new Error(`Vanilla version ${mcVersion} not found`);
    const details = await fetchJson<{ downloads?: { server?: { url: string; sha1?: string } } }>(verMeta.url);
    const serverDl = details.downloads?.server;
    if (!serverDl?.url) throw new Error(`Vanilla ${mcVersion} does not have a server JAR`);
    const jarName = `vanilla-${mcVersion}.jar`;
    await downloadToFile(
      serverDl.url,
      path.join(serverDir, jarName),
      onProgress,
      serverDl.sha1 && /^[a-fA-F0-9]{40}$/.test(serverDl.sha1) ? { algorithm: 'sha1', hex: serverDl.sha1 } : undefined,
    );
    onProgress?.(100, `Installed ${jarName}`);
    return { jarFile: jarName };
  }

  if (software === 'fabric') {
    onProgress?.(5, `Resolving latest Fabric loader & installer for ${mcVersion}...`);
    const [loaders, installers] = await Promise.all([
      fetchJson<Array<{ version: string; stable: boolean }>>('https://meta.fabricmc.net/v2/versions/loader'),
      fetchJson<Array<{ version: string; stable: boolean }>>('https://meta.fabricmc.net/v2/versions/installer'),
    ]);
    const loaderVer = (loaders.find((l) => l.stable) || loaders[0])?.version;
    const installerVer = (installers.find((i) => i.stable) || installers[0])?.version;
    if (!loaderVer || !installerVer) throw new Error('Could not resolve Fabric loader/installer');

    const jarName = `fabric-server-mc.${mcVersion}-loader.${loaderVer}.jar`;
    const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVer)}/${encodeURIComponent(installerVer)}/server/jar`;
    onLog?.(`Downloading Fabric server launcher: ${jarName}`, 'system');
    await downloadToFile(url, path.join(serverDir, jarName), onProgress);
    onLog?.(`Installed ${jarName}`, 'system');
    onProgress?.(100, `Installed ${jarName}`);
    return { jarFile: jarName, build: loaderVer };
  }

  if (software === 'neoforge') {
    onProgress?.(5, `Resolving latest NeoForge release for MC ${mcVersion}...`);
    const parts = mcVersion.split('.');
    const prefix = parts[0] === '1' ? `${parts[1]}.${parts[2] || '0'}.` : `${parts[0]}.${parts[1] || '0'}.`;
    const latest = await fetchJson<{ version: string }>(
      `https://maven.neoforged.net/api/maven/latest/version/releases/net/neoforged/neoforge?filter=${encodeURIComponent(prefix)}`,
    );
    const nfVer = latest.version;
    if (!nfVer) throw new Error(`No NeoForge version found for MC ${mcVersion}`);
    const installerName = `neoforge-${nfVer}-installer.jar`;
    const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${encodeURIComponent(nfVer)}/${installerName}`;
    onLog?.(`Downloading NeoForge installer: ${installerName}`, 'system');
    await downloadToFile(url, path.join(serverDir, installerName), onProgress);
    const jarFile = await runInstallerJar(serverDir, installerName, mcVersion, javaPathSetting, onProgress, onLog);
    onProgress?.(100, `Installed NeoForge ${nfVer}`);
    return { jarFile, build: nfVer };
  }

  if (software === 'forge') {
    onProgress?.(5, `Resolving Forge build for MC ${mcVersion}...`);
    const data = await fetchJson<{ promos: Record<string, string> }>(
      'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
    );
    const forgeVer = data.promos[`${mcVersion}-recommended`] || data.promos[`${mcVersion}-latest`];
    if (!forgeVer) throw new Error(`No Forge build found for MC ${mcVersion}`);
    const fullVer = `${mcVersion}-${forgeVer}`;
    const installerName = `forge-${fullVer}-installer.jar`;
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${encodeURIComponent(fullVer)}/${installerName}`;
    onLog?.(`Downloading Forge installer: ${installerName}`, 'system');
    await downloadToFile(url, path.join(serverDir, installerName), onProgress);
    const jarFile = await runInstallerJar(serverDir, installerName, mcVersion, javaPathSetting, onProgress, onLog);
    onProgress?.(100, `Installed Forge ${fullVer}`);
    return { jarFile, build: forgeVer };
  }

  // Custom / Spigot (user uploads their own jar or uses existing)
  onProgress?.(100, 'Ready for custom server JAR');
  return { jarFile: 'server.jar' };
}
