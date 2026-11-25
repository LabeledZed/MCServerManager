import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { store, type StoredUser } from './store.js';
import type { Permission, UserAccount } from '../../../shared/types.js';

export const SESSION_COOKIE = 'mcservermanager_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const revokedTokenSigs = new Map<string, number>();

declare global {
  namespace Express {
    interface Request {
      user?: UserAccount | null;
    }
  }
}

export function isLoopbackAddress(addr?: string): boolean {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function computePasswordFingerprint(passwordHash: string): string {
  return crypto
    .createHmac('sha256', store.state.sessionSecret)
    .update(`pwh:${passwordHash}`)
    .digest('base64url')
    .slice(0, 16);
}

function pruneRevokedTokens(): void {
  const now = Date.now();
  for (const [sig, exp] of revokedTokenSigs.entries()) {
    if (exp <= now) revokedTokenSigs.delete(sig);
  }
}

export function revokeSessionToken(token?: string): void {
  if (!token) return;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return;
  pruneRevokedTokens();
  revokedTokenSigs.set(sig, Date.now() + SESSION_TTL_MS);
}

export function createSessionToken(userId: string): string {
  const user = store.state.users.find((u) => u.id === userId);
  const pwh = user ? computePasswordFingerprint(user.passwordHash) : '';
  const payload = Buffer.from(
    JSON.stringify({
      uid: userId,
      pwh,
      iat: Date.now(),
      exp: Date.now() + SESSION_TTL_MS,
      jti: crypto.randomBytes(8).toString('base64url'),
    }),
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
  if (revokedTokenSigs.has(sig)) return null;
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
      pwh?: string;
      exp: number;
    };
    if (Date.now() > parsed.exp) return null;
    const user = store.state.users.find((u) => u.id === parsed.uid);
    if (!user) return null;
    const expectedPwh = computePasswordFingerprint(user.passwordHash);
    if (!parsed.pwh || parsed.pwh !== expectedPwh) {
      return null;
    }
    return user;
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
    try {
      map[k] = decodeURIComponent(v);
    } catch {
      map[k] = v;
    }
  }
  return map;
}

export function resolveRequestUser(cookieHeader?: string, remoteAddress?: string): UserAccount | null {
  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies[SESSION_COOKIE];
  if (token) {
    const found = verifySessionToken(token);
    if (found) return store.toPublicUser(found);
  }

  // When auth is disabled (Local Quick Access), sign in transparently as the default owner ONLY on loopback
  if (!store.state.settings.requireAuth && (!remoteAddress || isLoopbackAddress(remoteAddress))) {
    const owner = store.state.users.find((u) => u.role === 'owner') || store.state.users[0];
    return owner ? store.toPublicUser(owner) : null;
  }

  return null;
}

export function attachAuth(req: Request, _res: Response, next: NextFunction): void {
  req.user = resolveRequestUser(req.headers.cookie, req.socket.remoteAddress);
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
