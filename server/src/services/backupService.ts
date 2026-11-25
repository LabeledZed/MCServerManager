import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { BACKUPS_DIR, getServerDir } from '../config.js';
import {
  assertSafeZipEntries,
  MAX_ZIP_SINGLE_ENTRY_BYTES,
  MAX_ZIP_UNCOMPRESSED_BYTES,
  resolveInside,
} from '../utils/fsSafe.js';
import { store } from './store.js';
import { listWorlds } from './worldService.js';
import { serverManager } from './serverManager.js';
import type { BackupInfo } from '../../../shared/types.js';

async function addFolderToZipNoSymlinks(zip: AdmZip, folderFull: string, zipPrefix: string): Promise<void> {
  const entries = await fs.readdir(folderFull, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name.endsWith('.lock')) continue;
    const full = path.join(folderFull, entry.name);
    const relZip = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
    const lstat = await fs.lstat(full).catch(() => null);
    if (!lstat || lstat.isSymbolicLink()) continue;
    if (lstat.isDirectory()) {
      await addFolderToZipNoSymlinks(zip, full, relZip);
    } else if (lstat.isFile()) {
      const parentZipDir = path.posix.dirname(relZip);
      zip.addLocalFile(full, parentZipDir === '.' ? '' : parentZipDir);
    }
  }
}

function getServerBackupDir(serverId: string): string {
  const safe = serverId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(BACKUPS_DIR, safe);
}

interface BackupMetaFile {
  id: string;
  serverId: string;
  fileName: string;
  label: string;
  scope: 'full' | 'worlds';
  createdAt: string;
}

export async function listBackups(serverId: string): Promise<BackupInfo[]> {
  const dir = getServerBackupDir(serverId);
  if (!fsSync.existsSync(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const backups: BackupInfo[] = [];

  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.zip')) continue;
    const full = path.join(dir, e.name);
    const stat = await fs.stat(full);
    const metaPath = `${full}.meta.json`;
    let meta: Partial<BackupMetaFile> = {};
    if (fsSync.existsSync(metaPath)) {
      try {
        meta = JSON.parse(await fs.readFile(metaPath, 'utf8')) as Partial<BackupMetaFile>;
      } catch {
        // ignore
      }
    }
    backups.push({
      id: meta.id || e.name.replace(/\.zip$/i, ''),
      serverId,
      fileName: e.name,
      label: meta.label || e.name.replace(/\.zip$/i, ''),
      scope: meta.scope === 'worlds' ? 'worlds' : 'full',
      sizeBytes: stat.size,
      createdAt: meta.createdAt || stat.mtime.toISOString(),
    });
  }

  backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return backups;
}

export async function createBackup(
  serverId: string,
  label = 'Manual Backup',
  scope: 'full' | 'worlds' = 'full',
): Promise<BackupInfo> {
  const serverDir = getServerDir(serverId);
  if (!fsSync.existsSync(serverDir)) {
    throw new Error('Server directory does not exist');
  }

  // Ask running server to flush chunks to disk before zipping
  if (serverManager.isRunning(serverId)) {
    try {
      serverManager.sendCommand(serverId, 'save-all');
      await new Promise((r) => setTimeout(r, 1200));
    } catch {
      // ignore if proxy
    }
  }

  const backupDir = getServerBackupDir(serverId);
  await fs.mkdir(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'backup';
  const id = `${stamp}_${safeLabel}`;
  const fileName = `${id}.zip`;
  const zipPath = path.join(backupDir, fileName);

  const zip = new AdmZip();

  if (scope === 'worlds') {
    const worlds = await listWorlds(serverDir);
    if (worlds.length === 0) {
      throw new Error('No Minecraft worlds found to back up');
    }
    for (const w of worlds) {
      await addFolderToZipNoSymlinks(zip, resolveInside(serverDir, w.name), w.name);
    }
  } else {
    const rootItems = await fs.readdir(serverDir, { withFileTypes: true });
    for (const item of rootItems) {
      if (item.isSymbolicLink()) continue;
      if (item.name === 'cache' || item.name === 'logs' || item.name.endsWith('.lock')) continue;
      const full = resolveInside(serverDir, item.name);
      const lstat = await fs.lstat(full).catch(() => null);
      if (!lstat || lstat.isSymbolicLink()) continue;
      if (lstat.isDirectory()) {
        await addFolderToZipNoSymlinks(zip, full, item.name);
      } else if (lstat.isFile()) {
        zip.addLocalFile(full);
      }
    }
  }

  zip.writeZip(zipPath);
  const stat = await fs.stat(zipPath);

  const meta: BackupMetaFile = {
    id,
    serverId,
    fileName,
    label: label.trim() || 'Manual Backup',
    scope,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(`${zipPath}.meta.json`, JSON.stringify(meta, null, 2), 'utf8');

  // Enforce retention limit
  const retention = store.state.settings.defaultBackupRetention || 10;
  const all = await listBackups(serverId);
  if (all.length > retention) {
    for (const old of all.slice(retention)) {
      await deleteBackup(serverId, old.id).catch(() => {});
    }
  }

  return {
    ...meta,
    sizeBytes: stat.size,
  };
}

export async function restoreBackup(serverId: string, backupId: string): Promise<void> {
  if (serverManager.isRunning(serverId)) {
    throw new Error('Stop the server before restoring a backup');
  }

  const backupDir = getServerBackupDir(serverId);
  const zipPath = resolveInside(backupDir, `${backupId}.zip`);
  if (!fsSync.existsSync(zipPath)) {
    throw new Error('Backup archive not found');
  }

  const serverDir = getServerDir(serverId);
  await fs.mkdir(serverDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  assertSafeZipEntries(entries);
  let extractedBytes = 0;
  for (const entry of entries) {
    const rel = entry.entryName.replace(/\\/g, '/');
    if (!rel || rel.startsWith('..')) continue;
    const dest = resolveInside(serverDir, rel);
    if (entry.isDirectory) {
      await fs.mkdir(dest, { recursive: true });
    } else {
      const data = entry.getData();
      if (data.byteLength > MAX_ZIP_SINGLE_ENTRY_BYTES) {
        throw new Error(`Backup entry "${rel}" exceeds maximum allowed file size`);
      }
      extractedBytes += data.byteLength;
      if (extractedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
        throw new Error('Backup restore aborted: uncompressed data exceeds 1 GB limit');
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, data);
    }
  }
}

export function getBackupFilePath(serverId: string, backupId: string): string {
  const backupDir = getServerBackupDir(serverId);
  const full = resolveInside(backupDir, `${backupId}.zip`);
  if (!fsSync.existsSync(full)) {
    throw new Error('Backup archive not found');
  }
  return full;
}

export async function deleteBackup(serverId: string, backupId: string): Promise<void> {
  const backupDir = getServerBackupDir(serverId);
  const zipPath = resolveInside(backupDir, `${backupId}.zip`);
  await fs.rm(zipPath, { force: true });
  await fs.rm(`${zipPath}.meta.json`, { force: true });
}
