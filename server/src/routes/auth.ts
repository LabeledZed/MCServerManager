import { Router } from 'express';
import crypto from 'node:crypto';
import { hashPassword, ROLE_PERMISSIONS, store, verifyPassword } from '../services/store.js';
import {
  createSessionToken,
  requireAuth,
  requirePermission,
  SESSION_COOKIE,
} from '../services/authService.js';
import type { Permission, UserRole } from '../../../shared/types.js';

export const authRouter = Router();

authRouter.get('/session', (req, res) => {
  res.json({
    authenticated: Boolean(req.user),
    requireAuth: store.state.settings.requireAuth,
    user: req.user || null,
  });
});

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }
  const user = store.state.users.find(
    (u) => u.username.toLowerCase() === username.trim().toLowerCase(),
  );
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }
  const token = createSessionToken(user.id);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  res.json({
    authenticated: true,
    requireAuth: store.state.settings.requireAuth,
    user: store.toPublicUser(user),
  });
});

authRouter.post('/logout', (_req, res) => {
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
  if (typeof reqAuth === 'boolean') {
    store.state.settings.requireAuth = reqAuth;
    // Automatically issue a session cookie for the current owner when enabling auth so they aren't locked out
    if (reqAuth && req.user) {
      const token = createSessionToken(req.user.id);
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
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
});

authRouter.get('/users', requirePermission('users'), (_req, res) => {
  res.json(store.state.users.map((u) => store.toPublicUser(u)));
});

authRouter.post('/users', requirePermission('users'), (req, res) => {
  const { username, password, role, permissions } = req.body as {
    username?: string;
    password?: string;
    role?: UserRole;
    permissions?: Permission[];
  };
  const cleanUser = (username || '').trim();
  if (cleanUser.length < 2 || !password || password.length < 4) {
    res.status(400).json({ error: 'Username (min 2 chars) and password (min 4 chars) are required' });
    return;
  }
  if (store.state.users.some((u) => u.username.toLowerCase() === cleanUser.toLowerCase())) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }
  const safeRole: UserRole = role && role in ROLE_PERMISSIONS && role !== 'owner' ? role : 'operator';
  const user = {
    id: crypto.randomUUID(),
    username: cleanUser,
    role: safeRole,
    permissions: Array.isArray(permissions) && permissions.length > 0 ? permissions : [...ROLE_PERMISSIONS[safeRole]],
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  store.state.users.push(user);
  store.save();
  res.status(201).json(store.toPublicUser(user));
});

authRouter.patch('/users/:userId', requirePermission('users'), (req, res) => {
  const target = store.state.users.find((u) => u.id === req.params.userId);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
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

  if (typeof password === 'string' && password.length > 0) {
    if (password.length < 4) {
      res.status(400).json({ error: 'Password must be at least 4 characters' });
      return;
    }
    target.passwordHash = hashPassword(password);
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
