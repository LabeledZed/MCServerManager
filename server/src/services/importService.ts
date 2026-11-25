import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import AdmZip from 'adm-zip';
import { DATA_DIR, PROJECT_ROOT } from '../config.js';
import { getDirectorySize } from '../utils/fsSafe.js';
import { supportsBridgePlugin } from './bridgeService.js';
import type { ServerSoftware } from '../../../shared/types.js';

export interface InspectedExistingServer {
  sourcePath: string;
  suggestedName: string;
  software: ServerSoftware;
  mcVersion: string;
  jarFile: string;
  jarCandidates: string[];
  port: number;
  eulaAccepted: boolean;
  isSpigotCompatible: boolean;
  worldCount: number;
  pluginOrModCount: number;
  sizeBytes: number;
}

function extractVersionFromText(text: string): string | null {
  // Match 26.x.y or 1.xx(.y)
  const m = text.match(/\b(2[6-9]\.\d+(?:\.\d+)?|1\.\d{1,2}(?:\.\d{1,2})?)\b/);
  return m ? m[1] : null;
}

function inspectJarForSoftwareAndVersion(jarFullPath: string): {
  softwareHint: ServerSoftware | null;
  versionHint: string | null;
} {
  const fileLower = path.basename(jarFullPath).toLowerCase();
  let softwareHint: ServerSoftware | null = null;
  let versionHint: string | null = extractVersionFromText(fileLower);

  if (fileLower.includes('leaf')) softwareHint = 'leaf';
  else if (fileLower.includes('purpur')) softwareHint = 'purpur';
  else if (fileLower.includes('folia')) softwareHint = 'folia';
  else if (fileLower.includes('paper')) softwareHint = 'paper';
  else if (fileLower.includes('spigot') || fileLower.includes('craftbukkit')) softwareHint = 'spigot';
  else if (fileLower.includes('velocity')) softwareHint = 'velocity';
  else if (fileLower.includes('fabric')) softwareHint = 'fabric';
  else if (fileLower.includes('neoforge')) softwareHint = 'neoforge';
  else if (fileLower.includes('forge')) softwareHint = 'forge';
  else if (fileLower.includes('vanilla')) softwareHint = 'vanilla';

  try {
    const zip = new AdmZip(jarFullPath);

    // Paper/Leaf/Purpur/Folia paperclip patch.properties or version.json
    const patchProps = zip.getEntry('patch.properties');
    if (patchProps) {
      const txt = patchProps.getData().toString('utf8');
      const vMatch = txt.match(/^version=(.+)$/m);
      if (vMatch && !versionHint) versionHint = extractVersionFromText(vMatch[1]) || vMatch[1].trim();
    }

    const versionJson = zip.getEntry('version.json');
    if (versionJson) {
      try {
        const parsed = JSON.parse(versionJson.getData().toString('utf8')) as { id?: string; name?: string };
        if (parsed.id) versionHint = parsed.id;
      } catch {
        // ignore
      }
    }

    const versionsList = zip.getEntry('META-INF/versions.list');
    if (versionsList) {
      const txt = versionsList.getData().toString('utf8');
      const lower = txt.toLowerCase();
      if (!softwareHint) {
        if (lower.includes('leaf')) softwareHint = 'leaf';
        else if (lower.includes('purpur')) softwareHint = 'purpur';
        else if (lower.includes('folia')) softwareHint = 'folia';
        else if (lower.includes('paper')) softwareHint = 'paper';
      }
      if (!versionHint) versionHint = extractVersionFromText(txt);
    }

    const manifest = zip.getEntry('META-INF/MANIFEST.MF');
    if (manifest) {
      const txt = manifest.getData().toString('utf8');
      const lower = txt.toLowerCase();
      if (!softwareHint) {
        if (lower.includes('leaf')) softwareHint = 'leaf';
        else if (lower.includes('purpur')) softwareHint = 'purpur';
        else if (lower.includes('folia')) softwareHint = 'folia';
        else if (lower.includes('paperclip') || lower.includes('papermc')) softwareHint = 'paper';
        else if (lower.includes('spigot') || lower.includes('craftbukkit')) softwareHint = 'spigot';
        else if (lower.includes('velocity')) softwareHint = 'velocity';
        else if (lower.includes('fabric')) softwareHint = 'fabric';
      }
    }
  } catch {
    // ignore invalid/unreadable zip
  }

  return { softwareHint, versionHint };
}

function scoreJarCandidate(fileName: string): number {
  const l = fileName.toLowerCase();
  if (l.includes('installer')) return -50;
  if (l.includes('leaf')) return 100;
  if (l.includes('purpur')) return 95;
  if (l.includes('folia')) return 92;
  if (l.includes('paper')) return 90;
  if (l.includes('spigot') || l.includes('craftbukkit')) return 85;
  if (l.includes('fabric')) return 84;
  if (l.includes('velocity')) return 82;
  if (l.includes('neoforge') || l.includes('forge')) return 80;
  if (l === 'server.jar' || l.includes('minecraft_server') || l.includes('vanilla')) return 75;
  return 50;
}

export async function inspectExistingServerFolder(rawPath: string): Promise<InspectedExistingServer> {
  const trimmed = rawPath.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) throw new Error('Folder path is required');

  const resolved = path.resolve(trimmed);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new Error(`Folder not found: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error('The specified path is not a directory');
  }

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const jarCandidates = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.jar'))
    .map((e) => e.name)
    .sort((a, b) => scoreJarCandidate(b) - scoreJarCandidate(a));

  const hasRunScript = entries.some((e) => e.isFile() && (e.name === 'run.bat' || e.name === 'run.sh'));
  const hasNeoForgeLib = fsSync.existsSync(path.join(resolved, 'libraries', 'net', 'neoforged'));
  const hasForgeLib = fsSync.existsSync(path.join(resolved, 'libraries', 'net', 'minecraftforge'));

  let jarFile = jarCandidates[0] || ((hasRunScript && (hasNeoForgeLib || hasForgeLib)) ? '@args' : 'server.jar');
  let software: ServerSoftware | null = null;
  let mcVersion: string | null = null;

  // 1. Inspect top JAR candidate
  if (jarCandidates[0]) {
    const jarInfo = inspectJarForSoftwareAndVersion(path.join(resolved, jarCandidates[0]));
    software = jarInfo.softwareHint;
    mcVersion = jarInfo.versionHint;
  }

  // 2. Inspect server configuration files & directories for reliable software detection
  const hasLeafConfig = fsSync.existsSync(path.join(resolved, 'config', 'leaf-global.yml'));
  const hasPurpurConfig = fsSync.existsSync(path.join(resolved, 'purpur.yml'));
  const hasFoliaConfig =
    fsSync.existsSync(path.join(resolved, 'config', 'folia-global.yml')) ||
    fsSync.existsSync(path.join(resolved, 'folia-global.yml'));
  const hasPaperConfig =
    fsSync.existsSync(path.join(resolved, 'config', 'paper-global.yml')) ||
    fsSync.existsSync(path.join(resolved, 'paper.yml'));
  const hasSpigotConfig =
    fsSync.existsSync(path.join(resolved, 'spigot.yml')) ||
    fsSync.existsSync(path.join(resolved, 'bukkit.yml'));
  const hasVelocityConfig = fsSync.existsSync(path.join(resolved, 'velocity.toml'));
  const hasFabricConfig =
    fsSync.existsSync(path.join(resolved, 'fabric-server-launcher.properties')) ||
    fsSync.existsSync(path.join(resolved, '.fabric'));
  const hasPluginsDir = fsSync.existsSync(path.join(resolved, 'plugins'));

  if (!software) {
    if (hasLeafConfig) software = 'leaf';
    else if (hasPurpurConfig) software = 'purpur';
    else if (hasFoliaConfig) software = 'folia';
    else if (hasPaperConfig) software = 'paper';
    else if (hasSpigotConfig) software = 'spigot';
    else if (hasVelocityConfig) software = 'velocity';
    else if (hasFabricConfig) software = 'fabric';
    else if (hasNeoForgeLib) software = 'neoforge';
    else if (hasForgeLib) software = 'forge';
    else if (hasPluginsDir) software = 'spigot';
    else software = 'vanilla';
  }

  // Try extracting version from versions/ or cache/ if still unknown
  if (!mcVersion) {
    for (const sub of ['versions', 'cache']) {
      const subDir = path.join(resolved, sub);
      if (fsSync.existsSync(subDir)) {
        const subEntries = await fs.readdir(subDir).catch(() => []);
        for (const item of subEntries) {
          const found = extractVersionFromText(item);
          if (found) {
            mcVersion = found;
            break;
          }
        }
      }
      if (mcVersion) break;
    }
  }

  // Read port from velocity.toml (for Velocity proxies) or server.properties
  let port = 25565;
  const velocityTomlPath = path.join(resolved, 'velocity.toml');
  const propsPath = path.join(resolved, 'server.properties');
  if (software === 'velocity' && fsSync.existsSync(velocityTomlPath)) {
    const rawToml = await fs.readFile(velocityTomlPath, 'utf8').catch(() => '');
    const m = rawToml.match(/^\s*bind\s*=\s*["'][^"']*:(\d+)["']/m);
    if (m) {
      const p = Number(m[1]);
      if (p >= 1024 && p <= 65535) port = p;
    }
  } else if (fsSync.existsSync(propsPath)) {
    const rawProps = await fs.readFile(propsPath, 'utf8').catch(() => '');
    const m = rawProps.match(/^server-port\s*=\s*(\d+)/m);
    if (m) {
      const p = Number(m[1]);
      if (p >= 1024 && p <= 65535) port = p;
    }
  }

  // Read EULA
  let eulaAccepted = true;
  const eulaPath = path.join(resolved, 'eula.txt');
  if (fsSync.existsSync(eulaPath)) {
    const rawEula = await fs.readFile(eulaPath, 'utf8').catch(() => '');
    eulaAccepted = /^eula\s*=\s*true/im.test(rawEula);
  }

  // Count worlds and plugins/mods
  let worldCount = 0;
  for (const e of entries) {
    if (
      e.isDirectory() &&
      (fsSync.existsSync(path.join(resolved, e.name, 'level.dat')) ||
        fsSync.existsSync(path.join(resolved, e.name, 'dimensions', 'minecraft')))
    ) {
      worldCount++;
    }
  }

  let pluginOrModCount = 0;
  const addonDir = path.join(resolved, ['fabric', 'forge', 'neoforge'].includes(software) ? 'mods' : 'plugins');
  if (fsSync.existsSync(addonDir)) {
    const addonItems = await fs.readdir(addonDir).catch(() => []);
    pluginOrModCount = addonItems.filter((f) => /\.jar(\.disabled)?$/i.test(f)).length;
  }

  const isSpigotCompatible =
    (supportsBridgePlugin(software) && software !== 'custom') ||
    hasSpigotConfig ||
    hasPaperConfig ||
    hasPurpurConfig ||
    hasLeafConfig;

  const hasValidServerMarker =
    jarCandidates.length > 0 ||
    fsSync.existsSync(propsPath) ||
    fsSync.existsSync(velocityTomlPath) ||
    fsSync.existsSync(eulaPath) ||
    hasNeoForgeLib ||
    hasForgeLib ||
    hasFabricConfig ||
    hasPaperConfig ||
    hasSpigotConfig ||
    hasPurpurConfig ||
    hasLeafConfig ||
    hasFoliaConfig ||
    worldCount > 0;

  if (!hasValidServerMarker) {
    throw new Error(
      'The specified folder does not contain recognizable Minecraft or Velocity server files (no server JAR, server.properties, velocity.toml, or worlds found).',
    );
  }

  const sizeBytes = await getDirectorySize(resolved, 7);

  return {
    sourcePath: resolved,
    suggestedName: path.basename(resolved) || 'Imported Server',
    software,
    mcVersion: mcVersion || '1.21.4',
    jarFile,
    jarCandidates: jarCandidates.length > 0 ? jarCandidates : [jarFile],
    port,
    eulaAccepted,
    isSpigotCompatible,
    worldCount,
    pluginOrModCount,
    sizeBytes,
  };
}

/**
 * Safely moves (or copies) an existing server folder into MCServerManager's data/servers/<id> directory.
 */
export async function transferServerFolder(
  sourcePath: string,
  destDir: string,
  mode: 'move' | 'copy',
): Promise<void> {
  const src = path.resolve(sourcePath.trim().replace(/^["']|["']$/g, ''));
  const dest = path.resolve(destDir);

  if (!fsSync.existsSync(src)) {
    throw new Error(`Source folder does not exist: ${src}`);
  }

  // Prevent moving/copying MCServerManager's own project or data directory into itself
  const srcLower = src.toLowerCase();
  const destLower = dest.toLowerCase();
  const rootLower = path.resolve(PROJECT_ROOT).toLowerCase();
  const dataLower = path.resolve(DATA_DIR).toLowerCase();

  if (
    srcLower === rootLower ||
    srcLower === dataLower ||
    destLower.startsWith(`${srcLower}${path.sep}`) ||
    srcLower.startsWith(`${destLower}${path.sep}`)
  ) {
    throw new Error('Cannot import a folder that contains or overlaps with MCServerManager itself.');
  }

  await fs.mkdir(path.dirname(dest), { recursive: true });

  if (mode === 'move') {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      // Cross-device (e.g. C:\ to D:\) or Windows lock fallback: copy then delete source
      if (code === 'EXDEV' || code === 'EPERM' || code === 'EACCES') {
        await fs.cp(src, dest, { recursive: true, force: true });
        await fs.rm(src, { recursive: true, force: true });
        return;
      }
      throw err;
    }
  }

  await fs.cp(src, dest, { recursive: true, force: true });
}

/**
 * Opens a native Windows folder selection dialog so local users can browse to an existing server directory.
 */
export async function pickLocalFolderDialog(): Promise<string | null> {
  if (process.platform !== 'win32') {
    throw new Error('Native folder picker is only available on Windows');
  }

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Select existing Minecraft server folder'
$dlg.ShowNewFolderButton = $false
$top = New-Object System.Windows.Forms.Form
$top.TopMost = $true
$top.StartPosition = 'CenterScreen'
$top.Opacity = 0
$top.Show()
$res = $dlg.ShowDialog($top)
$top.Close()
$top.Dispose()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dlg.SelectedPath
}
`;

  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-STA', '-NonInteractive', '-Command', psScript],
      { timeout: 120_000 },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const selected = stdout.trim();
        resolve(selected || null);
      },
    );
  });
}
