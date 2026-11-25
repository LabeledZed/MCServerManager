import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import type { ConfigFormat } from '../../../shared/types.js';

const BINARY_EXTENSIONS = new Set([
  '.jar', '.zip', '.tar', '.gz', '.7z', '.rar', '.xz', '.bz2',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
  '.dat', '.dat_old', '.mca', '.mcr', '.nbt', '.schematic', '.schem', '.litematic',
  '.db', '.sqlite', '.sqlite3', '.mv.db', '.trace.db', '.h2.db', '.ldb', '.sst',
  '.ogg', '.mp3', '.wav', '.mp4', '.webm',
  '.exe', '.dll', '.so', '.dylib', '.class', '.bin', '.lock',
]);

/**
 * Safely resolve a relative path strictly inside a root directory, preventing lexical
 * path traversal as well as symlink / Windows NTFS junction escapes.
 */
export function resolveInside(rootDir: string, relativePath: string): string {
  const normalizedRoot = path.resolve(rootDir);
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(normalizedRoot, cleaned);
  const rel = path.relative(normalizedRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Access denied: path escapes root directory');
  }

  if (fsSync.existsSync(normalizedRoot)) {
    const realRoot = fsSync.realpathSync(normalizedRoot);
    const segments = rel ? rel.split(path.sep).filter(Boolean) : [];
    let cur = normalizedRoot;
    for (const seg of segments) {
      cur = path.join(cur, seg);
      if (!fsSync.existsSync(cur)) {
        break;
      }
      const lstat = fsSync.lstatSync(cur);
      if (lstat.isSymbolicLink()) {
        throw new Error('Access denied: symbolic links are not permitted inside server directory');
      }
      const realCur = fsSync.realpathSync(cur);
      const realRel = path.relative(realRoot, realCur);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new Error('Access denied: resolved real path escapes root directory');
      }
    }
  }

  return resolved;
}

export interface ZipEntryLike {
  entryName: string;
  isDirectory: boolean;
  header?: { size?: number };
}

export const MAX_ZIP_ENTRIES = 10_000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1 GB
export const MAX_ZIP_SINGLE_ENTRY_BYTES = 512 * 1024 * 1024; // 512 MB

export function assertSafeZipEntries(
  entries: ZipEntryLike[],
  maxEntries = MAX_ZIP_ENTRIES,
  maxTotalBytes = MAX_ZIP_UNCOMPRESSED_BYTES,
  maxEntryBytes = MAX_ZIP_SINGLE_ENTRY_BYTES,
): void {
  if (entries.length > maxEntries) {
    throw new Error(`Archive contains too many entries (${entries.length} > ${maxEntries})`);
  }
  let totalUncompressed = 0;
  for (const entry of entries) {
    const declaredSize = Number(entry.header?.size ?? 0);
    if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > maxEntryBytes) {
      throw new Error(`Archive entry "${entry.entryName}" exceeds maximum allowed uncompressed size`);
    }
    totalUncompressed += declaredSize;
    if (totalUncompressed > maxTotalBytes) {
      throw new Error('Archive total uncompressed size exceeds safety limit (potential zip bomb)');
    }
  }
}

export function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function detectConfigFormat(fileName: string): ConfigFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml';
  if (lower.endsWith('.json') || lower.endsWith('.json5') || lower.endsWith('.jsonc')) return 'json';
  if (lower.endsWith('.toml')) return 'toml';
  if (lower.endsWith('.properties')) return 'properties';
  return 'raw';
}

export function isBinaryFilename(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mv.db') || lower.endsWith('.trace.db') || lower.endsWith('.h2.db')) {
    return true;
  }
  const ext = path.extname(lower);
  return BINARY_EXTENSIONS.has(ext);
}

export async function isLikelyBinaryBuffer(buf: Buffer): Promise<boolean> {
  const len = Math.min(buf.length, 4096);
  let suspicious = 0;
  for (let i = 0; i < len; i++) {
    const byte = buf[i];
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious++;
  }
  return len > 0 && suspicious / len > 0.15;
}

export async function atomicWriteFile(filePath: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
  await fs.writeFile(tmpPath, content);
  try {
    await fs.rename(tmpPath, filePath);
  } catch {
    // Windows rename fallback if destination is locked/exists
    await fs.writeFile(filePath, content);
    await fs.rm(tmpPath, { force: true }).catch(() => {});
  }
}

export async function getDirectorySize(dirPath: string, maxDepth = 6): Promise<number> {
  let total = 0;
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full);
          total += stat.size;
        } catch {
          // ignore transient files
        }
      }
    }
  }
  await walk(dirPath, 0);
  return total;
}
