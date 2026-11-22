import path from 'node:path';
import fs from 'node:fs/promises';
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
 * Safely resolve a relative path strictly inside a root directory, preventing path traversal.
 */
export function resolveInside(rootDir: string, relativePath: string): string {
  const normalizedRoot = path.resolve(rootDir);
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const resolved = path.resolve(normalizedRoot, cleaned);
  const rel = path.relative(normalizedRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Access denied: path escapes root directory');
  }
  return resolved;
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
