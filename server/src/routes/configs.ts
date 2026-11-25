import { Router } from 'express';
import path from 'node:path';
import fsSync from 'node:fs';
import { getServerDir } from '../config.js';
import { store } from '../services/store.js';
import {
  assertAllowedConfigPath,
  discoverServerConfigs,
  readConfigDocument,
  saveConfigFromTree,
  saveConfigRaw,
} from '../services/configParser.js';
import { requirePermission } from '../services/authService.js';
import { extractVelocityBindPort } from '../services/velocityService.js';
import { atomicWriteFile, normalizeRelPath, resolveInside } from '../utils/fsSafe.js';
import type { ConfigTreeNode } from '../../../shared/types.js';

export const configsRouter = Router({ mergeParams: true });

configsRouter.get('/', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  try {
    const configs = await discoverServerConfigs(getServerDir(srv.id), srv.software);
    res.json({ configs });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

configsRouter.get('/file', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const rel = String(req.query.path || '');
  if (!rel) {
    res.status(400).json({ error: 'Query parameter "path" is required' });
    return;
  }
  try {
    const doc = await readConfigDocument(getServerDir(srv.id), rel);
    res.json(doc);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : 400;
    res.status(code).json({ error: msg });
  }
});

configsRouter.put('/file', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { path: relPath, mode, tree, raw } = req.body as {
    path?: string;
    mode?: 'tree' | 'raw';
    tree?: ConfigTreeNode[];
    raw?: string;
  };
  if (!relPath) {
    res.status(400).json({ error: 'Field "path" is required' });
    return;
  }
  try {
    const serverDir = getServerDir(srv.id);
    let doc;
    if (mode === 'tree' && Array.isArray(tree)) {
      doc = await saveConfigFromTree(serverDir, relPath, tree);
    } else if (typeof raw === 'string') {
      doc = await saveConfigRaw(serverDir, relPath, raw);
    } else {
      res.status(400).json({ error: 'Provide either { mode: "tree", tree } or { mode: "raw", raw }' });
      return;
    }

    // Keep server port in store synchronized if server-port changed in server.properties or bind changed in velocity.toml
    const normalizedRel = normalizeRelPath(relPath).toLowerCase();
    if (normalizedRel === 'server.properties') {
      const match = doc.raw.match(/^server-port\s*=\s*(\d+)/m);
      if (match) {
        const nextPort = Number(match[1]);
        if (nextPort >= 1024 && nextPort <= 65535 && srv.port !== nextPort) {
          srv.port = nextPort;
          store.upsertServer(srv);
        }
      }
    } else if (normalizedRel === 'velocity.toml') {
      const nextPort = extractVelocityBindPort(doc.raw);
      if (nextPort !== null && srv.port !== nextPort) {
        srv.port = nextPort;
        store.upsertServer(srv);
      }
    }

    res.json(doc);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

configsRouter.post('/create', requirePermission('configs'), async (req, res) => {
  const srv = store.getServer(req.params.id);
  if (!srv) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  const { path: relPath, initialContent } = req.body as { path?: string; initialContent?: string };
  if (!relPath) {
    res.status(400).json({ error: 'Field "path" is required' });
    return;
  }
  try {
    const safeRel = assertAllowedConfigPath(relPath);
    const serverDir = getServerDir(srv.id);
    const full = resolveInside(serverDir, safeRel);
    if (fsSync.existsSync(full)) {
      res.status(409).json({ error: 'File already exists' });
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const defaultContent =
      initialContent !== undefined
        ? initialContent
        : ext === '.json'
          ? '{}\n'
          : ext === '.yml' || ext === '.yaml'
            ? '# Created with MCServerManager\n'
            : '';
    await atomicWriteFile(full, defaultContent);
    const doc = await readConfigDocument(serverDir, relPath);
    res.status(201).json(doc);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
