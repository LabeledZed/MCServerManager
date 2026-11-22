import fs from 'node:fs';
import crypto from 'node:crypto';
import { STORE_FILE, ensureAppDirs } from '../config.js';
import type {
  PanelSettings,
  Permission,
  ScheduledTask,
  ServerConfig,
  UserAccount,
  UserRole,
} from '../../../shared/types.js';

export interface StoredUser extends UserAccount {
  passwordHash: string;
}

export interface AppStoreData {
  sessionSecret: string;
  settings: PanelSettings;
  users: StoredUser[];
  servers: ServerConfig[];
  schedules: ScheduledTask[];
}

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: ['console', 'power', 'configs', 'plugins', 'files', 'players', 'backups', 'schedules', 'settings', 'users'],
  admin: ['console', 'power', 'configs', 'plugins', 'files', 'players', 'backups', 'schedules', 'settings', 'users'],
  operator: ['console', 'power', 'configs', 'plugins', 'files', 'players', 'backups', 'schedules'],
  viewer: ['console'],
};

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

class StoreService {
  private data: AppStoreData;

  constructor() {
    ensureAppDirs();
    this.data = this.load();
  }

  private createDefaultData(): AppStoreData {
    return {
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      settings: {
        requireAuth: false, // Local Aternos-style quick access out of the box; toggleable in Access Control
        defaultBackupRetention: 10,
        hostPort: 3001,
      },
      users: [
        {
          id: 'owner-default',
          username: 'admin',
          role: 'owner',
          permissions: [...ROLE_PERMISSIONS.owner],
          passwordHash: hashPassword('admin'),
          createdAt: new Date().toISOString(),
        },
      ],
      servers: [],
      schedules: [],
    };
  }

  private load(): AppStoreData {
    if (!fs.existsSync(STORE_FILE)) {
      const defaults = this.createDefaultData();
      this.writeSync(defaults);
      return defaults;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) as Partial<AppStoreData>;
      const defaults = this.createDefaultData();
      return {
        sessionSecret: parsed.sessionSecret || defaults.sessionSecret,
        settings: { ...defaults.settings, ...(parsed.settings || {}) },
        users: Array.isArray(parsed.users) && parsed.users.length > 0 ? parsed.users : defaults.users,
        servers: Array.isArray(parsed.servers) ? parsed.servers : [],
        schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
      };
    } catch {
      const defaults = this.createDefaultData();
      this.writeSync(defaults);
      return defaults;
    }
  }

  private writeSync(data: AppStoreData): void {
    ensureAppDirs();
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    try {
      fs.renameSync(tmp, STORE_FILE);
    } catch {
      fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf8');
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }

  save(): void {
    this.writeSync(this.data);
  }

  get state(): AppStoreData {
    return this.data;
  }

  getServers(): ServerConfig[] {
    return this.data.servers;
  }

  getServer(id: string): ServerConfig | undefined {
    return this.data.servers.find((s) => s.id === id);
  }

  upsertServer(server: ServerConfig): ServerConfig {
    const idx = this.data.servers.findIndex((s) => s.id === server.id);
    if (idx >= 0) {
      this.data.servers[idx] = server;
    } else {
      this.data.servers.push(server);
    }
    this.save();
    return server;
  }

  deleteServer(id: string): boolean {
    const before = this.data.servers.length;
    this.data.servers = this.data.servers.filter((s) => s.id !== id);
    this.data.schedules = this.data.schedules.filter((t) => t.serverId !== id);
    if (this.data.servers.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  getSchedules(serverId?: string): ScheduledTask[] {
    return serverId
      ? this.data.schedules.filter((s) => s.serverId === serverId)
      : this.data.schedules;
  }

  upsertSchedule(task: ScheduledTask): ScheduledTask {
    const idx = this.data.schedules.findIndex((s) => s.id === task.id);
    if (idx >= 0) {
      this.data.schedules[idx] = task;
    } else {
      this.data.schedules.push(task);
    }
    this.save();
    return task;
  }

  deleteSchedule(id: string): boolean {
    const before = this.data.schedules.length;
    this.data.schedules = this.data.schedules.filter((s) => s.id !== id);
    if (this.data.schedules.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  toPublicUser(u: StoredUser): UserAccount {
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      permissions: u.permissions,
      createdAt: u.createdAt,
    };
  }
}

export const store = new StoreService();
