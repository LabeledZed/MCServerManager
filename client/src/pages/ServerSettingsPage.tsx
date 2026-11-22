import { useEffect, useState } from 'react';
import { DownloadCloud, Save, Settings, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { Switch } from '../components/Switch';
import { ConfirmDialog } from '../components/ModalDialog';
import type { JavaRuntimeInfo, JvmPreset, ServerSoftware, ServerSummary } from '../../../shared/types';

interface ServerSettingsPageProps {
  server: ServerSummary;
  onUpdated: (srv: ServerSummary) => void;
  onDeleted: (id: string) => void;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

const SOFTWARE_OPTIONS: Array<{ id: ServerSoftware; label: string }> = [
  { id: 'paper', label: 'Paper (Plugins)' },
  { id: 'purpur', label: 'Purpur (Plugins)' },
  { id: 'leaf', label: 'Leaf (Plugins)' },
  { id: 'vanilla', label: 'Vanilla' },
  { id: 'fabric', label: 'Fabric (Mods)' },
  { id: 'neoforge', label: 'NeoForge (Mods)' },
  { id: 'forge', label: 'Forge (Mods)' },
  { id: 'folia', label: 'Folia (Plugins)' },
  { id: 'velocity', label: 'Velocity (Proxy + Plugins)' },
  { id: 'custom', label: 'Custom / Spigot (Plugins)' },
];

export function ServerSettingsPage({ server, onUpdated, onDeleted, onNotify }: ServerSettingsPageProps) {
  const [name, setName] = useState(server.name);
  const [port, setPort] = useState(server.port);
  const [minRamMb, setMinRamMb] = useState(server.minRamMb);
  const [maxRamMb, setMaxRamMb] = useState(server.maxRamMb);
  const [javaPath, setJavaPath] = useState(server.javaPath);
  const [jvmPreset, setJvmPreset] = useState<JvmPreset>(server.jvmPreset);
  const [customJvmArgs, setCustomJvmArgs] = useState(server.customJvmArgs);
  const [jarFile, setJarFile] = useState(server.jarFile);
  const [stopCommand, setStopCommand] = useState(server.stopCommand);
  const [autoStart, setAutoStart] = useState(Boolean(server.autoStart));
  const [autoRestart, setAutoRestart] = useState(server.autoRestart);
  const [maxRestartAttempts, setMaxRestartAttempts] = useState(server.maxRestartAttempts);
  const [eulaAccepted, setEulaAccepted] = useState(server.eulaAccepted);
  const [runtimes, setRuntimes] = useState<JavaRuntimeInfo[]>([]);
  const [saving, setSaving] = useState(false);

  // Software / Version switcher
  const [targetSoftware, setTargetSoftware] = useState<ServerSoftware>(server.software);
  const [versions, setVersions] = useState<string[]>([]);
  const [targetVersion, setTargetVersion] = useState(server.mcVersion);
  const [switching, setSwitching] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setName(server.name);
    setPort(server.port);
    setMinRamMb(server.minRamMb);
    setMaxRamMb(server.maxRamMb);
    setJavaPath(server.javaPath);
    setJvmPreset(server.jvmPreset);
    setCustomJvmArgs(server.customJvmArgs);
    setJarFile(server.jarFile);
    setStopCommand(server.stopCommand);
    setAutoStart(Boolean(server.autoStart));
    setAutoRestart(server.autoRestart);
    setMaxRestartAttempts(server.maxRestartAttempts);
    setEulaAccepted(server.eulaAccepted);
    setTargetSoftware(server.software);
    setTargetVersion(server.mcVersion);
  }, [server]);

  useEffect(() => {
    api.listJavaRuntimes().then((r) => setRuntimes(r.runtimes)).catch(() => {});
  }, []);

  useEffect(() => {
    if (targetSoftware === 'custom') return;
    api
      .listSoftwareVersions(targetSoftware)
      .then((res) => {
        setVersions(res.versions);
        if (res.versions.length > 0 && !res.versions.includes(targetVersion)) {
          setTargetVersion(res.versions[0]);
        }
      })
      .catch(() => {});
  }, [targetSoftware, targetVersion]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateServer(server.id, {
        name,
        port,
        minRamMb,
        maxRamMb: Math.max(minRamMb, maxRamMb),
        javaPath,
        jvmPreset,
        customJvmArgs,
        jarFile,
        stopCommand,
        autoStart,
        autoRestart,
        maxRestartAttempts,
        eulaAccepted,
      });
      onUpdated(updated);
      onNotify('success', 'Server settings saved');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReinstall = async () => {
    setSwitching(true);
    try {
      await api.reinstallServer(server.id, targetSoftware, targetVersion);
      onNotify('info', `Downloading ${targetSoftware} ${targetVersion}...`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Version switch failed');
    } finally {
      setSwitching(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.deleteServer(server.id, true);
      onNotify('info', `Deleted server "${server.name}"`);
      setDeleteOpen(false);
      onDeleted(server.id);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      <form className="card" onSubmit={(e) => void handleSave(e)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2 className="card-title">
            <Settings size={18} aria-hidden="true" />
            Runtime &amp; Startup Settings
          </h2>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
            <Save size={15} aria-hidden="true" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="st-name">Display Name</label>
            <input id="st-name" type="text" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="st-port">
              {server.software === 'velocity'
                ? 'Proxy Port (syncs with velocity.toml)'
                : 'Server Port (syncs with server.properties)'}
            </label>
            <input
              id="st-port"
              type="number"
              min={1024}
              max={65535}
              className="input mono"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="st-minram">Minimum RAM (MB)</label>
            <input id="st-minram" type="number" step={256} min={256} className="input mono" value={minRamMb} onChange={(e) => setMinRamMb(Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="st-maxram">Maximum RAM (MB)</label>
            <input id="st-maxram" type="number" step={512} min={512} className="input mono" value={maxRamMb} onChange={(e) => setMaxRamMb(Number(e.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="st-java">Java Runtime</label>
            <select id="st-java" className="select" value={javaPath} onChange={(e) => setJavaPath(e.target.value)}>
              <option value="auto">Auto-detect recommended Java</option>
              {runtimes.map((r) => (
                <option key={r.id} value={r.path}>
                  Java {r.major} ({r.version} — {r.vendor}) [{r.source}]
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="st-preset">JVM Flags Preset</label>
            <select id="st-preset" className="select" value={jvmPreset} onChange={(e) => setJvmPreset(e.target.value as JvmPreset)}>
              <option value="aikar">Aikar&apos;s Flags (Recommended)</option>
              <option value="g1gc">G1GC Standard</option>
              <option value="zgc">Generational ZGC (Java 21+)</option>
              <option value="custom">Custom Flags</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="st-jar">Server JAR / Launch Target</label>
            <input id="st-jar" type="text" className="input mono" value={jarFile} onChange={(e) => setJarFile(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="st-stop">Graceful Stop Command</label>
            <input id="st-stop" type="text" className="input mono" value={stopCommand} onChange={(e) => setStopCommand(e.target.value)} />
          </div>
        </div>

        {jvmPreset === 'custom' && (
          <div className="field">
            <label htmlFor="st-custom-args">Custom JVM Arguments</label>
            <input
              id="st-custom-args"
              type="text"
              className="input mono"
              placeholder="-XX:+UseG1GC -Dfile.encoding=UTF-8"
              value={customJvmArgs}
              onChange={(e) => setCustomJvmArgs(e.target.value)}
            />
          </div>
        )}

        <Switch checked={autoStart} onChange={setAutoStart} label="Auto-start server when MCServerManager starts" />

        <div className="grid-2" style={{ alignItems: 'center' }}>
          <Switch checked={autoRestart} onChange={setAutoRestart} label="Auto-restart server if it crashes unexpectedly" />
          <div className="field">
            <label htmlFor="st-retries">Max Auto-Restart Retries</label>
            <input
              id="st-retries"
              type="number"
              min={1}
              max={10}
              className="input mono"
              disabled={!autoRestart}
              value={maxRestartAttempts}
              onChange={(e) => setMaxRestartAttempts(Number(e.target.value))}
            />
          </div>
        </div>

        {server.software !== 'velocity' && (
          <Switch checked={eulaAccepted} onChange={setEulaAccepted} label="Accept Minecraft EULA (eula=true)" />
        )}
      </form>

      {/* Software & Version Switcher */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <h3 className="card-title">
          <DownloadCloud size={18} aria-hidden="true" />
          Software &amp; Minecraft Version Switcher
        </h3>
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
          Switch server software or Minecraft version while keeping worlds and configs.
        </p>
        <div className="grid-3" style={{ alignItems: 'end' }}>
          <div className="field">
            <label htmlFor="sw-soft">Software</label>
            <select
              id="sw-soft"
              className="select"
              value={targetSoftware}
              onChange={(e) => setTargetSoftware(e.target.value as ServerSoftware)}
            >
              {SOFTWARE_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sw-ver">{targetSoftware === 'velocity' ? 'Velocity Version' : 'Minecraft Version'}</label>
            {versions.length > 0 ? (
              <select
                id="sw-ver"
                className="select mono"
                value={targetVersion}
                onChange={(e) => setTargetVersion(e.target.value)}
              >
                {versions.slice(0, 80).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input id="sw-ver" type="text" className="input mono" value={targetVersion} onChange={(e) => setTargetVersion(e.target.value)} />
            )}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={switching || server.runtime.status === 'online' || server.runtime.status === 'starting'}
            onClick={() => void handleReinstall()}
          >
            <DownloadCloud size={15} aria-hidden="true" />
            {switching ? 'Installing...' : 'Install / Switch Version'}
          </button>
        </div>
      </section>

      {/* Danger Zone */}
      <section className="card" style={{ borderColor: 'color-mix(in oklab, var(--status-danger), transparent 45%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ color: 'var(--status-danger)' }}>Danger Zone</h3>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Delete this server and its files.
            </p>
          </div>
          <button type="button" className="btn btn-danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 size={15} aria-hidden="true" />
            Delete Server
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title={`Permanently delete "${server.name}"?`}
        message="This stops the server and removes all worlds, plugins, configs, and JARs inside this server directory. Saved backups in data/backups are kept."
        confirmLabel="Delete Forever"
      />
    </div>
  );
}
