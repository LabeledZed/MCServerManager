import { useCallback, useEffect, useState } from 'react';
import { Ban, Plus, RefreshCw, Shield, Trash2, UserCheck, UserMinus, Users } from 'lucide-react';
import { api } from '../api/client';
import { Switch } from '../components/Switch';
import type { PlayersState, ServerSummary } from '../../../shared/types';

interface PlayersPageProps {
  server: ServerSummary;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

export function PlayersPage({ server, onNotify }: PlayersPageProps) {
  const [state, setState] = useState<PlayersState | null>(null);
  const [tab, setTab] = useState<'online' | 'whitelist' | 'ops' | 'bans'>('online');
  const [loading, setLoading] = useState(true);
  const [newPlayer, setNewPlayer] = useState('');
  const [newOpLevel, setNewOpLevel] = useState(4);
  const [banReason, setBanReason] = useState('');
  const [newBanIp, setNewBanIp] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPlayers(server.id);
      setState(res);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to load players');
    } finally {
      setLoading(false);
    }
  }, [server.id, onNotify]);

  useEffect(() => {
    void load();
  }, [load, server.runtime.playersOnline]);

  const toggleWhitelist = async (enabled: boolean) => {
    try {
      await api.setWhitelistEnabled(server.id, enabled);
      onNotify('success', `Whitelist ${enabled ? 'enabled' : 'disabled'}`);
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to update whitelist');
    }
  };

  const handleAddWhitelist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayer.trim()) return;
    try {
      await api.addWhitelist(server.id, newPlayer.trim());
      onNotify('success', `Added ${newPlayer.trim()} to whitelist`);
      setNewPlayer('');
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to add player');
    }
  };

  const handleAddOp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayer.trim()) return;
    try {
      await api.addOp(server.id, newPlayer.trim(), newOpLevel);
      onNotify('success', `Granted OP (level ${newOpLevel}) to ${newPlayer.trim()}`);
      setNewPlayer('');
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to add operator');
    }
  };

  const handleBanPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayer.trim()) return;
    try {
      await api.banPlayer(server.id, newPlayer.trim(), banReason || 'Banned by operator');
      onNotify('warn', `Banned ${newPlayer.trim()}`);
      setNewPlayer('');
      setBanReason('');
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to ban player');
    }
  };

  const handleBanIp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBanIp.trim()) return;
    try {
      await api.banIp(server.id, newBanIp.trim(), banReason || 'Banned by operator');
      onNotify('warn', `Banned IP ${newBanIp.trim()}`);
      setNewBanIp('');
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to ban IP');
    }
  };

  const handleKick = async (name: string) => {
    try {
      await api.kickPlayer(server.id, name, 'Kicked from MCServerManager panel');
      onNotify('info', `Kicked ${name}`);
      await load();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Kick failed');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="tablist" role="tablist" aria-label="Player lists" style={{ borderBottom: 0 }}>
          <button
            type="button"
            role="tab"
            className="tab-btn"
            aria-selected={tab === 'online'}
            onClick={() => setTab('online')}
          >
            <Users size={15} aria-hidden="true" />
            Online ({state?.online.length ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            className="tab-btn"
            aria-selected={tab === 'whitelist'}
            onClick={() => setTab('whitelist')}
          >
            <UserCheck size={15} aria-hidden="true" />
            Whitelist ({state?.whitelist.length ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            className="tab-btn"
            aria-selected={tab === 'ops'}
            onClick={() => setTab('ops')}
          >
            <Shield size={15} aria-hidden="true" />
            Operators ({state?.ops.length ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            className="tab-btn"
            aria-selected={tab === 'bans'}
            onClick={() => setTab('bans')}
          >
            <Ban size={15} aria-hidden="true" />
            Bans ({(state?.bannedPlayers.length ?? 0) + (state?.bannedIps.length ?? 0)})
          </button>
        </div>

        <button type="button" className="btn btn-sm" onClick={() => void load()}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {tab === 'online' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Online Players ({state?.online.length ?? 0})</h3>
          </div>
          {!state || state.online.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.8rem' }}>
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>No players are currently online.</p>
            </div>
          ) : (
            <div tabIndex={0} role="region" aria-labelledby="online-players-cap" className="table-wrapper">
              <table className="data-table responsive-stack">
                <caption id="online-players-cap">Connected players</caption>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Quick Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.online.map((name) => (
                    <tr key={name}>
                      <td data-label="Player">
                        <strong>{name}</strong>
                      </td>
                      <td data-label="Actions">
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() =>
                              api.addOp(server.id, name, 4).then(() => {
                                onNotify('success', `OP'd ${name}`);
                                void load();
                              })
                            }
                          >
                            <Shield size={13} aria-hidden="true" />
                            OP
                          </button>
                          <button type="button" className="btn btn-sm" onClick={() => void handleKick(name)}>
                            <UserMinus size={13} aria-hidden="true" />
                            Kick
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() =>
                              api.banPlayer(server.id, name, 'Banned from MCServerManager').then(() => {
                                onNotify('warn', `Banned ${name}`);
                                void load();
                              })
                            }
                          >
                            <Ban size={13} aria-hidden="true" />
                            Ban
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'whitelist' && state && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <Switch
              checked={state.whitelistEnabled}
              onChange={(val) => void toggleWhitelist(val)}
              label="Require Whitelist (white-list in server.properties)"
            />
            <form onSubmit={(e) => void handleAddWhitelist(e)} style={{ display: 'flex', gap: '0.45rem' }}>
              <label htmlFor="wl-name" className="visually-hidden">
                Minecraft username
              </label>
              <input
                id="wl-name"
                type="text"
                className="input"
                style={{ width: '220px' }}
                placeholder="Player username..."
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={newPlayer}
                onChange={(e) => setNewPlayer(e.target.value)}
              />
              <button type="submit" className="btn btn-primary">
                <Plus size={15} aria-hidden="true" />
                Add
              </button>
            </form>
          </div>

          <div tabIndex={0} role="region" aria-labelledby="wl-cap" className="table-wrapper">
            <table className="data-table responsive-stack">
              <caption id="wl-cap">Whitelisted players (whitelist.json)</caption>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>UUID</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.whitelist.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--text-muted)' }}>
                      Whitelist is empty.
                    </td>
                  </tr>
                ) : (
                  state.whitelist.map((p) => (
                    <tr key={p.uuid + p.name}>
                      <td data-label="Username">
                        <strong>{p.name}</strong>
                      </td>
                      <td data-label="UUID" className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {p.uuid}
                      </td>
                      <td data-label="Actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            api.removeWhitelist(server.id, p.name).then(() => {
                              onNotify('info', `Removed ${p.name} from whitelist`);
                              void load();
                            })
                          }
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'ops' && state && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <form onSubmit={(e) => void handleAddOp(e)} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label htmlFor="op-name" className="visually-hidden">
              Operator username
            </label>
            <input
              id="op-name"
              type="text"
              className="input"
              style={{ width: '220px' }}
              placeholder="Player username..."
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={newPlayer}
              onChange={(e) => setNewPlayer(e.target.value)}
            />
            <select
              aria-label="Operator permission level"
              className="select"
              style={{ width: '170px' }}
              value={newOpLevel}
              onChange={(e) => setNewOpLevel(Number(e.target.value))}
            >
              <option value={4}>Level 4 (Full Admin)</option>
              <option value={3}>Level 3 (Moderator)</option>
              <option value={2}>Level 2 (Commands)</option>
              <option value={1}>Level 1 (Spawn Bypass)</option>
            </select>
            <button type="submit" className="btn btn-primary">
              <Shield size={15} aria-hidden="true" />
              Add Operator
            </button>
          </form>

          <div tabIndex={0} role="region" aria-labelledby="ops-cap" className="table-wrapper">
            <table className="data-table responsive-stack">
              <caption id="ops-cap">Server Operators (ops.json)</caption>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Level</th>
                  <th>UUID</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {state.ops.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--text-muted)' }}>
                      No operators configured.
                    </td>
                  </tr>
                ) : (
                  state.ops.map((op) => (
                    <tr key={op.uuid + op.name}>
                      <td data-label="Username">
                        <strong>{op.name}</strong>
                      </td>
                      <td data-label="Level">
                        <span className="badge badge-accent">Level {op.level}</span>
                      </td>
                      <td data-label="UUID" className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {op.uuid}
                      </td>
                      <td data-label="Actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            api.removeOp(server.id, op.name).then(() => {
                              onNotify('info', `De-OP'd ${op.name}`);
                              void load();
                            })
                          }
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          De-OP
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'bans' && state && (
        <div className="grid-2">
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <h3 className="card-title">Banned Players</h3>
            <form onSubmit={(e) => void handleBanPlayer(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input
                type="text"
                className="input"
                placeholder="Username to ban..."
                aria-label="Username to ban"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={newPlayer}
                onChange={(e) => setNewPlayer(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '0.45rem' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Reason (optional)"
                  aria-label="Ban reason"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                />
                <button type="submit" className="btn btn-danger">
                  Ban
                </button>
              </div>
            </form>
            <div tabIndex={0} role="region" aria-labelledby="banp-cap" className="table-wrapper">
              <table className="data-table">
                <caption id="banp-cap">banned-players.json</caption>
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>Reason</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {state.bannedPlayers.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ color: 'var(--text-muted)' }}>
                        No banned players.
                      </td>
                    </tr>
                  ) : (
                    state.bannedPlayers.map((b) => (
                      <tr key={b.name}>
                        <td>{b.name}</td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{b.reason}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() =>
                              api.unbanPlayer(server.id, b.name).then(() => {
                                onNotify('success', `Unbanned ${b.name}`);
                                void load();
                              })
                            }
                          >
                            Pardon
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <h3 className="card-title">Banned IP Addresses</h3>
            <form onSubmit={(e) => void handleBanIp(e)} style={{ display: 'flex', gap: '0.45rem' }}>
              <input
                type="text"
                className="input mono"
                placeholder="IP address (e.g. 192.168.1.50)"
                aria-label="IP address to ban"
                value={newBanIp}
                onChange={(e) => setNewBanIp(e.target.value)}
              />
              <button type="submit" className="btn btn-danger">
                Ban IP
              </button>
            </form>
            <div tabIndex={0} role="region" aria-labelledby="banip-cap" className="table-wrapper">
              <table className="data-table">
                <caption id="banip-cap">banned-ips.json</caption>
                <thead>
                  <tr>
                    <th>IP</th>
                    <th>Reason</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {state.bannedIps.length === 0 ? (
                    <tr>
                      <td colSpan={3} style={{ color: 'var(--text-muted)' }}>
                        No banned IPs.
                      </td>
                    </tr>
                  ) : (
                    state.bannedIps.map((b) => (
                      <tr key={b.ip}>
                        <td className="mono">{b.ip}</td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{b.reason}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() =>
                              api.unbanIp(server.id, b.ip).then(() => {
                                onNotify('success', `Unbanned IP ${b.ip}`);
                                void load();
                              })
                            }
                          >
                            Pardon
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
