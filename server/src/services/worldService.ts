import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { getDirectorySize, normalizeRelPath, resolveInside } from '../utils/fsSafe.js';
import type {
  WorldDimensionEntry,
  WorldInfo,
  WorldLayoutFormat,
  WorldSharedDataInfo,
} from '../../../shared/types.js';

const RESERVED_WORLD_ROOT_DIRS = new Set([
  'dimensions',
  'data',
  'region',
  'entities',
  'poi',
  'playerdata',
  'advancements',
  'stats',
  'datapacks',
  'serverconfig',
  'DIM-1',
  'DIM1',
]);

const RESERVED_DIMENSION_ROOT_DIRS = new Set([
  'region',
  'entities',
  'poi',
  'data',
]);

interface StandardDimensionSpec {
  id: string;
  label: string;
  dimension: 'overworld' | 'nether' | 'end';
  subPath: string;
  legacyPathHint: string;
}

const STANDARD_26_1_DIMENSIONS: StandardDimensionSpec[] = [
  {
    id: 'minecraft:overworld',
    label: 'Overworld',
    dimension: 'overworld',
    subPath: 'dimensions/minecraft/overworld',
    legacyPathHint: 'Moved from root world directory (region, entities, poi, data) in 26.1',
  },
  {
    id: 'minecraft:the_nether',
    label: 'The Nether',
    dimension: 'nether',
    subPath: 'dimensions/minecraft/the_nether',
    legacyPathHint: 'Unified from world_nether (pre-26.1 Bukkit/Paper) & DIM-1 (Vanilla/Singleplayer)',
  },
  {
    id: 'minecraft:the_end',
    label: 'The End',
    dimension: 'end',
    subPath: 'dimensions/minecraft/the_end',
    legacyPathHint: 'Unified from world_the_end (pre-26.1 Bukkit/Paper) & DIM1 (Vanilla/Singleplayer)',
  },
];

export function isMcVersion26OrNewer(mcVersion?: string): boolean {
  if (!mcVersion) return false;
  const trimmed = mcVersion.trim();
  // Matches 26.1, 26.1.1, 26.1-snapshot-6, 26w06a, etc.
  return /^(?:2[6-9]|[3-9]\d)(?:\.|w|-)/i.test(trimmed);
}

function has26_1CoreDimensions(worldFullPath: string): boolean {
  return (
    fsSync.existsSync(path.join(worldFullPath, 'dimensions', 'minecraft', 'overworld')) ||
    fsSync.existsSync(path.join(worldFullPath, 'dimensions', 'minecraft', 'the_nether')) ||
    fsSync.existsSync(path.join(worldFullPath, 'dimensions', 'minecraft', 'the_end'))
  );
}

function hasAnyDimensionsDir(worldFullPath: string): boolean {
  const dimsDir = path.join(worldFullPath, 'dimensions');
  if (!fsSync.existsSync(dimsDir)) return false;
  try {
    return fsSync.readdirSync(dimsDir, { withFileTypes: true }).some((d) => d.isDirectory());
  } catch {
    return false;
  }
}

function hasLegacyDimensionMarkers(worldFullPath: string): boolean {
  return (
    fsSync.existsSync(path.join(worldFullPath, 'region')) ||
    fsSync.existsSync(path.join(worldFullPath, 'DIM-1')) ||
    fsSync.existsSync(path.join(worldFullPath, 'DIM1'))
  );
}

export function isMinecraftWorldDir(worldFullPath: string): boolean {
  return (
    fsSync.existsSync(path.join(worldFullPath, 'level.dat')) ||
    has26_1CoreDimensions(worldFullPath) ||
    hasAnyDimensionsDir(worldFullPath) ||
    hasLegacyDimensionMarkers(worldFullPath)
  );
}

function detectDimension(worldName: string, worldFullPath: string): WorldInfo['dimension'] {
  const hasOverworld26 = fsSync.existsSync(path.join(worldFullPath, 'dimensions', 'minecraft', 'overworld'));
  const hasNether26 = fsSync.existsSync(path.join(worldFullPath, 'dimensions', 'minecraft', 'the_nether'));
  const hasEnd26 = fsSync.existsSync(path.join(worldFullPath, 'dimensions', 'minecraft', 'the_end'));

  if (worldName.endsWith('_nether') || (!hasOverworld26 && hasNether26 && !hasEnd26)) {
    return 'nether';
  }
  if (worldName.endsWith('_the_end') || (!hasOverworld26 && hasEnd26 && !hasNether26)) {
    return 'end';
  }
  if (
    worldName === 'world' ||
    hasOverworld26 ||
    fsSync.existsSync(path.join(worldFullPath, 'level.dat')) ||
    fsSync.existsSync(path.join(worldFullPath, 'region'))
  ) {
    return 'overworld';
  }
  return 'custom';
}

function detectLayoutFormat(
  worldName: string,
  worldFullPath: string,
  allWorldFolderNames: Set<string>,
  mcVersion?: string,
): WorldLayoutFormat {
  // Any Minecraft 26.1+ server or world with dimensions/ directory uses the 26.1+ unified dimensions layout
  if (isMcVersion26OrNewer(mcVersion) || has26_1CoreDimensions(worldFullPath) || hasAnyDimensionsDir(worldFullPath)) {
    return '26.1+';
  }

  // Check if this world is part of a pre-26.1 Bukkit/Spigot/Paper split setup (world + world_nether + world_the_end)
  const isSplitBukkitFolder =
    worldName.endsWith('_nether') ||
    worldName.endsWith('_the_end') ||
    allWorldFolderNames.has(`${worldName}_nether`) ||
    allWorldFolderNames.has(`${worldName}_the_end`) ||
    fsSync.existsSync(path.join(worldFullPath, 'paper-world.yml'));

  if (hasLegacyDimensionMarkers(worldFullPath)) {
    return isSplitBukkitFolder ? 'legacy-bukkit' : 'legacy-vanilla';
  }

  return isSplitBukkitFolder ? 'legacy-bukkit' : 'legacy-vanilla';
}

async function computeRootOverworldSize(worldFullPath: string): Promise<number> {
  let total = 0;
  for (const sub of ['region', 'entities', 'poi', 'data']) {
    const p = path.join(worldFullPath, sub);
    if (fsSync.existsSync(p)) {
      total += await getDirectorySize(p, 4);
    }
  }
  return total;
}

async function buildDimensionEntry(
  worldName: string,
  worldFullPath: string,
  spec: {
    id: string;
    label: string;
    dimension: 'overworld' | 'nether' | 'end' | 'custom';
    subPath: string;
    legacyPathHint?: string;
  },
): Promise<WorldDimensionEntry> {
  const isRoot = spec.subPath === '.';
  const dimFull = isRoot ? worldFullPath : path.join(worldFullPath, ...spec.subPath.split('/'));
  const hasRegion = fsSync.existsSync(path.join(dimFull, 'region'));
  const hasEntities = fsSync.existsSync(path.join(dimFull, 'entities'));
  const hasPoi = fsSync.existsSync(path.join(dimFull, 'poi'));
  const hasData = fsSync.existsSync(path.join(dimFull, 'data'));
  const exists = isRoot ? hasRegion || hasEntities || hasPoi : fsSync.existsSync(dimFull);
  const sizeBytes = exists
    ? isRoot
      ? await computeRootOverworldSize(worldFullPath)
      : await getDirectorySize(dimFull, 5)
    : 0;
  const hasPaperWorldConfig = !isRoot && fsSync.existsSync(path.join(dimFull, 'paper-world.yml'));

  return {
    id: spec.id,
    label: spec.label,
    dimension: spec.dimension,
    subPath: spec.subPath,
    relativePath: isRoot ? worldName : `${worldName}/${spec.subPath}`,
    legacyPathHint: spec.legacyPathHint,
    exists,
    sizeBytes,
    hasRegion,
    hasEntities,
    hasPoi,
    hasData,
    hasPaperWorldConfig,
  };
}

async function discoverWorldDimensions(
  serverDir: string,
  worldName: string,
  worldFullPath: string,
  layoutFormat: WorldLayoutFormat,
): Promise<WorldDimensionEntry[]> {
  const results: WorldDimensionEntry[] = [];
  const seenSubPaths = new Set<string>();

  if (layoutFormat === '26.1+') {
    for (const spec of STANDARD_26_1_DIMENSIONS) {
      seenSubPaths.add(spec.subPath.toLowerCase());
      results.push(await buildDimensionEntry(worldName, worldFullPath, spec));
    }
  } else if (layoutFormat === 'legacy-bukkit') {
    // Pre-26.1 Bukkit / Spigot / Paper split top-level folders (world, world_nether, world_the_end)
    if (worldName.endsWith('_nether')) {
      const subPath = fsSync.existsSync(path.join(worldFullPath, 'DIM-1')) ? 'DIM-1' : '.';
      seenSubPaths.add(subPath.toLowerCase());
      results.push(
        await buildDimensionEntry(worldName, worldFullPath, {
          id: 'minecraft:the_nether',
          label: 'The Nether',
          dimension: 'nether',
          subPath,
          legacyPathHint: 'Pre-26.1 Bukkit/Spigot/Paper separate top-level world_nether folder',
        }),
      );
    } else if (worldName.endsWith('_the_end')) {
      const subPath = fsSync.existsSync(path.join(worldFullPath, 'DIM1')) ? 'DIM1' : '.';
      seenSubPaths.add(subPath.toLowerCase());
      results.push(
        await buildDimensionEntry(worldName, worldFullPath, {
          id: 'minecraft:the_end',
          label: 'The End',
          dimension: 'end',
          subPath,
          legacyPathHint: 'Pre-26.1 Bukkit/Spigot/Paper separate top-level world_the_end folder',
        }),
      );
    } else {
      seenSubPaths.add('.');
      results.push(
        await buildDimensionEntry(worldName, worldFullPath, {
          id: 'minecraft:overworld',
          label: 'Overworld',
          dimension: 'overworld',
          subPath: '.',
          legacyPathHint: 'Pre-26.1 Bukkit/Spigot/Paper root Overworld folder (Nether/End in world_nether & world_the_end)',
        }),
      );
    }
  } else {
    // Pre-26.1 Vanilla / Singleplayer / Modded single-world folder (root + DIM-1 + DIM1)
    const legacyVanillaSpecs = [
      {
        id: 'minecraft:overworld',
        label: 'Overworld',
        dimension: 'overworld' as const,
        subPath: '.',
        legacyPathHint: 'Pre-26.1 Vanilla / Singleplayer root directory',
      },
      {
        id: 'minecraft:the_nether',
        label: 'The Nether',
        dimension: 'nether' as const,
        subPath: 'DIM-1',
        legacyPathHint: 'Pre-26.1 Vanilla / Singleplayer DIM-1 directory',
      },
      {
        id: 'minecraft:the_end',
        label: 'The End',
        dimension: 'end' as const,
        subPath: 'DIM1',
        legacyPathHint: 'Pre-26.1 Vanilla / Singleplayer DIM1 directory',
      },
    ];
    for (const spec of legacyVanillaSpecs) {
      seenSubPaths.add(spec.subPath.toLowerCase());
      results.push(await buildDimensionEntry(worldName, worldFullPath, spec));
    }
  }

  // Also scan <world>/dimensions/<namespace>/<dimension> for any custom / datapack / Multiverse dimensions
  const dimsRoot = path.join(worldFullPath, 'dimensions');
  if (fsSync.existsSync(dimsRoot)) {
    const namespaces = await fs.readdir(dimsRoot, { withFileTypes: true }).catch(() => []);
    for (const ns of namespaces) {
      if (!ns.isDirectory()) continue;
      const nsDir = path.join(dimsRoot, ns.name);
      const dimDirs = await fs.readdir(nsDir, { withFileTypes: true }).catch(() => []);
      for (const d of dimDirs) {
        if (!d.isDirectory()) continue;
        const subPath = `dimensions/${ns.name}/${d.name}`;
        if (seenSubPaths.has(subPath.toLowerCase())) continue;
        seenSubPaths.add(subPath.toLowerCase());

        const matchedStd = STANDARD_26_1_DIMENSIONS.find((s) => s.subPath === subPath);
        results.push(
          await buildDimensionEntry(worldName, worldFullPath, {
            id: `${ns.name}:${d.name}`,
            label: matchedStd ? matchedStd.label : `${ns.name}:${d.name}`,
            dimension: matchedStd ? matchedStd.dimension : 'custom',
            subPath,
            legacyPathHint: matchedStd?.legacyPathHint || 'Custom / plugin dimension under dimensions/',
          }),
        );
      }
    }
  }

  // Also include any configured worlds from plugins/MCServerManagerBridge/realms.json on 26.1+ servers
  if (layoutFormat === '26.1+') {
    const realmsPath = path.join(serverDir, 'plugins', 'MCServerManagerBridge', 'realms.json');
    if (fsSync.existsSync(realmsPath)) {
      try {
        const rawRealms = JSON.parse(await fs.readFile(realmsPath, 'utf8')) as {
          worlds?: Array<{ name?: string; environment?: string }>;
        };
        for (const mw of rawRealms.worlds || []) {
          const rawName = (mw?.name || '').trim();
          if (!rawName) continue;
          const cleanKey = rawName.toLowerCase().replace(/^minecraft:/, '');
          if (cleanKey === 'world' || cleanKey === 'overworld' || cleanKey === 'the_nether' || cleanKey === 'the_end') {
            continue;
          }
          const subPath = `dimensions/minecraft/${cleanKey}`;
          if (seenSubPaths.has(subPath.toLowerCase())) continue;
          seenSubPaths.add(subPath.toLowerCase());
          const dimKind: WorldDimensionEntry['dimension'] =
            mw.environment === 'NETHER'
              ? 'nether'
              : mw.environment === 'THE_END'
                ? 'end'
                : 'custom';
          results.push(
            await buildDimensionEntry(worldName, worldFullPath, {
              id: `minecraft:${cleanKey}`,
              label: rawName,
              dimension: dimKind,
              subPath,
              legacyPathHint: 'Configured in Realms & Worlds',
            }),
          );
        }
      } catch {
        // ignore invalid realms.json
      }
    }
  }

  return results;
}

async function countFilesRecursive(dirPath: string, maxDepth = 4): Promise<number> {
  let count = 0;
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory()) {
        await walk(path.join(current, e.name), depth + 1);
      } else if (e.isFile()) {
        count++;
      }
    }
  }
  await walk(dirPath, 0);
  return count;
}

async function inspectSharedData(worldName: string, worldFullPath: string): Promise<WorldSharedDataInfo> {
  const dataDir = path.join(worldFullPath, 'data');
  const exists = fsSync.existsSync(dataDir);
  const [sizeBytes, fileCount] = exists
    ? await Promise.all([getDirectorySize(dataDir, 5), countFilesRecursive(dataDir, 4)])
    : [0, 0];
  return {
    subPath: 'data',
    relativePath: `${worldName}/data`,
    exists,
    sizeBytes,
    fileCount,
  };
}

export async function listWorlds(serverDir: string, mcVersion?: string): Promise<WorldInfo[]> {
  const worlds: WorldInfo[] = [];
  const entries = await fs.readdir(serverDir, { withFileTypes: true }).catch(() => []);

  const candidateDirs: Array<{ name: string; full: string }> = [];
  const allWorldFolderNames = new Set<string>();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(serverDir, entry.name);
    if (!isMinecraftWorldDir(full)) continue;
    candidateDirs.push({ name: entry.name, full });
    allWorldFolderNames.add(entry.name);
  }

  for (const { name, full } of candidateDirs) {
    const stat = await fs.stat(full);
    const primaryDimension = detectDimension(name, full);
    const layoutFormat = detectLayoutFormat(name, full, allWorldFolderNames, mcVersion);
    const [sizeBytes, dimensions, sharedData] = await Promise.all([
      getDirectorySize(full, 8),
      discoverWorldDimensions(serverDir, name, full, layoutFormat),
      inspectSharedData(name, full),
    ]);

    worlds.push({
      name,
      relativePath: name,
      dimension: primaryDimension,
      layoutFormat,
      sizeBytes,
      modifiedAt: stat.mtime.toISOString(),
      hasPaperWorldConfig: fsSync.existsSync(path.join(full, 'paper-world.yml')),
      hasServerConfigDir: fsSync.existsSync(path.join(full, 'serverconfig')),
      dimensions,
      sharedData,
    });
  }

  worlds.sort((a, b) => a.name.localeCompare(b.name));
  return worlds;
}

export function createWorldZipBuffer(serverDir: string, worldName: string, subPath?: string): Buffer {
  const worldFull = resolveInside(serverDir, worldName);
  if (!fsSync.existsSync(worldFull)) {
    throw new Error(`World "${worldName}" not found`);
  }
  const isRootSub = !subPath || subPath === '.';
  const targetFull = isRootSub ? worldFull : resolveInside(worldFull, subPath);
  if (!fsSync.existsSync(targetFull)) {
    throw new Error(!isRootSub ? `Path "${subPath}" in world "${worldName}" not found` : `World "${worldName}" not found`);
  }
  const archiveRootName = !isRootSub ? path.basename(targetFull) : worldName;
  const zip = new AdmZip();
  zip.addLocalFolder(targetFull, archiveRootName);
  return zip.toBuffer();
}

export async function replaceWorldFromZip(
  serverDir: string,
  worldName: string,
  zipBuffer: Buffer,
  subPath?: string,
): Promise<void> {
  const safeName = worldName.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeName) throw new Error('Invalid world name');
  const worldFull = resolveInside(serverDir, safeName);
  const cleanSubPath = subPath && subPath !== '.' ? normalizeRelPath(subPath) : '';
  const targetFull = cleanSubPath ? resolveInside(worldFull, cleanSubPath) : worldFull;

  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  if (entries.length === 0) throw new Error('Uploaded ZIP archive is empty');

  const topDirs = new Set(
    entries
      .map((e) => e.entryName.replace(/\\/g, '/').split('/')[0])
      .filter(Boolean),
  );

  let stripPrefix = '';

  if (cleanSubPath) {
    const normalizedSub = `${cleanSubPath}/`;
    const allNormalized = entries.map((e) => e.entryName.replace(/\\/g, '/')).filter(Boolean);
    const hasExactSubPrefix = allNormalized.some((p) => p.startsWith(normalizedSub));
    if (hasExactSubPrefix) {
      stripPrefix = normalizedSub;
    } else {
      // Check if archive wraps a single 26.1 dimension inside dimensions/<ns>/<dim>/
      const dimMatch = allNormalized[0]?.match(/^(dimensions\/[^/]+\/[^/]+\/)/);
      if (dimMatch && allNormalized.every((p) => p.startsWith(dimMatch[1]) || `${p}/` === dimMatch[1])) {
        stripPrefix = dimMatch[1];
      } else if (topDirs.size === 1) {
        const [singleTop] = Array.from(topDirs);
        const hasRootFilesOutsideTop = allNormalized.some((p) => !p.includes('/') && p !== singleTop);
        if (!hasRootFilesOutsideTop && !RESERVED_DIMENSION_ROOT_DIRS.has(singleTop)) {
          stripPrefix = `${singleTop}/`;
          // If inside that top wrapper folder there is dimensions/<ns>/<dim>/, unwrap that too
          const afterTop = allNormalized
            .filter((p) => p.startsWith(stripPrefix))
            .map((p) => p.slice(stripPrefix.length))
            .filter(Boolean);
          const nestedDimMatch = afterTop[0]?.match(/^(dimensions\/[^/]+\/[^/]+\/)/);
          if (
            nestedDimMatch &&
            afterTop.every((p) => p.startsWith(nestedDimMatch[1]) || `${p}/` === nestedDimMatch[1])
          ) {
            stripPrefix = `${stripPrefix}${nestedDimMatch[1]}`;
          }
        }
      }
    }
  } else {
    const hasRootLevelDat = entries.some((e) => e.entryName.replace(/\\/g, '/') === 'level.dat');
    if (!hasRootLevelDat && topDirs.size === 1) {
      const [singleDir] = Array.from(topDirs);
      if (!RESERVED_WORLD_ROOT_DIRS.has(singleDir)) {
        stripPrefix = `${singleDir}/`;
      }
    }
  }

  await fs.rm(targetFull, { recursive: true, force: true });
  await fs.mkdir(targetFull, { recursive: true });

  for (const entry of entries) {
    const normalized = entry.entryName.replace(/\\/g, '/');
    let innerRel = normalized;
    if (stripPrefix) {
      if (!normalized.startsWith(stripPrefix)) continue;
      innerRel = normalized.slice(stripPrefix.length);
    }
    if (!innerRel || innerRel.startsWith('..')) continue;
    const dest = resolveInside(targetFull, innerRel);
    if (entry.isDirectory) {
      await fs.mkdir(dest, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, entry.getData());
    }
  }
}

export async function deleteWorld(serverDir: string, worldName: string, subPath?: string): Promise<void> {
  const worldFull = resolveInside(serverDir, worldName);
  const cleanSubPath = subPath && subPath !== '.' ? subPath : undefined;
  const targetFull = cleanSubPath ? resolveInside(worldFull, cleanSubPath) : worldFull;
  await fs.rm(targetFull, { recursive: true, force: true });
}
