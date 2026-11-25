import { Router } from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import { getServerDir } from '../config.js';
import { store } from '../services/store.js';
import { serverManager } from '../services/serverManager.js';
import {
  deleteAddon,
  getAddonDirName,
  installFromModrinth,
  listInstalledAddons,
  listModrinthVersions,
  searchModrinthAddons,
  toggleAddonEnabled,
} from '../services/pluginService.js';
import { requirePermission } from '../services/authService.js';
import { resolveInside } from '../utils/fsSafe.js';

export const pluginsRouter = Router({ mergeParams: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, _file, cb) =>
      cb(null, `mcsm-addon-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jar`),
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});

pluginsRouter.get('/', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const data = await listInstalledAddons(
      getServerDir(srv.id),
      srv.software,
      srv.pluginConfigFolderOverrides || {},
      (srv.pendingAddonDeletions || []).map((p) => p.fileName),
    );
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

pluginsRouter.post('/upload', requirePermission('plugins'), upload.single('file'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  const uploadedPath = req.file?.path;
  try {
    if (!srv) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    if (!req.file || !uploadedPath) {
      res.status(400).json({ error: 'No .jar file uploaded' });
      return;
    }
    const safeName = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._+-]/g, '_');
    if (!safeName.toLowerCase().endsWith('.jar')) {
      res.status(400).json({ error: 'Only .jar files are allowed' });
      return;
    }
    const addonDir = getAddonDirName(srv.software);
    const target = resolveInside(getServerDir(srv.id), `${addonDir}/${safeName}`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(uploadedPath, target);
    res.status(201).json({ ok: true, fileName: safeName });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    if (uploadedPath) {
      await fs.rm(uploadedPath, { force: true }).catch(() => {});
    }
  }
});

pluginsRouter.post('/:fileName/toggle', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const nextName = await toggleAddonEnabled(getServerDir(srv.id), srv.software, req.params.fileName);
    res.json({ ok: true, fileName: nextName });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

pluginsRouter.put('/:fileName/config-folder', requirePermission('plugins'), (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const folderName = String((req.body as { folderName?: string }).folderName || '').trim();
  if (folderName && (folderName.includes('/') || folderName.includes('\\') || folderName.includes('..') || folderName === '.')) {
    res.status(400).json({ error: 'Invalid config folder name' });
    return;
  }
  const overrides = { ...(srv.pluginConfigFolderOverrides || {}) };
  if (folderName) {
    overrides[req.params.fileName] = folderName;
  } else {
    delete overrides[req.params.fileName];
  }
  srv.pluginConfigFolderOverrides = overrides;
  store.upsertServer(srv);
  res.json({ ok: true, overrides });
});

pluginsRouter.delete('/:fileName/pending', requirePermission('plugins'), (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const target = req.params.fileName.toLowerCase();
  srv.pendingAddonDeletions = (srv.pendingAddonDeletions || []).filter(
    (p) => p.fileName.toLowerCase() !== target,
  );
  store.upsertServer(srv);
  res.json({ ok: true });
});

pluginsRouter.delete('/:fileName', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const deleteConfigs = req.query.deleteConfigs === 'true';
    const configFolder = typeof req.query.configFolder === 'string' ? req.query.configFolder : null;
    const result = await deleteAddon(getServerDir(srv.id), srv.software, req.params.fileName, deleteConfigs, configFolder);

    if (result.locked) {
      const existing = srv.pendingAddonDeletions || [];
      const filtered = existing.filter((p) => p.fileName.toLowerCase() !== req.params.fileName.toLowerCase());
      filtered.push({
        fileName: req.params.fileName,
        deleteConfigs,
        configFolder,
      });
      srv.pendingAddonDeletions = filtered;
      store.upsertServer(srv);
      res.json({
        ok: true,
        queued: true,
        message: serverManager.isRunning(srv.id)
          ? `${req.params.fileName} is locked while the server is running and will be removed automatically when the server stops.`
          : `${req.params.fileName} is currently locked and queued for automatic removal.`,
      });
      return;
    }

    // Clear any stale pending entry if deleted immediately
    if (srv.pendingAddonDeletions?.length) {
      srv.pendingAddonDeletions = srv.pendingAddonDeletions.filter(
        (p) => p.fileName.toLowerCase() !== req.params.fileName.toLowerCase(),
      );
      store.upsertServer(srv);
    }

    res.json({ ok: true, queued: false, message: `Removed ${req.params.fileName}` });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

pluginsRouter.get('/modrinth/search', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const query = String(req.query.q || '');
    const filterVersion = req.query.allVersions === 'true' ? undefined : srv.mcVersion;
    const hits = await searchModrinthAddons(query, srv.software, filterVersion, 24);
    res.json({ hits });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

pluginsRouter.get('/modrinth/:projectId/versions', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const versions = await listModrinthVersions(req.params.projectId, srv.software, srv.mcVersion);
    res.json({ versions });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

pluginsRouter.post('/modrinth/install', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { downloadUrl, fileName } = req.body as { downloadUrl?: string; fileName?: string };
  if (!downloadUrl || !fileName) {
    res.status(400).json({ error: 'downloadUrl and fileName are required' });
    return;
  }
  if (!downloadUrl.startsWith('https://cdn.modrinth.com/')) {
    res.status(400).json({ error: 'Invalid Modrinth CDN download URL' });
    return;
  }
  try {
    const saved = await installFromModrinth(getServerDir(srv.id), srv.software, downloadUrl, fileName);
    res.status(201).json({ ok: true, fileName: saved });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
