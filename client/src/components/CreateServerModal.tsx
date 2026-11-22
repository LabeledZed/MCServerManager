import { useEffect, useState } from 'react';
import { Loader2, Server } from 'lucide-react';
import { api } from '../api/client';
import { ModalDialog } from './ModalDialog';
import { Switch } from './Switch';
import type { JavaRuntimeInfo, JvmPreset, ServerSoftware, ServerSummary } from '../../../shared/types';

interface CreateServerModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (server: ServerSummary) => void;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

const SOFTWARE_OPTIONS: Array<{ id: ServerSoftware; label: string; displayName: string }> = [
  { id: 'paper', label: 'Paper (Plugins)', displayName: 'Paper' },
  { id: 'purpur', label: 'Purpur (Plugins)', displayName: 'Purpur' },
  { id: 'leaf', label: 'Leaf (Plugins)', displayName: 'Leaf' },
  { id: 'vanilla', label: 'Vanilla', displayName: 'Vanilla' },
  { id: 'fabric', label: 'Fabric (Mods)', displayName: 'Fabric' },
  { id: 'neoforge', label: 'NeoForge (Mods)', displayName: 'NeoForge' },
  { id: 'forge', label: 'Forge (Mods)', displayName: 'Forge' },
  { id: 'folia', label: 'Folia (Plugins)', displayName: 'Folia' },
  { id: 'velocity', label: 'Velocity (Proxy + Plugins)', displayName: 'Velocity' },
  { id: 'custom', label: 'Custom / Spigot (Plugins)', displayName: 'Custom' },
];

function computeDefaultName(software: ServerSoftware, version: string): string {
  const v = version.trim() || '1.21.4';
  if (software === 'velocity') return `${v} Velocity Proxy`;
  const platform = SOFTWARE_OPTIONS.find((s) => s.id === software)?.displayName || software;
  return `${v} ${platform} Server`;
}

function computeDefaultMotd(software: ServerSoftware, version: string): string {
  if (software === 'velocity') return 'A Velocity proxy';
  const v = version.trim() || '1.21.4';
  const platform = SOFTWARE_OPTIONS.find((s) => s.id === software)?.displayName || software;
  return `${v} ${platform} server`;
}

export function CreateServerModal({ open, onClose, onCreated, onNotify }: CreateServerModalProps) {
  const [software, setSoftware] = useState<ServerSoftware>('paper');
  const [versions, setVersions] = useState<string[]>([]);
  const [mcVersion, setMcVersion] = useState('1.21.4');
  const [name, setName] = useState(() => computeDefaultName('paper', '1.21.4'));
  const [nameDirty, setNameDirty] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [port, setPort] = useState(25560);
  const [minRamMb, setMinRamMb] = useState(1024);
  const [maxRamMb, setMaxRamMb] = useState(4096);
  const [jvmPreset, setJvmPreset] = useState<JvmPreset>('aikar');
  const [javaPath, setJavaPath] = useState('auto');
  const [runtimes, setRuntimes] = useState<JavaRuntimeInfo[]>([]);
  const [eulaAccepted, setEulaAccepted] = useState(true);
  const [motd, setMotd] = useState(() => computeDefaultMotd('paper', '1.21.4'));
  const [motdDirty, setMotdDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNameDirty(false);
    setMotdDirty(false);
    setName(computeDefaultName(software, mcVersion));
    setMotd(computeDefaultMotd(software, mcVersion));
    api.listJavaRuntimes().then((r) => setRuntimes(r.runtimes)).catch(() => {});
    api.getNextServerPort().then((r) => setPort(r.port)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!nameDirty) setName(computeDefaultName(software, mcVersion));
    if (!motdDirty) setMotd(computeDefaultMotd(software, mcVersion));
  }, [software, mcVersion, nameDirty, motdDirty]);

  useEffect(() => {
    if (!open) return;
    if (software === 'custom') {
      setVersions(['1.21.4', '1.21.1', '1.20.4', '1.19.4', '1.18.2', '1.16.5']);
      return;
    }
    let active = true;
    setLoadingVersions(true);
    api
      .listSoftwareVersions(software)
      .then((res) => {
        if (!active) return;
        setVersions(res.versions);
        if (res.versions.length > 0) setMcVersion(res.versions[0]);
      })
      .catch((err) => {
        if (active) onNotify('warn', `Could not fetch ${software} versions: ${err.message}`);
      })
      .finally(() => {
        if (active) setLoadingVersions(false);
      });
    return () => {
      active = false;
    };
  }, [open, software, onNotify]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const created = await api.createServer({
        name: name.trim(),
        software,
        mcVersion,
        port,
        minRamMb,
        maxRamMb: Math.max(minRamMb, maxRamMb),
        javaPath,
        jvmPreset,
        eulaAccepted,
        motd,
      });
      onNotify('success', `Created "${created.name}" (${software} ${mcVersion})`);
      onCreated(created);
      onClose();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to create server');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Create New Minecraft Server"
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="create-server-form" className="btn btn-primary" disabled={submitting}>
            {submitting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Server size={16} aria-hidden="true" />}
            {submitting ? 'Creating...' : 'Create & Download Server'}
          </button>
        </>
      }
    >
      <form id="create-server-form" onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="cs-name">Server Name *</label>
            <input
              id="cs-name"
              name="name"
              type="text"
              className="input"
              required
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameDirty(true);
              }}
              placeholder={computeDefaultName(software, mcVersion)}
            />
          </div>
          <div className="field">
            <label htmlFor="cs-port">Port</label>
            <input
              id="cs-port"
              name="port"
              type="number"
              min={1024}
              max={65535}
              className="input mono"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </div>
        </div>

        <fieldset className="field-group">
          <legend>Server Software & Version</legend>
          <div className="grid-2" style={{ marginTop: '0.35rem' }}>
            <div className="field">
              <label htmlFor="cs-software">Platform / Loader</label>
              <select
                id="cs-software"
                className="select"
                value={software}
                onChange={(e) => setSoftware(e.target.value as ServerSoftware)}
              >
                {SOFTWARE_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cs-version">
                {software === 'velocity' ? 'Velocity Version' : 'Minecraft Version'}{' '}
                {loadingVersions && <span className="field-hint">(loading...)</span>}
              </label>
              {versions.length > 0 ? (
                <select
                  id="cs-version"
                  className="select mono"
                  value={mcVersion}
                  onChange={(e) => setMcVersion(e.target.value)}
                >
                  {versions.slice(0, 80).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="cs-version"
                  type="text"
                  className="input mono"
                  value={mcVersion}
                  onChange={(e) => setMcVersion(e.target.value)}
                />
              )}
            </div>
          </div>
        </fieldset>

        <fieldset className="field-group">
          <legend>Memory & Java Runtime</legend>
          <div className="grid-2" style={{ marginTop: '0.35rem' }}>
            <div className="field">
              <label htmlFor="cs-minram">Min RAM (MB)</label>
              <input
                id="cs-minram"
                type="number"
                min={512}
                step={256}
                className="input mono"
                value={minRamMb}
                onChange={(e) => setMinRamMb(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="cs-maxram">Max RAM (MB)</label>
              <input
                id="cs-maxram"
                type="number"
                min={512}
                step={512}
                className="input mono"
                value={maxRamMb}
                onChange={(e) => setMaxRamMb(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="cs-java">Java Runtime</label>
              <select
                id="cs-java"
                className="select"
                value={javaPath}
                onChange={(e) => setJavaPath(e.target.value)}
              >
                <option value="auto">Auto-select best Java for MC version</option>
                {runtimes.map((r) => (
                  <option key={r.id} value={r.path}>
                    Java {r.major} ({r.version} — {r.vendor}) [{r.source}]
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cs-preset">JVM Flags Preset</label>
              <select
                id="cs-preset"
                className="select"
                value={jvmPreset}
                onChange={(e) => setJvmPreset(e.target.value as JvmPreset)}
              >
                <option value="aikar">Aikar&apos;s Flags (Recommended for Paper/Purpur)</option>
                <option value="g1gc">Standard G1GC</option>
                <option value="zgc">Generational ZGC (Java 21+)</option>
                <option value="custom">None / Custom</option>
              </select>
            </div>
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="cs-motd">{software === 'velocity' ? 'Proxy MOTD' : 'Server List MOTD'}</label>
          <input
            id="cs-motd"
            type="text"
            className="input mono"
            value={motd}
            onChange={(e) => {
              setMotd(e.target.value);
              setMotdDirty(true);
            }}
          />
        </div>

        {software === 'velocity' ? (
          <div
            className="banner"
            style={{
              background: 'var(--bg-surface-subtle)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.86rem',
              color: 'var(--text-secondary)',
            }}
          >
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Velocity Proxy Mode:</strong> Velocity does not host
              worlds directly — it forwards players to your other managed MCServerManager servers or external backends.
              Starter <code>velocity.toml</code>, <code>forwarding.secret</code>, and{' '}
              <code>MCServerManagerBridge-Velocity.jar</code> will be created automatically.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0' }}>
            <Switch
              checked={eulaAccepted}
              onChange={setEulaAccepted}
              label="I accept the Minecraft EULA (writes eula=true automatically)"
            />
          </div>
        )}
      </form>
    </ModalDialog>
  );
}
