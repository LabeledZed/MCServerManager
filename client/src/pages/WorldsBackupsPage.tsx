import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Database,
  Download,
  FolderTree,
  Globe,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, formatBytes } from '../api/client';
import { ConfirmDialog, ModalDialog } from '../components/ModalDialog';
import type { BackupInfo, ServerSummary, WorldDimensionEntry, WorldInfo, WorldLayoutFormat } from '../../../shared/types';

interface WorldsBackupsPageProps {
  server: ServerSummary;
  onOpenConfigFile: (relPath: string) => void;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

interface DeleteTarget {
  worldName: string;
  subPath?: string;
  label: string;
  isDimension: boolean;
}

type WorldUploadMode = 'replace-existing' | 'add-new' | 'replace-root';

interface ExistingWorldOption {
  key: string;
  worldName: string;
  subPath?: string;
  label: string;
  savePath: string;
}

const DEFAULT_26_1_DIMENSIONS: Array<{
  id: string;
  label: string;
  dimension: 'overworld' | 'nether' | 'end';
  subPath: string;
  legacyPathHint: string;
}> = [
  {
    id: 'minecraft:overworld',
    label: 'Overworld',
    dimension: 'overworld',
    subPath: 'dimensions/minecraft/overworld',
    legacyPathHint: 'Moved from root world directory (region, entities, poi, data) in 26.1',
  },
  {
    id: 'minecraft:the_nether',
    label: 'The Nether',
    dimension: 'nether',
    subPath: 'dimensions/minecraft/the_nether',
    legacyPathHint: 'Unified from world_nether (pre-26.1 Bukkit/Paper) & DIM-1 (Vanilla/Singleplayer)',
  },
  {
    id: 'minecraft:the_end',
    label: 'The End',
    dimension: 'end',
    subPath: 'dimensions/minecraft/the_end',
    legacyPathHint: 'Unified from world_the_end (pre-26.1 Bukkit/Paper) & DIM1 (Vanilla/Singleplayer)',
  },
];

function formatLayoutBadge(format?: WorldLayoutFormat): string {
  if (format === 'legacy-bukkit') return 'PRE-26.1 BUKKIT / PAPER SPLIT';
  if (format === 'legacy-vanilla') return 'PRE-26.1 VANILLA / SINGLEPLAYER';
  return '26.1+ UNIFIED DIMENSIONS';
}

export function WorldsBackupsPage({ server, onOpenConfigFile, onNotify }: WorldsBackupsPageProps) {
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [backupLabel, setBackupLabel] = useState('Pre-Update Snapshot');
  const [backupScope, setBackupScope] = useState<'full' | 'worlds'>('full');
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);
  const [deleteBackupTarget, setDeleteBackupTarget] = useState<BackupInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // Upload / Import World Popup Modal State
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadingWorld, setUploadingWorld] = useState(false);
  const [uploadMode, setUploadMode] = useState<WorldUploadMode>('replace-existing');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [selectedExistingKey, setSelectedExistingKey] = useState<string>('');
  const [newWorldName, setNewWorldName] = useState<string>('world_2');
  const [newWorldEnv, setNewWorldEnv] = useState<'NORMAL' | 'NETHER' | 'THE_END'>('NORMAL');
  const [rootContainerName, setRootContainerName] = useState<string>('world');
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const isVelocity = server.software === 'velocity';
  const is26Server = !isVelocity && /^(?:2[6-9]|[3-9]\d)(?:\.|w|-)/i.test((server.mcVersion || '').trim());

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [wRes, bRes] = await Promise.all([
        isVelocity ? Promise.resolve({ worlds: [] as WorldInfo[] }) : api.listWorlds(server.id),
        api.listBackups(server.id),
      ]);
      setWorlds(wRes.worlds);
      setBackups(bRes.backups);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to load worlds/backups');
    } finally {
      setLoading(false);
    }
  }, [server.id, isVelocity, onNotify]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const getWorldDimensions = useCallback((w: WorldInfo): WorldDimensionEntry[] => {
    if (w.dimensions && w.dimensions.length > 0) return w.dimensions;
    return DEFAULT_26_1_DIMENSIONS.map((d) => ({
      ...d,
      relativePath: `${w.name}/${d.subPath}`,
      exists: false,
      sizeBytes: 0,
      hasRegion: false,
      hasEntities: false,
      hasPoi: false,
      hasData: false,
    }));
  }, []);

  // Build list of existing worlds/dimensions that can be individually replaced
  const existingWorldOptions = useMemo<ExistingWorldOption[]>(() => {
    const opts: ExistingWorldOption[] = [];
    if (worlds.length === 0) {
      if (is26Server) {
        for (const d of DEFAULT_26_1_DIMENSIONS) {
          opts.push({
            key: `world::${d.subPath}`,
            worldName: 'world',
            subPath: d.subPath,
            label: `${d.label} (${d.id})`,
            savePath: `world/${d.subPath}`,
          });
        }
      } else {
        opts.push({
          key: 'world::',
          worldName: 'world',
          subPath: undefined,
          label: 'world',
          savePath: 'world/',
        });
      }
      return opts;
    }

    for (const w of worlds) {
      const is26 = (w.layoutFormat ?? (is26Server ? '26.1+' : 'legacy-bukkit')) === '26.1+';
      if (is26) {
        const dims = getWorldDimensions(w);
        for (const dim of dims) {
          opts.push({
            key: `${w.name}::${dim.subPath}`,
            worldName: w.name,
            subPath: dim.subPath,
            label: `${dim.label} (${dim.id})`,
            savePath: `${w.name}/${dim.subPath}`,
          });
        }
        opts.push({
          key: `${w.name}::data`,
          worldName: w.name,
          subPath: 'data',
          label: `Shared Data (${w.name}/data)`,
          savePath: `${w.name}/data`,
        });
      } else {
        opts.push({
          key: `${w.name}::`,
          worldName: w.name,
          subPath: undefined,
          label: `${w.name} (${w.dimension})`,
          savePath: `${w.name}/`,
        });
        for (const dim of w.dimensions || []) {
          if (dim.subPath && dim.subPath !== '.') {
            opts.push({
              key: `${w.name}::${dim.subPath}`,
              worldName: w.name,
              subPath: dim.subPath,
              label: `${dim.label} (${w.name}/${dim.subPath})`,
              savePath: `${w.name}/${dim.subPath}`,
            });
          }
        }
      }
    }
    return opts;
  }, [worlds, is26Server, getWorldDimensions]);

  const openUploadModal = (preset?: {
    mode?: WorldUploadMode;
    worldName?: string;
    subPath?: string;
  }) => {
    setUploadFile(null);
    if (uploadInputRef.current) {
      uploadInputRef.current.value = '';
    }
    const container = preset?.worldName || worlds[0]?.name || 'world';
    setRootContainerName(container);

    if (preset?.mode) {
      setUploadMode(preset.mode);
    } else if (preset?.subPath) {
      setUploadMode('replace-existing');
    } else {
      setUploadMode('replace-existing');
    }

    if (preset?.worldName && preset?.subPath) {
      const matchKey = `${preset.worldName}::${preset.subPath}`;
      setSelectedExistingKey(matchKey);
    } else if (existingWorldOptions.length > 0) {
      setSelectedExistingKey(existingWorldOptions[0].key);
    }

    setNewWorldName('world_2');
    setNewWorldEnv('NORMAL');
    setUploadModalOpen(true);
  };

  const handleFileChosenInModal = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setUploadFile(file);
    if (file) {
      const stem = file.name
        .replace(/\.zip$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
      if (stem && stem !== 'world' && stem !== 'overworld') {
        setNewWorldName(stem);
      }
    }
  };

  const handleConfirmUploadModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      onNotify('error', 'Please select a world .zip file to upload.');
      return;
    }

    setUploadingWorld(true);
    try {
      if (uploadMode === 'replace-existing') {
        const chosen =
          existingWorldOptions.find((o) => o.key === selectedExistingKey) || existingWorldOptions[0];
        if (!chosen) {
          throw new Error('No target world selected');
        }
        await api.uploadWorld(server.id, chosen.worldName, uploadFile, chosen.subPath);
        onNotify(
          'success',
          `Replaced "${chosen.label}" (${chosen.savePath}) from ${uploadFile.name} while keeping all other worlds intact.`,
        );
      } else if (uploadMode === 'add-new') {
        const cleanName = newWorldName.trim().replace(/^minecraft:/i, '').toLowerCase();
        if (!/^[a-z0-9_-]{1,64}$/.test(cleanName)) {
          throw new Error('New world name must use lowercase letters, numbers, underscores, or hyphens.');
        }
        const container = worlds[0]?.name || 'world';
        if (is26Server) {
          const subPath = `dimensions/minecraft/${cleanName}`;
          await api.uploadWorld(server.id, container, uploadFile, subPath, {
            registerRealmWorld: cleanName,
            environment: newWorldEnv,
          });
          onNotify(
            'success',
            `Added new world "minecraft:${cleanName}" at ${container}/${subPath} from ${uploadFile.name}.`,
          );
        } else {
          await api.uploadWorld(server.id, cleanName, uploadFile, undefined, {
            registerRealmWorld: cleanName,
            environment: newWorldEnv,
          });
          onNotify('success', `Added new world "${cleanName}" from ${uploadFile.name}.`);
        }
      } else {
        // replace-root: replaces entire root world container folder
        const targetRoot = rootContainerName.trim() || 'world';
        await api.uploadWorld(server.id, targetRoot, uploadFile, undefined);
        onNotify('success', `Replaced root world folder "${targetRoot}/" from ${uploadFile.name}.`);
      }

      setUploadModalOpen(false);
      setUploadFile(null);
      await loadAll();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'World upload failed');
    } finally {
      setUploadingWorld(false);
    }
  };

  const handleCreateBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingBackup(true);
    try {
      const b = await api.createBackup(server.id, backupLabel.trim() || 'Manual Backup', backupScope);
      onNotify('success', `Backup created: ${b.fileName} (${formatBytes(b.sizeBytes)})`);
      setBackupModalOpen(false);
      await loadAll();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    try {
      await api.restoreBackup(server.id, restoreTarget.id);
      onNotify('success', `Restored backup "${restoreTarget.label}"`);
      setRestoreTarget(null);
      await loadAll();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Restore failed');
    }
  };

  const handleDeleteBackup = async () => {
    if (!deleteBackupTarget) return;
    try {
      await api.deleteBackup(server.id, deleteBackupTarget.id);
      onNotify('info', `Deleted backup ${deleteBackupTarget.fileName}`);
      setDeleteBackupTarget(null);
      await loadAll();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleDeleteTarget = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteWorld(server.id, deleteTarget.worldName, deleteTarget.subPath);
      onNotify(
        'warn',
        deleteTarget.isDimension
          ? `Reset "${deleteTarget.label}". Minecraft will regenerate it on next start.`
          : `Deleted world "${deleteTarget.worldName}". It will regenerate on next start.`,
      );
      setDeleteTarget(null);
      await loadAll();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Worlds Card (hidden on proxy-only servers like Velocity) */}
      {!isVelocity && (
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="card-header" style={{ marginBottom: 0 }}>
          <h2 className="card-title">
            <Globe size={18} aria-hidden="true" />
            Worlds ({worlds.length})
          </h2>
          <div style={{ display: 'flex', gap: '0.45rem' }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => openUploadModal({ mode: 'replace-existing' })}
            >
              <Upload size={14} aria-hidden="true" />
              Import / Upload World .zip
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadAll()}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* World Save Structure Reference (26.1+ Unified vs Pre-26.1 Bukkit/Paper & Vanilla) */}
        <div
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-surface-subtle)',
            padding: '0.85rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.55rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <FolderTree size={15} style={{ color: 'var(--accent-primary)' }} aria-hidden="true" />
            <strong style={{ fontSize: '0.88rem' }}>World Save Layouts (Minecraft 26.1+ vs Pre-26.1)</strong>
          </div>
          <div
            className="grid-2"
            style={{
              gap: '0.45rem 1rem',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
            }}
          >
            <div>
              <strong>26.1+ Unified (Vanilla, Paper, Spigot, Bukkit):</strong>{' '}
              The root <code className="mono">world/</code> folder is a container that holds all worlds under{' '}
              <code className="mono">world/dimensions/</code> —{' '}
              <code className="mono">dimensions/minecraft/overworld</code>,{' '}
              <code className="mono">dimensions/minecraft/the_nether</code>,{' '}
              <code className="mono">dimensions/minecraft/the_end</code>, and additional worlds under{' '}
              <code className="mono">dimensions/minecraft/&lt;name&gt;</code>.
            </div>
            <div>
              <strong>26.1+ Shared Data:</strong>{' '}
              Top-level <code className="mono">&lt;world&gt;/data/</code> is reserved for data shared across dimensions, while dimension-specific{' '}
              <code className="mono">region</code>, <code className="mono">entities</code>, <code className="mono">poi</code>, and{' '}
              <code className="mono">data</code> live inside each world&apos;s dimension folder.
            </div>
            <div>
              <strong>Pre-26.1 Bukkit / Spigot / Paper:</strong>{' '}
              Split Nether and The End into separate top-level folders (<code className="mono">world_nether</code> and{' '}
              <code className="mono">world_the_end</code>).
            </div>
            <div>
              <strong>Pre-26.1 Vanilla / Singleplayer / Modded:</strong>{' '}
              Stored Overworld in the root <code className="mono">world/</code> directory and Nether/End in{' '}
              <code className="mono">DIM-1</code> and <code className="mono">DIM1</code>.
            </div>
          </div>
        </div>

        {worlds.length === 0 ? (
          <div className="empty-state" style={{ padding: '1.6rem' }}>
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
              No worlds found. Start the server or import a world <code>.zip</code>.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {worlds.map((w) => {
              const dims = getWorldDimensions(w);
              const shared = w.sharedData ?? {
                subPath: 'data',
                relativePath: `${w.name}/data`,
                exists: false,
                sizeBytes: 0,
                fileCount: 0,
              };
              const is26Layout = (w.layoutFormat ?? (is26Server ? '26.1+' : 'legacy-bukkit')) === '26.1+';

              return (
                <article
                  key={w.name}
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface-subtle)',
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.85rem',
                  }}
                >
                  {/* World Header & Full-World Controls */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                      <strong className="mono" style={{ fontSize: '1.02rem' }}>
                        {w.name}/
                      </strong>
                      {!is26Layout && <span className="badge badge-accent">{w.dimension.toUpperCase()}</span>}
                      <span className="badge badge-neutral mono">{formatLayoutBadge(w.layoutFormat)}</span>
                      <span className="field-hint">
                        Total Size: <span className="mono">{formatBytes(w.sizeBytes)}</span>
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <a
                        className="btn btn-sm"
                        href={`/api/servers/${encodeURIComponent(server.id)}/worlds/${encodeURIComponent(w.name)}/download`}
                        download
                      >
                        <Download size={13} aria-hidden="true" />
                        Download All
                      </a>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          openUploadModal({
                            mode: 'replace-existing',
                            worldName: w.name,
                          })
                        }
                      >
                        <Upload size={13} aria-hidden="true" />
                        Upload / Replace...
                      </button>
                      {w.hasPaperWorldConfig && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => onOpenConfigFile(`${w.name}/paper-world.yml`)}
                        >
                          <Settings2 size={13} aria-hidden="true" />
                          paper-world.yml
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Regenerate or delete ${w.name}`}
                        onClick={() =>
                          setDeleteTarget({
                            worldName: w.name,
                            label: w.name,
                            isDimension: false,
                          })
                        }
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Per-Dimension & Shared Data Breakdown */}
                  <div className="table-wrapper">
                    <table className="data-table responsive-stack" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>World / Dimension</th>
                          <th>Save Path</th>
                          <th>Contents</th>
                          <th>Size</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dims.map((dim) => {
                          const isRootSub = dim.subPath === '.';
                          const displayPath = isRootSub ? `${w.name}/ (root)` : `${w.name}/${dim.subPath}`;
                          const folders = [
                            { name: 'region', present: dim.hasRegion },
                            { name: 'entities', present: dim.hasEntities },
                            { name: 'poi', present: dim.hasPoi },
                            { name: 'data', present: dim.hasData },
                          ];
                          return (
                            <tr key={dim.subPath}>
                              <td data-label="World / Dimension">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                  <Layers size={14} style={{ color: 'var(--accent-primary)' }} aria-hidden="true" />
                                  <strong>{dim.label}</strong>
                                  <span className="badge badge-neutral mono">{dim.id}</span>
                                </div>
                                {dim.legacyPathHint && (
                                  <div className="field-hint" style={{ marginTop: '0.15rem' }}>
                                    {dim.legacyPathHint}
                                  </div>
                                )}
                              </td>
                              <td data-label="Save Path">
                                <code className="mono" style={{ fontSize: '0.82rem' }}>
                                  {displayPath}
                                </code>
                              </td>
                              <td data-label="Contents">
                                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                                  {folders.map((f) => (
                                    <span
                                      key={f.name}
                                      className={`badge ${f.present ? 'badge-accent' : 'badge-neutral'} mono`}
                                      style={{ opacity: f.present ? 1 : 0.45 }}
                                      title={
                                        f.present
                                          ? `${displayPath}/${f.name} present`
                                          : `${displayPath}/${f.name} not generated yet`
                                      }
                                    >
                                      {f.name}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td data-label="Size" className="mono">
                                {dim.exists ? (
                                  formatBytes(dim.sizeBytes)
                                ) : (
                                  <span className="field-hint">Not generated</span>
                                )}
                              </td>
                              <td data-label="Actions">
                                {isRootSub ? (
                                  <span className="field-hint">Managed via top-level world actions</span>
                                ) : (
                                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                    {dim.exists && (
                                      <a
                                        className="btn btn-sm"
                                        href={`/api/servers/${encodeURIComponent(server.id)}/worlds/${encodeURIComponent(w.name)}/download?subPath=${encodeURIComponent(dim.subPath)}`}
                                        download
                                        title={`Download ${w.name}/${dim.subPath} as .zip`}
                                      >
                                        <Download size={13} aria-hidden="true" />
                                      </a>
                                    )}
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      title={`Replace ${w.name}/${dim.subPath} from .zip`}
                                      onClick={() =>
                                        openUploadModal({
                                          mode: 'replace-existing',
                                          worldName: w.name,
                                          subPath: dim.subPath,
                                        })
                                      }
                                    >
                                      <Upload size={13} aria-hidden="true" />
                                      Replace
                                    </button>
                                    {dim.hasPaperWorldConfig && (
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => onOpenConfigFile(`${w.name}/${dim.subPath}/paper-world.yml`)}
                                      >
                                        <Settings2 size={13} aria-hidden="true" />
                                        paper-world.yml
                                      </button>
                                    )}
                                    {dim.exists && (
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        aria-label={`Reset ${dim.label} (${w.name}/${dim.subPath})`}
                                        title={`Reset ${dim.label} (${w.name}/${dim.subPath})`}
                                        onClick={() =>
                                          setDeleteTarget({
                                            worldName: w.name,
                                            subPath: dim.subPath,
                                            label: `${dim.label} (${w.name}/${dim.subPath})`,
                                            isDimension: true,
                                          })
                                        }
                                      >
                                        <Trash2 size={13} aria-hidden="true" />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}

                        {/* Top-Level Shared Data Row (26.1+ cross-dimension data folder) */}
                        {is26Layout && (
                          <tr>
                            <td data-label="Layer">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                <Database size={14} style={{ color: 'var(--accent-primary)' }} aria-hidden="true" />
                                <strong>Shared Data</strong>
                                <span className="badge badge-neutral">CROSS-DIMENSION</span>
                              </div>
                              <div className="field-hint" style={{ marginTop: '0.15rem' }}>
                                Top-level data folder reserved for data shared across dimensions
                              </div>
                            </td>
                            <td data-label="Save Path">
                              <code className="mono" style={{ fontSize: '0.82rem' }}>
                                {w.name}/data/
                              </code>
                            </td>
                            <td data-label="Contents">
                              <span className="field-hint">
                                {shared.exists
                                  ? `${shared.fileCount} shared data file${shared.fileCount === 1 ? '' : 's'}`
                                  : 'No shared data files yet'}
                              </span>
                            </td>
                            <td data-label="Size" className="mono">
                              {shared.exists ? formatBytes(shared.sizeBytes) : <span className="field-hint">0 B</span>}
                            </td>
                            <td data-label="Actions">
                              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                {shared.exists && (
                                  <a
                                    className="btn btn-sm"
                                    href={`/api/servers/${encodeURIComponent(server.id)}/worlds/${encodeURIComponent(w.name)}/download?subPath=data`}
                                    download
                                    title={`Download ${w.name}/data as .zip`}
                                  >
                                    <Download size={13} aria-hidden="true" />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  title={`Replace ${w.name}/data from .zip`}
                                  onClick={() =>
                                    openUploadModal({
                                      mode: 'replace-existing',
                                      worldName: w.name,
                                      subPath: 'data',
                                    })
                                  }
                                >
                                  <Upload size={13} aria-hidden="true" />
                                  Replace
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* Backups Card */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Archive size={18} aria-hidden="true" />
            Backups ({backups.length})
          </h2>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setBackupModalOpen(true)}>
            <Plus size={15} aria-hidden="true" />
            Create Backup
          </button>
        </div>

        <div tabIndex={0} role="region" aria-labelledby="backups-cap" className="table-wrapper">
          <table className="data-table responsive-stack">
            <caption id="backups-cap">Saved ZIP backups for {server.name}</caption>
            <thead>
              <tr>
                <th>Label &amp; Archive</th>
                <th>Scope</th>
                <th>Size</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {backups.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                    No backups created yet.
                  </td>
                </tr>
              ) : (
                backups.map((b) => (
                  <tr key={b.id}>
                    <td data-label="Backup">
                      <div style={{ fontWeight: 600 }}>{b.label}</div>
                      <div className="mono field-hint">{b.fileName}</div>
                    </td>
                    <td data-label="Scope">
                      <span className="badge badge-accent">{b.scope === 'worlds' ? 'Worlds Only' : 'Full Server'}</span>
                    </td>
                    <td data-label="Size" className="mono">
                      {formatBytes(b.sizeBytes)}
                    </td>
                    <td data-label="Created" style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                      {new Date(b.createdAt).toLocaleString()}
                    </td>
                    <td data-label="Actions">
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setRestoreTarget(b)}
                        >
                          <RotateCcw size={13} aria-hidden="true" />
                          Restore
                        </button>
                        <a
                          className="btn btn-sm"
                          href={`/api/servers/${encodeURIComponent(server.id)}/backups/${encodeURIComponent(b.id)}/download`}
                          download
                        >
                          <Download size={13} aria-hidden="true" />
                        </a>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-label={`Delete backup ${b.label}`}
                          onClick={() => setDeleteBackupTarget(b)}
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
      </section>

      {/* ==================== MODAL: UPLOAD / IMPORT WORLD (.ZIP) ==================== */}
      <ModalDialog
        open={uploadModalOpen}
        onClose={() => !uploadingWorld && setUploadModalOpen(false)}
        title="Upload / Import World (.zip)"
        footer={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setUploadModalOpen(false)}
              disabled={uploadingWorld}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="upload-world-form"
              className="btn btn-primary"
              disabled={uploadingWorld || !uploadFile}
            >
              <Upload size={14} aria-hidden="true" />
              {uploadingWorld ? 'Uploading...' : 'Upload & Apply'}
            </button>
          </>
        }
      >
        <form
          id="upload-world-form"
          onSubmit={(e) => void handleConfirmUploadModal(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.95rem' }}
        >
          <div className="field">
            <label>How do you want to import this world archive?</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.6rem',
                  padding: '0.7rem 0.85rem',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${uploadMode === 'replace-existing' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                  background: uploadMode === 'replace-existing' ? 'var(--bg-surface-subtle)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="uploadMode"
                  checked={uploadMode === 'replace-existing'}
                  onChange={() => setUploadMode('replace-existing')}
                  style={{ marginTop: '0.2rem' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  <strong>Replace one of the existing worlds</strong>
                  <span className="field-hint">
                    Replaces only the selected world (e.g. <code>minecraft:overworld</code>,{' '}
                    <code>minecraft:the_nether</code>, or a custom world in <code>dimensions/</code>) while keeping all
                    other worlds intact.
                  </span>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.6rem',
                  padding: '0.7rem 0.85rem',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${uploadMode === 'add-new' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                  background: uploadMode === 'add-new' ? 'var(--bg-surface-subtle)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="uploadMode"
                  checked={uploadMode === 'add-new'}
                  onChange={() => setUploadMode('add-new')}
                  style={{ marginTop: '0.2rem' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  <strong>Add as a new world to existing worlds</strong>
                  <span className="field-hint">
                    Adds this world alongside your existing worlds (under{' '}
                    <code>{is26Server ? 'world/dimensions/minecraft/<name>' : '<name>/'}</code>) without deleting any
                    existing worlds.
                  </span>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.6rem',
                  padding: '0.7rem 0.85rem',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${uploadMode === 'replace-root' ? 'var(--status-warn)' : 'var(--border-subtle)'}`,
                  background: uploadMode === 'replace-root' ? 'var(--bg-surface-subtle)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="uploadMode"
                  checked={uploadMode === 'replace-root'}
                  onChange={() => setUploadMode('replace-root')}
                  style={{ marginTop: '0.2rem' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                  <strong>Upload a new root world container (replaces entire root world folder)</strong>
                  <span className="field-hint">
                    Deletes the entire root <code>{rootContainerName}/</code> folder (and all worlds inside it) and
                    extracts the archive directly into <code>{rootContainerName}/</code>.
                  </span>
                </div>
              </label>
            </div>
          </div>

          {uploadMode === 'replace-existing' && (
            <div className="field">
              <label htmlFor="uw-existing-target">Target World to Replace</label>
              <select
                id="uw-existing-target"
                className="select mono"
                value={selectedExistingKey}
                onChange={(e) => setSelectedExistingKey(e.target.value)}
              >
                {existingWorldOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label} — {opt.savePath}
                  </option>
                ))}
              </select>
            </div>
          )}

          {uploadMode === 'add-new' && (
            <div className="grid-2">
              <div className="field">
                <label htmlFor="uw-new-name">New World Name</label>
                <input
                  id="uw-new-name"
                  type="text"
                  required
                  className="input mono"
                  placeholder="world_2"
                  value={newWorldName}
                  onChange={(e) => setNewWorldName(e.target.value)}
                />
                <span className="field-hint">
                  Target path:{' '}
                  <code className="mono">
                    {is26Server
                      ? `${worlds[0]?.name || 'world'}/dimensions/minecraft/${newWorldName.trim().replace(/^minecraft:/i, '').toLowerCase() || 'world_2'}`
                      : `${newWorldName.trim() || 'world_2'}/`}
                  </code>
                </span>
              </div>
              <div className="field">
                <label htmlFor="uw-new-env">Dimension Environment</label>
                <select
                  id="uw-new-env"
                  className="select"
                  value={newWorldEnv}
                  onChange={(e) => setNewWorldEnv(e.target.value as 'NORMAL' | 'NETHER' | 'THE_END')}
                >
                  <option value="NORMAL">Overworld (NORMAL)</option>
                  <option value="NETHER">Nether (NETHER)</option>
                  <option value="THE_END">The End (THE_END)</option>
                </select>
              </div>
            </div>
          )}

          {uploadMode === 'replace-root' && (
            <div className="banner banner-warn" style={{ fontSize: '0.84rem' }}>
              <span>
                <strong>Warning:</strong> This will wipe the entire root <code>{rootContainerName}/</code> folder
                (including all worlds inside <code>{rootContainerName}/dimensions/</code>) and extract the archive into{' '}
                <code>{rootContainerName}/</code>. Use this only when uploading a full root level save.
              </span>
            </div>
          )}

          <div className="field">
            <label htmlFor="uw-file">World Archive (.zip)</label>
            <input
              ref={uploadInputRef}
              id="uw-file"
              type="file"
              accept=".zip"
              required
              className="input"
              onChange={handleFileChosenInModal}
            />
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        open={backupModalOpen}
        onClose={() => setBackupModalOpen(false)}
        title="Create Server Backup"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setBackupModalOpen(false)} disabled={creatingBackup}>
              Cancel
            </button>
            <button type="submit" form="create-backup-form" className="btn btn-primary" disabled={creatingBackup}>
              {creatingBackup ? 'Archiving...' : 'Create Backup'}
            </button>
          </>
        }
      >
        <form id="create-backup-form" onSubmit={(e) => void handleCreateBackup(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div className="field">
            <label htmlFor="bk-label">Backup Label</label>
            <input
              id="bk-label"
              type="text"
              className="input"
              required
              autoFocus
              value={backupLabel}
              onChange={(e) => setBackupLabel(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="bk-scope">Backup Scope</label>
            <select
              id="bk-scope"
              className="select"
              value={backupScope}
              onChange={(e) => setBackupScope(e.target.value as 'full' | 'worlds')}
            >
              <option value="full">
                {isVelocity ? 'Full Proxy (velocity.toml, forwarding.secret, Plugins)' : 'Full Server (Configs, Plugins/Mods, Worlds)'}
              </option>
              {!isVelocity && (
                <option value="worlds">
                  Worlds Only (All world folders, dimensions/minecraft/* &amp; shared data/)
                </option>
              )}
            </select>
          </div>
        </form>
      </ModalDialog>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        onConfirm={handleRestore}
        title={`Restore "${restoreTarget?.label}"?`}
        message="This overwrites server files with the contents of this backup archive. Make sure the server is stopped first."
        confirmLabel="Restore Backup"
        danger
      />

      <ConfirmDialog
        open={Boolean(deleteBackupTarget)}
        onClose={() => setDeleteBackupTarget(null)}
        onConfirm={handleDeleteBackup}
        title="Delete Backup?"
        message={`Permanently delete backup archive "${deleteBackupTarget?.fileName}"?`}
        confirmLabel="Delete"
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteTarget}
        title={
          deleteTarget?.isDimension
            ? `Reset Dimension "${deleteTarget.label}"?`
            : `Delete / Regenerate "${deleteTarget?.worldName}"?`
        }
        message={
          deleteTarget?.isDimension
            ? `This permanently deletes "${deleteTarget.label}" while keeping level.dat, other dimensions, and top-level shared data/ intact. Minecraft will regenerate this dimension on the next startup.`
            : 'This permanently deletes the entire world folder. Minecraft will generate a fresh world on the next startup. Consider creating a backup first.'
        }
        confirmLabel={deleteTarget?.isDimension ? 'Reset Dimension' : 'Delete World'}
      />
    </div>
  );
}
