import { Router } from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { getServerDir } from '../config.js';
import { store } from '../services/store.js';
import { serverManager } from '../services/serverManager.js';
import {
  createWorldZipBuffer,
  deleteWorld,
  listWorlds,
  replaceWorldFromZip,
} from '../services/worldService.js';
import { readRealmsConfigFromDisk, writeRealmsConfigToDisk } from '../services/bridgeService.js';
import {
  createBackup,
  deleteBackup,
  getBackupFilePath,
  listBackups,
  restoreBackup,
} from '../services/backupService.js';
import { scheduleService, validateTrigger } from '../services/scheduleService.js';
import { requirePermission } from '../services/authService.js';
import type { ScheduleAction, ScheduledTask, ScheduleTrigger } from '../../../shared/types.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// ---------- Worlds Router ----------
export const worldsRouter = Router({ mergeParams: true });

worldsRouter.get('/', requirePermission('backups'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const worlds = await listWorlds(getServerDir(srv.id), srv.mcVersion);
  res.json({ worlds });
});

worldsRouter.get('/:worldName/download', requirePermission('backups'), (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const subPath = typeof req.query.subPath === 'string' && req.query.subPath.trim() ? req.query.subPath.trim() : undefined;
  try {
    const buf = createWorldZipBuffer(getServerDir(srv.id), req.params.worldName, subPath);
    const suffix = subPath ? `-${subPath.replace(/[\\/]+/g, '-')}` : '';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.worldName}${suffix}.zip"`);
    res.send(buf);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

worldsRouter.post('/:worldName/upload', requirePermission('backups'), upload.single('file'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  if (serverManager.isRunning(srv.id)) {
    res.status(409).json({ error: 'Stop the server before replacing a world or dimension' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'World .zip file is required' });
    return;
  }
  const subPath = typeof req.query.subPath === 'string' && req.query.subPath.trim() ? req.query.subPath.trim() : undefined;
  const registerRealmWorld =
    typeof req.query.registerRealmWorld === 'string' && req.query.registerRealmWorld.trim()
      ? req.query.registerRealmWorld.trim()
      : undefined;
  const envRaw = typeof req.query.environment === 'string' ? req.query.environment.trim().toUpperCase() : 'NORMAL';
  const environment: 'NORMAL' | 'NETHER' | 'THE_END' =
    envRaw === 'NETHER' || envRaw === 'THE_END' ? envRaw : 'NORMAL';
  try {
    await replaceWorldFromZip(getServerDir(srv.id), req.params.worldName, req.file.buffer, subPath);
    if (registerRealmWorld) {
      const cfg = await readRealmsConfigFromDisk(srv.id);
      const exists = cfg.worlds.some((w) => w.name.toLowerCase() === registerRealmWorld.toLowerCase());
      if (!exists) {
        cfg.worlds.push({
          name: registerRealmWorld,
          environment,
          worldType: 'NORMAL',
          generateStructures: true,
          autoLoad: true,
        });
        await writeRealmsConfigToDisk(srv.id, cfg);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

worldsRouter.delete('/:worldName', requirePermission('backups'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  if (serverManager.isRunning(srv.id)) {
    res.status(409).json({ error: 'Stop the server before deleting/regenerating a world or dimension' });
    return;
  }
  const subPath = typeof req.query.subPath === 'string' && req.query.subPath.trim() ? req.query.subPath.trim() : undefined;
  try {
    await deleteWorld(getServerDir(srv.id), req.params.worldName, subPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---------- Backups Router ----------
export const backupsRouter = Router({ mergeParams: true });

backupsRouter.get('/', requirePermission('backups'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const backups = await listBackups(srv.id);
  res.json({ backups });
});

backupsRouter.post('/', requirePermission('backups'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { label, scope } = req.body as { label?: string; scope?: 'full' | 'worlds' };
  try {
    const created = await createBackup(srv.id, label || 'Manual Backup', scope === 'worlds' ? 'worlds' : 'full');
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

backupsRouter.post('/:backupId/restore', requirePermission('backups'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    await restoreBackup(srv.id, req.params.backupId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

backupsRouter.get('/:backupId/download', requirePermission('backups'), (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const filePath = getBackupFilePath(srv.id, req.params.backupId);
    res.download(filePath);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

backupsRouter.delete('/:backupId', requirePermission('backups'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    await deleteBackup(srv.id, req.params.backupId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---------- Native Task Scheduler Router ----------
export const schedulesRouter = Router({ mergeParams: true });

schedulesRouter.get('/', requirePermission('schedules'), (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  res.json({ tasks: scheduleService.listWithNextRun(srv.id) });
});

schedulesRouter.post('/', requirePermission('schedules'), (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { name, trigger, action, payload, onlyWhenRunning, enabled } = req.body as {
    name?: string;
    trigger?: ScheduleTrigger;
    action?: ScheduleAction;
    payload?: string;
    onlyWhenRunning?: boolean;
    enabled?: boolean;
  };
  if (!name?.trim() || !trigger || !action) {
    res.status(400).json({ error: 'name, trigger, and action are required' });
    return;
  }
  const err = validateTrigger(trigger);
  if (err) {
    res.status(400).json({ error: err });
    return;
  }
  const task: ScheduledTask = {
    id: crypto.randomUUID(),
    serverId: srv.id,
    name: name.trim(),
    trigger,
    action,
    payload: payload?.trim() || '',
    onlyWhenRunning: typeof onlyWhenRunning === 'boolean' ? onlyWhenRunning : action !== 'start',
    enabled: enabled !== false,
  };
  scheduleService.refreshNextRun(task, new Date());
  store.upsertSchedule(task);
  res.status(201).json(task);
});

schedulesRouter.patch('/:taskId', requirePermission('schedules'), (req, res) => {
  const task = store.getSchedules(req.params.id).find((t) => t.id === req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Scheduled task not found' });
    return;
  }
  const updates = req.body as Partial<ScheduledTask>;
  if (typeof updates.name === 'string' && updates.name.trim()) task.name = updates.name.trim();
  if (updates.trigger) {
    const err = validateTrigger(updates.trigger);
    if (err) {
      res.status(400).json({ error: err });
      return;
    }
    task.trigger = updates.trigger;
  }
  if (updates.action) task.action = updates.action;
  if (typeof updates.payload === 'string') task.payload = updates.payload;
  if (typeof updates.onlyWhenRunning === 'boolean') task.onlyWhenRunning = updates.onlyWhenRunning;
  if (typeof updates.enabled === 'boolean') task.enabled = updates.enabled;

  scheduleService.refreshNextRun(task, new Date());
  store.upsertSchedule(task);
  res.json(task);
});

schedulesRouter.post('/:taskId/run', requirePermission('schedules'), async (req, res) => {
  const task = store.getSchedules(req.params.id).find((t) => t.id === req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Scheduled task not found' });
    return;
  }
  const result = await scheduleService.executeTask(task.id, true);
  res.json(result);
});

schedulesRouter.delete('/:taskId', requirePermission('schedules'), (req, res) => {
  store.deleteSchedule(req.params.taskId);
  res.json({ ok: true });
});
