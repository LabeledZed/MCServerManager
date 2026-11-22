import { Router } from 'express';
import { getServerDir } from '../config.js';
import { store } from '../services/store.js';
import {
  addOpPlayer,
  addWhitelistPlayer,
  banIp,
  banPlayer,
  getPlayersState,
  kickPlayer,
  removeOpPlayer,
  removeWhitelistPlayer,
  setWhitelistEnabled,
  unbanIp,
  unbanPlayer,
} from '../services/playerService.js';
import { requirePermission } from '../services/authService.js';

export const playersRouter = Router({ mergeParams: true });

playersRouter.get('/', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const state = await getPlayersState(srv.id, getServerDir(srv.id));
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

playersRouter.put('/whitelist/enabled', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const enabled = Boolean((req.body as { enabled?: boolean }).enabled);
  await setWhitelistEnabled(srv.id, getServerDir(srv.id), enabled);
  res.json({ ok: true, enabled });
});

playersRouter.post('/whitelist', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const username = String((req.body as { username?: string }).username || '').trim();
  if (!username) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }
  const entry = await addWhitelistPlayer(srv.id, getServerDir(srv.id), username);
  res.status(201).json(entry);
});

playersRouter.delete('/whitelist/:username', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  await removeWhitelistPlayer(srv.id, getServerDir(srv.id), req.params.username);
  res.json({ ok: true });
});

playersRouter.post('/ops', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { username, level, bypassesPlayerLimit } = req.body as {
    username?: string;
    level?: number;
    bypassesPlayerLimit?: boolean;
  };
  if (!username?.trim()) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }
  const entry = await addOpPlayer(srv.id, getServerDir(srv.id), username, level ?? 4, bypassesPlayerLimit ?? false);
  res.status(201).json(entry);
});

playersRouter.delete('/ops/:username', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  await removeOpPlayer(srv.id, getServerDir(srv.id), req.params.username);
  res.json({ ok: true });
});

playersRouter.post('/bans', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { username, reason } = req.body as { username?: string; reason?: string };
  if (!username?.trim()) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }
  const entry = await banPlayer(srv.id, getServerDir(srv.id), username, reason);
  res.status(201).json(entry);
});

playersRouter.delete('/bans/:username', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  await unbanPlayer(srv.id, getServerDir(srv.id), req.params.username);
  res.json({ ok: true });
});

playersRouter.post('/ban-ips', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { ip, reason } = req.body as { ip?: string; reason?: string };
  if (!ip?.trim()) {
    res.status(400).json({ error: 'IP address is required' });
    return;
  }
  const entry = await banIp(srv.id, getServerDir(srv.id), ip, reason);
  res.status(201).json(entry);
});

playersRouter.delete('/ban-ips/:ip', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  await unbanIp(srv.id, getServerDir(srv.id), req.params.ip);
  res.json({ ok: true });
});

playersRouter.post('/kick', requirePermission('players'), (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { username, reason } = req.body as { username?: string; reason?: string };
  if (!username?.trim()) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }
  try {
    kickPlayer(srv.id, username, reason);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
