import { useEffect, useState } from 'react';
import { FolderInput, FolderSearch, Loader2, Search, ShieldCheck } from 'lucide-react';
import { api, formatBytes, type InspectedExistingServer } from '../api/client';
import { ModalDialog } from './ModalDialog';
import { Switch } from './Switch';
import type { JavaRuntimeInfo, JvmPreset, ServerSoftware, ServerSummary } from '../../../shared/types';

interface ImportServerModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (server: ServerSummary) => void;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

const SOFTWARE_OPTIONS: Array<{ id: ServerSoftware; label: string }> = [
  { id: 'paper', label: 'Paper (Plugins)' },
  { id: 'purpur', label: 'Purpur (Plugins)' },
  { id: 'leaf', label: 'Leaf (Plugins)' },
  { id: 'spigot', label: 'Spigot (Plugins)' },
  { id: 'folia', label: 'Folia (Plugins)' },
  { id: 'vanilla', label: 'Vanilla' },
  { id: 'fabric', label: 'Fabric (Mods)' },
  { id: 'neoforge', label: 'NeoForge (Mods)' },
  { id: 'forge', label: 'Forge (Mods)' },
  { id: 'velocity', label: 'Velocity (Proxy + Plugins)' },
  { id: 'custom', label: 'Custom / Spigot (Plugins)' },
];

export function ImportServerModal({ open, onClose, onImported, onNotify }: ImportServerModalProps) {
  const [sourcePath, setSourcePath] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [inspected, setInspected] = useState<InspectedExistingServer | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const [transferMode, setTransferMode] = useState<'move' | 'copy'>('copy');
  const [name, setName] = useState('');
  const [software, setSoftware] = useState<ServerSoftware>('paper');
  const [mcVersion, setMcVersion] = useState('1.21.4');
  const [jarFile, setJarFile] = useState('server.jar');
  const [port, setPort] = useState(25565);
  const [minRamMb, setMinRamMb] = useState(1024);
  const [maxRamMb, setMaxRamMb] = useState(4096);
  const [javaPath, setJavaPath] = useState('auto');
  const [jvmPreset, setJvmPreset] = useState<JvmPreset>('aikar');
  const [installBridge, setInstallBridge] = useState(true);
  const [runtimes, setRuntimes] = useState<JavaRuntimeInfo[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.listJavaRuntimes().then((r) => setRuntimes(r.runtimes)).catch(() => {});
  }, [open]);

  const resetAndClose = () => {
    setInspectError(null);
    onClose();
  };

  const runInspect = async (targetPath: string) => {
    const clean = targetPath.trim();
    if (!clean) return;
    setInspecting(true);
    setInspectError(null);
    try {
      const info = await api.inspectImportFolder(clean);
      setInspected(info);
      setSourcePath(info.sourcePath);
      setName(info.suggestedName);
      setSoftware(info.software);
      setMcVersion(info.mcVersion);
      setJarFile(info.jarFile);
      setPort(info.port);
      setInstallBridge(info.software !== 'vanilla');
    } catch (err) {
      setInspected(null);
      setInspectError(err instanceof Error ? err.message : 'Could not inspect folder');
    } finally {
      setInspecting(false);
    }
  };

  const handleBrowse = async () => {
    setPicking(true);
    try {
      const res = await api.pickImportFolder();
      if (res.path) {
        setSourcePath(res.path);
        await runInspect(res.path);
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Could not open folder browser');
    } finally {
      setPicking(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspected) return;
    setImporting(true);
    try {
      const imported = await api.importServer({
        sourcePath: inspected.sourcePath,
        transferMode,
        name: name.trim() || inspected.suggestedName,
        software,
        mcVersion: mcVersion.trim() || inspected.mcVersion,
        jarFile: jarFile.trim() || inspected.jarFile,
        port,
        minRamMb,
        maxRamMb: Math.max(minRamMb, maxRamMb),
        javaPath,
        jvmPreset,
        installBridge,
      });
      onNotify(
        'success',
        `${transferMode === 'move' ? 'Moved' : 'Copied'} "${imported.name}" into MCServerManager${imported.bridgeEnabled ? ' (bridge plugin installed)' : ''}.`,
      );
      setInspected(null);
      setSourcePath('');
      onImported(imported);
      onClose();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const supportsBridge = software !== 'vanilla';

  return (
    <ModalDialog
      open={open}
      onClose={resetAndClose}
      title="Import Existing Minecraft Server"
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={resetAndClose} disabled={importing}>
            Cancel
          </button>
          <button
            type="submit"
            form="import-server-form"
            className="btn btn-primary"
            disabled={!inspected || importing}
          >
            {importing ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <FolderInput size={16} aria-hidden="true" />}
            {importing
              ? transferMode === 'move'
                ? 'Moving Server...'
                : 'Copying Server...'
              : transferMode === 'move'
                ? 'Move & Import Server'
                : 'Copy & Import Server'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="field">
          <label htmlFor="imp-path">Existing Server Folder</label>
          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
            <input
              id="imp-path"
              type="text"
              className="input mono"
              style={{ flex: '1 1 280px' }}
              placeholder="C:\Users\you\Desktop\MyMinecraftServer"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  void runInspect(sourcePath);
                }
              }}
            />
            <button type="button" className="btn" disabled={picking || inspecting} onClick={() => void handleBrowse()}>
              <FolderSearch size={15} aria-hidden="true" />
              {picking ? 'Opening...' : 'Browse'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!sourcePath.trim() || inspecting}
              onClick={() => void runInspect(sourcePath)}
            >
              <Search size={15} aria-hidden="true" />
              {inspecting ? 'Scanning...' : 'Scan'}
            </button>
          </div>
        </div>

        {inspectError && (
          <div className="banner banner-danger" role="alert">
            <span>{inspectError}</span>
          </div>
        )}

        {inspected && (
          <form id="import-server-form" onSubmit={(e) => void handleImport(e)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="banner">
              <ShieldCheck size={18} style={{ color: 'var(--accent-bright)', flexShrink: 0 }} aria-hidden="true" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '100%' }}>
                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="badge badge-accent">{inspected.software.toUpperCase()}</span>
                  <span className="badge badge-neutral mono">{inspected.mcVersion}</span>
                  <span className="badge badge-neutral">{inspected.worldCount} world(s)</span>
                  <span className="badge badge-neutral">{inspected.pluginOrModCount} plugin/mod JAR(s)</span>
                  <span className="badge badge-neutral">{formatBytes(inspected.sizeBytes)}</span>
                </div>
                {inspected.isSpigotCompatible && (
                  <span style={{ fontSize: '0.84rem', color: 'var(--accent-bright)' }}>
                    Spigot-compatible server detected — MCServerManagerBridge will be installed automatically.
                  </span>
                )}
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label htmlFor="imp-mode">Transfer Mode</label>
                <select
                  id="imp-mode"
                  className="select"
                  value={transferMode}
                  onChange={(e) => setTransferMode(e.target.value as 'move' | 'copy')}
                >
                  <option value="copy">Copy folder (keep original)</option>
                  <option value="move">Move folder into MCServerManager</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="imp-name">Server Name</label>
                <input
                  id="imp-name"
                  type="text"
                  className="input"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="imp-software">Platform</label>
                <select
                  id="imp-software"
                  className="select"
                  value={software}
                  onChange={(e) => {
                    const next = e.target.value as ServerSoftware;
                    setSoftware(next);
                    setInstallBridge(next !== 'vanilla');
                  }}
                >
                  {SOFTWARE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="imp-version">Minecraft Version</label>
                <input
                  id="imp-version"
                  type="text"
                  className="input mono"
                  required
                  value={mcVersion}
                  onChange={(e) => setMcVersion(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="imp-jar">Server JAR</label>
                {inspected.jarCandidates.length > 1 ? (
                  <select
                    id="imp-jar"
                    className="select mono"
                    value={jarFile}
                    onChange={(e) => setJarFile(e.target.value)}
                  >
                    {inspected.jarCandidates.map((j) => (
                      <option key={j} value={j}>
                        {j}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="imp-jar"
                    type="text"
                    className="input mono"
                    required
                    value={jarFile}
                    onChange={(e) => setJarFile(e.target.value)}
                  />
                )}
              </div>
              <div className="field">
                <label htmlFor="imp-port">Port</label>
                <input
                  id="imp-port"
                  type="number"
                  min={1024}
                  max={65535}
                  className="input mono"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label htmlFor="imp-minram">Min RAM (MB)</label>
                <input
                  id="imp-minram"
                  type="number"
                  step={256}
                  min={256}
                  className="input mono"
                  value={minRamMb}
                  onChange={(e) => setMinRamMb(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label htmlFor="imp-maxram">Max RAM (MB)</label>
                <input
                  id="imp-maxram"
                  type="number"
                  step={512}
                  min={512}
                  className="input mono"
                  value={maxRamMb}
                  onChange={(e) => setMaxRamMb(Number(e.target.value))}
                />
              </div>
              <div className="field">
                <label htmlFor="imp-java">Java Runtime</label>
                <select id="imp-java" className="select" value={javaPath} onChange={(e) => setJavaPath(e.target.value)}>
                  <option value="auto">Auto-select</option>
                  {runtimes.map((r) => (
                    <option key={r.id} value={r.path}>
                      Java {r.major} ({r.version})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="imp-preset">JVM Flags</label>
                <select id="imp-preset" className="select" value={jvmPreset} onChange={(e) => setJvmPreset(e.target.value as JvmPreset)}>
                  <option value="aikar">Aikar&apos;s Flags</option>
                  <option value="g1gc">G1GC</option>
                  <option value="zgc">Generational ZGC</option>
                  <option value="custom">None / Custom</option>
                </select>
              </div>
            </div>

            {supportsBridge && (
              <Switch
                checked={installBridge}
                onChange={setInstallBridge}
                label={
                  software === 'velocity'
                    ? 'Install MCServerManagerBridge-Velocity plugin (live proxy players, server transfer & broadcasts)'
                    : ['fabric', 'forge', 'neoforge'].includes(software)
                      ? `Install MCServerManagerBridge-${software} mod (live gamerules, world controls & online players)`
                      : 'Install MCServerManagerBridge plugin (live gamerules, world controls, Realms & TPS)'
                }
              />
            )}
          </form>
        )}
      </div>
    </ModalDialog>
  );
}
