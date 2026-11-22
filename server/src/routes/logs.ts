import { Router } from 'express';
import { getServerDir } from '../config.js';
import { requirePermission } from '../services/authService.js';
import { listLogFiles, searchLogs } from '../services/logSearchService.js';
import { store } from '../services/store.js';

export const logsRouter = Router({ mergeParams: true });

logsRouter.get('/', requirePermission('console'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }

  try {
    const files = await listLogFiles(getServerDir(srv.id));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

logsRouter.post('/search', requirePermission('console'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }

  const body = (req.body || {}) as {
    query?: unknown;
    regex?: unknown;
    caseSensitive?: unknown;
    files?: unknown;
    maxResults?: unknown;
  };

  if (typeof body.query !== 'string') {
    res.status(400).json({ error: 'query must be a string' });
    return;
  }

  let maxResults = 2000;
  if (body.maxResults !== undefined) {
    const parsed = Number(body.maxResults);
    if (!Number.isFinite(parsed)) {
      res.status(400).json({ error: 'maxResults must be a finite number' });
      return;
    }
    maxResults = Math.max(1, Math.min(5000, Math.floor(parsed)));
  }

  try {
    const result = await searchLogs(getServerDir(srv.id), {
      query: body.query,
      regex: Boolean(body.regex),
      caseSensitive: Boolean(body.caseSensitive),
      files: body.files as string[] | undefined,
      maxResults,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
