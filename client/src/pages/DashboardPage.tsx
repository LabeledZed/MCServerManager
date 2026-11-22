import { useEffect, useState } from 'react';
import {
  Coffee,
  Copy,
  Cpu,
  FolderInput,
  HardDrive,
  Play,
  Plus,
  Server,
  Square,
  Terminal,
  Users,
} from 'lucide-react';
import { api, formatDuration, type HostStats } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import type { JavaRuntimeInfo, ServerRuntimeState, ServerSummary } from '../../../shared/types';

interface DashboardPageProps {
  servers: ServerSummary[];
  onSelectServer: (id: string, tab?: string) => void;
  onOpenCreate: () => void;
  onOpenImport: () => void;
  onOpenJavaPage: () => void;
  onRuntimeUpdate?: (serverId: string, runtime: ServerRuntimeState) => void;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

export function DashboardPage({
  servers,
  onSelectServer,
  onOpenCreate,
  onOpenImport,
  onOpenJavaPage,
  onRuntimeUpdate,
  onNotify,
}: DashboardPageProps) {
  const [host, setHost] = useState<HostStats | null>(null);
  const [javas, setJavas] = useState<JavaRuntimeInfo[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api.getHostStats().then(setHost).catch(() => {});
    api.listJavaRuntimes().then((r) => setJavas(r.runtimes)).catch(() => {});
  }, []);

  const onlineCount = servers.filter((s) => s.runtime.status === 'online').length;
  const totalPlayers = servers.reduce((acc, s) => acc + (s.runtime.playersOnline || 0), 0);
  const hasJava21 = javas.some((j) => j.major >= 21);

  const handleQuickPower = async (srv: ServerSummary, action: 'start' | 'stop') => {
    setBusyId(srv.id);
    try {
      const res = await api.powerServer(srv.id, action);
      if (res.runtime) onRuntimeUpdate?.(srv.id, res.runtime);
      onNotify('info', `${action === 'start' ? 'Starting' : 'Stopping'} ${srv.name}...`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Power action failed');
    } finally {
      setBusyId(null);
    }
  };

  const copyAddress = (port: number) => {
    const addr = port === 25565 ? 'localhost' : `localhost:${port}`;
    navigator.clipboard?.writeText(addr).then(
      () => onNotify('success', `Copied ${addr}`),
      () => onNotify('info', `Connect address: ${addr}`),
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Host & Fleet Summary */}
      <div className="grid-4">
        <div className="stat-tile">
          <span className="stat-label">Servers Running</span>
          <span className="stat-value">
            {onlineCount} / {servers.length}
          </span>
          <span className="stat-sub">Local Minecraft instances</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Players Online</span>
          <span className="stat-value">{totalPlayers}</span>
          <span className="stat-sub">Across all active worlds</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Host Memory</span>
          <span className="stat-value">
            {host ? `${(host.usedMemMb / 1024).toFixed(1)} / ${(host.totalMemMb / 1024).toFixed(0)} GB` : '—'}
          </span>
          <span className="stat-sub">{host ? `${(host.freeMemMb / 1024).toFixed(1)} GB free` : 'Loading...'}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Java Runtimes</span>
          <span className="stat-value">{javas.length}</span>
          <span className="stat-sub">
            {javas.length > 0 ? javas.map((j) => `Java ${j.major}`).slice(0, 3).join(', ') : 'None detected'}
          </span>
        </div>
      </div>

      {/* Java 21 Advisory Banner */}
      {javas.length > 0 && !hasJava21 && (
        <div className="banner banner-warn">
          <Coffee size={20} style={{ flexShrink: 0, color: 'var(--status-warn)' }} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>Minecraft 1.20.5+ requires Java 21</strong>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '0.15rem' }}>
              Detected {javas.map((j) => `Java ${j.major}`).join(', ')}. Install Java 21 in Java Runtimes.
            </div>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={onOpenJavaPage}>
            Install Java 21
          </button>
        </div>
      )}

      {/* Server List Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '1.35rem' }}>Your Minecraft Servers</h2>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={onOpenImport}>
            <FolderInput size={17} aria-hidden="true" />
            Import Server
          </button>
          <button type="button" className="btn btn-primary" onClick={onOpenCreate}>
            <Plus size={17} aria-hidden="true" />
            Create Server
          </button>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="empty-state">
          <Server size={44} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
          <h3 style={{ fontSize: '1.3rem' }}>No Minecraft servers yet</h3>
          <p style={{ margin: 0, maxWidth: '460px', color: 'var(--text-secondary)' }}>
            Create a new server or import an existing server folder.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <button type="button" className="btn btn-primary btn-lg" onClick={onOpenCreate}>
              <Plus size={18} aria-hidden="true" />
              Create Server
            </button>
            <button type="button" className="btn btn-lg" onClick={onOpenImport}>
              <FolderInput size={18} aria-hidden="true" />
              Import Existing Server
            </button>
          </div>
        </div>
      ) : (
        <div className="grid-2">
          {servers.map((srv) => {
            const rt = srv.runtime;
            const running = rt.status === 'online' || rt.status === 'starting' || rt.status === 'stopping';
            const addr = srv.port === 25565 ? 'localhost' : `localhost:${srv.port}`;

            return (
              <article key={srv.id} className="server-card">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <div>
                    <button
                      type="button"
                      onClick={() => onSelectServer(srv.id, 'overview')}
                      style={{
                        background: 'none',
                        border: 0,
                        padding: 0,
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-display)',
                        fontWeight: 700,
                        fontSize: '1.3rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {srv.name}
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                      <span className="badge badge-accent">{srv.software.toUpperCase()}</span>
                      {srv.software === 'velocity' && <span className="badge badge-neutral">PROXY</span>}
                      <span className="badge badge-neutral mono">{srv.mcVersion}</span>
                      <button
                        type="button"
                        className="chip-btn"
                        title="Copy connect address"
                        onClick={() => copyAddress(srv.port)}
                      >
                        {addr} <Copy size={11} style={{ marginInlineStart: '3px', verticalAlign: '-1px' }} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <StatusBadge status={rt.status} />
                </div>

                {rt.installProgress && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.82rem',
                        color: rt.installProgress.stage === 'error' ? 'var(--status-danger)' : 'var(--accent-bright)',
                      }}
                    >
                      <span>{rt.installProgress.message}</span>
                      <span className="mono">{rt.installProgress.percent}%</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${rt.installProgress.percent}%` }} />
                    </div>
                    {rt.installProgress.recentLines && rt.installProgress.recentLines.length > 0 && (
                      <div
                        className="mono"
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--text-muted)',
                          background: 'var(--bg-canvas)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.35rem 0.55rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          maxHeight: '68px',
                          overflowY: 'auto',
                        }}
                      >
                        {rt.installProgress.recentLines.slice(-3).join('\n')}
                      </div>
                    )}
                  </div>
                )}

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '0.5rem',
                    padding: '0.6rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface-subtle)',
                    fontSize: '0.84rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Users size={14} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
                    <span className="mono">
                      {rt.playersOnline}/{rt.maxPlayers}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Cpu size={14} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
                    <span className="mono">{rt.cpuPercent.toFixed(1)}%</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <HardDrive size={14} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
                    <span className="mono">
                      {rt.memoryMb} / {srv.maxRamMb} MB
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '0.45rem' }}>
                    {!running ? (
                      <button
                        type="button"
                        className="btn btn-success btn-sm"
                        disabled={busyId === srv.id || rt.status === 'installing'}
                        onClick={() => void handleQuickPower(srv, 'start')}
                      >
                        <Play size={14} aria-hidden="true" />
                        Start
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busyId === srv.id}
                        onClick={() => void handleQuickPower(srv, 'stop')}
                      >
                        <Square size={14} aria-hidden="true" />
                        Stop
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onSelectServer(srv.id, 'console')}
                    >
                      <Terminal size={14} aria-hidden="true" />
                      Console
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    {running && (
                      <span className="field-hint mono">Up {formatDuration(rt.uptimeSeconds)}</span>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onSelectServer(srv.id, 'overview')}
                    >
                      Manage
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
