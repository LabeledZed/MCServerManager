import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { store, type StoredUser } from './store.js';
import type { Permission, UserAccount } from '../../../shared/types.js';

export const SESSION_COOKIE = 'mcservermanager_session';

declare global {
  namespace Express {
    interface Request {
      user?: UserAccount | null;
    }
  }
}

export function createSessionToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, iat: Date.now(), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }),
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', store.state.sessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string): StoredUser | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto
    .createHmac('sha256', store.state.sessionSecret)
    .update(payload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      uid: string;
      exp: number;
    };
    if (Date.now() > parsed.exp) return null;
    return store.state.users.find((u) => u.id === parsed.uid) || null;
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    map[k] = decodeURIComponent(v);
  }
  return map;
}

export function resolveRequestUser(cookieHeader?: string): UserAccount | null {
  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    const found = verifySessionToken(token);
    if (found) return store.toPublicUser(found);
  }

  // When auth is disabled (Local Quick Access), sign in transparently as the default owner
  if (!store.state.settings.requireAuth) {
    const owner = store.state.users.find((u) => u.role === 'owner') || store.state.users[0];
    return owner ? store.toPublicUser(owner) : null;
  }

  return null;
}

export function attachAuth(req: Request, _res: Response, next: NextFunction): void {
  req.user = resolveRequestUser(req.headers.cookie);
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (req.user.role === 'owner' || req.user.permissions.includes(permission)) {
      next();
      return;
    }
    res.status(403).json({ error: `Missing permission: ${permission}` });
  };
}
