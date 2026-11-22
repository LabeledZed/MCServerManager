import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { USER_AGENT } from '../config.js';
import { atomicWriteFile } from '../utils/fsSafe.js';
import { serverManager } from './serverManager.js';
import type {
  BannedIpEntry,
  BannedPlayerEntry,
  OpEntry,
  PlayersState,
  WhitelistEntry,
} from '../../../shared/types.js';

function formatUuid(hex32: string): string {
  const clean = hex32.replace(/-/g, '').toLowerCase();
  if (clean.length !== 32) return hex32;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

/**
 * Generates Minecraft's exact offline-mode v3 UUID ("OfflinePlayer:<name>") as fallback.
 */
function offlineUuidForPlayer(name: string): string {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30; // version 3
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant RFC 4122
  return formatUuid(hash.toString('hex'));
}

export async function lookupPlayerProfile(username: string): Promise<{ name: string; uuid: string }> {
  const clean = username.trim();
  try {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(clean)}`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (res.ok) {
      const data = (await res.json()) as { id: string; name: string };
      if (data?.id && data?.name) {
        return { name: data.name, uuid: formatUuid(data.id) };
      }
    }
  } catch {
    // offline fallback below
  }
  return { name: clean, uuid: offlineUuidForPlayer(clean) };
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  if (!fsSync.existsSync(filePath)) return [];
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function isWhitelistEnabled(serverDir: string): Promise<boolean> {
  const propsPath = path.join(serverDir, 'server.properties');
  if (!fsSync.existsSync(propsPath)) return false;
  try {
    const raw = await fs.readFile(propsPath, 'utf8');
    const m = raw.match(/^white-list\s*=\s*(true|false)/m);
    return m ? m[1] === 'true' : false;
  } catch {
    return false;
  }
}

export async function getPlayersState(serverId: string, serverDir: string): Promise<PlayersState> {
  const rt = serverManager.getRuntime(serverId);
  const [whitelistEnabled, whitelist, ops, bannedPlayers, bannedIps] = await Promise.all([
    isWhitelistEnabled(serverDir),
    readJsonArray<WhitelistEntry>(path.join(serverDir, 'whitelist.json')),
    readJsonArray<OpEntry>(path.join(serverDir, 'ops.json')),
    readJsonArray<BannedPlayerEntry>(path.join(serverDir, 'banned-players.json')),
    readJsonArray<BannedIpEntry>(path.join(serverDir, 'banned-ips.json')),
  ]);

  return {
    online: rt.onlinePlayerNames,
    whitelistEnabled,
    whitelist,
    ops,
    bannedPlayers,
    bannedIps,
  };
}

export async function setWhitelistEnabled(serverId: string, serverDir: string, enabled: boolean): Promise<void> {
  const propsPath = path.join(serverDir, 'server.properties');
  let raw = fsSync.existsSync(propsPath) ? await fs.readFile(propsPath, 'utf8') : '';
  if (/^white-list\s*=/m.test(raw)) {
    raw = raw.replace(/^white-list\s*=.*$/m, `white-list=${enabled}`);
  } else {
    raw = `${raw.trimEnd()}\nwhite-list=${enabled}\n`;
  }
  await atomicWriteFile(propsPath, raw);
  if (serverManager.isRunning(serverId)) {
    serverManager.sendCommand(serverId, enabled ? 'whitelist on' : 'whitelist off');
  }
}

export async function addWhitelistPlayer(serverId: string, serverDir: string, username: string): Promise<WhitelistEntry> {
  const profile = await lookupPlayerProfile(username);
  const filePath = path.join(serverDir, 'whitelist.json');
  const list = await readJsonArray<WhitelistEntry>(filePath);
  if (!list.some((e) => e.name.toLowerCase() === profile.name.toLowerCase())) {
    list.push(profile);
    await atomicWriteFile(filePath, `${JSON.stringify(list, null, 2)}\n`);
  }
  if (serverManager.isRunning(serverId)) {
    serverManager.sendCommand(serverId, `whitelist add ${profile.name}`);
    serverManager.sendCommand(serverId, 'whitelist reload');
  }
  return profile;
}

export async function removeWhitelistPlayer(serverId: string, serverDir: string, username: string): Promise<void> {
  const filePath = path.join(serverDir, 'whitelist.json');
  const list = await readJsonArray<WhitelistEntry>(filePath);
  const next = list.filter((e) => e.name.toLowerCase() !== username.toLowerCase());
  await atomicWriteFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
  if (serverManager.isRunning(serverId)) {
    serverManager.sendCommand(serverId, `whitelist remove ${username}`);
    serverManager.sendCommand(serverId, 'whitelist reload');
  }
}

export async function addOpPlayer(
  serverId: string,
  serverDir: string,
  username: string,
  level = 4,
  bypassesPlayerLimit = false,
): Promise<OpEntry> {
  const profile = await lookupPlayerProfile(username);
  const filePath = path.join(serverDir, 'ops.json');
  const list = await readJsonArray<OpEntry>(filePath);
  const entry: OpEntry = {
    uuid: profile.uuid,
    name: profile.name,
    level: Math.min(4, Math.max(1, Number(level) || 4)),
    bypassesPlayerLimit: Boolean(bypassesPlayerLimit),
  };
  const idx = list.findIndex((e) => e.name.toLowerCase() === profile.name.toLowerCase());
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  await atomicWriteFile(filePath, `${JSON.stringify(list, null, 2)}\n`);
  if (serverManager.isRunning(serverId)) {
    serverManager.sendCommand(serverId, `op ${profile.name}`);
  }
  return entry;
}

export async function removeOpPlayer(serverId: string, serverDir: string, username: string): Promise<void> {
  const filePath = path.join(serverDir, 'ops.json');
  const list = await readJsonArray<OpEntry>(filePath);
  const next = list.filter((e) => e.name.toLowerCase() !== username.toLowerCase());
  await atomicWriteFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
  if (serverManager.isRunning(serverId)) {
    serverManager.sendCommand(serverId, `deop ${username}`);
  }
}

export async function banPlayer(
  serverId: string,
  serverDir: string,
  username: string,
  reason = 'Banned by operator',
): Promise<BannedPlayerEntry> {
  const profile = await lookupPlayerProfile(username);
  const filePath = path.join(serverDir, 'banned-players.json');
  const list = await readJsonArray<BannedPlayerEntry>(filePath);
  const entry: BannedPlayerEntry = {
    uuid: profile.uuid,
    name: profile.name,
    created: new Date().toISOString(),
    source: 'MCServerManager',
    expires: 'forever',
    reason: reason.trim() || 'Banned by operator',
  };
  if (!list.some((e) => e.name.toLowerCase() === profile.name.toLowerCase())) {
    list.push(entry);
    await atomicWriteFile(filePath, `${JSON.stringify(list, null, 2)}\n`);
  }
  if (serverManager.isRunning(serverId)) {
    serverManager.sendCommand(serverId, `ban ${profile.name} ${entry.reason}`);
  }
  return entry;
}

export async function unbanPlayer(serverId: string, serverDir: string, username: string): Promise<void> {
  const filePath = path.join(serverDir, 'banned-players.json');
  const list = await readJsonArray<BannedPlayerEntry>(filePath);
  const next = list.filter((e) => e.name.toLowerCase() !== username.toLowerCase());
  await atomicWriteFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
  if (serverManager.isRunning(serverId)) {
    serverManager.sendCommand(serverId, `pardon ${username}`);
  }
}

export async function banIp(
  serverId: string,
  serverDir: string,
  ip: string,
  reason = 'Banned by operator',
): Promise<BannedIpEntry> {
  const cleanIp = ip.trim();
  const filePath = path.join(serverDir, 'banned-ips.json');
  const list = await readJsonArray<BannedIpEntry>(filePath);
  const entry: BannedIpEntry = {
    ip: cleanIp,
    created: new Date().toISOString(),
    source: 'MCServerManager',
    expires: 'forever',
    reason: reason.trim() || 'Banned by operator',
  };
  if (!list.some((e) => e.ip === cleanIp)) {
    list.push(entry);
    await atomicWriteFile(filePath, `${JSON.stringify(list, null, 2)}\n`);
  }
  if (serverManager.isRunning(serverId)) {
    serverManager.sendCommand(serverId, `ban-ip ${cleanIp} ${entry.reason}`);
  }
  return entry;
}

export async function unbanIp(serverId: string, serverDir: string, ip: string): Promise<void> {
  const filePath = path.join(serverDir, 'banned-ips.json');
  const list = await readJsonArray<BannedIpEntry>(filePath);
  const next = list.filter((e) => e.ip !== ip.trim());
  await atomicWriteFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
  if (serverManager.isRunning(serverId)) {
    serverManager.sendCommand(serverId, `pardon-ip ${ip.trim()}`);
  }
}

export function kickPlayer(serverId: string, username: string, reason = 'Kicked by operator'): void {
  if (!serverManager.isRunning(serverId)) {
    throw new Error('Server must be online to kick a player');
  }
  serverManager.sendCommand(serverId, `kick ${username.trim()} ${reason.trim()}`);
}
