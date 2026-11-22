import { Router } from 'express';
import {
  discoverJavaRuntimes,
  downloadTemurinJava,
  getActiveJavaDownloads,
  recommendedJavaMajorForMc,
} from '../services/javaService.js';
import { requireAuth, requirePermission } from '../services/authService.js';
import type { JavaDownloadStatus } from '../../../shared/types.js';

export function createJavaRouter(onDownloadProgress: (status: JavaDownloadStatus) => void): Router {
  const router = Router();

  router.get('/', requireAuth, async (_req, res) => {
    try {
      const runtimes = await discoverJavaRuntimes();
      res.json({
        runtimes,
        downloads: getActiveJavaDownloads(),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/recommend/:mcVersion', requireAuth, (req, res) => {
    res.json({ major: recommendedJavaMajorForMc(req.params.mcVersion) });
  });

  router.post('/download', requirePermission('settings'), (req, res) => {
    const major = Number((req.body as { major?: number }).major);
    if (![8, 17, 21, 25].includes(major)) {
      res.status(400).json({ error: 'Supported Adoptium Temurin versions: 8, 17, 21, 25' });
      return;
    }

    // Start async download and stream updates over WebSocket
    res.status(202).json({ ok: true, major });
    downloadTemurinJava(major, onDownloadProgress).catch((err) => {
      console.error(`[JavaDownload] Failed for Java ${major}:`, err);
    });
  });

  return router;
}
