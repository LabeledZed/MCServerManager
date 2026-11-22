import { Router } from 'express';
import { listSoftwareVersions } from '../services/catalogService.js';
import { requireAuth } from '../services/authService.js';
import type { ServerSoftware } from '../../../shared/types.js';

export const catalogRouter = Router();

const VALID_SOFTWARE: ServerSoftware[] = [
  'paper',
  'purpur',
  'leaf',
  'vanilla',
  'fabric',
  'neoforge',
  'forge',
  'folia',
  'velocity',
  'spigot',
  'custom',
];

catalogRouter.get('/versions/:software', requireAuth, async (req, res) => {
  const software = req.params.software as ServerSoftware;
  if (!VALID_SOFTWARE.includes(software)) {
    res.status(400).json({ error: `Unsupported server software: ${software}` });
    return;
  }
  try {
    const versions = await listSoftwareVersions(software);
    res.json({ software, versions });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
