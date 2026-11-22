import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileCode2,
  Info,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import { Switch } from '../components/Switch';
import type { GeyserStatusResponse, ServerSummary } from '../../../shared/types';

interface GeyserPageProps {
  server: ServerSummary;
  onOpenConfigFile: (relPath: string) => void;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

function modeLabel(mode: GeyserStatusResponse['installMode']): string {
  if (mode === 'plugin') return 'PLUGIN MODE';
  if (mode === 'mod') return 'MOD MODE';
  return 'STANDALONE SIDECAR';
}

export function GeyserPage({ server, onOpenConfigFile, onNotify }: GeyserPageProps) {
  const [status, setStatus] = useState<GeyserStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Editable config fields
  const [bedrockPort, setBedrockPort] = useState(19132);
  const [cloneRemotePort, setCloneRemotePort] = useState(false);
  const [motd1, setMotd1] = useState(server.name);
  const [motd2, setMotd2] = useState('Bedrock & Java Cross-Play');
  const [serverName, setServerName] = useState(server.name);
  const [authType, setAuthType] = useState<'floodgate' | 'online' | 'offline'>('online');
  const [remoteAddress, setRemoteAddress] = useState('127.0.0.1');
  const [remotePort, setRemotePort] = useState(server.port);
  const [standaloneEnabled, setStandaloneEnabled] = useState(false);

  // Editable Floodgate config fields
  const [fgPrefix, setFgPrefix] = useState('.');
  const [fgReplaceSpaces, setFgReplaceSpaces] = useState(true);
  const [fgLocale, setFgLocale] = useState('en_US');
  const [fgSendData, setFgSendData] = useState(server.software === 'velocity');
  const [fgLinkEnabled, setFgLinkEnabled] = useState(true);
  const [fgRequireLink, setFgRequireLink] = useState(false);
  const [fgOwnLink, setFgOwnLink] = useState(true);
  const [fgGlobalLink, setFgGlobalLink] = useState(true);

  const syncForm = useCallback((s: GeyserStatusResponse) => {
    setBedrockPort(s.config.bedrockPort);
    setCloneRemotePort(s.config.cloneRemotePort);
    setMotd1(s.config.motd1);
    setMotd2(s.config.motd2);
    setServerName(s.config.serverName);
    setAuthType(s.config.authType);
    setRemoteAddress(s.config.remoteAddress);
    setRemotePort(s.config.remotePort);
    setStandaloneEnabled(s.standaloneEnabled);
    if (s.floodgateConfig) {
      setFgPrefix(s.floodgateConfig.usernamePrefix);
      setFgReplaceSpaces(s.floodgateConfig.replaceSpaces);
      setFgLocale(s.floodgateConfig.defaultLocale);
      setFgSendData(s.floodgateConfig.sendFloodgateData);
      setFgLinkEnabled(s.floodgateConfig.playerLinkEnabled);
      setFgRequireLink(s.floodgateConfig.requireLinking);
      setFgOwnLink(s.floodgateConfig.enableOwnLinking);
      setFgGlobalLink(s.floodgateConfig.enableGlobalLinking);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.getGeyserStatus(server.id);
      setStatus(s);
      syncForm(s);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to load Geyser status');
    } finally {
      setLoading(false);
    }
  }, [server.id, syncForm, onNotify]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, server.runtime.status]);

  const handleInstallGeyser = async () => {
    setBusy('install-geyser');
    try {
      const next = await api.installGeyser(server.id);
      setStatus(next);
      syncForm(next);
      onNotify(
        'success',
        next.installMode === 'standalone'
          ? 'Installed Geyser-Standalone. Start or restart the server to launch the Bedrock sidecar automatically.'
          : `Installed ${next.geyserFileName || 'Geyser'}. Restart the server to enable Bedrock cross-play.`,
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to install Geyser');
    } finally {
      setBusy(null);
    }
  };

  const handleUninstallGeyser = async () => {
    setBusy('uninstall-geyser');
    try {
      const next = await api.uninstallGeyser(server.id);
      setStatus(next);
      syncForm(next);
      onNotify(
        'info',
        next.geyserPendingDeletion
          ? 'Server is running — queued Geyser for automatic removal when the server stops.'
          : 'Removed Geyser from this server.',
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to uninstall Geyser');
    } finally {
      setBusy(null);
    }
  };

  const handleCancelPendingGeyser = async () => {
    setBusy('cancel-geyser');
    try {
      const next = await api.cancelPendingGeyserUninstall(server.id);
      setStatus(next);
      syncForm(next);
      onNotify('info', 'Canceled queued removal for Geyser.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to cancel queued removal');
    } finally {
      setBusy(null);
    }
  };

  const handleInstallFloodgate = async () => {
    setBusy('install-floodgate');
    try {
      const next = await api.installFloodgate(server.id);
      setStatus(next);
      syncForm(next);
      onNotify(
        'success',
        `Installed ${next.floodgateFileName || 'Floodgate'} and switched Geyser auth-type to floodgate. Restart the server to apply.`,
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to install Floodgate');
    } finally {
      setBusy(null);
    }
  };

  const handleUninstallFloodgate = async () => {
    setBusy('uninstall-floodgate');
    try {
      const next = await api.uninstallFloodgate(server.id);
      setStatus(next);
      syncForm(next);
      onNotify(
        'info',
        next.floodgatePendingDeletion
          ? 'Server is running — queued Floodgate for automatic removal when the server stops (Geyser auth-type reverted to online).'
          : 'Removed Floodgate. Geyser auth-type reverted to online.',
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to uninstall Floodgate');
    } finally {
      setBusy(null);
    }
  };

  const handleCancelPendingFloodgate = async () => {
    setBusy('cancel-floodgate');
    try {
      const next = await api.cancelPendingFloodgateUninstall(server.id);
      setStatus(next);
      syncForm(next);
      onNotify('info', 'Canceled queued removal for Floodgate.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to cancel queued removal');
    } finally {
      setBusy(null);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('save-config');
    try {
      const next = await api.updateGeyserConfig(server.id, {
        bedrockPort,
        cloneRemotePort,
        motd1,
        motd2,
        serverName,
        authType,
        remoteAddress,
        remotePort,
        standaloneEnabled: status?.installMode === 'standalone' ? standaloneEnabled : undefined,
      });
      setStatus(next);
      syncForm(next);
      onNotify('success', 'Saved Geyser Bedrock configuration. Restart the server (or Geyser) for changes to take effect.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to save Geyser configuration');
    } finally {
      setBusy(null);
    }
  };

  const handleSaveFloodgateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('save-floodgate');
    try {
      const next = await api.updateFloodgateConfig(server.id, {
        usernamePrefix: fgPrefix,
        replaceSpaces: fgReplaceSpaces,
        defaultLocale: fgLocale,
        sendFloodgateData: fgSendData,
        playerLinkEnabled: fgLinkEnabled,
        requireLinking: fgRequireLink,
        enableOwnLinking: fgOwnLink,
        enableGlobalLinking: fgGlobalLink,
      });
      setStatus(next);
      syncForm(next);
      onNotify('success', 'Saved Floodgate configuration. Restart the server for changes to take effect.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to save Floodgate configuration');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !status) {
    return <div className="card">Loading Geyser &amp; Floodgate status...</div>;
  }

  if (!status) {
    return <div className="card">Unable to load Geyser status.</div>;
  }

  const effectiveBedrockPort = status.installMode !== 'standalone' && cloneRemotePort ? server.port : bedrockPort;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {/* Header Summary Card */}
      <section className="card card-accent">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <h2 className="card-title">
                <Smartphone size={20} aria-hidden="true" />
                Bedrock Cross-Play (GeyserMC &amp; Floodgate)
              </h2>
              <span className="badge badge-accent mono">{modeLabel(status.installMode)}</span>
              {status.geyserInstalled ? (
                <span className="badge badge-online">
                  <CheckCircle2 size={13} aria-hidden="true" />
                  Geyser Installed
                </span>
              ) : (
                <span className="badge badge-offline">Geyser Not Installed</span>
              )}
              {status.floodgateInstalled && (
                <span className="badge badge-online">
                  <ShieldCheck size={13} aria-hidden="true" />
                  Floodgate Active
                </span>
              )}
              {status.installMode === 'standalone' && status.standaloneRunning && (
                <span className="badge badge-online">Sidecar Running</span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Let Minecraft Bedrock Edition players (Console, Mobile, Windows) join your{' '}
              <strong>{server.software.toUpperCase()}</strong> server over{' '}
              <code className="mono">UDP {effectiveBedrockPort}</code>.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {status.geyserConfigPath && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onOpenConfigFile(status.geyserConfigPath!)}
              >
                <FileCode2 size={14} aria-hidden="true" />
                Open config.yml
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => void loadStatus()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
              Refresh
            </button>
          </div>
        </div>
      </section>

      {/* Install Cards: Geyser + Floodgate */}
      <div className="grid-2">
        {/* Geyser Card */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <h3 className="card-title">
              <Smartphone size={18} aria-hidden="true" />
              GeyserMC
            </h3>
            {status.geyserPendingDeletion ? (
              <span className="badge badge-warn">Queued for Removal</span>
            ) : (
              <span className={`badge ${status.geyserInstalled ? 'badge-online' : 'badge-neutral'}`}>
                {status.geyserInstalled ? 'Installed' : 'Not Installed'}
              </span>
            )}
          </div>

          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
            {status.installMode === 'plugin' &&
              `Installs the official Geyser ${server.software === 'velocity' ? 'Velocity' : 'Spigot/Paper/Folia'} plugin directly into plugins/.`}
            {status.installMode === 'mod' &&
              `Installs the official Geyser ${server.software === 'neoforge' ? 'NeoForge' : 'Fabric'} mod directly into mods/.`}
            {status.installMode === 'standalone' &&
              `Runs Geyser-Standalone.jar as an automatic companion sidecar process whenever this ${server.software.toUpperCase()} server starts, forwarding Bedrock traffic to 127.0.0.1:${server.port}.`}
          </p>

          {status.geyserFileName && (
            <div className="field-hint">
              Installed JAR: <code className="mono">{status.geyserFileName}</code>
            </div>
          )}

          {status.installMode === 'standalone' && status.geyserInstalled && (
            <div className="field-hint">
              Sidecar state:{' '}
              <strong>
                {status.standaloneRunning
                  ? 'Running alongside server'
                  : status.standaloneEnabled
                    ? 'Armed (starts automatically when server starts)'
                    : 'Disabled (toggle auto-start below)'}
              </strong>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '0.35rem' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void handleInstallGeyser()}
            >
              <Download size={14} aria-hidden="true" />
              {busy === 'install-geyser'
                ? 'Downloading...'
                : status.geyserInstalled
                  ? 'Update / Reinstall Geyser'
                  : 'Install Geyser'}
            </button>
            {status.geyserInstalled &&
              (status.geyserPendingDeletion ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== null}
                  onClick={() => void handleCancelPendingGeyser()}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  Cancel Removal
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy !== null}
                  onClick={() => void handleUninstallGeyser()}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Uninstall
                </button>
              ))}
          </div>
        </section>

        {/* Floodgate Card */}
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <h3 className="card-title">
              <ShieldCheck size={18} aria-hidden="true" />
              Floodgate (Optional)
            </h3>
            {status.floodgateSupported ? (
              status.floodgatePendingDeletion ? (
                <span className="badge badge-warn">Queued for Removal</span>
              ) : (
                <span className={`badge ${status.floodgateInstalled ? 'badge-online' : 'badge-neutral'}`}>
                  {status.floodgateInstalled ? 'Installed' : 'Optional'}
                </span>
              )
            ) : (
              <span className="badge badge-warn">Proxy Recommended</span>
            )}
          </div>

          {status.floodgateSupported ? (
            <>
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                Allows Bedrock Edition players to join using only their Xbox Live account — no Minecraft Java Edition
                account required. Automatically sets Geyser&apos;s <code className="mono">auth-type: floodgate</code>.
              </p>

              {status.floodgateFileName && (
                <div className="field-hint">
                  Installed JAR: <code className="mono">{status.floodgateFileName}</code>
                </div>
              )}

              {status.floodgateInstalled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.84rem' }}>
                  <KeyRound size={14} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
                  <span>
                    Floodgate <code className="mono">key.pem</code>:{' '}
                    {status.floodgateKeyExists ? (
                      <strong style={{ color: 'var(--status-online)' }}>Generated</strong>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>Will generate on first server start</span>
                    )}
                  </span>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '0.35rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== null}
                  onClick={() => void handleInstallFloodgate()}
                >
                  <Download size={14} aria-hidden="true" />
                  {busy === 'install-floodgate'
                    ? 'Downloading...'
                    : status.floodgateInstalled
                      ? 'Update / Reinstall Floodgate'
                      : 'Install Floodgate'}
                </button>
                {status.floodgateInstalled &&
                  (status.floodgatePendingDeletion ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy !== null}
                      onClick={() => void handleCancelPendingFloodgate()}
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      Cancel Removal
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy !== null}
                      onClick={() => void handleUninstallFloodgate()}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      Uninstall
                    </button>
                  ))}
              </div>
            </>
          ) : (
            <div
              className="banner"
              style={{
                marginTop: '0.15rem',
                alignItems: 'flex-start',
                background: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <Info size={18} style={{ color: 'var(--accent-bright)', flexShrink: 0, marginTop: '0.1rem' }} aria-hidden="true" />
              <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {status.floodgateNote ||
                  'Native Floodgate is not available for standalone mode on this platform. Bedrock players can join with a Java account (auth-type: online), or you can place a Velocity proxy with Geyser + Floodgate in front of this server.'}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Geyser Configuration Form */}
      <form
        className="card"
        onSubmit={(e) => void handleSaveConfig(e)}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h3 className="card-title">Bedrock Listener &amp; Cross-Play Settings</h3>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy !== null}>
            <Save size={14} aria-hidden="true" />
            {busy === 'save-config' ? 'Saving...' : 'Save Geyser Config'}
          </button>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="gy-port">Bedrock UDP Port</label>
            <input
              id="gy-port"
              type="number"
              min={1024}
              max={65535}
              className="input mono"
              disabled={status.installMode !== 'standalone' && cloneRemotePort}
              value={bedrockPort}
              onChange={(e) => setBedrockPort(Number(e.target.value))}
            />
            <span className="field-hint">Default Minecraft Bedrock port is 19132 (UDP). Remember to allow UDP in your firewall.</span>
          </div>

          <div className="field">
            <label htmlFor="gy-auth">Bedrock Authentication Mode</label>
            <select
              id="gy-auth"
              className="select"
              value={authType}
              onChange={(e) => setAuthType(e.target.value as 'floodgate' | 'online' | 'offline')}
            >
              <option value="floodgate" disabled={!status.floodgateSupported}>
                floodgate — Xbox Live only (requires Floodgate)
              </option>
              <option value="online">online — Requires Java Edition account login</option>
              <option value="offline">offline — Offline / cracked mode (no Microsoft login)</option>
            </select>
            <span className="field-hint">
              Use <code>floodgate</code> when Floodgate is installed, or <code>online</code> for vanilla Mojang login.
            </span>
          </div>

          <div className="field">
            <label htmlFor="gy-servername">Bedrock Server Name</label>
            <input
              id="gy-servername"
              type="text"
              className="input"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="gy-motd1">Bedrock MOTD Line 1</label>
            <input
              id="gy-motd1"
              type="text"
              className="input"
              value={motd1}
              onChange={(e) => setMotd1(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="gy-motd2">Bedrock MOTD Line 2</label>
            <input
              id="gy-motd2"
              type="text"
              className="input"
              value={motd2}
              onChange={(e) => setMotd2(e.target.value)}
            />
          </div>

          {status.installMode === 'standalone' && (
            <div className="grid-2" style={{ gap: '0.65rem' }}>
              <div className="field">
                <label htmlFor="gy-remote-addr">Target Java Host</label>
                <input
                  id="gy-remote-addr"
                  type="text"
                  className="input mono"
                  value={remoteAddress}
                  onChange={(e) => setRemoteAddress(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="gy-remote-port">Target Java Port</label>
                <input
                  id="gy-remote-port"
                  type="number"
                  min={1024}
                  max={65535}
                  className="input mono"
                  value={remotePort}
                  onChange={(e) => setRemotePort(Number(e.target.value))}
                />
              </div>
            </div>
          )}
        </div>

        {status.installMode === 'standalone' ? (
          <Switch
            checked={standaloneEnabled}
            onChange={setStandaloneEnabled}
            label="Auto-start Geyser-Standalone sidecar whenever this server starts"
          />
        ) : (
          <Switch
            checked={cloneRemotePort}
            onChange={setCloneRemotePort}
            label={`Clone Java server port (${server.port}) as the Bedrock UDP port instead of using ${bedrockPort}`}
          />
        )}
      </form>

      {/* Floodgate Configuration Form (shown on all platforms where Floodgate applies) */}
      {status.floodgateSupported && (
        <form
          className="card"
          onSubmit={(e) => void handleSaveFloodgateConfig(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <div className="card-header" style={{ marginBottom: 0 }}>
            <h3 className="card-title">
              <ShieldCheck size={18} aria-hidden="true" />
              Floodgate Settings
            </h3>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              {status.floodgateConfigPath && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onOpenConfigFile(status.floodgateConfigPath!)}
                >
                  <FileCode2 size={14} aria-hidden="true" />
                  Open floodgate/config.yml
                </button>
              )}
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy !== null}>
                <Save size={14} aria-hidden="true" />
                {busy === 'save-floodgate' ? 'Saving...' : 'Save Floodgate Config'}
              </button>
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="fg-prefix">Bedrock Username Prefix</label>
              <input
                id="fg-prefix"
                type="text"
                maxLength={16}
                className="input mono"
                placeholder="."
                value={fgPrefix}
                onChange={(e) => setFgPrefix(e.target.value)}
              />
              <span className="field-hint">
                Prepended to Bedrock player names to avoid collisions with Java accounts (default: <code>.</code>).
              </span>
            </div>

            <div className="field">
              <label htmlFor="fg-locale">Default Locale</label>
              <input
                id="fg-locale"
                type="text"
                className="input mono"
                placeholder="en_US"
                value={fgLocale}
                onChange={(e) => setFgLocale(e.target.value)}
              />
              <span className="field-hint">Language code for Floodgate messages (e.g. <code>en_US</code>).</span>
            </div>
          </div>

          <div className="grid-2">
            <Switch
              checked={fgReplaceSpaces}
              onChange={setFgReplaceSpaces}
              label="Replace spaces in Bedrock gamertags with underscores (_)"
            />
            <Switch
              checked={fgSendData}
              onChange={setFgSendData}
              label={
                server.software === 'velocity'
                  ? 'Forward Floodgate player data to backend servers (recommended on Velocity)'
                  : 'Send Floodgate data (enable only on proxy servers)'
              }
            />
          </div>

          <fieldset className="field-group">
            <legend>Java / Bedrock Account Linking (player-link)</legend>
            <div className="grid-2" style={{ marginTop: '0.45rem', gap: '0.65rem' }}>
              <Switch
                checked={fgLinkEnabled}
                onChange={setFgLinkEnabled}
                label="Enable account linking"
              />
              <Switch
                checked={fgRequireLink}
                onChange={setFgRequireLink}
                label="Require Bedrock players to link a Java account before joining"
              />
              <Switch
                checked={fgOwnLink}
                onChange={setFgOwnLink}
                label="Allow players to link accounts with /linkaccount"
              />
              <Switch
                checked={fgGlobalLink}
                onChange={setFgGlobalLink}
                label="Use GeyserMC Global Linking service"
              />
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
