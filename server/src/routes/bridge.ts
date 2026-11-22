import { Router } from 'express';
import { store } from '../services/store.js';
import { requirePermission } from '../services/authService.js';
import {
  clearTrackedPortals,
  createRealmWorld,
  deleteRealmWorld,
  getBridgeStatus,
  getRealmsState,
  getWorldGamerules,
  installBridgePlugin,
  loadRealmWorld,
  moveRealmPlayer,
  runBridgePlayerAction,
  saveRealmsConfig,
  sendBridgeBroadcast,
  setWorldGamerule,
  uninstallBridgePlugin,
  unloadRealmWorld,
  updateWorldEnvironment,
} from '../services/bridgeService.js';
import type { RealmsConfig } from '../../../shared/types.js';

export const bridgeRouter = Router({ mergeParams: true });

bridgeRouter.get('/status', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const status = await getBridgeStatus(srv);
  res.json(status);
});

bridgeRouter.post('/install', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const { port } = await installBridgePlugin(srv);
    res.json({ ok: true, port });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.delete('/install', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  await uninstallBridgePlugin(srv);
  res.json({ ok: true });
});

bridgeRouter.get('/worlds/:world/gamerules', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const data = await getWorldGamerules(srv, req.params.world);
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.put('/worlds/:world/gamerules', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { name, value } = req.body as { name?: string; value?: string | number | boolean };
  if (!name || value === undefined) {
    res.status(400).json({ error: 'name and value are required' });
    return;
  }
  try {
    const result = await setWorldGamerule(srv, req.params.world, name, value);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.put('/worlds/:world/environment', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const result = await updateWorldEnvironment(srv, req.params.world, req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.post('/players/:player/action', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const result = await runBridgePlayerAction(srv, req.params.player, req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.post('/broadcast', requirePermission('console'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const message = String((req.body as { message?: string }).message || '').trim();
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  try {
    const result = await sendBridgeBroadcast(srv, message);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---------- Realms, Multi-World, Colored Portals & Per-World Plugins ----------

bridgeRouter.get('/realms', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const state = await getRealmsState(srv);
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.put('/realms', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const state = await saveRealmsConfig(srv, req.body as RealmsConfig);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.post('/realms/worlds', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const result = await createRealmWorld(srv, req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.post('/realms/worlds/:world/load', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const env = (req.body as { environment?: 'NORMAL' | 'NETHER' | 'THE_END' })?.environment;
    const state = await loadRealmWorld(srv, req.params.world, env);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.post('/realms/worlds/:world/unload', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const save = (req.body as { save?: boolean })?.save !== false;
    const state = await unloadRealmWorld(srv, req.params.world, save);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.delete('/realms/worlds/:world', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const state = await deleteRealmWorld(srv, req.params.world);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.post('/realms/players/:player/move', requirePermission('players'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const state = await moveRealmPlayer(srv, req.params.player, req.body);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.delete('/realms/portals', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const state = await clearTrackedPortals(srv);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

bridgeRouter.delete('/realms/portals/:portalId', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const state = await clearTrackedPortals(srv, req.params.portalId);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
