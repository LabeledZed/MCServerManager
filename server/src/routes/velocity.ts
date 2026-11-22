import { Router } from 'express';
import { store } from '../services/store.js';
import { requirePermission } from '../services/authService.js';
import {
  getVelocityNetworkState,
  linkManagedBackendServer,
  regenerateVelocitySecret,
  syncFloodgateKeyToBackend,
  updateVelocitySettings,
} from '../services/velocityService.js';

export const velocityRouter = Router({ mergeParams: true });

velocityRouter.get('/', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  if (srv.software !== 'velocity') {
    res.status(400).json({ error: 'This endpoint is only available for Velocity proxy servers' });
    return;
  }
  try {
    res.json(await getVelocityNetworkState(srv));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

velocityRouter.put('/config', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv || srv.software !== 'velocity') {
    res.status(404).json({ error: 'Velocity server not found' });
    return;
  }
  try {
    res.json(await updateVelocitySettings(srv, req.body));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

velocityRouter.post('/link-managed', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv || srv.software !== 'velocity') {
    res.status(404).json({ error: 'Velocity server not found' });
    return;
  }
  try {
    res.json(await linkManagedBackendServer(srv, req.body));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

velocityRouter.post('/secret/regenerate', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv || srv.software !== 'velocity') {
    res.status(404).json({ error: 'Velocity server not found' });
    return;
  }
  try {
    res.json(await regenerateVelocitySecret(srv));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

velocityRouter.post('/sync-floodgate-key/:targetServerId', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv || srv.software !== 'velocity') {
    res.status(404).json({ error: 'Velocity server not found' });
    return;
  }
  try {
    res.json(await syncFloodgateKeyToBackend(srv, req.params.targetServerId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
