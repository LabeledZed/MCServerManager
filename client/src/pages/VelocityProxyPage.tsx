import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  Globe,
  KeyRound,
  Link2,
  Megaphone,
  Network,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  Send,
  Server,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react';
import { api } from '../api/client';
import { StatusBadge } from '../components/StatusBadge';
import { Switch } from '../components/Switch';
import type {
  BridgeStatusResponse,
  ServerSummary,
  VelocityForwardingMode,
  VelocityNetworkState,
} from '../../../shared/types';

interface VelocityProxyPageProps {
  server: ServerSummary;
  onOpenConfigFile: (relPath: string) => void;
  onNavigateTab: (tab: string) => void;
  onServerUpdated?: () => void;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

function slugAlias(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'server'
  );
}

export function VelocityProxyPage({
  server,
  onOpenConfigFile,
  onNavigateTab,
  onServerUpdated,
  onNotify,
}: VelocityProxyPageProps) {
  const [network, setNetwork] = useState<VelocityNetworkState | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Editable velocity.toml core settings
  const [bind, setBind] = useState(`0.0.0.0:${server.port}`);
  const [motd, setMotd] = useState(`<#37abc8>${server.name}`);
  const [showMaxPlayers, setShowMaxPlayers] = useState(500);
  const [onlineMode, setOnlineMode] = useState(true);
  const [forwardingMode, setForwardingMode] = useState<VelocityForwardingMode>('modern');
  const [serversDraft, setServersDraft] = useState<Array<{ alias: string; address: string }>>([]);
  const [tryDraft, setTryDraft] = useState<string[]>([]);
  const [forcedHostsDraft, setForcedHostsDraft] = useState<Record<string, string[]>>({});
  const [showSecret, setShowSecret] = useState(false);

  // Link managed server form
  const [selectedManagedId, setSelectedManagedId] = useState('');
  const [managedAlias, setManagedAlias] = useState('');
  const [managedAddToTry, setManagedAddToTry] = useState(true);
  const [managedAutoFwd, setManagedAutoFwd] = useState(true);
  const [managedSyncFloodgate, setManagedSyncFloodgate] = useState(true);

  // Add external server form
  const [extAlias, setExtAlias] = useState('');
  const [extAddress, setExtAddress] = useState('');
  const [extAddToTry, setExtAddToTry] = useState(false);

  // Add forced host form
  const [newForcedHost, setNewForcedHost] = useState('');
  const [newForcedTarget, setNewForcedTarget] = useState('');

  // Live proxy controls (via MCServerManagerBridge-Velocity.jar)
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [sendTargets, setSendTargets] = useState<Record<string, string>>({});

  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const pollInFlightRef = useRef(false);

  const hydrateDraft = useCallback((state: VelocityNetworkState) => {
    setBind(state.bind);
    setMotd(state.motd);
    setShowMaxPlayers(state.showMaxPlayers);
    setOnlineMode(state.onlineMode);
    setForwardingMode(state.forwardingMode);
    setServersDraft(state.servers.map((s) => ({ alias: s.alias, address: s.address })));
    setTryDraft([...state.tryOrder]);
    setForcedHostsDraft({ ...state.forcedHosts });
    setDirty(false);
  }, []);

  const loadAll = useCallback(
    async (silent = false) => {
      if (silent && pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      if (!silent) setLoading(true);
      try {
        const [net, br] = await Promise.all([
          api.getVelocityNetwork(server.id),
          api.getBridgeStatus(server.id).catch(() => null),
        ]);
        setNetwork(net);
        setBridgeStatus(br);
        if (!silent || !dirtyRef.current) {
          hydrateDraft(net);
        }
        if (net.managedCandidates.length > 0) {
          setSelectedManagedId((prev) => {
            if (prev && net.managedCandidates.some((c) => c.id === prev)) return prev;
            const unlinked = net.managedCandidates.find((c) => !c.alreadyLinkedAs) || net.managedCandidates[0];
            setManagedAlias((cur) => cur || slugAlias(unlinked.name));
            return unlinked.id;
          });
        }
      } catch (err) {
        if (!silent) {
          onNotify('error', err instanceof Error ? err.message : 'Failed to load Velocity configuration');
        }
      } finally {
        pollInFlightRef.current = false;
        if (!silent) setLoading(false);
      }
    },
    [server.id, hydrateDraft, onNotify],
  );

  useEffect(() => {
    void loadAll(false);
  }, [loadAll, server.runtime.status]);

  // Live refresh while Velocity is running
  useEffect(() => {
    if (server.runtime.status !== 'online' && server.runtime.status !== 'starting') return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadAll(true);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadAll, server.runtime.status]);

  const backendMetaByAlias = useMemo(() => {
    const map = new Map<string, VelocityNetworkState['servers'][number]>();
    for (const s of network?.servers || []) {
      map.set(s.alias, s);
    }
    return map;
  }, [network?.servers]);

  const handleSaveProxyConfig = async () => {
    setBusy('save');
    try {
      const next = await api.updateVelocityConfig(server.id, {
        bind: bind.trim(),
        motd,
        showMaxPlayers,
        onlineMode,
        forwardingMode,
        servers: serversDraft,
        tryOrder: tryDraft,
        forcedHosts: forcedHostsDraft,
      });
      setNetwork(next);
      hydrateDraft(next);
      onServerUpdated?.();
      onNotify('success', 'Saved velocity.toml configuration. Restart Velocity (or run /velocity reload) to apply.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to save velocity.toml');
    } finally {
      setBusy(null);
    }
  };

  const handleLinkManaged = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedManagedId) return;
    setBusy('link-managed');
    try {
      const res = await api.linkVelocityManagedServer(server.id, {
        targetServerId: selectedManagedId,
        alias: managedAlias.trim() || undefined,
        addToTry: managedAddToTry,
        autoConfigureForwarding: managedAutoFwd,
        syncFloodgateKey: Boolean(network?.floodgateKeyAvailable && managedSyncFloodgate),
      });
      setNetwork(res.state);
      hydrateDraft(res.state);
      onNotify('success', res.notes.join(' • '));
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to link managed server');
    } finally {
      setBusy(null);
    }
  };

  const handleAddExternal = async (e: React.FormEvent) => {
    e.preventDefault();
    const alias = slugAlias(extAlias.trim());
    const address = extAddress.trim();
    if (!alias || !address) return;
    setBusy('add-external');
    try {
      const nextServers = [...serversDraft.filter((s) => s.alias !== alias), { alias, address }];
      const nextTry = extAddToTry && !tryDraft.includes(alias) ? [...tryDraft, alias] : tryDraft;
      const next = await api.updateVelocityConfig(server.id, {
        servers: nextServers,
        tryOrder: nextTry,
      });
      setNetwork(next);
      hydrateDraft(next);
      setExtAlias('');
      setExtAddress('');
      onNotify('success', `Added external backend "${alias}" → ${address}`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to add external server');
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveBackend = (alias: string) => {
    setServersDraft((prev) => prev.filter((s) => s.alias !== alias));
    setTryDraft((prev) => prev.filter((a) => a !== alias));
    setDirty(true);
  };

  const handleToggleTry = (alias: string) => {
    setTryDraft((prev) => (prev.includes(alias) ? prev.filter((a) => a !== alias) : [...prev, alias]));
    setDirty(true);
  };

  const handleMoveTry = (alias: string, delta: -1 | 1) => {
    setTryDraft((prev) => {
      const idx = prev.indexOf(alias);
      if (idx === -1) return prev;
      const targetIdx = idx + delta;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[targetIdx]] = [copy[targetIdx], copy[idx]];
      return copy;
    });
    setDirty(true);
  };

  const handleAddForcedHost = (e: React.FormEvent) => {
    e.preventDefault();
    const host = newForcedHost.trim().toLowerCase();
    const target = (newForcedTarget || serversDraft[0]?.alias || '').trim();
    if (!host || !target) return;
    setForcedHostsDraft((prev) => ({
      ...prev,
      [host]: prev[host]?.includes(target) ? prev[host] : [...(prev[host] || []), target],
    }));
    setNewForcedHost('');
    setDirty(true);
  };

  const handleRemoveForcedHost = (host: string) => {
    setForcedHostsDraft((prev) => {
      const next = { ...prev };
      delete next[host];
      return next;
    });
    setDirty(true);
  };

  const handleRegenerateSecret = async () => {
    setBusy('regen-secret');
    try {
      const next = await api.regenerateVelocitySecret(server.id);
      setNetwork(next);
      onNotify(
        'warn',
        'Generated new forwarding.secret. Re-link managed backends (or update their paper-global.yml) so their secret matches.',
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to regenerate secret');
    } finally {
      setBusy(null);
    }
  };

  const handleSyncFloodgateKey = async (targetServerId: string) => {
    setBusy(`sync-fg-${targetServerId}`);
    try {
      const res = await api.syncVelocityFloodgateKey(server.id, targetServerId);
      onNotify('success', `Synced Floodgate key.pem to ${res.copiedTo}`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to sync Floodgate key');
    } finally {
      setBusy(null);
    }
  };

  const handleInstallBridge = async () => {
    setBusy('install-bridge');
    try {
      await api.installBridge(server.id);
      onNotify('success', 'Installed MCServerManagerBridge-Velocity.jar into plugins/. Restart Velocity to connect.');
      await loadAll(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to install Velocity bridge');
    } finally {
      setBusy(null);
    }
  };

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastMsg.trim()) return;
    try {
      await api.bridgeBroadcast(server.id, broadcastMsg.trim());
      onNotify('success', 'Network broadcast sent to all proxy players');
      setBroadcastMsg('');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Broadcast failed');
    }
  };

  const handleSendPlayer = async (playerName: string, targetAlias: string) => {
    if (!targetAlias) return;
    try {
      await api.bridgePlayerAction(server.id, playerName, { action: 'send', value: targetAlias });
      onNotify('success', `Sent ${playerName} to ${targetAlias}`);
      void loadAll(true);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to send player');
    }
  };

  const handleKickPlayer = async (playerName: string) => {
    try {
      await api.bridgePlayerAction(server.id, playerName, {
        action: 'kick',
        value: 'Disconnected by proxy administrator',
      });
      onNotify('info', `Kicked ${playerName} from proxy`);
      void loadAll(true);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to kick player');
    }
  };

  const copySecret = () => {
    if (!network?.forwardingSecret) return;
    navigator.clipboard?.writeText(network.forwardingSecret).then(
      () => onNotify('success', 'Copied forwarding.secret to clipboard'),
      () => onNotify('info', 'Copy manually from the secret field'),
    );
  };

  if (loading && !network) {
    return <div className="card">Loading Velocity proxy configuration...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {/* Header Summary Card */}
      <section className="card card-accent">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <h2 className="card-title">
                <Network size={20} aria-hidden="true" />
                Velocity Proxy &amp; Backend Network
              </h2>
              <span className="badge badge-accent">PROXY</span>
              {bridgeStatus?.connected ? (
                <span className="badge badge-online">
                  <CheckCircle2 size={13} aria-hidden="true" />
                  Velocity Bridge Connected
                </span>
              ) : bridgeStatus?.installed ? (
                <span className="badge badge-warn">Bridge Installed — Offline</span>
              ) : (
                <span className="badge badge-offline">Bridge Not Installed</span>
              )}
              {dirty && <span className="badge badge-warn">Unsaved Changes</span>}
            </div>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Velocity routes players across linked backend servers without hosting worlds directly. Manage linked
              MCServerManager servers, external backends, forwarding secrets, and live proxy players here.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {!bridgeStatus?.installed && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null}
                onClick={() => void handleInstallBridge()}
              >
                <Download size={14} aria-hidden="true" />
                Install Velocity Bridge
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onOpenConfigFile('velocity.toml')}
            >
              <FileCode2 size={14} aria-hidden="true" />
              Edit velocity.toml
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void loadAll(false)} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void handleSaveProxyConfig()}
            >
              <Save size={14} aria-hidden="true" />
              {busy === 'save' ? 'Saving...' : 'Save Proxy Config'}
            </button>
          </div>
        </div>

        <div className="grid-4" style={{ marginTop: '1rem' }}>
          <div className="stat-tile">
            <span className="stat-label">Proxy Bind</span>
            <span className="stat-value mono" style={{ fontSize: '1.1rem' }}>
              {bind}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Linked Backends</span>
            <span className="stat-value">{serversDraft.length}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Forwarding Mode</span>
            <span className="stat-value" style={{ fontSize: '1.1rem' }}>
              {forwardingMode.toUpperCase()}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Live Proxy Players</span>
            <span className="stat-value">{network?.livePlayers.length ?? 0}</span>
          </div>
        </div>
      </section>

      {/* Linked Backend Servers Table */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h3 className="card-title">
            <Server size={18} aria-hidden="true" />
            Linked Backend Servers ({serversDraft.length})
          </h3>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigateTab('plugins')}>
              Manage Velocity Plugins
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigateTab('geyser')}>
              Bedrock (Geyser)
            </button>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table responsive-stack" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th>Alias</th>
                <th>Target Address</th>
                <th>Type / Managed Server</th>
                <th>Join Priority (try)</th>
                <th>Live Players</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {serversDraft.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--text-muted)' }}>
                    No backend servers linked yet. Link one of your managed servers or add an external address below.
                  </td>
                </tr>
              ) : (
                serversDraft.map((entry) => {
                  const meta = backendMetaByAlias.get(entry.alias);
                  const tryIndex = tryDraft.indexOf(entry.alias);
                  return (
                    <tr key={entry.alias}>
                      <td data-label="Alias">
                        <strong className="mono">{entry.alias}</strong>
                      </td>
                      <td data-label="Address" className="mono">
                        {entry.address}
                      </td>
                      <td data-label="Source">
                        {meta?.managedServerId ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <span className="badge badge-accent">MANAGED</span>
                            <span>{meta.managedServerName}</span>
                            {meta.managedServerSoftware && (
                              <span className="badge badge-neutral mono">
                                {meta.managedServerSoftware.toUpperCase()}
                              </span>
                            )}
                            {meta.managedServerStatus && <StatusBadge status={meta.managedServerStatus} />}
                          </div>
                        ) : (
                          <span className="badge badge-neutral">
                            <Globe size={11} aria-hidden="true" />
                            EXTERNAL
                          </span>
                        )}
                      </td>
                      <td data-label="Join Order">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className={`btn btn-sm ${tryIndex >= 0 ? 'btn-secondary' : 'btn-ghost'}`}
                            onClick={() => handleToggleTry(entry.alias)}
                            title="Include this backend in Velocity's initial connection try list"
                          >
                            {tryIndex >= 0 ? `#${tryIndex + 1} in try` : 'Not in try'}
                          </button>
                          {tryIndex >= 0 && (
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={tryIndex === 0}
                                aria-label={`Move ${entry.alias} up in try order`}
                                onClick={() => handleMoveTry(entry.alias, -1)}
                              >
                                <ArrowUp size={13} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={tryIndex === tryDraft.length - 1}
                                aria-label={`Move ${entry.alias} down in try order`}
                                onClick={() => handleMoveTry(entry.alias, 1)}
                              >
                                <ArrowDown size={13} aria-hidden="true" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                      <td data-label="Live Players">
                        {meta?.livePlayers && meta.livePlayers.length > 0 ? (
                          <span className="badge badge-online">{meta.livePlayers.length} online</span>
                        ) : (
                          <span className="field-hint">0</span>
                        )}
                      </td>
                      <td data-label="Actions">
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          {meta?.managedServerId && network?.floodgateKeyAvailable && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              title="Copy Velocity's plugins/floodgate/key.pem to this backend server"
                              disabled={busy !== null}
                              onClick={() => void handleSyncFloodgateKey(meta.managedServerId!)}
                            >
                              <KeyRound size={13} aria-hidden="true" />
                              Sync key.pem
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-label={`Remove ${entry.alias}`}
                            onClick={() => handleRemoveBackend(entry.alias)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Link Managed vs Add External Forms */}
        <div className="grid-2">
          {/* Link Managed Server */}
          <form
            onSubmit={(e) => void handleLinkManaged(e)}
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface-subtle)',
              padding: '0.95rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Link2 size={16} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
              Link a Managed Server
            </h4>

            {network && network.managedCandidates.length > 0 ? (
              <>
                <div className="grid-2" style={{ gap: '0.65rem' }}>
                  <div className="field">
                    <label htmlFor="vel-managed-select">Managed Server</label>
                    <select
                      id="vel-managed-select"
                      className="select"
                      value={selectedManagedId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedManagedId(id);
                        const found = network.managedCandidates.find((c) => c.id === id);
                        if (found) setManagedAlias(found.alreadyLinkedAs || slugAlias(found.name));
                      }}
                    >
                      {network.managedCandidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.software} :{c.port}) {c.alreadyLinkedAs ? `[linked: ${c.alreadyLinkedAs}]` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="vel-managed-alias">Velocity Alias</label>
                    <input
                      id="vel-managed-alias"
                      type="text"
                      className="input mono"
                      required
                      placeholder="lobby"
                      value={managedAlias}
                      onChange={(e) => setManagedAlias(e.target.value)}
                    />
                  </div>
                </div>

                <Switch
                  checked={managedAddToTry}
                  onChange={setManagedAddToTry}
                  label="Add to initial join try order"
                />
                <Switch
                  checked={managedAutoFwd}
                  onChange={setManagedAutoFwd}
                  label="Auto-configure backend for Velocity forwarding (online-mode=false + sync forwarding secret)"
                />
                {network.floodgateKeyAvailable && (
                  <Switch
                    checked={managedSyncFloodgate}
                    onChange={setManagedSyncFloodgate}
                    label="Copy Velocity's Floodgate key.pem to this backend server"
                  />
                )}

                <div style={{ marginTop: 'auto' }}>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={busy !== null || !selectedManagedId}>
                    <Link2 size={14} aria-hidden="true" />
                    {busy === 'link-managed' ? 'Linking...' : 'Link Managed Server'}
                  </button>
                </div>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
                No other non-proxy servers exist in MCServerManager yet. Create a Paper, Purpur, Leaf, Folia, Fabric,
                NeoForge, Forge, or Vanilla server first, or link an external server on the right.
              </p>
            )}
          </form>

          {/* Add External Server */}
          <form
            onSubmit={(e) => void handleAddExternal(e)}
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface-subtle)',
              padding: '0.95rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Globe size={16} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
              Link an External Server
            </h4>
            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
              Point Velocity to any external backend server running on another port, machine, or host.
            </p>
            <div className="grid-2" style={{ gap: '0.65rem' }}>
              <div className="field">
                <label htmlFor="vel-ext-alias">Alias</label>
                <input
                  id="vel-ext-alias"
                  type="text"
                  className="input mono"
                  required
                  placeholder="minigames"
                  value={extAlias}
                  onChange={(e) => setExtAlias(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="vel-ext-addr">Host:Port</label>
                <input
                  id="vel-ext-addr"
                  type="text"
                  className="input mono"
                  required
                  placeholder="192.168.1.50:25566"
                  value={extAddress}
                  onChange={(e) => setExtAddress(e.target.value)}
                />
              </div>
            </div>
            <Switch
              checked={extAddToTry}
              onChange={setExtAddToTry}
              label="Add to initial join try order"
            />
            <div style={{ marginTop: 'auto' }}>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy !== null}>
                <Plus size={14} aria-hidden="true" />
                {busy === 'add-external' ? 'Adding...' : 'Add External Server'}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Proxy Settings, Forwarding Secret & Forced Hosts */}
      <div className="grid-2">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <h3 className="card-title">Proxy Settings &amp; Player Forwarding</h3>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="vel-bind">Bind Address</label>
              <input
                id="vel-bind"
                type="text"
                className="input mono"
                value={bind}
                onChange={(e) => {
                  setBind(e.target.value);
                  setDirty(true);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="vel-maxp">Advertised Max Players</label>
              <input
                id="vel-maxp"
                type="number"
                min={1}
                className="input mono"
                value={showMaxPlayers}
                onChange={(e) => {
                  setShowMaxPlayers(Number(e.target.value));
                  setDirty(true);
                }}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="vel-motd">Proxy MOTD (MiniMessage supported)</label>
            <input
              id="vel-motd"
              type="text"
              className="input mono"
              value={motd}
              onChange={(e) => {
                setMotd(e.target.value);
                setDirty(true);
              }}
            />
          </div>

          <div className="field">
            <label htmlFor="vel-fwd">Player Info Forwarding Mode</label>
            <select
              id="vel-fwd"
              className="select"
              value={forwardingMode}
              onChange={(e) => {
                setForwardingMode(e.target.value as VelocityForwardingMode);
                setDirty(true);
              }}
            >
              <option value="modern">modern — Recommended for Paper / Purpur / Leaf / Folia / Fabric (FabricProxy-Lite)</option>
              <option value="bungeeguard">bungeeguard — Token-authenticated BungeeCord forwarding</option>
              <option value="legacy">legacy — Classic BungeeCord forwarding (Spigot / older servers)</option>
              <option value="none">none — Disable IP/UUID forwarding</option>
            </select>
          </div>

          <Switch
            checked={onlineMode}
            onChange={(val) => {
              setOnlineMode(val);
              setDirty(true);
            }}
            label="Online Mode (authenticate Java players with Mojang at the proxy)"
          />

          <div className="field">
            <label htmlFor="vel-secret">Forwarding Secret (forwarding.secret)</label>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <input
                id="vel-secret"
                type={showSecret ? 'text' : 'password'}
                className="input mono"
                readOnly
                style={{ flex: 1, minWidth: '180px' }}
                value={network?.forwardingSecret || ''}
              />
              <button
                type="button"
                className="btn btn-sm"
                aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                onClick={() => setShowSecret((v) => !v)}
              >
                {showSecret ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
              </button>
              <button type="button" className="btn btn-sm" onClick={copySecret}>
                <Copy size={14} aria-hidden="true" />
                Copy
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy !== null}
                onClick={() => void handleRegenerateSecret()}
              >
                <RotateCw size={14} aria-hidden="true" />
                Regenerate
              </button>
            </div>
            <span className="field-hint">
              Paste this into <code>config/paper-global.yml</code> under <code>proxies.velocity.secret</code> on external
              Paper backends (managed backends sync automatically when linked).
            </span>
          </div>
        </section>

        {/* Forced Hosts */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <h3 className="card-title">
              <ArrowRightLeft size={18} aria-hidden="true" />
              Forced Hosts ([forced-hosts])
            </h3>
          </div>
          <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
            Route specific domain names directly to a backend server (for example,{' '}
            <code className="mono">survival.example.com</code> → <code className="mono">survival</code>).
          </p>

          <form onSubmit={handleAddForcedHost} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}>
            <div className="field" style={{ flex: 1, minWidth: '170px' }}>
              <label htmlFor="vel-fh-host">Hostname</label>
              <input
                id="vel-fh-host"
                type="text"
                className="input mono"
                placeholder="survival.example.com"
                value={newForcedHost}
                onChange={(e) => setNewForcedHost(e.target.value)}
              />
            </div>
            <div className="field" style={{ width: '165px' }}>
              <label htmlFor="vel-fh-target">Backend Alias</label>
              <select
                id="vel-fh-target"
                className="select mono"
                value={newForcedTarget || serversDraft[0]?.alias || ''}
                onChange={(e) => setNewForcedTarget(e.target.value)}
              >
                {serversDraft.map((s) => (
                  <option key={s.alias} value={s.alias}>
                    {s.alias}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-secondary btn-sm" disabled={serversDraft.length === 0}>
              <Plus size={14} aria-hidden="true" />
              Add
            </button>
          </form>

          {Object.keys(forcedHostsDraft).length === 0 ? (
            <div className="field-hint">No forced hosts configured.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {Object.entries(forcedHostsDraft).map(([host, targets]) => (
                <div
                  key={host}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.6rem',
                    padding: '0.5rem 0.7rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <code className="mono">{host}</code>
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                    {targets.map((t) => (
                      <span key={t} className="badge badge-accent mono">
                        {t}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Remove forced host ${host}`}
                    onClick={() => handleRemoveForcedHost(host)}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Live Proxy Players & Network Broadcast */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h3 className="card-title">
            <Users size={18} aria-hidden="true" />
            Live Proxy Players &amp; Network Broadcast ({network?.livePlayers.length ?? 0})
          </h3>
          {!bridgeStatus?.connected && (
            <span className="badge badge-neutral">Start Velocity with Bridge plugin to control live players</span>
          )}
        </div>

        {bridgeStatus?.connected ? (
          <>
            <form onSubmit={(e) => void handleBroadcast(e)} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                className="input"
                style={{ flex: 1, minWidth: '220px' }}
                placeholder="Broadcast a message to all players across the entire Velocity network..."
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
              />
              <button type="submit" className="btn btn-primary btn-sm">
                <Megaphone size={14} aria-hidden="true" />
                Network Broadcast
              </button>
            </form>

            <div className="table-wrapper">
              <table className="data-table responsive-stack" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Current Server</th>
                    <th>Ping</th>
                    <th>Send to Backend</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {network && network.livePlayers.length > 0 ? (
                    network.livePlayers.map((p) => {
                      const target = sendTargets[p.name] || serversDraft.find((s) => s.alias !== p.world)?.alias || serversDraft[0]?.alias || '';
                      return (
                        <tr key={p.uuid || p.name}>
                          <td data-label="Player">
                            <strong>{p.name}</strong>
                          </td>
                          <td data-label="Current Server">
                            <span className="badge badge-accent mono">{p.world || 'unknown'}</span>
                          </td>
                          <td data-label="Ping" className="mono">
                            {p.ping} ms
                          </td>
                          <td data-label="Send">
                            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                              <select
                                className="select mono"
                                style={{ minHeight: '32px', padding: '0.2rem 0.45rem', fontSize: '0.84rem' }}
                                value={target}
                                onChange={(e) => setSendTargets((prev) => ({ ...prev, [p.name]: e.target.value }))}
                              >
                                {serversDraft.map((s) => (
                                  <option key={s.alias} value={s.alias}>
                                    {s.alias}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                disabled={!target}
                                onClick={() => void handleSendPlayer(p.name, target)}
                              >
                                <Send size={13} aria-hidden="true" />
                                Send
                              </button>
                            </div>
                          </td>
                          <td data-label="Actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => void handleKickPlayer(p.name)}
                            >
                              <UserMinus size={14} aria-hidden="true" />
                              Kick
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                        No players currently connected to this Velocity proxy.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            Once Velocity is running with <code className="mono">MCServerManagerBridge-Velocity.jar</code> installed, you
            can view every online player across your network, transfer players between backend servers, send network-wide
            broadcasts, and kick players directly from here.
          </p>
        )}
      </section>
    </div>
  );
}
