import { Router, type Request } from 'express';
import crypto from 'node:crypto';
import {
  hashPasswordAsync,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  ROLE_PERMISSIONS,
  store,
  verifyPasswordAsync,
} from '../services/store.js';
import {
  createSessionToken,
  parseCookieHeader,
  requireAuth,
  requirePermission,
  revokeSessionToken,
  SESSION_COOKIE,
} from '../services/authService.js';
import type { Permission, UserRole } from '../../../shared/types.js';

export const authRouter = Router();

let requireAuthChangeListener: ((requireAuth: boolean) => void) | null = null;
export function onRequireAuthSettingChanged(listener: (requireAuth: boolean) => void): void {
  requireAuthChangeListener = listener;
}

// Per-IP login brute-force rate limiter (10 failed attempts per 5 minutes)
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = loginFailures.get(ip);
  if (!entry || now >= entry.resetAt) {
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= LOGIN_MAX_FAILURES) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = loginFailures.get(ip);
  if (!entry || now >= entry.resetAt) {
    loginFailures.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

function clearLoginFailures(ip: string): void {
  loginFailures.delete(ip);
}

function isRequestSecure(req: Request): boolean {
  return Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
}

authRouter.get('/session', (req, res) => {
  res.json({
    authenticated: Boolean(req.user),
    requireAuth: store.state.settings.requireAuth,
    user: req.user || null,
  });
});

authRouter.post('/login', async (req, res) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  const rate = checkLoginRateLimit(clientIp);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    res.status(429).json({
      error: `Too many failed login attempts. Try again in ${rate.retryAfterSec}s.`,
    });
    return;
  }

  const { username, password } = req.body as { username?: string; password?: string };
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    recordLoginFailure(clientIp);
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }
  const user = store.state.users.find(
    (u) => u.username.toLowerCase() === username.trim().toLowerCase(),
  );
  if (!user || !(await verifyPasswordAsync(password, user.passwordHash))) {
    recordLoginFailure(clientIp);
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }
  clearLoginFailures(clientIp);
  const token = createSessionToken(user.id);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isRequestSecure(req),
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  res.json({
    authenticated: true,
    requireAuth: store.state.settings.requireAuth,
    user: store.toPublicUser(user),
  });
});

authRouter.post('/logout', (req, res) => {
  const cookies = parseCookieHeader(req.headers.cookie);
  revokeSessionToken(cookies[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/settings', requireAuth, (_req, res) => {
  res.json(store.state.settings);
});

authRouter.patch('/settings', requirePermission('users'), (req, res) => {
  const { requireAuth: reqAuth, defaultBackupRetention } = req.body as {
    requireAuth?: boolean;
    defaultBackupRetention?: number;
  };
  let authChanged = false;
  if (typeof reqAuth === 'boolean') {
    if (!reqAuth && req.user?.role !== 'owner') {
      res.status(403).json({ error: 'Only the owner account can disable authentication' });
      return;
    }
    authChanged = store.state.settings.requireAuth !== reqAuth;
    store.state.settings.requireAuth = reqAuth;
    // Automatically issue a session cookie for the current user when enabling auth so they aren't locked out
    if (reqAuth && req.user) {
      const token = createSessionToken(req.user.id);
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isRequestSecure(req),
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });
    }
  }
  if (typeof defaultBackupRetention === 'number' && defaultBackupRetention >= 1 && defaultBackupRetention <= 100) {
    store.state.settings.defaultBackupRetention = Math.round(defaultBackupRetention);
  }
  store.save();
  res.json(store.state.settings);
  if (authChanged && requireAuthChangeListener) {
    res.once('finish', () => {
      requireAuthChangeListener?.(store.state.settings.requireAuth);
    });
  }
});

authRouter.get('/users', requirePermission('users'), (_req, res) => {
  res.json(store.state.users.map((u) => store.toPublicUser(u)));
});

authRouter.post('/users', requirePermission('users'), async (req, res) => {
  const { username, password, role, permissions } = req.body as {
    username?: string;
    password?: string;
    role?: UserRole;
    permissions?: Permission[];
  };
  const cleanUser = (typeof username === 'string' ? username : '').trim();
  if (
    cleanUser.length < 2 ||
    typeof password !== 'string' ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    res.status(400).json({
      error: `Username (min 2 chars) and password (${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} chars) are required`,
    });
    return;
  }
  if (store.state.users.some((u) => u.username.toLowerCase() === cleanUser.toLowerCase())) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }
  const safeRole: UserRole = role && role in ROLE_PERMISSIONS && role !== 'owner' ? role : 'operator';
  const validPerms = new Set<Permission>(ROLE_PERMISSIONS.owner);
  const filteredPerms = Array.isArray(permissions)
    ? permissions.filter((p): p is Permission => validPerms.has(p))
    : [];
  const user = {
    id: crypto.randomUUID(),
    username: cleanUser,
    role: safeRole,
    permissions: filteredPerms.length > 0 ? filteredPerms : [...ROLE_PERMISSIONS[safeRole]],
    passwordHash: await hashPasswordAsync(password),
    createdAt: new Date().toISOString(),
  };
  store.state.users.push(user);
  store.save();
  res.status(201).json(store.toPublicUser(user));
});

authRouter.patch('/users/:userId', requirePermission('users'), async (req, res) => {
  const target = store.state.users.find((u) => u.id === req.params.userId);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (target.role === 'owner' && req.user?.role !== 'owner') {
    res.status(403).json({ error: 'Only the owner account can modify the owner user' });
    return;
  }

  const { username, password, role, permissions } = req.body as {
    username?: string;
    password?: string;
    role?: UserRole;
    permissions?: Permission[];
  };

  if (typeof username === 'string') {
    const cleanUser = username.trim();
    if (cleanUser.length < 2) {
      res.status(400).json({ error: 'Username must be at least 2 characters' });
      return;
    }
    if (
      store.state.users.some(
        (u) => u.id !== target.id && u.username.toLowerCase() === cleanUser.toLowerCase(),
      )
    ) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }
    target.username = cleanUser;
  }

  let passwordChanged = false;
  if (typeof password === 'string' && password.length > 0) {
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      res.status(400).json({
        error: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
      });
      return;
    }
    target.passwordHash = await hashPasswordAsync(password);
    passwordChanged = true;
  }

  if (target.role !== 'owner') {
    if (role && role in ROLE_PERMISSIONS && role !== 'owner') {
      target.role = role;
    }
    if (Array.isArray(permissions)) {
      const valid = new Set<Permission>(ROLE_PERMISSIONS.owner);
      target.permissions = permissions.filter((p): p is Permission => valid.has(p));
    }
  }

  store.save();

  // If the current logged-in user changed their own password, issue a fresh session cookie so they stay logged in
  // while all other sessions for that account are automatically invalidated
  if (passwordChanged && req.user?.id === target.id && store.state.settings.requireAuth) {
    const token = createSessionToken(target.id);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isRequestSecure(req),
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  res.json(store.toPublicUser(target));
});

authRouter.delete('/users/:userId', requirePermission('users'), (req, res) => {
  const target = store.state.users.find((u) => u.id === req.params.userId);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (target.role === 'owner') {
    res.status(400).json({ error: 'Cannot delete the owner account' });
    return;
  }
  store.state.users = store.state.users.filter((u) => u.id !== target.id);
  store.save();
  res.json({ ok: true });
});
