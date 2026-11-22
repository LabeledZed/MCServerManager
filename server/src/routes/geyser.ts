import { Router } from 'express';
import { store } from '../services/store.js';
import { requirePermission } from '../services/authService.js';
import {
  cancelPendingGeyserUninstall,
  getGeyserStatus,
  installFloodgate,
  installGeyser,
  uninstallFloodgate,
  uninstallGeyser,
  updateFloodgateConfig,
  updateGeyserConfig,
} from '../services/geyserService.js';

export const geyserRouter = Router({ mergeParams: true });

geyserRouter.get('/', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    res.json(await getGeyserStatus(srv));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

geyserRouter.post('/install', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    res.json(await installGeyser(srv));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

geyserRouter.delete('/install', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    res.json(await uninstallGeyser(srv));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

geyserRouter.delete('/install/pending', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    res.json(await cancelPendingGeyserUninstall(srv, 'geyser'));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

geyserRouter.post('/floodgate/install', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    res.json(await installFloodgate(srv));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

geyserRouter.delete('/floodgate/install', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    res.json(await uninstallFloodgate(srv));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

geyserRouter.delete('/floodgate/install/pending', requirePermission('plugins'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    res.json(await cancelPendingGeyserUninstall(srv, 'floodgate'));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

geyserRouter.put('/config', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    res.json(await updateGeyserConfig(srv, req.body));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

geyserRouter.put('/floodgate/config', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    res.json(await updateFloodgateConfig(srv, req.body));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
