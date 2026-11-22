import { useEffect, useState } from 'react';
import {
  Archive,
  Coffee,
  Copy,
  FolderOpen,
  Network,
  Play,
  Puzzle,
  RotateCw,
  Sliders,
  Smartphone,
  Square,
  Terminal,
  Zap,
} from 'lucide-react';
import { api, formatBytes, formatDuration } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { Sparkline } from '../components/Sparkline';
import type { JavaRuntimeInfo, ServerRuntimeState, ServerSummary } from '../../../shared/types';

interface ServerOverviewPageProps {
  server: ServerSummary;
  onNavigateTab: (tab: string) => void;
  onOpenJavaPage: () => void;
  onRuntimeUpdate?: (serverId: string, runtime: ServerRuntimeState) => void;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

export function ServerOverviewPage({
  server,
  onNavigateTab,
  onOpenJavaPage,
  onRuntimeUpdate,
  onNotify,
}: ServerOverviewPageProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [detailDiskBytes, setDetailDiskBytes] = useState<number | undefined>(server.diskSizeBytes);
  const [recommendedJava, setRecommendedJava] = useState<number | null>(null);
  const [runtimes, setRuntimes] = useState<JavaRuntimeInfo[]>([]);

  useEffect(() => {
    api.getServer(server.id).then((s) => setDetailDiskBytes(s.diskSizeBytes)).catch(() => {});
    if (server.software === 'velocity') {
      setRecommendedJava(17);
    } else {
      api.recommendJava(server.mcVersion).then((r) => setRecommendedJava(r.major)).catch(() => {});
    }
    api.listJavaRuntimes().then((r) => setRuntimes(r.runtimes)).catch(() => {});
  }, [server.id, server.mcVersion, server.software]);

  const rt = server.runtime;
  const isVelocity = server.software === 'velocity';
  const isRunning = rt.status === 'online' || rt.status === 'starting' || rt.status === 'stopping';
  const connectAddr = server.port === 25565 ? 'localhost' : `localhost:${server.port}`;

  const missingRecommendedJava =
    recommendedJava !== null &&
    runtimes.length > 0 &&
    !runtimes.some((r) => (recommendedJava >= 17 ? r.major >= recommendedJava : r.major === recommendedJava));

  const runPower = async (action: 'start' | 'stop' | 'restart' | 'kill') => {
    setBusyAction(action);
    try {
      const res = await api.powerServer(server.id, action);
      if (res.runtime) onRuntimeUpdate?.(server.id, res.runtime);
      onNotify('info', `Command "${action}" sent to ${server.name}`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : `Failed to ${action} server`);
    } finally {
      setBusyAction(null);
    }
  };

  const copyAddress = () => {
    navigator.clipboard?.writeText(connectAddr).then(
      () => onNotify('success', `Copied ${connectAddr} to clipboard`),
      () => onNotify('info', `Connect address: ${connectAddr}`),
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* Aternos-style Hero Control Panel */}
      <section className="server-hero" aria-label="Server control header">
        <div className="server-hero-top">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h2 className="server-hero-title">{server.name}</h2>
              <StatusBadge status={rt.status} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
              <button type="button" className="server-address-bar" onClick={copyAddress} title="Click to copy address">
                <span>{connectAddr}</span>
                <Copy size={14} aria-hidden="true" />
              </button>
              <span className="badge badge-accent">{server.software.toUpperCase()}</span>
              {isVelocity && <span className="badge badge-neutral">PROXY</span>}
              <span className="badge badge-neutral mono">
                {isVelocity ? `v${server.mcVersion}` : `MC ${server.mcVersion}`}
              </span>
              {server.build && <span className="badge badge-neutral mono">Build #{server.build}</span>}
              {server.autoStart && <span className="badge badge-neutral">AUTO-START</span>}
            </div>
          </div>

          <div className="power-controls">
            {!isRunning ? (
              <button
                type="button"
                className="btn btn-success btn-lg"
                disabled={busyAction !== null || rt.status === 'installing'}
                onClick={() => void runPower('start')}
              >
                <Play size={18} aria-hidden="true" />
                {isVelocity ? 'Start Proxy' : 'Start Server'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-lg"
                  disabled={busyAction !== null}
                  onClick={() => void runPower('restart')}
                >
                  <RotateCw size={18} aria-hidden="true" />
                  Restart
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-lg"
                  disabled={busyAction !== null}
                  onClick={() => void runPower('stop')}
                >
                  <Square size={18} aria-hidden="true" />
                  Stop
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busyAction !== null}
                  title="Force kill process immediately"
                  onClick={() => void runPower('kill')}
                >
                  <Zap size={14} aria-hidden="true" />
                  Kill
                </button>
              </>
            )}
          </div>
        </div>

        {rt.installProgress && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', fontSize: '0.88rem', color: rt.installProgress.stage === 'error' ? 'var(--status-danger)' : 'var(--accent-bright)' }}>
              <span>{rt.installProgress.message}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="mono">{rt.installProgress.percent}%</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigateTab('console')}>
                  <Terminal size={13} aria-hidden="true" />
                  Live Console
                </button>
              </div>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${rt.installProgress.percent}%` }} />
            </div>
            {rt.installProgress.recentLines && rt.installProgress.recentLines.length > 0 && (
              <pre
                className="mono"
                style={{
                  margin: 0,
                  padding: '0.55rem 0.75rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-canvas)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.76rem',
                  lineHeight: 1.45,
                  color: 'var(--text-secondary)',
                  maxHeight: '130px',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {rt.installProgress.recentLines.slice(-6).join('\n')}
              </pre>
            )}
          </div>
        )}
      </section>

      {/* Smart Java Version Compatibility Warning */}
      {missingRecommendedJava && recommendedJava && (
        <div className="banner banner-warn">
          <Coffee size={20} style={{ color: 'var(--status-warn)', flexShrink: 0 }} aria-hidden="true" />
          <div style={{ flex: 1 }}>
            <strong>
              Java {recommendedJava} recommended for {isVelocity ? `Velocity ${server.mcVersion}` : `Minecraft ${server.mcVersion}`}
            </strong>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '0.15rem' }}>
              Detected {runtimes.map((r) => `Java ${r.major}`).join(', ')}. Install Java {recommendedJava} in Java Runtimes.
            </div>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={onOpenJavaPage}>
            Open Java Manager
          </button>
        </div>
      )}

      {/* Real-time Telemetry Tiles */}
      <div className="grid-4">
        <div className="stat-tile">
          <span className="stat-label">CPU Usage</span>
          <span className="stat-value">{rt.cpuPercent.toFixed(1)}%</span>
          <Sparkline
            values={rt.history.map((h) => h.cpuPercent)}
            max={100}
            label="CPU usage trend"
          />
        </div>

        <div className="stat-tile">
          <span className="stat-label">Memory (RAM)</span>
          <span className="stat-value">
            {rt.memoryMb} <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>/ {server.maxRamMb} MB</span>
          </span>
          <Sparkline
            values={rt.history.map((h) => h.memoryMb)}
            max={server.maxRamMb}
            label="Memory usage trend"
          />
        </div>

        <div className="stat-tile">
          <span className="stat-label">{isVelocity ? 'Network Players' : 'Players & TPS'}</span>
          <span className="stat-value">
            {rt.playersOnline} / {rt.maxPlayers}
          </span>
          <span className="stat-sub">
            {isVelocity
              ? isRunning
                ? 'Velocity proxy routing active'
                : 'Proxy offline'
              : rt.tps !== null
                ? `TPS: ${rt.tps.toFixed(1)}`
                : isRunning
                  ? 'Run /tps in console for TPS'
                  : 'Server offline'}
          </span>
          {rt.onlinePlayerNames.length > 0 && (
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
              {rt.onlinePlayerNames.slice(0, 6).map((p) => (
                <span key={p} className="badge badge-accent">
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="stat-tile">
          <span className="stat-label">Uptime &amp; Storage</span>
          <span className="stat-value">{isRunning ? formatDuration(rt.uptimeSeconds) : 'Offline'}</span>
          <span className="stat-sub">
            Disk: {detailDiskBytes !== undefined ? formatBytes(detailDiskBytes) : '—'}
          </span>
          <span className="stat-sub mono" style={{ fontSize: '0.76rem' }}>
            {server.jarFile}
          </span>
        </div>
      </div>

      {/* Quick Navigation Cards (Aternos-inspired workflow shortcuts) */}
      <div className="grid-3">
        {isVelocity ? (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <h3 className="card-title">
              <Network size={18} aria-hidden="true" />
              Proxy &amp; Backend Network
            </h3>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
              Link managed MCServerManager servers or external servers, configure forwarding secrets, and route players.
            </p>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '0.35rem' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigateTab('velocity')}>
                Open Proxy &amp; Network
              </button>
              <button type="button" className="btn btn-sm" onClick={() => onNavigateTab('configs')}>
                <Sliders size={14} aria-hidden="true" />
                velocity.toml
              </button>
            </div>
          </div>
        ) : (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            <h3 className="card-title">
              <Sliders size={18} aria-hidden="true" />
              Options &amp; Configs
            </h3>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
              Edit server.properties and server configuration files.
            </p>
            <div style={{ marginTop: 'auto', paddingTop: '0.35rem' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigateTab('configs')}>
                Open Configs
              </button>
            </div>
          </div>
        )}

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          <h3 className="card-title">
            <Puzzle size={18} aria-hidden="true" />
            {isVelocity ? 'Velocity Plugins & Bedrock' : 'Plugins, Mods & Bedrock'}
          </h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            {isVelocity
              ? 'Install Velocity plugins from Modrinth or enable Geyser + Floodgate for Bedrock players.'
              : 'Install plugins or mods, edit configs, or enable Geyser/Floodgate Bedrock cross-play.'}
          </p>
          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '0.35rem' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigateTab('plugins')}>
              {isVelocity ? 'Velocity Plugins' : 'Plugins & Mods'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onNavigateTab('geyser')}>
              <Smartphone size={14} aria-hidden="true" />
              Bedrock (Geyser)
            </button>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          <h3 className="card-title">
            <Terminal size={18} aria-hidden="true" />
            Console, Files &amp; Backups
          </h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            View live logs, browse files, and manage backups.
          </p>
          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '0.35rem' }}>
            <button type="button" className="btn btn-sm" onClick={() => onNavigateTab('console')}>
              <Terminal size={14} aria-hidden="true" />
              Console
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onNavigateTab('files')}>
              <FolderOpen size={14} aria-hidden="true" />
              Files
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onNavigateTab('backups')}>
              <Archive size={14} aria-hidden="true" />
              Backups
            </button>
          </div>
        </div>
      </div>

      {/* Server Metadata Card */}
      <div className="card">
        <div className="card-header" style={{ marginBottom: '0.5rem' }}>
          <h3 className="card-title">Instance Details</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigateTab('settings')}>
            {isVelocity ? 'Proxy Settings' : 'Edit Settings'}
          </button>
        </div>
        <div className="grid-3" style={{ fontSize: '0.88rem' }}>
          <div>
            <div className="stat-label">Directory</div>
            <div className="mono" style={{ wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
              {server.directory}
            </div>
          </div>
          <div>
            <div className="stat-label">JVM Memory &amp; Preset</div>
            <div className="mono" style={{ color: 'var(--text-secondary)' }}>
              {server.minRamMb}M – {server.maxRamMb}M ({server.jvmPreset.toUpperCase()})
            </div>
          </div>
          <div>
            <div className="stat-label">Crash Recovery</div>
            <div style={{ color: 'var(--text-secondary)' }}>
              {server.autoRestart
                ? `Auto-restart enabled (max ${server.maxRestartAttempts} retries)`
                : 'Auto-restart disabled'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
