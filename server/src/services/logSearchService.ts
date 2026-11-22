import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { resolveInside } from '../utils/fsSafe.js';
import type { LogFileInfo, LogSearchMatch, LogSearchResponse } from '../../../shared/types.js';

const gunzip = promisify(zlib.gunzip);
const LOG_FILENAME_RE = /^[\w.-]+\.log(\.gz)?$/i;
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const MAX_QUERY_LENGTH = 500;

export interface BuildMatcherOptions {
  regex?: boolean;
  caseSensitive?: boolean;
}

export interface SearchLogsOptions extends BuildMatcherOptions {
  query: string;
  files?: string[];
  maxResults?: number;
}

function escapeRegexLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

export function buildMatcher(query: string, opts: BuildMatcherOptions = {}): RegExp {
  if (typeof query !== 'string' || query.length === 0) {
    throw new Error('Search query must not be empty');
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new Error(`Search query must not exceed ${MAX_QUERY_LENGTH} characters`);
  }

  const pattern = opts.regex ? query : escapeRegexLiteral(query);
  const flags = opts.caseSensitive ? '' : 'i';

  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regular expression: ${msg}`);
  }
}

export async function listLogFiles(serverDir: string): Promise<LogFileInfo[]> {
  const logsDir = path.join(serverDir, 'logs');
  let entries;
  try {
    entries = await fs.readdir(logsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const items: Array<LogFileInfo & { mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !LOG_FILENAME_RE.test(entry.name)) {
      continue;
    }
    const fullPath = path.join(logsDir, entry.name);
    try {
      const stat = await fs.stat(fullPath);
      items.push({
        name: entry.name,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // Skip transient or unreadable files
    }
  }

  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.map(({ name, sizeBytes, modifiedAt }) => ({ name, sizeBytes, modifiedAt }));
}

function validateLogFileName(name: string): string {
  if (typeof name !== 'string' || path.basename(name) !== name || !LOG_FILENAME_RE.test(name)) {
    throw new Error(`Invalid log filename: ${String(name)}`);
  }
  return name;
}

export async function searchLogs(serverDir: string, options: SearchLogsOptions): Promise<LogSearchResponse> {
  const matcher = buildMatcher(options.query, {
    regex: options.regex,
    caseSensitive: options.caseSensitive,
  });

  const maxResults = Math.max(1, Math.min(5000, Math.floor(options.maxResults ?? 2000)));
  const scanCap = maxResults * 10;
  const logsDir = path.join(serverDir, 'logs');

  let targetNames: string[];
  if (options.files !== undefined) {
    if (!Array.isArray(options.files)) {
      throw new Error('files must be an array of filenames');
    }
    const validated = options.files.map(validateLogFileName);
    if (validated.length > 0) {
      targetNames = validated;
    } else {
      targetNames = (await listLogFiles(serverDir)).map((f) => f.name);
    }
  } else {
    targetNames = (await listLogFiles(serverDir)).map((f) => f.name);
  }

  // Resolve all paths upfront so invalid/escaping paths fail before reading
  const targetFiles = targetNames.map((name) => ({
    name,
    fullPath: resolveInside(logsDir, name),
  }));

  const matches: LogSearchMatch[] = [];
  let filesSearched = 0;
  let totalMatches = 0;
  let truncated = false;

  for (const file of targetFiles) {
    if (totalMatches >= scanCap) {
      break;
    }

    let content: string;
    try {
      const rawBuf = await fs.readFile(file.fullPath);
      const decodedBuf = file.name.toLowerCase().endsWith('.gz') ? await gunzip(rawBuf) : rawBuf;
      content = stripAnsi(decodedBuf.toString('utf8'));
    } catch {
      // Skip unreadable or corrupt files instead of failing the whole search
      continue;
    }

    filesSearched++;
    const lines = content.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      if (!matcher.test(lineText)) {
        continue;
      }

      totalMatches++;
      if (matches.length < maxResults) {
        matches.push({
          file: file.name,
          lineNumber: i + 1,
          text: lineText,
        });
      } else {
        truncated = true;
      }

      if (totalMatches >= scanCap) {
        truncated = true;
        break;
      }
    }
  }

  return {
    matches,
    filesSearched,
    truncated,
    totalMatches,
  };
}
