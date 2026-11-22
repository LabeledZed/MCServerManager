import { store } from './store.js';
import { serverManager } from './serverManager.js';
import { createBackup } from './backupService.js';
import type { ScheduledTask, ScheduleTrigger, ServerRuntimeState } from '../../../shared/types.js';

function parseLocalDateTime(value?: string): Date | null {
  if (!value) return null;
  // Supports "YYYY-MM-DDTHH:MM" or full ISO string
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const dt = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] || 0),
      0,
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseTimeOfDay(value?: string): { hours: number; minutes: number } | null {
  if (!value) return null;
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Computes the next scheduled Date in local wall-clock time strictly after `after`.
 */
export function computeNextRun(trigger: ScheduleTrigger, after: Date = new Date()): Date | null {
  if (!trigger) return null;

  if (trigger.type === 'on_start') {
    return null; // Event-driven
  }

  if (trigger.type === 'once') {
    const dt = parseLocalDateTime(trigger.runAt);
    if (!dt) return null;
    return dt.getTime() > after.getTime() ? dt : null;
  }

  if (trigger.type === 'interval') {
    const val = Math.max(1, Math.round(Number(trigger.everyValue) || 1));
    const ms = trigger.everyUnit === 'minutes' ? val * 60_000 : val * 3_600_000;
    return new Date(after.getTime() + ms);
  }

  if (trigger.type === 'daily') {
    const tod = parseTimeOfDay(trigger.timeOfDay) || { hours: 4, minutes: 0 };
    const candidate = new Date(
      after.getFullYear(),
      after.getMonth(),
      after.getDate(),
      tod.hours,
      tod.minutes,
      0,
      0,
    );
    if (candidate.getTime() <= after.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  if (trigger.type === 'weekly') {
    const tod = parseTimeOfDay(trigger.timeOfDay) || { hours: 4, minutes: 0 };
    const days = Array.isArray(trigger.daysOfWeek) && trigger.daysOfWeek.length > 0
      ? trigger.daysOfWeek.filter((d) => d >= 0 && d <= 6)
      : [0];
    if (days.length === 0) return null;

    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(
        after.getFullYear(),
        after.getMonth(),
        after.getDate() + offset,
        tod.hours,
        tod.minutes,
        0,
        0,
      );
      if (days.includes(candidate.getDay()) && candidate.getTime() > after.getTime()) {
        return candidate;
      }
    }
  }

  return null;
}

export function validateTrigger(trigger: ScheduleTrigger): string | null {
  if (!trigger || !trigger.type) return 'Schedule trigger type is required';
  if (trigger.type === 'once') {
    const dt = parseLocalDateTime(trigger.runAt);
    if (!dt) return 'Please specify a valid date and time for the one-time schedule.';
    return null;
  }
  if (trigger.type === 'interval') {
    const val = Number(trigger.everyValue);
    if (!Number.isFinite(val) || val < 1 || val > 10080) {
      return 'Interval value must be at least 1.';
    }
    if (trigger.everyUnit !== 'minutes' && trigger.everyUnit !== 'hours') {
      return 'Interval unit must be minutes or hours.';
    }
    return null;
  }
  if (trigger.type === 'daily') {
    if (!parseTimeOfDay(trigger.timeOfDay)) return 'Please specify a valid time of day (HH:MM).';
    return null;
  }
  if (trigger.type === 'weekly') {
    if (!parseTimeOfDay(trigger.timeOfDay)) return 'Please specify a valid time of day (HH:MM).';
    if (!Array.isArray(trigger.daysOfWeek) || trigger.daysOfWeek.length === 0) {
      return 'Select at least one day of the week.';
    }
    return null;
  }
  if (trigger.type === 'on_start') return null;
  return 'Unsupported schedule trigger type.';
}

/**
 * Automatically migrates any legacy cron-based tasks saved prior to the native task scheduler.
 */
function migrateLegacyTask(task: ScheduledTask): boolean {
  let changed = false;
  if (!task.trigger) {
    const cron = (task.cron || '').trim();
    const parts = cron.split(/\s+/);
    let trigger: ScheduleTrigger = { type: 'daily', timeOfDay: '04:00' };
    if (parts.length === 5) {
      const [min, hr, , , dow] = parts;
      if (min.startsWith('*/')) {
        trigger = { type: 'interval', everyValue: Math.max(1, Number(min.slice(2)) || 30), everyUnit: 'minutes' };
      } else if (hr.startsWith('*/')) {
        trigger = { type: 'interval', everyValue: Math.max(1, Number(hr.slice(2)) || 6), everyUnit: 'hours' };
      } else if (/^\d+$/.test(min) && /^\d+$/.test(hr)) {
        const tod = `${String(Number(hr)).padStart(2, '0')}:${String(Number(min)).padStart(2, '0')}`;
        if (/^[0-6](,[0-6])*$/.test(dow)) {
          trigger = { type: 'weekly', timeOfDay: tod, daysOfWeek: dow.split(',').map(Number) };
        } else {
          trigger = { type: 'daily', timeOfDay: tod };
        }
      }
    }
    task.trigger = trigger;
    delete task.cron;
    changed = true;
  }
  if (typeof task.onlyWhenRunning !== 'boolean') {
    task.onlyWhenRunning = task.action !== 'start';
    changed = true;
  }
  return changed;
}

class ScheduleService {
  private tickTimer: NodeJS.Timeout | null = null;
  private runningTaskIds = new Set<string>();
  private lastKnownStatuses = new Map<string, string>();
  private stateListener: ((serverId: string, rt: ServerRuntimeState) => void) | null = null;

  init(): void {
    let migratedAny = false;
    const now = new Date();
    for (const task of store.getSchedules()) {
      if (migrateLegacyTask(task)) migratedAny = true;
      if (task.enabled && !task.nextRunAt && task.trigger.type !== 'on_start') {
        const next = computeNextRun(task.trigger, now);
        task.nextRunAt = next ? next.toISOString() : undefined;
        migratedAny = true;
      }
    }
    if (migratedAny) store.save();

    // Check due tasks every 10 seconds (native cross-platform Windows/POSIX scheduler)
    this.tickTimer = setInterval(() => {
      void this.tick();
    }, 10_000);

    // Trigger 'on_start' tasks whenever a server transitions into 'online'
    this.stateListener = (serverId: string, rt: ServerRuntimeState) => {
      const prev = this.lastKnownStatuses.get(serverId);
      this.lastKnownStatuses.set(serverId, rt.status);
      if (prev !== 'online' && rt.status === 'online') {
        const onStartTasks = store
          .getSchedules(serverId)
          .filter((t) => t.enabled && t.trigger?.type === 'on_start');
        for (const t of onStartTasks) {
          void this.executeTask(t.id, false);
        }
      }
    };
    serverManager.on('state', this.stateListener);
  }

  refreshNextRun(task: ScheduledTask, base: Date = new Date()): void {
    if (!task.enabled || task.trigger.type === 'on_start') {
      task.nextRunAt = undefined;
      return;
    }
    const next = computeNextRun(task.trigger, base);
    task.nextRunAt = next ? next.toISOString() : undefined;
  }

  listWithNextRun(serverId: string): ScheduledTask[] {
    const now = new Date();
    return store.getSchedules(serverId).map((t) => {
      migrateLegacyTask(t);
      if (t.enabled && t.trigger.type !== 'on_start' && !t.nextRunAt) {
        const next = computeNextRun(t.trigger, now);
        t.nextRunAt = next ? next.toISOString() : undefined;
      }
      return { ...t };
    });
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const nowMs = now.getTime();
    const due = store.getSchedules().filter((t) => {
      if (!t.enabled || t.trigger?.type === 'on_start') return false;
      if (this.runningTaskIds.has(t.id)) return false;
      if (!t.nextRunAt) {
        const next = computeNextRun(t.trigger, now);
        t.nextRunAt = next ? next.toISOString() : undefined;
        store.save();
        return false;
      }
      const dueMs = new Date(t.nextRunAt).getTime();
      return !Number.isNaN(dueMs) && dueMs <= nowMs;
    });

    for (const task of due) {
      await this.executeTask(task.id, false);
    }
  }

  async executeTask(
    taskId: string,
    manual = false,
  ): Promise<{ ok: boolean; skipped?: boolean; message: string }> {
    const task = store.getSchedules().find((t) => t.id === taskId);
    if (!task) return { ok: false, message: 'Task not found' };
    if (this.runningTaskIds.has(task.id)) {
      return { ok: false, message: 'Task is already running' };
    }

    this.runningTaskIds.add(task.id);
    const now = new Date();
    let result: 'ok' | 'skipped' | 'error' = 'ok';
    let message = 'Executed successfully';

    try {
      const running = serverManager.isRunning(task.serverId);

      // Guard: Do not back up / run commands / restart if server isn't running (when onlyWhenRunning is set)
      if (!manual && task.onlyWhenRunning && !running) {
        result = 'skipped';
        message = 'Skipped — server is not running';
      } else if (task.action === 'command') {
        if (!task.payload?.trim()) throw new Error('Command payload is empty');
        if (!running) {
          result = 'skipped';
          message = 'Skipped — server is offline';
        } else {
          serverManager.sendCommand(task.serverId, task.payload);
          message = `Sent command: ${task.payload}`;
        }
      } else if (task.action === 'backup' || task.action === 'backup_worlds') {
        if (task.onlyWhenRunning && !running) {
          result = 'skipped';
          message = 'Skipped backup — server is not running';
        } else {
          const scope = task.action === 'backup_worlds' ? 'worlds' : 'full';
          const b = await createBackup(task.serverId, task.payload || task.name, scope);
          message = `Created ${scope} backup ${b.fileName}`;
        }
      } else if (task.action === 'restart') {
        if (!running && task.onlyWhenRunning) {
          result = 'skipped';
          message = 'Skipped restart — server is offline';
        } else {
          await serverManager.restartServer(task.serverId);
          message = 'Server restarted';
        }
      } else if (task.action === 'start') {
        if (!running) {
          await serverManager.startServer(task.serverId);
          message = 'Server started';
        } else {
          result = 'skipped';
          message = 'Server is already running';
        }
      } else if (task.action === 'stop') {
        if (running) {
          await serverManager.stopServer(task.serverId, false);
          message = 'Server stop initiated';
        } else {
          result = 'skipped';
          message = 'Server is already offline';
        }
      }
    } catch (err) {
      result = 'error';
      message = err instanceof Error ? err.message : String(err);
    } finally {
      this.runningTaskIds.delete(task.id);
    }

    task.lastRunAt = now.toISOString();
    task.lastResult = result;
    task.lastMessage = message;

    // Advance next run (or disable one-time tasks after execution)
    if (!manual) {
      if (task.trigger.type === 'once') {
        task.enabled = false;
        task.nextRunAt = undefined;
      } else {
        this.refreshNextRun(task, new Date());
      }
    }

    store.upsertSchedule(task);
    return { ok: result !== 'error', skipped: result === 'skipped', message };
  }

  dispose(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.stateListener) {
      serverManager.off('state', this.stateListener);
      this.stateListener = null;
    }
  }
}

export const scheduleService = new ScheduleService();
