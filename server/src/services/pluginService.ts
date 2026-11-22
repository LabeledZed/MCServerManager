import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import YAML from 'yaml';
import { parse as parseToml } from 'smol-toml';
import { USER_AGENT } from '../config.js';
import {
  detectConfigFormat,
  isBinaryFilename,
  normalizeRelPath,
  resolveInside,
} from '../utils/fsSafe.js';
import type {
  AddonConfigFile,
  AddonKind,
  AddonManifestInfo,
  InstalledAddon,
  ModrinthSearchResult,
  ModrinthVersionInfo,
  OrphanConfigFolder,
  ServerSoftware,
} from '../../../shared/types.js';

const MOD_LOADERS: ServerSoftware[] = ['fabric', 'forge', 'neoforge'];

export function getAddonKindForSoftware(software: ServerSoftware): AddonKind {
  return MOD_LOADERS.includes(software) ? 'mod' : 'plugin';
}

export function getAddonDirName(software: ServerSoftware): 'mods' | 'plugins' {
  return MOD_LOADERS.includes(software) ? 'mods' : 'plugins';
}

function readZipEntryText(zip: AdmZip, entryName: string): string | null {
  const entry = zip.getEntry(entryName);
  if (!entry || entry.isDirectory) return null;
  try {
    return entry.getData().toString('utf8');
  } catch {
    return null;
  }
}

function normalizeAuthors(raw: unknown): string[] | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) {
    return raw
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a && typeof a === 'object' && 'name' in a) return String((a as { name: unknown }).name);
        return '';
      })
      .filter(Boolean);
  }
  return undefined;
}

/**
 * Inspects a Minecraft plugin or mod .jar archive to extract manifest metadata
 * (manifest.json, paper-plugin.yml, plugin.yml, bungee.yml, velocity-plugin.json,
 * fabric.mod.json, quilt.mod.json, META-INF/neoforge.mods.toml, META-INF/mods.toml, MANIFEST.MF).
 */
export function inspectJarManifest(jarFullPath: string): AddonManifestInfo {
  const baseName = path.basename(jarFullPath).replace(/\.disabled$/i, '').replace(/\.jar$/i, '');
  const fallbackName = baseName.replace(/[-_](v?\d[\d.a-zA-Z_-]*)$/, '') || baseName;

  try {
    const zip = new AdmZip(jarFullPath);

    // 1. manifest.json (explicitly requested & used by several modern plugins/packs)
    const manifestJsonRaw = readZipEntryText(zip, 'manifest.json');
    if (manifestJsonRaw) {
      try {
        const m = JSON.parse(manifestJsonRaw) as Record<string, unknown>;
        const name = String(m.name || m.Name || m.id || fallbackName);
        return {
          name,
          id: String(m.id || m.Id || name).toLowerCase(),
          version: String(m.version || m.Version || 'unknown'),
          description: typeof m.description === 'string' ? m.description : typeof m.Description === 'string' ? m.Description : undefined,
          authors: normalizeAuthors(m.authors || m.Authors || m.author || m.Author),
          website: typeof m.website === 'string' ? m.website : typeof m.Website === 'string' ? m.Website : undefined,
          manifestSource: 'manifest.json',
        };
      } catch {
        // fall through to other manifests
      }
    }

    // 2. paper-plugin.yml (Paper 1.19.3+)
    const paperPluginYml = readZipEntryText(zip, 'paper-plugin.yml');
    if (paperPluginYml) {
      try {
        const y = YAML.parse(paperPluginYml) as Record<string, unknown>;
        if (y && typeof y === 'object') {
          const name = String(y.name || fallbackName);
          return {
            name,
            id: name.toLowerCase(),
            version: String(y.version || 'unknown'),
            description: typeof y.description === 'string' ? y.description : undefined,
            authors: normalizeAuthors(y.authors || y.author),
            website: typeof y.website === 'string' ? y.website : undefined,
            apiVersion: y['api-version'] ? String(y['api-version']) : undefined,
            manifestSource: 'paper-plugin.yml',
          };
        }
      } catch {
        // fall through
      }
    }

    // 3. plugin.yml (Bukkit / Spigot / Paper / Purpur)
    const pluginYml = readZipEntryText(zip, 'plugin.yml');
    if (pluginYml) {
      try {
        const y = YAML.parse(pluginYml) as Record<string, unknown>;
        if (y && typeof y === 'object') {
          const name = String(y.name || fallbackName);
          return {
            name,
            id: name.toLowerCase(),
            version: String(y.version || 'unknown'),
            description: typeof y.description === 'string' ? y.description : undefined,
            authors: normalizeAuthors(y.authors || y.author),
            website: typeof y.website === 'string' ? y.website : undefined,
            apiVersion: y['api-version'] ? String(y['api-version']) : undefined,
            manifestSource: 'plugin.yml',
          };
        }
      } catch {
        // fall through
      }
    }

    // 4. velocity-plugin.json
    const velocityJson = readZipEntryText(zip, 'velocity-plugin.json');
    if (velocityJson) {
      try {
        const v = JSON.parse(velocityJson) as Record<string, unknown>;
        const name = String(v.name || v.id || fallbackName);
        return {
          name,
          id: String(v.id || name).toLowerCase(),
          version: String(v.version || 'unknown'),
          description: typeof v.description === 'string' ? v.description : undefined,
          authors: normalizeAuthors(v.authors),
          website: typeof v.url === 'string' ? v.url : undefined,
          manifestSource: 'velocity-plugin.json',
        };
      } catch {
        // fall through
      }
    }

    // 5. bungee.yml
    const bungeeYml = readZipEntryText(zip, 'bungee.yml');
    if (bungeeYml) {
      try {
        const y = YAML.parse(bungeeYml) as Record<string, unknown>;
        if (y && typeof y === 'object') {
          const name = String(y.name || fallbackName);
          return {
            name,
            id: name.toLowerCase(),
            version: String(y.version || 'unknown'),
            description: typeof y.description === 'string' ? y.description : undefined,
            authors: normalizeAuthors(y.author || y.authors),
            manifestSource: 'bungee.yml',
          };
        }
      } catch {
        // fall through
      }
    }

    // 6. fabric.mod.json
    const fabricJson = readZipEntryText(zip, 'fabric.mod.json');
    if (fabricJson) {
      try {
        const f = JSON.parse(fabricJson) as Record<string, unknown>;
        const name = String(f.name || f.id || fallbackName);
        const contact = (f.contact || {}) as Record<string, unknown>;
        return {
          name,
          id: String(f.id || name).toLowerCase(),
          version: String(f.version || 'unknown'),
          description: typeof f.description === 'string' ? f.description : undefined,
          authors: normalizeAuthors(f.authors),
          website: typeof contact.homepage === 'string' ? contact.homepage : undefined,
          manifestSource: 'fabric.mod.json',
        };
      } catch {
        // fall through
      }
    }

    // 7. quilt.mod.json
    const quiltJson = readZipEntryText(zip, 'quilt.mod.json');
    if (quiltJson) {
      try {
        const q = JSON.parse(quiltJson) as {
          quilt_loader?: { id?: string; version?: string; metadata?: { name?: string; description?: string } };
        };
        const loader = q.quilt_loader;
        const name = String(loader?.metadata?.name || loader?.id || fallbackName);
        return {
          name,
          id: String(loader?.id || name).toLowerCase(),
          version: String(loader?.version || 'unknown'),
          description: loader?.metadata?.description,
          manifestSource: 'quilt.mod.json',
        };
      } catch {
        // fall through
      }
    }

    // 8. META-INF/neoforge.mods.toml or META-INF/mods.toml
    for (const tomlPath of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
      const tomlRaw = readZipEntryText(zip, tomlPath);
      if (tomlRaw) {
        try {
          const parsed = parseToml(tomlRaw) as {
            mods?: Array<Record<string, unknown>>;
          };
          const mod = Array.isArray(parsed.mods) ? parsed.mods[0] : undefined;
          if (mod) {
            const name = String(mod.displayName || mod.modId || fallbackName);
            return {
              name,
              id: String(mod.modId || name).toLowerCase(),
              version: String(mod.version || 'unknown'),
              description: typeof mod.description === 'string' ? mod.description.trim() : undefined,
              authors: normalizeAuthors(mod.authors),
              website: typeof mod.displayURL === 'string' ? mod.displayURL : undefined,
              manifestSource: tomlPath,
            };
          }
        } catch {
          // fall through
        }
      }
    }

    // 9. META-INF/MANIFEST.MF fallback
    const manifestMf = readZipEntryText(zip, 'META-INF/MANIFEST.MF');
    if (manifestMf) {
      const title = manifestMf.match(/^Implementation-Title:\s*(.+)$/m)?.[1]?.trim();
      const version = manifestMf.match(/^Implementation-Version:\s*(.+)$/m)?.[1]?.trim();
      if (title) {
        return {
          name: title,
          id: title.toLowerCase().replace(/\s+/g, '-'),
          version: version || 'unknown',
          manifestSource: 'META-INF/MANIFEST.MF',
        };
      }
    }
  } catch {
    // Corrupted or non-zip jar
  }

  return {
    name: fallbackName,
    id: fallbackName.toLowerCase(),
    version: 'unknown',
    manifestSource: 'filename',
  };
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'cache', 'caches', 'libs', 'libraries', 'tmp', 'temp']);

/**
 * Recursively collects all config files in a plugin/mod folder (both root files AND nested subfolder files).
 */
async function collectConfigFilesRecursively(
  serverDir: string,
  configRootFull: string,
  maxFiles = 400,
): Promise<AddonConfigFile[]> {
  const files: AddonConfigFile[] = [];

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (depth > 8 || files.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort: files in current dir first (config.yml first), then subdirectories alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? 1 : -1;
      if (!a.isDirectory()) {
        const aIsMain = /^config\.(yml|yaml|json|toml|properties)$/i.test(a.name);
        const bIsMain = /^config\.(yml|yaml|json|toml|properties)$/i.test(b.name);
        if (aIsMain !== bIsMain) return aIsMain ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const isBin = isBinaryFilename(entry.name);
        try {
          const stat = await fs.stat(fullPath);
          const relativePath = normalizeRelPath(path.relative(serverDir, fullPath));
          const subPath = normalizeRelPath(path.relative(configRootFull, fullPath));
          const folder = path.dirname(subPath) === '.' ? '' : normalizeRelPath(path.dirname(subPath));
          files.push({
            relativePath,
            subPath,
            folder,
            fileName: entry.name,
            format: isBin ? 'raw' : detectConfigFormat(entry.name),
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            isBinary: isBin,
          });
        } catch {
          // ignore transient files
        }
      }
    }
  }

  await walk(configRootFull, 0);
  return files;
}

function normalizeMatchKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Matches a plugin's manifest name/id to its config folder inside plugins/ (case-insensitive & flexible).
 */
function matchPluginConfigFolder(
  manifest: AddonManifestInfo,
  existingFolders: string[],
  override?: string,
): string | null {
  if (override) {
    const exact = existingFolders.find((f) => f.toLowerCase() === override.toLowerCase());
    if (exact) return exact;
    return override;
  }

  // 1. Exact match on manifest.name
  const exactName = existingFolders.find((f) => f === manifest.name);
  if (exactName) return exactName;

  // 2. Case-insensitive match on manifest.name or manifest.id
  const ciName = existingFolders.find(
    (f) => f.toLowerCase() === manifest.name.toLowerCase() || f.toLowerCase() === manifest.id.toLowerCase(),
  );
  if (ciName) return ciName;

  // 3. Normalized alphanumeric match (e.g. "WorldEdit-Bukkit" vs "WorldEdit", "LuckPerms" vs "luckperms")
  const normName = normalizeMatchKey(manifest.name);
  const normId = normalizeMatchKey(manifest.id);
  const normMatch = existingFolders.find((f) => {
    const nf = normalizeMatchKey(f);
    return nf === normName || nf === normId;
  });
  if (normMatch) return normMatch;

  return null;
}

/**
 * Discovers config files for a mod inside config/ (both root-level files like config/<modid>.toml
 * and nested directories like config/<modid>/**) plus <world>/serverconfig/<modid>*.
 */
async function discoverModConfigs(
  serverDir: string,
  manifest: AddonManifestInfo,
  override?: string,
): Promise<{ configFolder: string | null; files: AddonConfigFile[] }> {
  const configDir = path.join(serverDir, 'config');
  const files: AddonConfigFile[] = [];
  let configFolder: string | null = null;

  const candidates = Array.from(
    new Set(
      [override, manifest.id, manifest.name, normalizeMatchKey(manifest.id), normalizeMatchKey(manifest.name)]
        .filter((x): x is string => Boolean(x))
        .map((x) => x.toLowerCase()),
    ),
  );

  if (fsSync.existsSync(configDir)) {
    const entries = await fs.readdir(configDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      const baseNoExt = lower.replace(/\.[^.]+$/, '');
      const matches = candidates.some(
        (c) =>
          lower === c ||
          baseNoExt === c ||
          baseNoExt.startsWith(`${c}-`) ||
          baseNoExt.startsWith(`${c}_`) ||
          normalizeMatchKey(baseNoExt) === normalizeMatchKey(c),
      );

      if (!matches) continue;

      const full = path.join(configDir, entry.name);
      if (entry.isDirectory()) {
        configFolder = `config/${entry.name}`;
        const nested = await collectConfigFilesRecursively(serverDir, full);
        files.push(...nested);
      } else if (entry.isFile()) {
        const isBin = isBinaryFilename(entry.name);
        const stat = await fs.stat(full).catch(() => null);
        if (stat) {
          if (!configFolder) configFolder = 'config';
          files.push({
            relativePath: normalizeRelPath(path.relative(serverDir, full)),
            subPath: entry.name,
            folder: '',
            fileName: entry.name,
            format: isBin ? 'raw' : detectConfigFormat(entry.name),
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            isBinary: isBin,
          });
        }
      }
    }
  }

  // Also inspect per-world serverconfig/<modid>*.toml (Forge/NeoForge)
  try {
    const rootItems = await fs.readdir(serverDir, { withFileTypes: true });
    for (const item of rootItems) {
      if (!item.isDirectory()) continue;
      const scDir = path.join(serverDir, item.name, 'serverconfig');
      if (!fsSync.existsSync(scDir)) continue;
      const scEntries = await fs.readdir(scDir, { withFileTypes: true }).catch(() => []);
      for (const f of scEntries) {
        if (!f.isFile()) continue;
        const lower = f.name.toLowerCase();
        const matches = candidates.some((c) => lower.startsWith(`${c}-`) || lower.startsWith(`${c}.`));
        if (!matches) continue;
        const full = path.join(scDir, f.name);
        const stat = await fs.stat(full).catch(() => null);
        if (stat) {
          files.push({
            relativePath: normalizeRelPath(path.relative(serverDir, full)),
            subPath: `${item.name}/serverconfig/${f.name}`,
            folder: `${item.name}/serverconfig`,
            fileName: f.name,
            format: detectConfigFormat(f.name),
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            isBinary: false,
          });
        }
      }
    }
  } catch {
    // ignore
  }

  return { configFolder, files };
}

export async function listInstalledAddons(
  serverDir: string,
  software: ServerSoftware,
  folderOverrides: Record<string, string> = {},
  pendingDeletionNames: string[] = [],
): Promise<{ kind: AddonKind; addonDir: string; addons: InstalledAddon[]; orphanFolders: OrphanConfigFolder[] }> {
  const kind = getAddonKindForSoftware(software);
  const addonDirName = getAddonDirName(software);
  const addonDirFull = path.join(serverDir, addonDirName);
  await fs.mkdir(addonDirFull, { recursive: true });
  const pendingSet = new Set(pendingDeletionNames.map((n) => n.toLowerCase()));

  const entries = await fs.readdir(addonDirFull, { withFileTypes: true });
  const foldersInAddonDir = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name.toLowerCase() !== 'update')
    .map((e) => e.name);

  const jarEntries = entries.filter(
    (e) => e.isFile() && (/\.jar$/i.test(e.name) || /\.jar\.disabled$/i.test(e.name)),
  );

  const matchedFolders = new Set<string>();
  const addons: InstalledAddon[] = [];

  for (const entry of jarEntries) {
    const fullJarPath = path.join(addonDirFull, entry.name);
    const stat = await fs.stat(fullJarPath);
    const enabled = !entry.name.toLowerCase().endsWith('.disabled');
    const manifest = inspectJarManifest(fullJarPath);
    const override = folderOverrides[entry.name] || folderOverrides[entry.name.replace(/\.disabled$/i, '')];

    let configFolder: string | null = null;
    let configFiles: AddonConfigFile[] = [];

    if (kind === 'plugin') {
      const matched = matchPluginConfigFolder(manifest, foldersInAddonDir, override);
      if (matched) {
        matchedFolders.add(matched.toLowerCase());
        const folderFull = path.join(addonDirFull, matched);
        if (fsSync.existsSync(folderFull)) {
          configFolder = `${addonDirName}/${matched}`;
          configFiles = await collectConfigFilesRecursively(serverDir, folderFull);
        } else {
          configFolder = `${addonDirName}/${matched}`;
        }
      }
    } else {
      const modCfg = await discoverModConfigs(serverDir, manifest, override);
      configFolder = modCfg.configFolder;
      configFiles = modCfg.files;
    }

    addons.push({
      fileName: entry.name,
      kind,
      enabled,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      manifest,
      configFolder,
      configFolderOverride: override,
      pendingDeletion: pendingSet.has(entry.name.toLowerCase()),
      configFiles,
    });
  }

  addons.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

  // Collect unmatched config folders inside plugins/ (or config/ subfolders for mods) so user can always edit them too
  const orphanFolders: OrphanConfigFolder[] = [];
  if (kind === 'plugin') {
    for (const folder of foldersInAddonDir) {
      if (matchedFolders.has(folder.toLowerCase())) continue;
      const folderFull = path.join(addonDirFull, folder);
      const configFiles = await collectConfigFilesRecursively(serverDir, folderFull);
      orphanFolders.push({
        folderName: folder,
        relativePath: `${addonDirName}/${folder}`,
        configFiles,
      });
    }
  } else {
    const configDir = path.join(serverDir, 'config');
    if (fsSync.existsSync(configDir)) {
      const cfgEntries = await fs.readdir(configDir, { withFileTypes: true }).catch(() => []);
      const usedFolders = new Set(addons.map((a) => a.configFolder?.toLowerCase()).filter(Boolean));
      for (const entry of cfgEntries) {
        if (!entry.isDirectory()) continue;
        const rel = `config/${entry.name}`;
        if (usedFolders.has(rel.toLowerCase())) continue;
        const configFiles = await collectConfigFilesRecursively(serverDir, path.join(configDir, entry.name));
        orphanFolders.push({
          folderName: entry.name,
          relativePath: rel,
          configFiles,
        });
      }
    }
  }

  return { kind, addonDir: addonDirName, addons, orphanFolders };
}

function isFileLockError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

export async function toggleAddonEnabled(
  serverDir: string,
  software: ServerSoftware,
  fileName: string,
): Promise<string> {
  const addonDirName = getAddonDirName(software);
  const currentPath = resolveInside(serverDir, `${addonDirName}/${fileName}`);
  const isDisabled = fileName.toLowerCase().endsWith('.disabled');
  const nextName = isDisabled ? fileName.slice(0, -'.disabled'.length) : `${fileName}.disabled`;
  const nextPath = resolveInside(serverDir, `${addonDirName}/${nextName}`);
  try {
    await fs.rename(currentPath, nextPath);
  } catch (err) {
    if (isFileLockError(err)) {
      throw new Error('Cannot disable/enable a loaded plugin while the server is running (file is locked by Java). Stop the server first.');
    }
    throw err;
  }
  return nextName;
}

export async function deleteAddon(
  serverDir: string,
  software: ServerSoftware,
  fileName: string,
  deleteConfigFolder = false,
  configFolderRel?: string | null,
): Promise<{ deletedImmediately: boolean; locked: boolean }> {
  const addonDirName = getAddonDirName(software);
  const jarPath = resolveInside(serverDir, `${addonDirName}/${fileName}`);

  try {
    await fs.rm(jarPath, { force: true });
  } catch (err) {
    if (isFileLockError(err)) {
      return { deletedImmediately: false, locked: true };
    }
    throw err;
  }

  if (deleteConfigFolder && configFolderRel && configFolderRel !== 'config' && configFolderRel !== addonDirName) {
    const cfgFull = resolveInside(serverDir, configFolderRel);
    try {
      await fs.rm(cfgFull, { recursive: true, force: true });
    } catch (err) {
      if (isFileLockError(err)) {
        return { deletedImmediately: false, locked: true };
      }
      throw err;
    }
  }

  return { deletedImmediately: true, locked: false };
}

// ---------- Modrinth Search & 1-Click Install ----------

function mapSoftwareToModrinthLoader(software: ServerSoftware): string {
  switch (software) {
    case 'paper':
    case 'purpur':
    case 'leaf':
    case 'folia':
    case 'spigot':
      return software === 'spigot' ? 'spigot' : 'paper';
    case 'fabric':
      return 'fabric';
    case 'neoforge':
      return 'neoforge';
    case 'forge':
      return 'forge';
    case 'velocity':
      return 'velocity';
    default:
      return 'paper';
  }
}

export async function searchModrinthAddons(
  query: string,
  software: ServerSoftware,
  mcVersion?: string,
  limit = 20,
): Promise<ModrinthSearchResult[]> {
  const loader = mapSoftwareToModrinthLoader(software);
  const kind = getAddonKindForSoftware(software);
  const facets: string[][] = [
    [`categories:${loader}`],
    [`project_type:${kind === 'mod' ? 'mod' : 'plugin'}`],
  ];
  if (mcVersion && software !== 'velocity') {
    facets.push([`versions:${mcVersion}`]);
  }

  const params = new URLSearchParams({
    query: query.trim(),
    facets: JSON.stringify(facets),
    limit: String(limit),
    index: query.trim() ? 'relevance' : 'downloads',
  });

  const url = `https://api.modrinth.com/v2/search?${params.toString()}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Modrinth search failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as {
    hits: Array<{
      project_id: string;
      slug: string;
      title: string;
      description: string;
      author: string;
      icon_url?: string;
      downloads: number;
      categories: string[];
      versions: string[];
      project_type: string;
    }>;
  };

  return (data.hits || []).map((h) => ({
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    iconUrl: h.icon_url || null,
    downloads: h.downloads,
    categories: h.categories || [],
    versions: h.versions || [],
    projectType: h.project_type,
  }));
}

export async function listModrinthVersions(
  projectId: string,
  software: ServerSoftware,
  mcVersion?: string,
): Promise<ModrinthVersionInfo[]> {
  const loader = mapSoftwareToModrinthLoader(software);
  const loadersParam = loader === 'paper' ? ['paper', 'spigot', 'bukkit', 'purpur'] : [loader];
  const params = new URLSearchParams({
    loaders: JSON.stringify(loadersParam),
  });
  if (mcVersion && software !== 'velocity') {
    params.set('game_versions', JSON.stringify([mcVersion]));
  }

  let res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  let raw = res.ok ? ((await res.json()) as Array<Record<string, unknown>>) : [];

  // If strict mcVersion filter returned empty, fall back to loader-only so user can still pick a compatible build
  if (raw.length === 0 && mcVersion) {
    const fallbackParams = new URLSearchParams({ loaders: JSON.stringify(loadersParam) });
    res = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version?${fallbackParams}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    raw = res.ok ? ((await res.json()) as Array<Record<string, unknown>>) : [];
  }

  return raw
    .map((v) => {
      const files = (v.files as Array<{ filename: string; url: string; size: number; primary?: boolean }>) || [];
      const primary = files.find((f) => f.primary) || files[0];
      if (!primary) return null;
      return {
        id: String(v.id),
        name: String(v.name || v.version_number),
        versionNumber: String(v.version_number),
        gameVersions: (v.game_versions as string[]) || [],
        loaders: (v.loaders as string[]) || [],
        datePublished: String(v.date_published || ''),
        fileName: primary.filename,
        downloadUrl: primary.url,
        fileSize: primary.size,
      };
    })
    .filter((x): x is ModrinthVersionInfo => x !== null)
    .slice(0, 20);
}

export async function installFromModrinth(
  serverDir: string,
  software: ServerSoftware,
  downloadUrl: string,
  fileName: string,
): Promise<string> {
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._+-]/g, '_');
  if (!safeName.toLowerCase().endsWith('.jar')) {
    throw new Error('Only .jar plugin/mod files can be installed');
  }
  const addonDirName = getAddonDirName(software);
  const targetPath = resolveInside(serverDir, `${addonDirName}/${safeName}`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const res = await fetch(downloadUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Failed to download ${safeName} (HTTP ${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(targetPath, buf);
  return safeName;
}
