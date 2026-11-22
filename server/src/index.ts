import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { CLIENT_DIST_DIR, ensureAppDirs, PORT } from './config.js';
import { attachAuth, resolveRequestUser } from './services/authService.js';
import { serverManager } from './services/serverManager.js';
import { scheduleService } from './services/scheduleService.js';
import { authRouter } from './routes/auth.js';
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

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(attachAuth);

// WebSocket hub
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

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
  const user = resolveRequestUser(req.headers.cookie);
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

// Loopback guard for local tray/console control endpoints
function isLoopbackAddress(addr?: string): boolean {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

// API routes
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'MCServerManager', version: '1.0.0' });
});

app.get('/api/system/running-servers', (req, res) => {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'Localhost access only' });
    return;
  }
  const running = serverManager.getRunningServers();
  res.json({ count: running.length, servers: running });
});

app.post('/api/system/shutdown', async (req, res) => {
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: 'Localhost access only' });
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  MCServerManager running at http://localhost:${PORT}\n`);
  void serverManager.startAutoStartServers();
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
