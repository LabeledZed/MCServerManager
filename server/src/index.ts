import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { CLIENT_DIST_DIR, ensureAppDirs, PORT } from './config.js';
import { attachAuth, isLoopbackAddress, resolveRequestUser } from './services/authService.js';
import { store } from './services/store.js';
import { serverManager } from './services/serverManager.js';
import { scheduleService } from './services/scheduleService.js';
import { authRouter, onRequireAuthSettingChanged } from './routes/auth.js';
import { createJavaRouter } from './routes/java.js';
import { catalogRouter } from './routes/catalog.js';
import { serversRouter } from './routes/servers.js';
import { configsRouter } from './routes/configs.js';
import { pluginsRouter } from './routes/plugins.js';
import { filesRouter } from './routes/files.js';
import { logsRouter } from './routes/logs.js';
import { playersRouter } from './routes/players.js';
import { bridgeRouter } from './routes/bridge.js';
import { geyserRouter } from './routes/geyser.js';
import { velocityRouter } from './routes/velocity.js';
import { backupsRouter, schedulesRouter, worldsRouter } from './routes/worldsBackupsSchedules.js';
import type { ConsoleLine, JavaDownloadStatus, ServerRuntimeState, WsServerMessage } from '../../shared/types.js';

ensureAppDirs();
scheduleService.init();

function isAllowedOrigin(originHeader: string | undefined, hostHeader: string | undefined): boolean {
  if (!originHeader) return true;
  try {
    const parsed = new URL(originHeader);
    if (hostHeader && parsed.host.toLowerCase() === hostHeader.toLowerCase()) {
      return true;
    }
    // Allow local Vite dev server origin when running on loopback
    if (
      (parsed.host === 'localhost:5173' || parsed.host === '127.0.0.1:5173') &&
      (!hostHeader || hostHeader.startsWith('localhost:') || hostHeader.startsWith('127.0.0.1:'))
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const app = express();

// Enforce loopback-only access when requireAuth is false, and strict Origin/CORS checks
app.use((req, res, next) => {
  if (!store.state.settings.requireAuth && !isLoopbackAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'Remote access is disabled while authentication is turned off.' });
    return;
  }

  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin) {
    if (!isAllowedOrigin(origin, host)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.status(403).json({ error: 'Cross-origin request blocked' });
        return;
      }
    } else {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Tray-Secret');
        res.status(204).end();
        return;
      }
    }
  }

  next();
});

app.use(express.json({ limit: '15mb' }));
app.use(attachAuth);

// WebSocket hub
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const activeSockets = new Set<net.Socket>();
server.on('connection', (socket) => {
  activeSockets.add(socket);
  socket.on('close', () => activeSockets.delete(socket));
});

interface ClientMeta {
  subscribedConsoleServerId: string | null;
}

const clientMeta = new Map<WebSocket, ClientMeta>();

function sendWs(ws: WebSocket, msg: WsServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastWs(msg: WsServerMessage): void {
  const payload = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

wss.on('connection', (ws, req) => {
  try {
    if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
      ws.close(4003, 'Forbidden origin');
      return;
    }

    const user = resolveRequestUser(req.headers.cookie, req.socket.remoteAddress);
    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    clientMeta.set(ws, { subscribedConsoleServerId: null });
    sendWs(ws, { type: 'servers:all', states: serverManager.getAllRuntimes() });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf8')) as {
          type: string;
          serverId?: string;
          command?: string;
        };
        const meta = clientMeta.get(ws);
        if (!meta) return;

        if (msg.type === 'console:subscribe' && msg.serverId) {
          if (user.role !== 'owner' && !user.permissions.includes('console')) {
            return;
          }
          meta.subscribedConsoleServerId = msg.serverId;
          sendWs(ws, {
            type: 'console:history',
            serverId: msg.serverId,
            lines: serverManager.getConsoleHistory(msg.serverId),
          });
        } else if (msg.type === 'console:unsubscribe') {
          meta.subscribedConsoleServerId = null;
        } else if (msg.type === 'console:command' && msg.serverId && msg.command) {
          if (user.role === 'owner' || user.permissions.includes('console')) {
            try {
              serverManager.sendCommand(msg.serverId, msg.command);
            } catch {
              // ignored if server offline
            }
          }
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      clientMeta.delete(ws);
    });
  } catch {
    try {
      ws.close(1011, 'Internal error');
    } catch {
      // ignore
    }
  }
});

serverManager.on('state', (serverId: string, runtime: ServerRuntimeState) => {
  broadcastWs({ type: 'server:state', serverId, runtime });
});

serverManager.on('console', (serverId: string, line: ConsoleLine) => {
  const payload = JSON.stringify({ type: 'console:line', serverId, line } satisfies WsServerMessage);
  for (const [ws, meta] of clientMeta.entries()) {
    if (ws.readyState === WebSocket.OPEN && meta.subscribedConsoleServerId === serverId) {
      ws.send(payload);
    }
  }
});

const broadcastJavaDownload = (status: JavaDownloadStatus) => {
  broadcastWs({ type: 'java:download', status });
};

function verifyTrayOrOwnerRequest(req: express.Request): boolean {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    return false;
  }
  const traySecret = process.env.MCSM_TRAY_SECRET;
  const providedSecret = req.headers['x-tray-secret'];
  if (traySecret && typeof providedSecret === 'string') {
    const a = Buffer.from(traySecret, 'utf8');
    const b = Buffer.from(providedSecret, 'utf8');
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return true;
    }
  }
  if (!traySecret && req.user?.role === 'owner' && isAllowedOrigin(req.headers.origin, req.headers.host)) {
    return true;
  }
  return false;
}

// API routes
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'MCServerManager', version: '1.0.2' });
});

app.get('/api/system/running-servers', (req, res) => {
  if (!verifyTrayOrOwnerRequest(req)) {
    res.status(403).json({ error: 'Authorized local tray/owner access only' });
    return;
  }
  const running = serverManager.getRunningServers();
  res.json({ count: running.length, servers: running });
});

app.post('/api/system/shutdown', async (req, res) => {
  if (!verifyTrayOrOwnerRequest(req)) {
    res.status(403).json({ error: 'Authorized local tray/owner access only' });
    return;
  }
  const mode = (req.body as { mode?: string })?.mode === 'kill' ? 'kill' : 'stop';
  console.log(`\n[MCServerManager] Shutdown requested from tray/console (mode: ${mode})...`);
  scheduleService.dispose();
  serverManager.dispose();
  await serverManager.stopAllServers(mode === 'kill');
  res.json({ ok: true, mode });
  setTimeout(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  }, 100);
});

app.use('/api/auth', authRouter);
app.use('/api/java', createJavaRouter(broadcastJavaDownload));
app.use('/api/catalog', catalogRouter);
app.use('/api/servers', serversRouter);
app.use('/api/servers/:id/configs', configsRouter);
app.use('/api/servers/:id/addons', pluginsRouter);
app.use('/api/servers/:id/files', filesRouter);
app.use('/api/servers/:id/logs', logsRouter);
app.use('/api/servers/:id/players', playersRouter);
app.use('/api/servers/:id/bridge', bridgeRouter);
app.use('/api/servers/:id/geyser', geyserRouter);
app.use('/api/servers/:id/velocity', velocityRouter);
app.use('/api/servers/:id/worlds', worldsRouter);
app.use('/api/servers/:id/backups', backupsRouter);
app.use('/api/servers/:id/schedules', schedulesRouter);

// Serve built React SPA when present (production / standalone mode)
if (fs.existsSync(CLIENT_DIST_DIR)) {
  app.use(
    express.static(CLIENT_DIST_DIR, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      },
    }),
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
  });
}

function resolveBindHost(requireAuth: boolean): string {
  if (process.env.HOST && process.env.HOST.trim()) {
    return process.env.HOST.trim();
  }
  return requireAuth ? '0.0.0.0' : '127.0.0.1';
}

let currentBindHost = resolveBindHost(store.state.settings.requireAuth);

server.listen(PORT, currentBindHost, () => {
  console.log(
    `\n  MCServerManager running at http://localhost:${PORT} (bound to ${currentBindHost}, requireAuth=${store.state.settings.requireAuth})\n`,
  );
  void serverManager.startAutoStartServers();
});

onRequireAuthSettingChanged((requireAuth) => {
  const nextHost = resolveBindHost(requireAuth);
  if (nextHost === currentBindHost) return;
  currentBindHost = nextHost;
  console.log(`[MCServerManager] requireAuth=${requireAuth} — rebinding HTTP server to ${nextHost}:${PORT}...`);
  for (const ws of wss.clients) {
    try { ws.close(1012, 'Rebinding listener'); } catch { /* ignore */ }
  }
  for (const sock of activeSockets) {
    try { sock.destroy(); } catch { /* ignore */ }
  }
  server.close(() => {
    server.listen(PORT, nextHost, () => {
      console.log(`[MCServerManager] HTTP server now listening on ${nextHost}:${PORT}`);
    });
  });
});

let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[MCServerManager] Received ${signal}, stopping running Minecraft servers cleanly...`);
  scheduleService.dispose();
  serverManager.dispose();
  await serverManager.stopAllServers(false);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 12000);
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
