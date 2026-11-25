import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import {
  atomicWriteFile,
  detectConfigFormat,
  isBinaryFilename,
  isLikelyBinaryBuffer,
  normalizeRelPath,
  resolveInside,
} from '../utils/fsSafe.js';
import type {
  ConfigFormat,
  ConfigTreeNode,
  ParsedConfigDocument,
  ServerConfigFileEntry,
  ServerSoftware,
} from '../../../shared/types.js';

const FORBIDDEN_CONFIG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function assertAllowedConfigPath(relativePath: string): string {
  const rel = normalizeRelPath(relativePath);
  if (!rel) throw new Error('Config file path is required');
  if (/(?:^|\/)bridge\.properties$/i.test(rel)) {
    throw new Error('Access denied: bridge.properties is managed internally');
  }
  if (/^libraries(?:\/|$)/i.test(rel) || /(?:^|\/)(?:win_args|unix_args)\.txt$/i.test(rel)) {
    throw new Error('Access denied: modloader runtime libraries and JVM argument files cannot be edited in Configs');
  }
  if (isBinaryFilename(rel) || /\.(?:bat|cmd|sh|ps1|exe|dll|so|dylib|jar)$/i.test(rel)) {
    throw new Error('Access denied: executable or binary files cannot be edited in Configs');
  }
  return rel;
}

// ---------- Curated metadata for server.properties (Aternos-grade Descriptions & Categories) ----------

export const SERVER_PROPERTIES_META: Record<
  string,
  { label: string; description: string; category: string; options?: string[]; min?: number; max?: number }
> = {
  motd: {
    label: 'Server MOTD',
    description: 'Message displayed in the Minecraft server list below the server name. Supports § color codes.',
    category: 'General',
  },
  'max-players': {
    label: 'Max Players',
    description: 'Maximum number of players allowed to connect simultaneously.',
    category: 'General',
    min: 1,
    max: 10000,
  },
  'server-port': {
    label: 'Server Port',
    description: 'TCP port the Minecraft server listens on (default 25565).',
    category: 'Network',
    min: 1024,
    max: 65535,
  },
  'server-ip': {
    label: 'Bind IP Address',
    description: 'Leave empty to listen on all local interfaces.',
    category: 'Network',
  },
  'online-mode': {
    label: 'Online Mode (Mojang Auth)',
    description: 'Verify connecting players against Mojang authentication servers. Disable only for offline/LAN testing.',
    category: 'Security',
  },
  'white-list': {
    label: 'Enable Whitelist',
    description: 'Only players listed in whitelist.json (and ops) can join the server.',
    category: 'Security',
  },
  'enforce-whitelist': {
    label: 'Enforce Whitelist Immediately',
    description: 'Kick non-whitelisted online players immediately when whitelist is reloaded.',
    category: 'Security',
  },
  'enforce-secure-profile': {
    label: 'Enforce Secure Chat Profile',
    description: 'Require Mojang-signed public keys for chat messages.',
    category: 'Security',
  },
  gamemode: {
    label: 'Default Gamemode',
    description: 'Gamemode assigned to new players joining the server.',
    category: 'Gameplay',
    options: ['survival', 'creative', 'adventure', 'spectator'],
  },
  'force-gamemode': {
    label: 'Force Default Gamemode',
    description: 'Reset players to the default gamemode every time they join.',
    category: 'Gameplay',
  },
  difficulty: {
    label: 'Difficulty',
    description: 'World difficulty affecting mob damage, hunger, and spawning.',
    category: 'Gameplay',
    options: ['peaceful', 'easy', 'normal', 'hard'],
  },
  hardcore: {
    label: 'Hardcore Mode',
    description: 'Players are switched to spectator mode upon death.',
    category: 'Gameplay',
  },
  pvp: {
    label: 'Allow PvP',
    description: 'Allow players to damage each other in combat.',
    category: 'Gameplay',
  },
  'allow-flight': {
    label: 'Allow Flight',
    description: 'Allow players to fly in Survival mode (required for many mods/plugins with jetpacks or elytra boosts).',
    category: 'Gameplay',
  },
  'allow-nether': {
    label: 'Allow Nether',
    description: 'Allow players to travel to the Nether dimension.',
    category: 'World',
  },
  'enable-command-block': {
    label: 'Enable Command Blocks',
    description: 'Allow command blocks to execute commands.',
    category: 'Gameplay',
  },
  'spawn-monsters': {
    label: 'Spawn Monsters',
    description: 'Allow hostile mobs to spawn naturally.',
    category: 'Gameplay',
  },
  'spawn-animals': {
    label: 'Spawn Animals',
    description: 'Allow passive animal mobs to spawn naturally.',
    category: 'Gameplay',
  },
  'spawn-npcs': {
    label: 'Spawn Villagers',
    description: 'Allow villagers to spawn.',
    category: 'Gameplay',
  },
  'spawn-protection': {
    label: 'Spawn Protection Radius',
    description: 'Radius in blocks around world spawn protected from non-op edits (0 disables protection).',
    category: 'World',
    min: 0,
    max: 512,
  },
  'level-name': {
    label: 'World Folder Name',
    description: 'Directory name of the main world folder.',
    category: 'World',
  },
  'level-seed': {
    label: 'World Seed',
    description: 'Seed used when generating a new world (leave blank for random).',
    category: 'World',
  },
  'level-type': {
    label: 'World Type',
    description: 'World generator preset for newly generated worlds.',
    category: 'World',
    options: ['minecraft:normal', 'minecraft:flat', 'minecraft:large_biomes', 'minecraft:amplified', 'minecraft:single_biome_surface'],
  },
  'generate-structures': {
    label: 'Generate Structures',
    description: 'Generate villages, temples, strongholds, and dungeons.',
    category: 'World',
  },
  'view-distance': {
    label: 'View Distance (Chunks)',
    description: 'Chunk radius sent to clients (recommended 8–12 for smooth performance).',
    category: 'Performance',
    min: 3,
    max: 32,
  },
  'simulation-distance': {
    label: 'Simulation Distance (Chunks)',
    description: 'Chunk radius around players where entities and redstone tick.',
    category: 'Performance',
    min: 3,
    max: 32,
  },
  'max-tick-time': {
    label: 'Max Tick Time (ms)',
    description: 'Watchdog timeout before stopping a hung server (-1 disables watchdog).',
    category: 'Performance',
  },
  'entity-broadcast-range-percentage': {
    label: 'Entity Broadcast Range (%)',
    description: 'Percentage of normal distance at which entities become visible to clients.',
    category: 'Performance',
    min: 10,
    max: 1000,
  },
  'network-compression-threshold': {
    label: 'Compression Threshold',
    description: 'Packet size in bytes above which network traffic is compressed (-1 disables).',
    category: 'Network',
  },
  'enable-rcon': {
    label: 'Enable RCON',
    description: 'Allow remote console connections over TCP.',
    category: 'Network',
  },
  'enable-query': {
    label: 'Enable GameSpy4 Query',
    description: 'Allow external server status queries via UDP.',
    category: 'Network',
  },
  'resource-pack': {
    label: 'Resource Pack URL',
    description: 'Optional download URL for a server resource pack.',
    category: 'Resource Pack',
  },
  'require-resource-pack': {
    label: 'Require Resource Pack',
    description: 'Disconnect players who decline the server resource pack.',
    category: 'Resource Pack',
  },
};

// ---------- Helpers to convert YAML AST / JS Objects / Properties to ConfigTreeNode[] ----------

function cleanComment(c?: string | null): string | undefined {
  if (!c) return undefined;
  const cleaned = c
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*#?\s?/, '').trimEnd())
    .join('\n')
    .trim();
  return cleaned || undefined;
}

function yamlNodeToTree(node: unknown, key: string, nodePath: (string | number)[], commentBefore?: string, inlineComment?: string): ConfigTreeNode {
  if (YAML.isMap(node)) {
    const children: ConfigTreeNode[] = [];
    for (const pair of node.items) {
      const k = YAML.isScalar(pair.key) ? String(pair.key.value ?? '') : String(pair.key ?? '');
      const pairComment = cleanComment((pair.key as { commentBefore?: string | null })?.commentBefore) ||
        cleanComment((pair.value as { commentBefore?: string | null })?.commentBefore);
      const pairInline = cleanComment((pair.value as { comment?: string | null })?.comment) ||
        cleanComment((pair.key as { comment?: string | null })?.comment);
      children.push(yamlNodeToTree(pair.value, k, [...nodePath, k], pairComment, pairInline));
    }
    return {
      key,
      path: nodePath,
      kind: 'object',
      children,
      comment: commentBefore,
      inlineComment,
    };
  }

  if (YAML.isSeq(node)) {
    const children: ConfigTreeNode[] = node.items.map((item, idx) => {
      const itemComment = cleanComment((item as { commentBefore?: string | null })?.commentBefore);
      const itemInline = cleanComment((item as { comment?: string | null })?.comment);
      return yamlNodeToTree(item, String(idx), [...nodePath, idx], itemComment, itemInline);
    });
    return {
      key,
      path: nodePath,
      kind: 'array',
      children,
      comment: commentBefore,
      inlineComment,
    };
  }

  if (YAML.isScalar(node)) {
    const val = node.value;
    if (val === null || val === undefined) {
      return { key, path: nodePath, kind: 'null', value: null, comment: commentBefore, inlineComment };
    }
    if (typeof val === 'boolean') {
      return { key, path: nodePath, kind: 'boolean', value: val, comment: commentBefore, inlineComment };
    }
    if (typeof val === 'number') {
      return { key, path: nodePath, kind: 'number', value: val, comment: commentBefore, inlineComment };
    }
    return { key, path: nodePath, kind: 'string', value: String(val), comment: commentBefore, inlineComment };
  }

  return { key, path: nodePath, kind: 'null', value: null, comment: commentBefore, inlineComment };
}

function jsValueToTree(val: unknown, key: string, nodePath: (string | number)[], commentsMap?: Map<string, string>): ConfigTreeNode {
  const pathKey = nodePath.join('.');
  const comment = commentsMap?.get(pathKey);
  if (val === null || val === undefined) {
    return { key, path: nodePath, kind: 'null', value: null, comment };
  }
  if (Array.isArray(val)) {
    return {
      key,
      path: nodePath,
      kind: 'array',
      comment,
      children: val.map((item, idx) => jsValueToTree(item, String(idx), [...nodePath, idx], commentsMap)),
    };
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>);
    return {
      key,
      path: nodePath,
      kind: 'object',
      comment,
      children: entries.map(([k, v]) => jsValueToTree(v, k, [...nodePath, k], commentsMap)),
    };
  }
  if (typeof val === 'boolean') {
    return { key, path: nodePath, kind: 'boolean', value: val, comment };
  }
  if (typeof val === 'number') {
    return { key, path: nodePath, kind: 'number', value: val, comment };
  }
  return { key, path: nodePath, kind: 'string', value: String(val), comment };
}

function treeNodeToJs(node: ConfigTreeNode): unknown {
  if (node.kind === 'object') {
    const obj: Record<string, unknown> = Object.create(null);
    for (const child of node.children || []) {
      if (FORBIDDEN_CONFIG_KEYS.has(child.key)) continue;
      obj[child.key] = treeNodeToJs(child);
    }
    return obj;
  }
  if (node.kind === 'array') {
    return (node.children || []).map((c) => treeNodeToJs(c));
  }
  if (node.kind === 'null') return null;
  if (node.kind === 'boolean') return Boolean(node.value);
  if (node.kind === 'number') {
    const n = Number(node.value);
    return Number.isNaN(n) ? 0 : n;
  }
  return node.value === undefined || node.value === null ? '' : String(node.value);
}

function treeToJsObject(tree: ConfigTreeNode[], rootIsArray = false): unknown {
  if (rootIsArray) {
    return tree.map((node) => treeNodeToJs(node));
  }
  const obj: Record<string, unknown> = Object.create(null);
  for (const node of tree) {
    if (FORBIDDEN_CONFIG_KEYS.has(node.key)) continue;
    obj[node.key] = treeNodeToJs(node);
  }
  return obj;
}

/**
 * Strip single-line // and block /* * / comments from JSON5/JSONC while respecting string literals.
 */
function stripJsonComments(input: string): string {
  let out = '';
  let inStr = false;
  let strChar = '';
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (inStr) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === strChar) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      strChar = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  // Remove trailing commas before } or ]
  return out.replace(/,\s*([}\]])/g, '$1');
}

function extractTomlComments(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  let currentSection = '';
  let pending: string[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      pending = [];
      continue;
    }
    if (trimmed.startsWith('#')) {
      pending.push(trimmed.replace(/^#\s?/, ''));
      continue;
    }
    const secMatch = trimmed.match(/^\[+([^\]]+)\]+$/);
    if (secMatch) {
      currentSection = secMatch[1].trim().replace(/['"]/g, '');
      if (pending.length > 0) {
        map.set(currentSection, pending.join('\n'));
        pending = [];
      }
      continue;
    }
    const keyMatch = trimmed.match(/^([A-Za-z0-9_."'-]+)\s*=/);
    if (keyMatch) {
      const k = keyMatch[1].trim().replace(/^["']|["']$/g, '');
      const fullKey = currentSection ? `${currentSection}.${k}` : k;
      if (pending.length > 0) {
        map.set(fullKey, pending.join('\n'));
        pending = [];
      }
    } else {
      pending = [];
    }
  }
  return map;
}

export function parsePropertiesToTree(raw: string, attachMcMeta: boolean): ConfigTreeNode[] {
  const nodes: ConfigTreeNode[] = [];
  let pendingComments: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      pendingComments = [];
      continue;
    }
    if (trimmed.startsWith('#') || trimmed.startsWith('!')) {
      pendingComments.push(trimmed.replace(/^[#!]\s?/, ''));
      continue;
    }
    const eqIdx = line.indexOf('=');
    const colonIdx = line.indexOf(':');
    let sepIdx = eqIdx;
    if (sepIdx < 0 || (colonIdx >= 0 && colonIdx < sepIdx)) sepIdx = colonIdx;
    if (sepIdx < 0) continue;

    const key = line.slice(0, sepIdx).trim();
    const rawVal = line.slice(sepIdx + 1).trim();
    const unescaped = rawVal.replace(/\\:/g, ':').replace(/\\=/g, '=');
    const meta = attachMcMeta ? SERVER_PROPERTIES_META[key] : undefined;
    const comment = pendingComments.length > 0 ? pendingComments.join('\n') : undefined;
    pendingComments = [];

    let kind: ConfigTreeNode['kind'] = 'string';
    let value: string | number | boolean = unescaped;

    if (unescaped === 'true' || unescaped === 'false') {
      kind = 'boolean';
      value = unescaped === 'true';
    } else if (/^-?\d+(\.\d+)?$/.test(unescaped) && key !== 'level-seed' && key !== 'rcon.password') {
      kind = 'number';
      value = Number(unescaped);
    }

    nodes.push({
      key,
      path: [key],
      kind,
      value,
      comment,
      meta,
    });
  }

  return nodes;
}

export function serializePropertiesPreservingComments(originalRaw: string, tree: ConfigTreeNode[]): string {
  const values = new Map<string, string>();
  for (const node of tree) {
    const rawStr = node.value === null || node.value === undefined ? '' : String(node.value);
    values.set(node.key, rawStr);
  }

  const seen = new Set<string>();
  const lines = originalRaw.length > 0 ? originalRaw.split(/\r?\n/) : [];
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      out.push(line);
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx).trim();
      if (values.has(key)) {
        out.push(`${key}=${values.get(key)}`);
        seen.add(key);
        continue;
      }
      // Key was removed from tree
      continue;
    }
    out.push(line);
  }

  for (const [k, v] of values.entries()) {
    if (!seen.has(k)) {
      out.push(`${k}=${v}`);
    }
  }

  return out.join('\n').replace(/\n*$/, '\n');
}

/**
 * Recursively updates a YAML Document AST in place so original comments and formatting are preserved!
 */
function applyTreeToYamlDoc(doc: YAML.Document, tree: ConfigTreeNode[], rootIsArray: boolean): void {
  if (!doc.contents || (rootIsArray && !YAML.isSeq(doc.contents)) || (!rootIsArray && !YAML.isMap(doc.contents))) {
    doc.contents = doc.createNode(treeToJsObject(tree, rootIsArray));
    return;
  }

  function syncMap(map: YAML.YAMLMap, nodes: ConfigTreeNode[]): void {
    const desiredKeys = new Set(nodes.map((n) => n.key));

    // Delete removed keys
    for (let i = map.items.length - 1; i >= 0; i--) {
      const pair = map.items[i];
      const k = YAML.isScalar(pair.key) ? String(pair.key.value ?? '') : String(pair.key ?? '');
      if (!desiredKeys.has(k)) {
        map.items.splice(i, 1);
      }
    }

    // Update or add keys
    for (const node of nodes) {
      const existingPair = map.items.find((p) => {
        const k = YAML.isScalar(p.key) ? String(p.key.value ?? '') : String(p.key ?? '');
        return k === node.key;
      });

      if (!existingPair) {
        map.set(node.key, doc.createNode(treeNodeToJs(node)));
        continue;
      }

      if (node.kind === 'object' && YAML.isMap(existingPair.value)) {
        syncMap(existingPair.value, node.children || []);
      } else if (node.kind === 'array' && YAML.isSeq(existingPair.value)) {
        syncSeq(existingPair.value, node.children || []);
      } else if (YAML.isScalar(existingPair.value) && node.kind !== 'object' && node.kind !== 'array') {
        existingPair.value.value = treeNodeToJs(node);
      } else {
        const prevComment = (existingPair.value as { comment?: string | null })?.comment;
        const prevCommentBefore = (existingPair.value as { commentBefore?: string | null })?.commentBefore;
        const newNode = doc.createNode(treeNodeToJs(node));
        if (prevComment) newNode.comment = prevComment;
        if (prevCommentBefore) newNode.commentBefore = prevCommentBefore;
        existingPair.value = newNode;
      }
    }
  }

  function syncSeq(seq: YAML.YAMLSeq, nodes: ConfigTreeNode[]): void {
    // Update existing indices in-place where shape matches, resize as needed
    while (seq.items.length > nodes.length) {
      seq.items.pop();
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (i < seq.items.length) {
        const existing = seq.items[i];
        if (node.kind === 'object' && YAML.isMap(existing)) {
          syncMap(existing, node.children || []);
        } else if (node.kind === 'array' && YAML.isSeq(existing)) {
          syncSeq(existing, node.children || []);
        } else if (YAML.isScalar(existing) && node.kind !== 'object' && node.kind !== 'array') {
          existing.value = treeNodeToJs(node);
        } else {
          seq.items[i] = doc.createNode(treeNodeToJs(node));
        }
      } else {
        seq.items.push(doc.createNode(treeNodeToJs(node)));
      }
    }
  }

  if (rootIsArray && YAML.isSeq(doc.contents)) {
    syncSeq(doc.contents, tree);
  } else if (!rootIsArray && YAML.isMap(doc.contents)) {
    syncMap(doc.contents, tree);
  }
}

export async function readConfigDocument(serverDir: string, relativePath: string): Promise<ParsedConfigDocument> {
  const rel = assertAllowedConfigPath(relativePath);
  const fullPath = resolveInside(serverDir, rel);
  const stat = await fs.stat(fullPath);
  if (stat.size > 5 * 1024 * 1024) {
    throw new Error('File exceeds 5 MB editor limit');
  }
  const buf = await fs.readFile(fullPath);
  if (await isLikelyBinaryBuffer(buf)) {
    throw new Error('Cannot open binary file in text/config editor');
  }

  const raw = buf.toString('utf8');
  const fileName = path.basename(fullPath);
  const format = detectConfigFormat(fileName);

  if (format === 'yaml') {
    try {
      const doc = YAML.parseDocument(raw, { prettyErrors: true });
      if (doc.errors.length > 0) {
        return {
          relativePath: rel,
          fileName,
          format,
          raw,
          supportsVisual: false,
          parseError: doc.errors[0].message,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        };
      }
      let tree: ConfigTreeNode[] = [];
      if (YAML.isMap(doc.contents)) {
        tree = yamlNodeToTree(doc.contents, '', []).children || [];
      } else if (YAML.isSeq(doc.contents)) {
        tree = yamlNodeToTree(doc.contents, '', []).children || [];
      } else if (doc.contents === null || doc.contents === undefined) {
        tree = [];
      }
      return {
        relativePath: rel,
        fileName,
        format,
        raw,
        supportsVisual: true,
        tree,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    } catch (err) {
      return {
        relativePath: rel,
        fileName,
        format,
        raw,
        supportsVisual: false,
        parseError: err instanceof Error ? err.message : String(err),
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    }
  }

  if (format === 'json') {
    try {
      let parsed: unknown;
      try {
        parsed = raw.trim() ? JSON.parse(raw) : {};
      } catch {
        parsed = JSON.parse(stripJsonComments(raw));
      }
      let tree: ConfigTreeNode[] = [];
      if (Array.isArray(parsed)) {
        tree = parsed.map((item, idx) => jsValueToTree(item, String(idx), [idx]));
      } else if (parsed && typeof parsed === 'object') {
        tree = Object.entries(parsed as Record<string, unknown>).map(([k, v]) => jsValueToTree(v, k, [k]));
      }
      return {
        relativePath: rel,
        fileName,
        format,
        raw,
        supportsVisual: true,
        tree,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    } catch (err) {
      return {
        relativePath: rel,
        fileName,
        format,
        raw,
        supportsVisual: false,
        parseError: err instanceof Error ? err.message : String(err),
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    }
  }

  if (format === 'toml') {
    try {
      const parsed = raw.trim() ? parseToml(raw) : {};
      const comments = extractTomlComments(raw);
      const tree = Object.entries(parsed).map(([k, v]) => jsValueToTree(v, k, [k], comments));
      return {
        relativePath: rel,
        fileName,
        format,
        raw,
        supportsVisual: true,
        tree,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    } catch (err) {
      return {
        relativePath: rel,
        fileName,
        format,
        raw,
        supportsVisual: false,
        parseError: err instanceof Error ? err.message : String(err),
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    }
  }

  if (format === 'properties') {
    const isServerProps = fileName.toLowerCase() === 'server.properties';
    const tree = parsePropertiesToTree(raw, isServerProps);
    return {
      relativePath: rel,
      fileName,
      format,
      raw,
      supportsVisual: true,
      tree,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  }

  return {
    relativePath: rel,
    fileName,
    format: 'raw',
    raw,
    supportsVisual: false,
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

export async function saveConfigFromTree(
  serverDir: string,
  relativePath: string,
  tree: ConfigTreeNode[],
): Promise<ParsedConfigDocument> {
  const rel = assertAllowedConfigPath(relativePath);
  const fullPath = resolveInside(serverDir, rel);
  const fileName = path.basename(fullPath);
  const format = detectConfigFormat(fileName);
  const existingRaw = fsSync.existsSync(fullPath) ? await fs.readFile(fullPath, 'utf8') : '';
  const rootIsArray = tree.length > 0 && tree.every((n, i) => n.key === String(i) && typeof n.path?.[0] === 'number');

  let serialized = '';
  if (format === 'yaml') {
    const doc = YAML.parseDocument(existingRaw || '{}');
    applyTreeToYamlDoc(doc, tree, rootIsArray);
    serialized = doc.toString({ indent: 2, lineWidth: 0 });
  } else if (format === 'json') {
    serialized = `${JSON.stringify(treeToJsObject(tree, rootIsArray), null, 2)}\n`;
  } else if (format === 'toml') {
    serialized = `${stringifyToml(treeToJsObject(tree, false) as Record<string, unknown>)}\n`;
  } else if (format === 'properties') {
    serialized = serializePropertiesPreservingComments(existingRaw, tree);
  } else {
    throw new Error('Visual tree saving is only supported for YAML, JSON, TOML, and Properties files');
  }

  await atomicWriteFile(fullPath, serialized);
  return readConfigDocument(serverDir, rel);
}

export async function saveConfigRaw(
  serverDir: string,
  relativePath: string,
  raw: string,
): Promise<ParsedConfigDocument> {
  const rel = assertAllowedConfigPath(relativePath);
  const fullPath = resolveInside(serverDir, rel);
  await atomicWriteFile(fullPath, raw);
  return readConfigDocument(serverDir, rel);
}

// ---------- Comprehensive Multi-Platform Server Config Discovery ----------

interface KnownConfigSpec {
  relativePath: string;
  label: string;
  category: ServerConfigFileEntry['category'];
  softwareHint: string;
  description: string;
  softwareFilter?: ServerSoftware[];
}

const NON_PROXY_SERVERS: ServerSoftware[] = [
  'paper',
  'purpur',
  'leaf',
  'spigot',
  'folia',
  'vanilla',
  'fabric',
  'forge',
  'neoforge',
  'custom',
];

const KNOWN_SERVER_CONFIGS: KnownConfigSpec[] = [
  // Core / Vanilla
  {
    relativePath: 'server.properties',
    label: 'server.properties',
    category: 'core',
    softwareHint: 'Minecraft Servers',
    description: 'Core Minecraft settings: MOTD, difficulty, gamemode, port, view distance, seed, and security.',
    softwareFilter: NON_PROXY_SERVERS,
  },
  {
    relativePath: 'eula.txt',
    label: 'eula.txt',
    category: 'core',
    softwareHint: 'Minecraft Servers',
    description: 'Minecraft End User License Agreement acceptance flag.',
    softwareFilter: NON_PROXY_SERVERS,
  },
  {
    relativePath: 'whitelist.json',
    label: 'whitelist.json',
    category: 'core',
    softwareHint: 'Minecraft Servers',
    description: 'Allowed players when whitelist mode is enabled.',
    softwareFilter: NON_PROXY_SERVERS,
  },
  {
    relativePath: 'ops.json',
    label: 'ops.json',
    category: 'core',
    softwareHint: 'Minecraft Servers',
    description: 'Server operators and their permission levels (1–4).',
    softwareFilter: NON_PROXY_SERVERS,
  },
  {
    relativePath: 'banned-players.json',
    label: 'banned-players.json',
    category: 'core',
    softwareHint: 'Minecraft Servers',
    description: 'Banned player accounts, expiration dates, and reasons.',
    softwareFilter: NON_PROXY_SERVERS,
  },
  {
    relativePath: 'banned-ips.json',
    label: 'banned-ips.json',
    category: 'core',
    softwareHint: 'Minecraft Servers',
    description: 'Banned IP addresses.',
    softwareFilter: NON_PROXY_SERVERS,
  },
  {
    relativePath: 'commands.yml',
    label: 'commands.yml',
    category: 'bukkit-spigot',
    softwareHint: 'Bukkit / Spigot / Paper / Purpur / Leaf',
    description: 'Custom command aliases and overrides.',
    softwareFilter: ['paper', 'purpur', 'leaf', 'spigot', 'folia', 'custom'],
  },
  {
    relativePath: 'permissions.yml',
    label: 'permissions.yml',
    category: 'bukkit-spigot',
    softwareHint: 'Bukkit / Spigot / Paper / Purpur / Leaf',
    description: 'Default Bukkit permission nodes and groups.',
    softwareFilter: ['paper', 'purpur', 'leaf', 'spigot', 'folia', 'custom'],
  },
  {
    relativePath: 'help.yml',
    label: 'help.yml',
    category: 'bukkit-spigot',
    softwareHint: 'Bukkit / Spigot / Paper / Purpur / Leaf',
    description: 'Custom /help topic documentation.',
    softwareFilter: ['paper', 'purpur', 'leaf', 'spigot', 'folia', 'custom'],
  },
  // Bukkit & Spigot
  {
    relativePath: 'bukkit.yml',
    label: 'bukkit.yml',
    category: 'bukkit-spigot',
    softwareHint: 'Bukkit / Spigot / Paper / Purpur / Leaf',
    description: 'Spawn limits, chunk-gc, world generators, ticks-per mob spawns, and plugin settings.',
    softwareFilter: ['paper', 'purpur', 'leaf', 'spigot', 'folia', 'custom'],
  },
  {
    relativePath: 'spigot.yml',
    label: 'spigot.yml',
    category: 'bukkit-spigot',
    softwareHint: 'Spigot / Paper / Purpur / Leaf',
    description: 'Entity activation ranges, merge radii, hopper timing, BungeeCord forwarding, and custom messages.',
    softwareFilter: ['paper', 'purpur', 'leaf', 'spigot', 'folia', 'custom'],
  },
  // Paper / Purpur / Leaf / Folia
  {
    relativePath: 'config/paper-global.yml',
    label: 'paper-global.yml',
    category: 'paper-purpur',
    softwareHint: 'Paper 1.19+ / Purpur / Leaf / Folia',
    description: 'Global Paper settings: Velocity/Bungee proxies, packet limiters, chunk system, watchdog, and async IO.',
    softwareFilter: ['paper', 'purpur', 'leaf', 'folia', 'custom'],
  },
  {
    relativePath: 'config/paper-world-defaults.yml',
    label: 'paper-world-defaults.yml',
    category: 'paper-purpur',
    softwareHint: 'Paper 1.19+ / Purpur / Leaf / Folia',
    description: 'Default per-world Paper tuning: anti-xray, despawn ranges, redstone, hopper optimizations, and collisions.',
    softwareFilter: ['paper', 'purpur', 'leaf', 'folia', 'custom'],
  },
  {
    relativePath: 'paper.yml',
    label: 'paper.yml (Legacy)',
    category: 'paper-purpur',
    softwareHint: 'Paper < 1.19',
    description: 'Legacy single-file Paper configuration for Minecraft 1.18 and earlier.',
  },
  {
    relativePath: 'purpur.yml',
    label: 'purpur.yml',
    category: 'paper-purpur',
    softwareHint: 'Purpur / Leaf',
    description: 'Purpur gameplay customization: rideable mobs, anvil colors, silk-touch spawners, and AFK settings.',
    softwareFilter: ['purpur', 'leaf', 'custom'],
  },
  {
    relativePath: 'config/leaf-global.yml',
    label: 'leaf-global.yml',
    category: 'paper-purpur',
    softwareHint: 'Leaf',
    description: 'Leaf performance, async systems, protocol support, and gameplay tuning.',
    softwareFilter: ['leaf', 'custom'],
  },
  {
    relativePath: 'config/gale-global.yml',
    label: 'gale-global.yml',
    category: 'paper-purpur',
    softwareHint: 'Leaf / Gale',
    description: 'Gale global optimization settings inherited by Leaf.',
    softwareFilter: ['leaf', 'custom'],
  },
  {
    relativePath: 'config/gale-world-defaults.yml',
    label: 'gale-world-defaults.yml',
    category: 'paper-purpur',
    softwareHint: 'Leaf / Gale',
    description: 'Gale default per-world optimization settings inherited by Leaf.',
    softwareFilter: ['leaf', 'custom'],
  },
  {
    relativePath: 'pufferfish.yml',
    label: 'pufferfish.yml',
    category: 'paper-purpur',
    softwareHint: 'Pufferfish / Purpur / Leaf',
    description: 'DAB (Dynamic Activation of Brain), async mob spawning, and SIMD optimizations.',
    softwareFilter: ['purpur', 'leaf', 'custom'],
  },
  {
    relativePath: 'config/folia-global.yml',
    label: 'folia-global.yml',
    category: 'paper-purpur',
    softwareHint: 'Folia',
    description: 'Folia regionized multithreading settings.',
    softwareFilter: ['folia'],
  },
  // Modloaders
  {
    relativePath: 'fabric-server-launcher.properties',
    label: 'fabric-server-launcher.properties',
    category: 'modloader',
    softwareHint: 'Fabric',
    description: 'Fabric server launcher JAR target configuration.',
    softwareFilter: ['fabric'],
  },
  {
    relativePath: 'user_jvm_args.txt',
    label: 'user_jvm_args.txt',
    category: 'modloader',
    softwareHint: 'Forge / NeoForge',
    description: 'Custom JVM startup arguments read by Forge/NeoForge launchers.',
    softwareFilter: ['forge', 'neoforge'],
  },
  {
    relativePath: 'config/fml.toml',
    label: 'fml.toml',
    category: 'modloader',
    softwareHint: 'Forge / NeoForge',
    description: 'Forge Mod Loader threading, version check, and config sync settings.',
    softwareFilter: ['forge', 'neoforge'],
  },
  {
    relativePath: 'config/neoforge-common.toml',
    label: 'neoforge-common.toml',
    category: 'modloader',
    softwareHint: 'NeoForge',
    description: 'NeoForge common configuration.',
    softwareFilter: ['neoforge'],
  },
  {
    relativePath: 'config/forge-common.toml',
    label: 'forge-common.toml',
    category: 'modloader',
    softwareHint: 'Forge',
    description: 'Minecraft Forge common configuration.',
    softwareFilter: ['forge'],
  },
  // Proxies
  {
    relativePath: 'velocity.toml',
    label: 'velocity.toml',
    category: 'proxy',
    softwareHint: 'Velocity Proxy',
    description: 'Velocity proxy bind address, backend servers, forwarding mode, and MOTD.',
    softwareFilter: ['velocity'],
  },
  {
    relativePath: 'forwarding.secret',
    label: 'forwarding.secret',
    category: 'proxy',
    softwareHint: 'Velocity Proxy',
    description: 'Shared secret key used for Velocity modern player info forwarding.',
    softwareFilter: ['velocity'],
  },
  // Geyser / Floodgate Bedrock Cross-Play (shown when installed/present)
  {
    relativePath: 'plugins/Geyser-Spigot/config.yml',
    label: 'Geyser-Spigot config.yml',
    category: 'other',
    softwareHint: 'Geyser (Bedrock)',
    description: 'Bedrock Edition cross-play settings: UDP port, MOTD, auth-type, and protocol options.',
  },
  {
    relativePath: 'plugins/Geyser-Velocity/config.yml',
    label: 'Geyser-Velocity config.yml',
    category: 'proxy',
    softwareHint: 'Geyser (Bedrock)',
    description: 'Bedrock Edition cross-play settings for Velocity proxy.',
  },
  {
    relativePath: 'config/Geyser-Fabric/config.yml',
    label: 'Geyser-Fabric config.yml',
    category: 'modloader',
    softwareHint: 'Geyser (Bedrock)',
    description: 'Bedrock Edition cross-play settings for Fabric.',
  },
  {
    relativePath: 'config/Geyser-NeoForge/config.yml',
    label: 'Geyser-NeoForge config.yml',
    category: 'modloader',
    softwareHint: 'Geyser (Bedrock)',
    description: 'Bedrock Edition cross-play settings for NeoForge.',
  },
  {
    relativePath: 'geyser-standalone/config.yml',
    label: 'Geyser-Standalone config.yml',
    category: 'other',
    softwareHint: 'Geyser Standalone',
    description: 'Managed Geyser Standalone sidecar configuration for Bedrock Edition cross-play.',
  },
  {
    relativePath: 'plugins/floodgate/config.yml',
    label: 'Floodgate config.yml',
    category: 'other',
    softwareHint: 'Floodgate (Bedrock)',
    description: 'Floodgate Bedrock authentication settings and username prefix.',
  },
  {
    relativePath: 'config/floodgate/config.yml',
    label: 'Floodgate config.yml',
    category: 'modloader',
    softwareHint: 'Floodgate (Bedrock)',
    description: 'Floodgate Bedrock authentication settings and username prefix for modded servers.',
  },
  {
    relativePath: 'config.yml',
    label: 'config.yml (BungeeCord)',
    category: 'proxy',
    softwareHint: 'BungeeCord / Waterfall',
    description: 'BungeeCord / Waterfall proxy listeners, servers, and IP forwarding.',
  },
  {
    relativePath: 'waterfall.yml',
    label: 'waterfall.yml',
    category: 'proxy',
    softwareHint: 'Waterfall Proxy',
    description: 'Waterfall proxy tuning and throttling configuration.',
  },
];

export async function discoverServerConfigs(
  serverDir: string,
  software: ServerSoftware,
): Promise<ServerConfigFileEntry[]> {
  const entries: ServerConfigFileEntry[] = [];
  const addedPaths = new Set<string>();

  async function tryStat(rel: string): Promise<{ exists: boolean; sizeBytes: number; modifiedAt?: string }> {
    try {
      const st = await fs.stat(resolveInside(serverDir, rel));
      if (!st.isFile()) return { exists: false, sizeBytes: 0 };
      return { exists: true, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() };
    } catch {
      return { exists: false, sizeBytes: 0 };
    }
  }

  // 1. Curated registry entries
  for (const spec of KNOWN_SERVER_CONFIGS) {
    const info = await tryStat(spec.relativePath);
    const relevantToSoftware = !spec.softwareFilter || spec.softwareFilter.includes(software);
    if (!info.exists && !relevantToSoftware) continue;
    // Skip legacy / optional configs unless they actually exist
    if (
      !info.exists &&
      [
        'paper.yml',
        'config.yml',
        'waterfall.yml',
        'help.yml',
        'pufferfish.yml',
        'plugins/Geyser-Spigot/config.yml',
        'plugins/Geyser-Velocity/config.yml',
        'config/Geyser-Fabric/config.yml',
        'config/Geyser-NeoForge/config.yml',
        'geyser-standalone/config.yml',
        'plugins/floodgate/config.yml',
        'config/floodgate/config.yml',
      ].includes(spec.relativePath)
    ) {
      continue;
    }

    addedPaths.add(spec.relativePath.toLowerCase());
    entries.push({
      id: spec.relativePath,
      relativePath: spec.relativePath,
      fileName: path.basename(spec.relativePath),
      label: spec.label,
      category: spec.category,
      softwareHint: spec.softwareHint,
      description: spec.description,
      format: detectConfigFormat(spec.relativePath),
      exists: info.exists,
      sizeBytes: info.sizeBytes,
      modifiedAt: info.modifiedAt,
    });
  }

  // 2. Dynamically discover any extra config files in root (e.g., leaves.yml, gale-global.yml, pufferfish.yml, etc.)
  try {
    const rootItems = await fs.readdir(serverDir, { withFileTypes: true });
    for (const item of rootItems) {
      if (item.isFile()) {
        const lower = item.name.toLowerCase();
        if (addedPaths.has(lower)) continue;
        const fmt = detectConfigFormat(item.name);
        if (fmt !== 'raw' && !lower.endsWith('usercache.json')) {
          const st = await fs.stat(path.join(serverDir, item.name));
          addedPaths.add(lower);
          entries.push({
            id: item.name,
            relativePath: item.name,
            fileName: item.name,
            label: item.name,
            category: 'other',
            softwareHint: 'Server Root',
            description: `Custom server configuration file in root directory.`,
            format: fmt,
            exists: true,
            sizeBytes: st.size,
            modifiedAt: st.mtime.toISOString(),
          });
        }
      } else if (item.isDirectory()) {
        // Check if this is a Minecraft world (contains level.dat or paper-world.yml or serverconfig or dimensions/)
        const worldDir = path.join(serverDir, item.name);
        const paperWorldRel = `${item.name}/paper-world.yml`;
        if (fsSync.existsSync(path.join(worldDir, 'paper-world.yml')) && !addedPaths.has(paperWorldRel.toLowerCase())) {
          const st = await fs.stat(path.join(worldDir, 'paper-world.yml'));
          addedPaths.add(paperWorldRel.toLowerCase());
          entries.push({
            id: paperWorldRel,
            relativePath: paperWorldRel,
            fileName: 'paper-world.yml',
            label: `${item.name} / paper-world.yml`,
            category: 'world',
            softwareHint: 'Per-World Paper Override',
            description: `World-specific Paper configuration overrides for "${item.name}".`,
            format: 'yaml',
            exists: true,
            sizeBytes: st.size,
            modifiedAt: st.mtime.toISOString(),
          });
        }

        // Check Paper 26.1+ per-dimension paper-world.yml under <world>/dimensions/<namespace>/<dimension>/paper-world.yml
        const dimsDir = path.join(worldDir, 'dimensions');
        if (fsSync.existsSync(dimsDir)) {
          try {
            const namespaces = await fs.readdir(dimsDir, { withFileTypes: true });
            for (const ns of namespaces) {
              if (!ns.isDirectory()) continue;
              const nsPath = path.join(dimsDir, ns.name);
              const dimEntries = await fs.readdir(nsPath, { withFileTypes: true });
              for (const dim of dimEntries) {
                if (!dim.isDirectory()) continue;
                const dimPaperFull = path.join(nsPath, dim.name, 'paper-world.yml');
                const dimPaperRel = `${item.name}/dimensions/${ns.name}/${dim.name}/paper-world.yml`;
                if (fsSync.existsSync(dimPaperFull) && !addedPaths.has(dimPaperRel.toLowerCase())) {
                  const st = await fs.stat(dimPaperFull);
                  addedPaths.add(dimPaperRel.toLowerCase());
                  entries.push({
                    id: dimPaperRel,
                    relativePath: dimPaperRel,
                    fileName: 'paper-world.yml',
                    label: `${item.name} (${ns.name}:${dim.name}) / paper-world.yml`,
                    category: 'world',
                    softwareHint: 'Per-Dimension Paper Override (26.1+)',
                    description: `Dimension-specific Paper configuration overrides for "${ns.name}:${dim.name}" in "${item.name}".`,
                    format: 'yaml',
                    exists: true,
                    sizeBytes: st.size,
                    modifiedAt: st.mtime.toISOString(),
                  });
                }
              }
            }
          } catch {
            // ignore
          }
        }

        // Check Forge/NeoForge <world>/serverconfig/*.toml
        const serverConfigDir = path.join(worldDir, 'serverconfig');
        if (fsSync.existsSync(serverConfigDir)) {
          try {
            const scFiles = await fs.readdir(serverConfigDir, { withFileTypes: true });
            for (const f of scFiles) {
              if (!f.isFile()) continue;
              const rel = `${item.name}/serverconfig/${f.name}`;
              if (addedPaths.has(rel.toLowerCase())) continue;
              const st = await fs.stat(path.join(serverConfigDir, f.name));
              addedPaths.add(rel.toLowerCase());
              entries.push({
                id: rel,
                relativePath: rel,
                fileName: f.name,
                label: `${item.name} / ${f.name}`,
                category: 'world',
                softwareHint: 'Per-World Server Config',
                description: `Per-world server config for "${item.name}".`,
                format: detectConfigFormat(f.name),
                exists: true,
                sizeBytes: st.size,
                modifiedAt: st.mtime.toISOString(),
              });
            }
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // serverDir may not exist yet
  }

  // 3. Dynamically discover any extra files inside serverDir/config/ (e.g. gale-global.yml, neoforge-server.toml, fabric mod configs, etc.)
  const configDir = path.join(serverDir, 'config');
  if (fsSync.existsSync(configDir)) {
    try {
      const cfgEntries = await fs.readdir(configDir, { withFileTypes: true });
      for (const item of cfgEntries) {
        if (!item.isFile()) continue;
        const rel = `config/${item.name}`;
        if (addedPaths.has(rel.toLowerCase())) continue;
        const fmt = detectConfigFormat(item.name);
        if (fmt === 'raw' && !item.name.endsWith('.cfg') && !item.name.endsWith('.conf')) continue;
        const st = await fs.stat(path.join(configDir, item.name));
        addedPaths.add(rel.toLowerCase());
        const isPaperFamily = item.name.includes('paper') || item.name.includes('gale') || item.name.includes('leaf') || item.name.includes('folia');
        entries.push({
          id: rel,
          relativePath: rel,
          fileName: item.name,
          label: `config/${item.name}`,
          category: isPaperFamily ? 'paper-purpur' : 'modloader',
          softwareHint: isPaperFamily ? 'Paper Fork Config' : 'Config Directory',
          description: `Configuration file located in /config/.`,
          format: fmt,
          exists: true,
          sizeBytes: st.size,
          modifiedAt: st.mtime.toISOString(),
        });
      }
    } catch {
      // ignore
    }
  }

  return entries;
}
