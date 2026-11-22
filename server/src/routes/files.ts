import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import multer from 'multer';
import { getServerDir } from '../config.js';
import { store } from '../services/store.js';
import { requirePermission } from '../services/authService.js';
import {
  atomicWriteFile,
  detectConfigFormat,
  isBinaryFilename,
  normalizeRelPath,
  resolveInside,
} from '../utils/fsSafe.js';
import type { FileEntry } from '../../../shared/types.js';

export const filesRouter = Router({ mergeParams: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 250 * 1024 * 1024 },
});

filesRouter.get('/', requirePermission('files'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const relDir = normalizeRelPath(String(req.query.path || ''));
  try {
    const serverDir = getServerDir(srv.id);
    const fullDir = resolveInside(serverDir, relDir);
    await fs.mkdir(serverDir, { recursive: true });
    const dirEntries = await fs.readdir(fullDir, { withFileTypes: true });
    const items: FileEntry[] = [];

    for (const entry of dirEntries) {
      const fullPath = path.join(fullDir, entry.name);
      try {
        const stat = await fs.stat(fullPath);
        const rel = normalizeRelPath(path.relative(serverDir, fullPath));
        const isDir = entry.isDirectory();
        const isBin = isDir ? false : isBinaryFilename(entry.name);
        items.push({
          name: entry.name,
          relativePath: rel,
          isDirectory: isDir,
          sizeBytes: isDir ? 0 : stat.size,
          modifiedAt: stat.mtime.toISOString(),
          format: isDir || isBin ? 'raw' : detectConfigFormat(entry.name),
          isBinary: isBin,
        });
      } catch {
        // skip unreadable transient files
      }
    }

    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ path: relDir, entries: items });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

filesRouter.post('/mkdir', requirePermission('files'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const rel = normalizeRelPath(String((req.body as { path?: string }).path || ''));
  if (!rel) {
    res.status(400).json({ error: 'Folder path is required' });
    return;
  }
  try {
    const full = resolveInside(getServerDir(srv.id), rel);
    await fs.mkdir(full, { recursive: true });
    res.status(201).json({ ok: true, path: rel });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

filesRouter.post('/touch', requirePermission('files'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { path: relPath, content } = req.body as { path?: string; content?: string };
  const rel = normalizeRelPath(String(relPath || ''));
  if (!rel) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }
  try {
    const full = resolveInside(getServerDir(srv.id), rel);
    await atomicWriteFile(full, content ?? '');
    res.status(201).json({ ok: true, path: rel });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

filesRouter.post('/upload', requirePermission('files'), upload.array('files', 20), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const targetDirRel = normalizeRelPath(String(req.query.path || ''));
  const uploaded = (req.files as Express.Multer.File[]) || [];
  if (uploaded.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }
  try {
    const serverDir = getServerDir(srv.id);
    const destDir = resolveInside(serverDir, targetDirRel);
    await fs.mkdir(destDir, { recursive: true });
    const saved: string[] = [];
    for (const file of uploaded) {
      const safeName = path.basename(file.originalname);
      const destFile = resolveInside(destDir, safeName);
      await fs.writeFile(destFile, file.buffer);
      saved.push(safeName);
    }
    res.status(201).json({ ok: true, files: saved });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

filesRouter.get('/download', requirePermission('files'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const rel = normalizeRelPath(String(req.query.path || ''));
  if (!rel) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }
  try {
    const full = resolveInside(getServerDir(srv.id), rel);
    res.download(full, path.basename(full));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

filesRouter.post('/rename', requirePermission('files'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { from, to } = req.body as { from?: string; to?: string };
  if (!from || !to) {
    res.status(400).json({ error: '"from" and "to" paths are required' });
    return;
  }
  try {
    const serverDir = getServerDir(srv.id);
    const src = resolveInside(serverDir, from);
    const dest = resolveInside(serverDir, to);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

filesRouter.post('/extract', requirePermission('files'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const rel = normalizeRelPath(String((req.body as { path?: string }).path || ''));
  if (!rel.toLowerCase().endsWith('.zip')) {
    res.status(400).json({ error: 'Only .zip files can be extracted' });
    return;
  }
  try {
    const serverDir = getServerDir(srv.id);
    const zipPath = resolveInside(serverDir, rel);
    const targetDir = path.dirname(zipPath);
    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
      const inner = entry.entryName.replace(/\\/g, '/');
      if (!inner || inner.startsWith('..')) continue;
      const dest = resolveInside(targetDir, inner);
      if (entry.isDirectory) {
        await fs.mkdir(dest, { recursive: true });
      } else {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, entry.getData());
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

filesRouter.delete('/', requirePermission('files'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const rel = normalizeRelPath(String(req.query.path || ''));
  if (!rel) {
    res.status(400).json({ error: 'Cannot delete server root directory' });
    return;
  }
  try {
    const full = resolveInside(getServerDir(srv.id), rel);
    await fs.rm(full, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
