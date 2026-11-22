import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, Pencil, Play, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { Switch } from '../components/Switch';
import { ModalDialog } from '../components/ModalDialog';
import type {
  IntervalUnit,
  ScheduleAction,
  ScheduledTask,
  ScheduleTrigger,
  ScheduleTriggerType,
  ServerSummary,
} from '../../../shared/types';

interface SchedulesPageProps {
  server: ServerSummary;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

const WEEKDAYS = [
  { id: 0, short: 'Sun' },
  { id: 1, short: 'Mon' },
  { id: 2, short: 'Tue' },
  { id: 3, short: 'Wed' },
  { id: 4, short: 'Thu' },
  { id: 5, short: 'Fri' },
  { id: 6, short: 'Sat' },
];

const ACTION_LABELS: Record<ScheduleAction, string> = {
  backup: 'Full Backup',
  backup_worlds: 'Worlds Backup',
  command: 'Run Command',
  restart: 'Restart Server',
  start: 'Start Server',
  stop: 'Stop Server',
};

function defaultDateTimeLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function describeTrigger(trigger?: ScheduleTrigger): string {
  if (!trigger) return '—';
  if (trigger.type === 'once') {
    if (!trigger.runAt) return 'One time';
    const d = new Date(trigger.runAt);
    return Number.isNaN(d.getTime()) ? `Once at ${trigger.runAt}` : `Once on ${d.toLocaleString()}`;
  }
  if (trigger.type === 'interval') {
    const val = trigger.everyValue || 1;
    const unit = trigger.everyUnit === 'minutes' ? (val === 1 ? 'minute' : 'minutes') : val === 1 ? 'hour' : 'hours';
    return `Every ${val} ${unit}`;
  }
  if (trigger.type === 'daily') {
    return `Every day at ${trigger.timeOfDay || '04:00'}`;
  }
  if (trigger.type === 'weekly') {
    const names = (trigger.daysOfWeek || [])
      .sort((a, b) => a - b)
      .map((d) => WEEKDAYS.find((w) => w.id === d)?.short)
      .filter(Boolean)
      .join(', ');
    return `${names || 'Weekly'} at ${trigger.timeOfDay || '04:00'}`;
  }
  if (trigger.type === 'on_start') {
    return 'Whenever server starts';
  }
  return 'Custom';
}

export function SchedulesPage({ server, onNotify }: SchedulesPageProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('Auto Backup Every 2 Hours');
  const [triggerType, setTriggerType] = useState<ScheduleTriggerType>('interval');
  const [runAt, setRunAt] = useState(defaultDateTimeLocal());
  const [everyValue, setEveryValue] = useState(2);
  const [everyUnit, setEveryUnit] = useState<IntervalUnit>('hours');
  const [timeOfDay, setTimeOfDay] = useState('04:00');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([0]);
  const [action, setAction] = useState<ScheduleAction>('backup');
  const [payload, setPayload] = useState('Scheduled Backup');
  const [onlyWhenRunning, setOnlyWhenRunning] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listSchedules(server.id);
      setTasks(res.tasks);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to load scheduled tasks');
    } finally {
      setLoading(false);
    }
  }, [server.id, onNotify]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreateModal = () => {
    setEditingTaskId(null);
    setName('Auto Backup Every 2 Hours');
    setTriggerType('interval');
    setRunAt(defaultDateTimeLocal());
    setEveryValue(2);
    setEveryUnit('hours');
    setTimeOfDay('04:00');
    setDaysOfWeek([0]);
    setAction('backup');
    setPayload('Scheduled Backup');
    setOnlyWhenRunning(true);
    setModalOpen(true);
  };

  const openEditModal = (t: ScheduledTask) => {
    setEditingTaskId(t.id);
    setName(t.name);
    setTriggerType(t.trigger.type);
    setRunAt(t.trigger.runAt || defaultDateTimeLocal());
    setEveryValue(t.trigger.everyValue || 2);
    setEveryUnit(t.trigger.everyUnit || 'hours');
    setTimeOfDay(t.trigger.timeOfDay || '04:00');
    setDaysOfWeek(t.trigger.daysOfWeek?.length ? t.trigger.daysOfWeek : [0]);
    setAction(t.action);
    setPayload(t.payload || '');
    setOnlyWhenRunning(t.onlyWhenRunning);
    setModalOpen(true);
  };

  const buildTrigger = (): ScheduleTrigger => {
    if (triggerType === 'once') return { type: 'once', runAt };
    if (triggerType === 'interval') return { type: 'interval', everyValue, everyUnit };
    if (triggerType === 'daily') return { type: 'daily', timeOfDay };
    if (triggerType === 'weekly') return { type: 'weekly', timeOfDay, daysOfWeek };
    return { type: 'on_start' };
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trigger = buildTrigger();
    try {
      if (editingTaskId) {
        await api.updateSchedule(server.id, editingTaskId, {
          name,
          trigger,
          action,
          payload,
          onlyWhenRunning,
        });
        onNotify('success', `Updated task "${name}"`);
      } else {
        await api.createSchedule(server.id, {
          name,
          trigger,
          action,
          payload,
          onlyWhenRunning,
          enabled: true,
        });
        onNotify('success', `Scheduled task "${name}" created`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Could not save task');
    }
  };

  const handleRunNow = async (task: ScheduledTask) => {
    try {
      const res = await api.runSchedule(server.id, task.id);
      onNotify(res.skipped ? 'warn' : res.ok ? 'success' : 'error', res.message);
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Execution failed');
    }
  };

  const toggleWeekday = (dayId: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(dayId)
        ? prev.length > 1
          ? prev.filter((d) => d !== dayId)
          : prev
        : [...prev, dayId].sort((a, b) => a - b),
    );
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card-header" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="card-title">
            <CalendarClock size={18} aria-hidden="true" />
            Task Scheduler ({tasks.length})
          </h2>
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
            Schedule backups, commands, restarts, and power actions.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.45rem' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreateModal}>
            <Plus size={15} aria-hidden="true" />
            New Task
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div tabIndex={0} role="region" aria-labelledby="sched-cap" className="table-wrapper">
        <table className="data-table responsive-stack">
          <caption id="sched-cap">Scheduled tasks for {server.name}</caption>
          <thead>
            <tr>
              <th>Task</th>
              <th>Schedule</th>
              <th>Action</th>
              <th>Next / Last Run</th>
              <th>Active</th>
              <th>Controls</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                  No scheduled tasks configured yet. Click &ldquo;New Task&rdquo; to automate backups, restarts, or
                  commands.
                </td>
              </tr>
            ) : (
              tasks.map((t) => (
                <tr key={t.id}>
                  <td data-label="Task">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                      <strong>{t.name}</strong>
                      {t.onlyWhenRunning && (
                        <span className="badge badge-neutral" title="Automatically skipped when server is offline">
                          <ShieldCheck size={12} aria-hidden="true" />
                          Online only
                        </span>
                      )}
                    </div>
                    {t.payload && <div className="mono field-hint">{t.payload}</div>}
                  </td>
                  <td data-label="Schedule" style={{ fontSize: '0.88rem', color: 'var(--accent-bright)' }}>
                    {describeTrigger(t.trigger)}
                  </td>
                  <td data-label="Action">
                    <span className="badge badge-accent">{ACTION_LABELS[t.action] || t.action}</span>
                  </td>
                  <td data-label="Runs" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    <div>
                      Next:{' '}
                      {t.trigger?.type === 'on_start'
                        ? 'On next startup'
                        : t.enabled && t.nextRunAt
                          ? new Date(t.nextRunAt).toLocaleString()
                          : 'Paused'}
                    </div>
                    {t.lastRunAt && (
                      <div
                        style={{
                          color:
                            t.lastResult === 'error'
                              ? 'var(--status-danger)'
                              : t.lastResult === 'skipped'
                                ? 'var(--status-warn)'
                                : 'var(--text-muted)',
                        }}
                      >
                        Last: {new Date(t.lastRunAt).toLocaleTimeString()} — {t.lastMessage}
                      </div>
                    )}
                  </td>
                  <td data-label="Active">
                    <Switch
                      checked={t.enabled}
                      onChange={(enabled) =>
                        api.updateSchedule(server.id, t.id, { enabled }).then(() => void load())
                      }
                    />
                  </td>
                  <td data-label="Controls">
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button type="button" className="btn btn-sm" onClick={() => void handleRunNow(t)}>
                        <Play size={13} aria-hidden="true" />
                        Run
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Edit ${t.name}`}
                        onClick={() => openEditModal(t)}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Delete ${t.name}`}
                        onClick={() =>
                          api.deleteSchedule(server.id, t.id).then(() => {
                            onNotify('info', `Deleted task "${t.name}"`);
                            void load();
                          })
                        }
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ModalDialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingTaskId ? 'Edit Scheduled Task' : 'Create Scheduled Task'}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="sched-save-form" className="btn btn-primary">
              {editingTaskId ? 'Save Changes' : 'Create Task'}
            </button>
          </>
        }
      >
        <form id="sched-save-form" onSubmit={(e) => void handleSave(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.95rem' }}>
          <div className="field">
            <label htmlFor="sch-name">Task Name</label>
            <input
              id="sch-name"
              type="text"
              className="input"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <fieldset className="field-group" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <legend>When should this task run?</legend>

            <div className="field">
              <label htmlFor="sch-freq">Frequency</label>
              <select
                id="sch-freq"
                className="select"
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as ScheduleTriggerType)}
              >
                <option value="interval">Repeating Interval (Every X Minutes / Hours)</option>
                <option value="daily">Every Day (Daily at specific time)</option>
                <option value="weekly">Specific Days of the Week (Weekly)</option>
                <option value="once">One Time (Specific Date &amp; Time)</option>
                <option value="on_start">When Server Finishes Starting</option>
              </select>
            </div>

            {triggerType === 'once' && (
              <div className="field">
                <label htmlFor="sch-runat">Date &amp; Time</label>
                <input
                  id="sch-runat"
                  type="datetime-local"
                  className="input mono"
                  required
                  value={runAt}
                  onChange={(e) => setRunAt(e.target.value)}
                />
                <span className="field-hint">Runs once at this local date and time, then automatically disables.</span>
              </div>
            )}

            {triggerType === 'interval' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div className="grid-2">
                  <div className="field">
                    <label htmlFor="sch-every-val">Repeat Every</label>
                    <input
                      id="sch-every-val"
                      type="number"
                      min={1}
                      max={10080}
                      className="input mono"
                      required
                      value={everyValue}
                      onChange={(e) => setEveryValue(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="sch-every-unit">Unit</label>
                    <select
                      id="sch-every-unit"
                      className="select"
                      value={everyUnit}
                      onChange={(e) => setEveryUnit(e.target.value as IntervalUnit)}
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {[
                    { label: 'Every 30 min', v: 30, u: 'minutes' as IntervalUnit },
                    { label: 'Every 1 hour', v: 1, u: 'hours' as IntervalUnit },
                    { label: 'Every 2 hours', v: 2, u: 'hours' as IntervalUnit },
                    { label: 'Every 6 hours', v: 6, u: 'hours' as IntervalUnit },
                    { label: 'Every 12 hours', v: 12, u: 'hours' as IntervalUnit },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className="chip-btn"
                      onClick={() => {
                        setEveryValue(p.v);
                        setEveryUnit(p.u);
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(triggerType === 'daily' || triggerType === 'weekly') && (
              <div className="field">
                <label htmlFor="sch-tod">Time of Day</label>
                <input
                  id="sch-tod"
                  type="time"
                  className="input mono"
                  required
                  value={timeOfDay}
                  onChange={(e) => setTimeOfDay(e.target.value)}
                />
              </div>
            )}

            {triggerType === 'weekly' && (
              <div className="field">
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '0.92rem' }}>
                  Days of Week
                </span>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {WEEKDAYS.map((d) => {
                    const active = daysOfWeek.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        aria-pressed={active}
                        className={`btn btn-sm ${active ? 'btn-primary' : ''}`}
                        onClick={() => toggleWeekday(d.id)}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </fieldset>

          <div className="field">
            <label htmlFor="sch-action">Action</label>
            <select
              id="sch-action"
              className="select"
              value={action}
              onChange={(e) => {
                const next = e.target.value as ScheduleAction;
                setAction(next);
                if (next === 'command') {
                  setPayload('say Auto-saving world...');
                  setOnlyWhenRunning(true);
                } else if (next === 'backup' || next === 'backup_worlds') {
                  setPayload('Scheduled Backup');
                  setOnlyWhenRunning(true);
                } else if (next === 'start') {
                  setPayload('');
                  setOnlyWhenRunning(false);
                } else {
                  setPayload('');
                  setOnlyWhenRunning(true);
                }
              }}
            >
              <option value="backup">Create Full Backup</option>
              <option value="backup_worlds">Create Worlds-Only Backup</option>
              <option value="command">Run Console Command</option>
              <option value="restart">Restart Server</option>
              <option value="start">Start Server</option>
              <option value="stop">Stop Server</option>
            </select>
          </div>

          {(action === 'command' || action === 'backup' || action === 'backup_worlds') && (
            <div className="field">
              <label htmlFor="sch-payload">{action === 'command' ? 'Console Command' : 'Backup Label'}</label>
              <input
                id="sch-payload"
                type="text"
                className="input mono"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder={action === 'command' ? 'save-all' : 'Scheduled Backup'}
              />
            </div>
          )}

          {action !== 'start' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              <Switch
                checked={onlyWhenRunning}
                onChange={setOnlyWhenRunning}
                label="Only run while server is running"
              />
              <span className="field-hint">
                Skips this task if the server is offline.
              </span>
            </div>
          )}
        </form>
      </ModalDialog>
    </div>
  );
}
