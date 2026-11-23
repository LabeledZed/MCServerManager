import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  CloudLightning,
  CloudRain,
  Download,
  Gamepad2,
  Heart,
  Home,
  Megaphone,
  Plug,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sun,
  Trash2,
  UserMinus,
  Zap,
} from 'lucide-react';
import { api } from '../api/client';
import { Switch } from '../components/Switch';
import { getGameruleDescription } from '../data/gamerules';
import type { BridgeGamerule, BridgeStatusResponse, ServerSummary } from '../../../shared/types';

interface GameControlPageProps {
  server: ServerSummary;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

const TIME_PRESETS = [
  { label: 'Dawn (0)', ticks: 0 },
  { label: 'Day (1000)', ticks: 1000 },
  { label: 'Noon (6000)', ticks: 6000 },
  { label: 'Sunset (12000)', ticks: 12000 },
  { label: 'Night (13000)', ticks: 13000 },
  { label: 'Midnight (18000)', ticks: 18000 },
];

function humanizeRule(name: string): string {
  return name
    .replace(/^minecraft:/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function GameControlPage({ server, onNotify }: GameControlPageProps) {
  const [status, setStatus] = useState<BridgeStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);

  const [selectedWorld, setSelectedWorld] = useState<string>('');
  const [gamerules, setGamerules] = useState<BridgeGamerule[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleFilter, setRuleFilter] = useState<'all' | 'boolean' | 'integer'>('all');
  const [intDrafts, setIntDrafts] = useState<Record<string, string>>({});
  const [borderDraft, setBorderDraft] = useState<string>('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const pollInFlightRef = useRef(false);
  const borderInitWorldRef = useRef<string>('');

  const loadStatus = useCallback(
    async (silent = false) => {
      if (silent && pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      if (!silent) setLoading(true);
      try {
        const s = await api.getBridgeStatus(server.id);
        setStatus(s);
        if (s.connected && s.worlds.length > 0) {
          setSelectedWorld((prev) => (prev && s.worlds.some((w) => w.name === prev) ? prev : s.worlds[0].name));
        }
      } catch (err) {
        if (!silent) {
          onNotify('error', err instanceof Error ? err.message : 'Failed to query bridge status');
        }
      } finally {
        pollInFlightRef.current = false;
        if (!silent) setLoading(false);
      }
    },
    [server.id, onNotify],
  );

  useEffect(() => {
    borderInitWorldRef.current = '';
    void loadStatus(false);
  }, [loadStatus, server.runtime.status]);

  // Real-time refresh of live players (coordinates, HP, ping, gamemode), TPS, heap, and world counts
  useEffect(() => {
    if (server.runtime.status !== 'online' && server.runtime.status !== 'starting') return;
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void loadStatus(true);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadStatus, server.runtime.status]);

  // Immediately refresh live players when player count changes over WebSocket
  useEffect(() => {
    if (status?.connected) {
      void loadStatus(true);
    }
  }, [server.runtime.playersOnline, loadStatus, status?.connected]);

  const loadGamerules = useCallback(
    async (worldName: string) => {
      if (!worldName) return;
      setLoadingRules(true);
      try {
        const res = await api.getGamerules(server.id, worldName);
        const sorted = [...res.gamerules].sort((a, b) => a.name.localeCompare(b.name));
        setGamerules(sorted);
        const drafts: Record<string, string> = {};
        for (const r of sorted) {
          if (r.type !== 'boolean') drafts[r.name] = r.value;
        }
        setIntDrafts(drafts);
      } catch (err) {
        onNotify('error', err instanceof Error ? err.message : 'Failed to load gamerules');
      } finally {
        setLoadingRules(false);
      }
    },
    [server.id, onNotify],
  );

  useEffect(() => {
    if (status?.connected && selectedWorld) {
      void loadGamerules(selectedWorld);
    }
  }, [status?.connected, selectedWorld, loadGamerules]);

  useEffect(() => {
    if (status?.connected && selectedWorld && borderInitWorldRef.current !== selectedWorld) {
      const w = status.worlds.find((x) => x.name === selectedWorld);
      if (w) {
        setBorderDraft(String(Math.round(w.borderSize)));
        borderInitWorldRef.current = selectedWorld;
      }
    }
  }, [status?.connected, status?.worlds, selectedWorld]);

  const activeWorld = useMemo(
    () => status?.worlds.find((w) => w.name === selectedWorld) || null,
    [status?.worlds, selectedWorld],
  );

  const visibleRules = useMemo(() => {
    const q = ruleSearch.trim().toLowerCase();
    return gamerules.filter((r) => {
      if (ruleFilter !== 'all' && r.type !== ruleFilter) return false;
      if (!q) return true;
      const desc = (getGameruleDescription(r.name) || '').toLowerCase();
      return r.name.toLowerCase().includes(q) || humanizeRule(r.name).toLowerCase().includes(q) || desc.includes(q);
    });
  }, [gamerules, ruleSearch, ruleFilter]);

  const isModBridge = ['fabric', 'forge', 'neoforge'].includes(server.software);
  const bridgeKindLabel = isModBridge ? 'Mod' : 'Plugin';
  const bridgeDirLabel = isModBridge ? '/mods/' : '/plugins/';
  const bridgeJarLabel = useMemo(() => {
    const m = (server.mcVersion || '').trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
    const maj = m ? parseInt(m[1], 10) : 0;
    const min = m ? parseInt(m[2], 10) : 0;
    const pat = m && m[3] ? parseInt(m[3], 10) : 0;
    if (server.software === 'fabric') return 'MCServerManagerBridge-Fabric.jar';
    if (server.software === 'neoforge') {
      return maj === 1 && min === 20 && pat === 1
        ? 'MCServerManagerBridge-Forge.jar'
        : 'MCServerManagerBridge-NeoForge.jar';
    }
    if (server.software === 'forge') {
      if (maj === 1 && min >= 3 && min <= 6) return 'MCServerManagerBridge-Forge-1.4-1.6.jar';
      if (maj === 1 && min === 7) return 'MCServerManagerBridge-Forge-1.7.jar';
      if (maj === 1 && min >= 8 && min <= 12) return 'MCServerManagerBridge-Forge-1.8-1.12.jar';
      return 'MCServerManagerBridge-Forge.jar';
    }
    if (server.software === 'velocity') return 'MCServerManagerBridge-Velocity.jar';
    return 'MCServerManagerBridge.jar';
  }, [server.software, server.mcVersion]);

  const handleInstallBridge = async () => {
    setInstalling(true);
    try {
      await api.installBridge(server.id);
      onNotify(
        'success',
        `Installed ${bridgeJarLabel} into ${bridgeDirLabel}. Restart (or start) the server to activate live controls.`,
      );
      await loadStatus();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : `Failed to install bridge ${bridgeKindLabel.toLowerCase()}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstallBridge = async () => {
    try {
      await api.uninstallBridge(server.id);
      onNotify('info', `Removed ${bridgeJarLabel}. Takes effect after server restart.`);
      await loadStatus();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : `Failed to remove bridge ${bridgeKindLabel.toLowerCase()}`);
    }
  };

  const handleUpdateRule = async (rule: BridgeGamerule, nextValue: string | boolean) => {
    if (!selectedWorld) return;
    try {
      await api.setGamerule(server.id, selectedWorld, rule.name, nextValue);
      setGamerules((prev) =>
        prev.map((r) => (r.name === rule.name ? { ...r, value: String(nextValue) } : r)),
      );
      setIntDrafts((prev) => ({ ...prev, [rule.name]: String(nextValue) }));
      onNotify('success', `Set ${rule.name} = ${nextValue} in ${selectedWorld}`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to update gamerule');
    }
  };

  const handleEnvPatch = async (
    patch: Parameters<typeof api.updateWorldEnvironment>[2],
    successMsg: string,
  ) => {
    if (!selectedWorld) return;
    try {
      await api.updateWorldEnvironment(server.id, selectedWorld, patch);
      onNotify('success', successMsg);
      await loadStatus();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to update world environment');
    }
  };

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMsg.trim()) return;
    try {
      await api.bridgeBroadcast(server.id, broadcastMsg.trim());
      onNotify('success', 'Broadcast sent to all online players');
      setBroadcastMsg('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Broadcast failed');
    }
  };

  if (loading && !status) {
    return <div className="card">Checking companion bridge {bridgeKindLabel.toLowerCase()} status...</div>;
  }

  if (status && !status.supported) {
    return (
      <div className="card">
        <div className="empty-state" style={{ border: 0 }}>
          <Plug size={38} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          <h3>Companion Bridge Unavailable on {server.software.toUpperCase()}</h3>
          <p style={{ margin: 0, maxWidth: '520px', color: 'var(--text-secondary)' }}>
            Vanilla servers cannot load plugins or mods. Companion bridge builds are available for Paper, Purpur, Leaf,
            Folia, Spigot, Fabric, NeoForge, Forge, and Velocity.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {/* Bridge Status Header Card */}
      <section className="card card-accent">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <h2 className="card-title">
                <Gamepad2 size={20} aria-hidden="true" />
                Live Game Controls (Companion Bridge {bridgeKindLabel})
              </h2>
              {status?.connected ? (
                <span className="badge badge-online">
                  <CheckCircle2 size={13} aria-hidden="true" />
                  Bridge Connected
                </span>
              ) : status?.installed ? (
                <span className="badge badge-warn">Installed — Waiting for Server</span>
              ) : (
                <span className="badge badge-offline">Not Installed</span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              {status?.connected
                ? `127.0.0.1:${status.bridgePort} • ${status.bukkitVersion || server.software} • ${status.pluginCount ?? 0} ${isModBridge ? 'mods' : 'plugins'}`
                : 'Manage live gamerules, world environment, broadcasts, and online players.'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {!status?.installed ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={installing}
                onClick={() => void handleInstallBridge()}
              >
                <Download size={15} aria-hidden="true" />
                {installing ? 'Installing...' : `Install Bridge ${bridgeKindLabel}`}
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-sm" onClick={() => void loadStatus()}>
                  <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
                  Refresh
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  title={`Uninstall ${bridgeJarLabel}`}
                  onClick={() => void handleUninstallBridge()}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Uninstall
                </button>
              </>
            )}
          </div>
        </div>

        {status?.connected && (
          <div className="grid-4" style={{ marginTop: '1rem' }}>
            <div className="stat-tile">
              <span className="stat-label">Live TPS (1m / 5m / 15m)</span>
              <span className="stat-value">
                {status.tps ? status.tps.map((v) => v.toFixed(1)).join(' / ') : '20.0'}
              </span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">JVM Heap</span>
              <span className="stat-value">
                {status.heapUsedMb ?? 0} / {status.heapMaxMb ?? 0} MB
              </span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Loaded Worlds</span>
              <span className="stat-value">{status.worlds.length}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Online Players</span>
              <span className="stat-value">{status.players.length}</span>
            </div>
          </div>
        )}
      </section>

      {!status?.connected ? (
        <div className="empty-state">
          <Zap size={40} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
          <h3>{status?.installed ? 'Start your server to use Live Game Controls' : `Install the Companion Bridge ${bridgeKindLabel}`}</h3>
          <p style={{ margin: 0, maxWidth: '520px', color: 'var(--text-secondary)' }}>
            {status?.installed
              ? 'Start the server to edit gamerules, world settings, and online players live.'
              : `Install ${bridgeJarLabel} into ${bridgeDirLabel} to enable live server controls.`}
          </p>
        </div>
      ) : (
        <>
          {/* Broadcast & Live Player Actions */}
          <div className="grid-2">
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h3 className="card-title">
                <Megaphone size={17} aria-hidden="true" />
                Server Broadcast
              </h3>
              <form onSubmit={(e) => void handleBroadcast(e)} style={{ display: 'flex', gap: '0.5rem' }}>
                <label htmlFor="bridge-bcast" className="visually-hidden">
                  Broadcast message
                </label>
                <input
                  id="bridge-bcast"
                  type="text"
                  className="input"
                  placeholder="&b[Server] &fRestarting in 5 minutes!"
                  value={broadcastMsg}
                  onChange={(e) => setBroadcastMsg(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={!broadcastMsg.trim()}>
                  Send
                </button>
              </form>
              <span className="field-hint">Supports Minecraft &amp; color codes (e.g. &amp;b, &amp;a, &amp;l).</span>
            </section>

            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h3 className="card-title">Live Player Controls ({status.players.length})</h3>
              {status.players.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                  No players online.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  {status.players.map((p) => (
                    <div
                      key={p.uuid}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.6rem',
                        flexWrap: 'wrap',
                        padding: '0.65rem 0.8rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-surface-subtle)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div>
                        <strong>{p.name}</strong>{' '}
                        <span className="field-hint mono">
                          {p.world} ({p.x}, {p.y}, {p.z}) • HP {Math.round(p.health)}/{Math.round(p.maxHealth)}
                          {p.ping >= 0 ? ` • ${p.ping}ms` : ''}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                          aria-label={`Gamemode for ${p.name}`}
                          className="select"
                          style={{ width: 'auto', minHeight: '32px', padding: '0.2rem 0.5rem', fontSize: '0.82rem' }}
                          value={p.gamemode}
                          onChange={(e) =>
                            void api
                              .bridgePlayerAction(server.id, p.name, { action: 'gamemode', value: e.target.value })
                              .then(() => {
                                onNotify('success', `Set ${p.name} to ${e.target.value}`);
                                void loadStatus();
                              })
                          }
                        >
                          <option value="SURVIVAL">Survival</option>
                          <option value="CREATIVE">Creative</option>
                          <option value="ADVENTURE">Adventure</option>
                          <option value="SPECTATOR">Spectator</option>
                        </select>
                        <button
                          type="button"
                          className="btn btn-sm"
                          title="Heal & feed player"
                          onClick={() =>
                            void api.bridgePlayerAction(server.id, p.name, { action: 'heal' }).then(() => {
                              onNotify('success', `Healed ${p.name}`);
                              void loadStatus();
                            })
                          }
                        >
                          <Heart size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          title="Teleport to world spawn"
                          onClick={() =>
                            void api.bridgePlayerAction(server.id, p.name, { action: 'spawn' }).then(() => {
                              onNotify('info', `Teleported ${p.name} to spawn`);
                              void loadStatus();
                            })
                          }
                        >
                          <Home size={13} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          title="Kick player"
                          onClick={() =>
                            void api
                              .bridgePlayerAction(server.id, p.name, { action: 'kick', value: 'Kicked via MCServerManager' })
                              .then(() => {
                                onNotify('warn', `Kicked ${p.name}`);
                                void loadStatus();
                              })
                          }
                        >
                          <UserMinus size={13} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* World Selector & Environment Controls */}
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="card-header" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <h3 className="card-title">World Environment</h3>
                <select
                  aria-label="Select world"
                  className="select mono"
                  style={{ width: 'auto', minWidth: '210px', minHeight: '36px', padding: '0.3rem 0.65rem' }}
                  value={selectedWorld}
                  onChange={(e) => setSelectedWorld(e.target.value)}
                >
                  {status.worlds.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.name} ({w.environment})
                    </option>
                  ))}
                </select>
              </div>
              {activeWorld && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="badge badge-neutral mono">Chunks: {activeWorld.loadedChunks}</span>
                  <span className="badge badge-neutral mono">Entities: {activeWorld.entityCount}</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => void handleEnvPatch({ save: true }, `Saved world "${activeWorld.name}"`)}
                  >
                    <Save size={14} aria-hidden="true" />
                    Save World
                  </button>
                </div>
              )}
            </div>

            {activeWorld && (
              <div className="grid-2">
                <div className="field">
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                    Time of Day (Current: <span className="mono">{activeWorld.time}</span>)
                  </span>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {TIME_PRESETS.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        className="chip-btn"
                        onClick={() => void handleEnvPatch({ time: t.ticks }, `Set time to ${t.label} in ${activeWorld.name}`)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>Weather</span>
                  <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${activeWorld.weather === 'clear' ? 'btn-primary' : ''}`}
                      onClick={() => void handleEnvPatch({ weather: 'clear' }, 'Weather set to Clear')}
                    >
                      <Sun size={14} aria-hidden="true" />
                      Clear
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${activeWorld.weather === 'rain' ? 'btn-primary' : ''}`}
                      onClick={() => void handleEnvPatch({ weather: 'rain' }, 'Weather set to Rain')}
                    >
                      <CloudRain size={14} aria-hidden="true" />
                      Rain
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${activeWorld.weather === 'thunder' ? 'btn-primary' : ''}`}
                      onClick={() => void handleEnvPatch({ weather: 'thunder' }, 'Weather set to Thunder')}
                    >
                      <CloudLightning size={14} aria-hidden="true" />
                      Thunder
                    </button>
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="env-difficulty">Difficulty</label>
                  <select
                    id="env-difficulty"
                    className="select"
                    value={activeWorld.difficulty}
                    onChange={(e) =>
                      void handleEnvPatch(
                        { difficulty: e.target.value as 'PEACEFUL' | 'EASY' | 'NORMAL' | 'HARD' },
                        `Difficulty set to ${e.target.value}`,
                      )
                    }
                  >
                    <option value="PEACEFUL">Peaceful</option>
                    <option value="EASY">Easy</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HARD">Hard</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="field" style={{ flex: 1, minWidth: '170px' }}>
                    <label htmlFor="env-border">World Border Size (blocks)</label>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <input
                        id="env-border"
                        type="number"
                        min={16}
                        max={60000000}
                        className="input mono"
                        value={borderDraft}
                        onChange={(e) => setBorderDraft(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          const sz = Number(borderDraft);
                          if (sz >= 16) void handleEnvPatch({ borderSize: sz }, `World border set to ${sz} blocks`);
                        }}
                      >
                        Set
                      </button>
                    </div>
                  </div>
                  <div style={{ paddingBottom: '0.45rem' }}>
                    <Switch
                      checked={activeWorld.pvp}
                      onChange={(pvp) => void handleEnvPatch({ pvp }, `PvP ${pvp ? 'enabled' : 'disabled'} in ${activeWorld.name}`)}
                      label="Allow PvP"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Live Gamerules Studio */}
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div className="card-header" style={{ marginBottom: 0 }}>
              <div>
                <h3 className="card-title">Live Gamerules — {selectedWorld}</h3>
                <span className="field-hint">Changes apply immediately without restarting.</span>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void loadGamerules(selectedWorld)}
              >
                <RefreshCw size={14} className={loadingRules ? 'spin' : ''} aria-hidden="true" />
                Reload Rules
              </button>
            </div>

            <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <search style={{ flex: '1 1 240px', maxWidth: '420px', position: 'relative' }}>
                <label htmlFor="gr-search" className="visually-hidden">
                  Filter gamerules
                </label>
                <Search
                  size={15}
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    insetInlineStart: '0.7rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  id="gr-search"
                  type="search"
                  className="input"
                  style={{ paddingInlineStart: '2.1rem', minHeight: '36px' }}
                  placeholder="Search gamerules (e.g. keepInventory, mobGriefing, tick)..."
                  value={ruleSearch}
                  onChange={(e) => setRuleSearch(e.target.value)}
                />
              </search>

              <div className="mode-segmented" role="group" aria-label="Filter gamerules by type">
                <button type="button" className={ruleFilter === 'all' ? 'active' : ''} onClick={() => setRuleFilter('all')}>
                  All ({gamerules.length})
                </button>
                <button
                  type="button"
                  className={ruleFilter === 'boolean' ? 'active' : ''}
                  onClick={() => setRuleFilter('boolean')}
                >
                  Toggles ({gamerules.filter((r) => r.type === 'boolean').length})
                </button>
                <button
                  type="button"
                  className={ruleFilter === 'integer' ? 'active' : ''}
                  onClick={() => setRuleFilter('integer')}
                >
                  Numbers ({gamerules.filter((r) => r.type === 'integer').length})
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {visibleRules.map((rule) => {
                const desc = getGameruleDescription(rule.name);
                const fallbackPrefix = rule.type === 'boolean' ? 'Toggle (true/false).' : 'Numeric value.';
                const isModified = rule.defaultValue && rule.value !== rule.defaultValue;
                return (
                  <div key={rule.name} className="cfg-row">
                    <div className="cfg-key-col">
                      <div className="cfg-key-title">
                        <span>{humanizeRule(rule.name)}</span>
                        <span className="cfg-key-raw">{rule.name}</span>
                        {isModified && <span className="badge badge-warn">Modified</span>}
                      </div>
                      {desc ? (
                        <div className="cfg-comment">{desc}</div>
                      ) : (
                        <div className="cfg-comment" style={{ fontStyle: 'italic', opacity: 0.75 }}>
                          {fallbackPrefix} No description available for this rule (it may come from a newer Minecraft version or a server fork).
                        </div>
                      )}
                      {rule.defaultValue && (
                        <div className="field-hint mono" style={{ fontSize: '0.74rem' }}>
                          Default: {rule.defaultValue}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {rule.type === 'boolean' ? (
                        <Switch
                          checked={rule.value === 'true'}
                          label={rule.value === 'true' ? 'Enabled (true)' : 'Disabled (false)'}
                          onChange={(checked) => void handleUpdateRule(rule, checked)}
                        />
                      ) : (
                        <>
                          <input
                            type={rule.type === 'integer' ? 'number' : 'text'}
                            aria-label={rule.name}
                            className="input mono"
                            style={{ maxWidth: '160px', minHeight: '36px' }}
                            value={intDrafts[rule.name] ?? rule.value}
                            onChange={(e) => setIntDrafts((prev) => ({ ...prev, [rule.name]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={(intDrafts[rule.name] ?? rule.value) === rule.value}
                            onClick={() => void handleUpdateRule(rule, intDrafts[rule.name] ?? rule.value)}
                          >
                            Apply
                          </button>
                        </>
                      )}
                    </div>

                    {rule.defaultValue ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={!isModified}
                        title={`Reset ${rule.name} to default (${rule.defaultValue})`}
                        aria-label={`Reset ${rule.name} to default`}
                        onClick={() =>
                          void handleUpdateRule(
                            rule,
                            rule.type === 'boolean' ? rule.defaultValue === 'true' : rule.defaultValue,
                          )
                        }
                      >
                        <RotateCcw size={14} aria-hidden="true" />
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
