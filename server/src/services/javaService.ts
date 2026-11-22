import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import AdmZip from 'adm-zip';
import { RUNTIMES_DIR, USER_AGENT } from '../config.js';
import type { JavaDownloadStatus, JavaRuntimeInfo } from '../../../shared/types.js';

const activeDownloads = new Map<number, JavaDownloadStatus>();

function parseJavaVersionOutput(output: string): { version: string; major: number; vendor: string } | null {
  const versionMatch = output.match(/version\s+"([^"]+)"/i);
  if (!versionMatch) return null;
  const version = versionMatch[1];
  let major = 0;
  if (version.startsWith('1.')) {
    major = Number(version.split('.')[1]) || 8;
  } else {
    major = Number(version.split(/[._+-]/)[0]) || 0;
  }
  let vendor = 'Unknown';
  if (/Temurin|Adoptium|AdoptOpenJDK/i.test(output)) vendor = 'Eclipse Temurin';
  else if (/HotSpot|Java\(TM\)|Oracle/i.test(output)) vendor = 'Oracle Java';
  else if (/Microsoft/i.test(output)) vendor = 'Microsoft OpenJDK';
  else if (/Zulu|Azul/i.test(output)) vendor = 'Azul Zulu';
  else if (/Corretto/i.test(output)) vendor = 'Amazon Corretto';
  else if (/GraalVM/i.test(output)) vendor = 'GraalVM';
  else if (/OpenJDK/i.test(output)) vendor = 'OpenJDK';
  return { version, major, vendor };
}

export async function probeJavaBinary(javaPath: string, source: 'managed' | 'system'): Promise<JavaRuntimeInfo | null> {
  if (!fsSync.existsSync(javaPath)) return null;
  const output = await new Promise<string>((resolve) => {
    execFile(javaPath, ['-version'], { timeout: 5000, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stderr && !stdout) resolve('');
      else resolve(`${stderr}\n${stdout}`);
    });
  });
  const parsed = parseJavaVersionOutput(output);
  if (!parsed) return null;
  const normalized = path.resolve(javaPath);
  return {
    id: Buffer.from(normalized).toString('base64url'),
    path: normalized,
    version: parsed.version,
    major: parsed.major,
    vendor: parsed.vendor,
    source,
  };
}

async function findJavaExesInBaseDir(baseDir: string, maxDepth = 3): Promise<string[]> {
  const exeName = process.platform === 'win32' ? 'java.exe' : 'java';
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const directBin = path.join(full, 'bin', exeName);
        if (fsSync.existsSync(directBin)) {
          found.push(directBin);
          continue;
        }
        await walk(full, depth + 1);
      }
    }
  }

  if (fsSync.existsSync(baseDir)) {
    await walk(baseDir, 0);
  }
  return found;
}

export async function discoverJavaRuntimes(): Promise<JavaRuntimeInfo[]> {
  const seen = new Set<string>();
  const candidates: { bin: string; source: 'managed' | 'system' }[] = [];
  const exeName = process.platform === 'win32' ? 'java.exe' : 'java';

  // 1. Managed runtimes downloaded by MCServerManager
  const managedBins = await findJavaExesInBaseDir(RUNTIMES_DIR, 3);
  for (const bin of managedBins) {
    candidates.push({ bin, source: 'managed' });
  }

  // 2. JAVA_HOME
  if (process.env.JAVA_HOME) {
    candidates.push({ bin: path.join(process.env.JAVA_HOME, 'bin', exeName), source: 'system' });
  }

  // 3. Common OS installation paths
  const searchRoots =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Java',
          'C:\\Program Files\\Eclipse Adoptium',
          'C:\\Program Files\\Microsoft',
          'C:\\Program Files\\Zulu',
          'C:\\Program Files\\Amazon Corretto',
          'C:\\Program Files\\BellSoft',
          'C:\\Program Files (x86)\\Java',
        ]
      : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines', '/opt/java'];

  for (const root of searchRoots) {
    const bins = await findJavaExesInBaseDir(root, 2);
    for (const bin of bins) {
      candidates.push({ bin, source: 'system' });
    }
  }

  // 4. PATH lookup
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const bin = path.join(dir, exeName);
    if (fsSync.existsSync(bin)) {
      candidates.push({ bin, source: 'system' });
    }
  }

  const results: JavaRuntimeInfo[] = [];
  const seenVersionKeys = new Set<string>();
  for (const cand of candidates) {
    let resolved = path.resolve(cand.bin);
    try {
      resolved = fsSync.realpathSync(resolved);
    } catch {
      // keep resolved path
    }
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    const info = await probeJavaBinary(resolved, cand.source);
    if (!info) continue;
    const verKey = `${info.source}:${info.vendor}:${info.version}`;
    if (seenVersionKeys.has(verKey)) continue;
    seenVersionKeys.add(verKey);
    results.push(info);
  }

  // Sort: managed first, then highest major version first
  results.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'managed' ? -1 : 1;
    return b.major - a.major;
  });

  return results;
}

export function recommendedJavaMajorForMc(mcVersion: string): number {
  const parts = mcVersion.split('.').map((n) => parseInt(n, 10));
  const major = parts[0] || 1;
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;

  // Minecraft 26.x+ (year-based versioning) requires Java 25 (or 21+)
  if (major >= 26) return 25;
  if (major > 1) return 21;
  if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 17) return 17;
  return 8;
}

export async function resolveJavaForServer(javaPathSetting: string, mcVersion: string): Promise<string> {
  if (javaPathSetting && javaPathSetting !== 'auto') {
    if (fsSync.existsSync(javaPathSetting)) return javaPathSetting;
  }
  const runtimes = await discoverJavaRuntimes();
  if (runtimes.length === 0) {
    return process.platform === 'win32' ? 'java.exe' : 'java';
  }
  const needed = recommendedJavaMajorForMc(mcVersion);
  // Prefer exact match, then closest higher version, then highest available
  const exact = runtimes.find((r) => r.major === needed);
  if (exact) return exact.path;
  if (needed >= 17) {
    const compatible = runtimes.filter((r) => r.major >= needed).sort((a, b) => a.major - b.major);
    if (compatible.length > 0) return compatible[0].path;
  }
  return runtimes[0].path;
}

export function getActiveJavaDownloads(): JavaDownloadStatus[] {
  return Array.from(activeDownloads.values());
}

export async function downloadTemurinJava(
  major: number,
  onProgress?: (status: JavaDownloadStatus) => void,
): Promise<JavaRuntimeInfo> {
  const supportedMajors = [8, 17, 21, 25];
  if (!supportedMajors.includes(major)) {
    throw new Error(`Unsupported Java major version: ${major}. Supported: ${supportedMajors.join(', ')}`);
  }

  const update = (status: JavaDownloadStatus) => {
    activeDownloads.set(major, status);
    onProgress?.(status);
  };

  try {
    update({ major, stage: 'downloading', percent: 2, message: `Querying Adoptium Temurin Java ${major}...` });

    const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    const archName = process.arch === 'arm64' ? 'aarch64' : 'x64';
    const apiUrl = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${archName}&image_type=jre&os=${osName}&vendor=eclipse`;

    const metaRes = await fetch(apiUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!metaRes.ok) {
      throw new Error(`Adoptium API error (${metaRes.status})`);
    }
    const assets = (await metaRes.json()) as Array<{
      binary?: { package?: { link?: string; name?: string; size?: number } };
    }>;

    // Fallback to JDK if JRE isn't available for this version/platform
    let pkg = assets[0]?.binary?.package;
    if (!pkg?.link) {
      const jdkUrl = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${archName}&image_type=jdk&os=${osName}&vendor=eclipse`;
      const jdkRes = await fetch(jdkUrl, { headers: { 'User-Agent': USER_AGENT } });
      if (jdkRes.ok) {
        const jdkAssets = (await jdkRes.json()) as typeof assets;
        pkg = jdkAssets[0]?.binary?.package;
      }
    }

    if (!pkg?.link || !pkg.name) {
      throw new Error(`No Adoptium Temurin ${major} binary found for ${osName}/${archName}`);
    }

    update({ major, stage: 'downloading', percent: 5, message: `Downloading ${pkg.name}...` });
    const dlRes = await fetch(pkg.link, { headers: { 'User-Agent': USER_AGENT } });
    if (!dlRes.ok || !dlRes.body) {
      throw new Error(`Download failed (${dlRes.status})`);
    }

    const totalBytes = Number(dlRes.headers.get('content-length')) || pkg.size || 0;
    const chunks: Uint8Array[] = [];
    let downloaded = 0;

    const reader = dlRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      downloaded += value.byteLength;
      if (totalBytes > 0) {
        const pct = Math.min(82, 5 + Math.round((downloaded / totalBytes) * 77));
        update({
          major,
          stage: 'downloading',
          percent: pct,
          message: `Downloading Java ${major}: ${(downloaded / 1048576).toFixed(1)} / ${(totalBytes / 1048576).toFixed(1)} MB`,
        });
      }
    }

    const archiveBuf = Buffer.concat(chunks);
    const targetDir = path.join(RUNTIMES_DIR, `temurin-${major}`);
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(targetDir, { recursive: true });

    update({ major, stage: 'extracting', percent: 86, message: `Extracting Temurin Java ${major}...` });

    if (pkg.name.endsWith('.zip')) {
      const zip = new AdmZip(archiveBuf);
      zip.extractAllTo(targetDir, true);
    } else {
      const archiveFile = path.join(targetDir, pkg.name);
      await fs.writeFile(archiveFile, archiveBuf);
      await new Promise<void>((resolve, reject) => {
        execFile('tar', ['-xzf', archiveFile, '-C', targetDir], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await fs.rm(archiveFile, { force: true });
    }

    const bins = await findJavaExesInBaseDir(targetDir, 3);
    if (bins.length === 0) {
      throw new Error('Extracted archive did not contain a java binary');
    }
    const info = await probeJavaBinary(bins[0], 'managed');
    if (!info) {
      throw new Error('Downloaded Java binary failed version probe');
    }

    update({ major, stage: 'done', percent: 100, message: `Installed ${info.vendor} ${info.version}` });
    setTimeout(() => activeDownloads.delete(major), 15000);
    return info;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    update({ major, stage: 'error', percent: 0, message: msg });
    throw err;
  }
}
