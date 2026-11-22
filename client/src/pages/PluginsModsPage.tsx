import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  FilePlus2,
  Folder,
  FolderCog,
  FolderOpen,
  Package,
  Puzzle,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, formatBytes } from '../api/client';
import { Switch } from '../components/Switch';
import { VisualConfigEditor } from '../components/VisualConfigEditor';
import { ConfirmDialog, ModalDialog } from '../components/ModalDialog';
import type {
  AddonConfigFile,
  AddonKind,
  InstalledAddon,
  ModrinthSearchResult,
  ModrinthVersionInfo,
  OrphanConfigFolder,
  ServerSummary,
} from '../../../shared/types';

interface PluginsModsPageProps {
  server: ServerSummary;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

interface ActiveConfigTarget {
  title: string;
  subtitle: string;
  addonFileName?: string;
  configFolder: string | null;
  files: AddonConfigFile[];
}

export function PluginsModsPage({ server, onNotify }: PluginsModsPageProps) {
  const [activeTab, setActiveTab] = useState<'installed' | 'browse'>('installed');
  const [kind, setKind] = useState<AddonKind>('plugin');
  const [addonDir, setAddonDir] = useState('plugins');
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [orphans, setOrphans] = useState<OrphanConfigFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Integrated Plugin/Mod Config Studio state
  const [studioTarget, setStudioTarget] = useState<ActiveConfigTarget | null>(null);
  const [selectedConfigPath, setSelectedConfigPath] = useState<string | null>(null);
  const [newFileModalOpen, setNewFileModalOpen] = useState(false);
  const [newFileSubPath, setNewFileSubPath] = useState('custom.yml');
  const [folderOverrideModalOpen, setFolderOverrideModalOpen] = useState(false);
  const [folderOverrideValue, setFolderOverrideValue] = useState('');

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<InstalledAddon | null>(null);
  const [deleteWithConfigs, setDeleteWithConfigs] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const serverRunning =
    server.runtime.status === 'online' ||
    server.runtime.status === 'starting' ||
    server.runtime.status === 'stopping';

  // Modrinth Marketplace state
  const [searchQuery, setSearchQuery] = useState('');
  const [allVersions, setAllVersions] = useState(false);
  const [searchResults, setSearchResults] = useState<ModrinthSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [versionPickerProject, setVersionPickerProject] = useState<ModrinthSearchResult | null>(null);
  const [projectVersions, setProjectVersions] = useState<ModrinthVersionInfo[]>([]);
  const [loadingProjectVersions, setLoadingProjectVersions] = useState(false);
  const [installingVersionId, setInstallingVersionId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAddons = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listAddons(server.id);
      setKind(res.kind);
      setAddonDir(res.addonDir);
      setAddons(res.addons);
      setOrphans(res.orphanFolders);

      // Keep open Config Studio in sync when refreshed
      setStudioTarget((prev) => {
        if (!prev) return null;
        if (prev.addonFileName) {
          const fresh = res.addons.find((a) => a.fileName === prev.addonFileName);
          if (fresh) {
            return {
              title: fresh.manifest.name,
              subtitle: `Manifest: ${fresh.manifest.manifestSource} • Folder: ${fresh.configFolder || 'Not generated yet'}`,
              addonFileName: fresh.fileName,
              configFolder: fresh.configFolder,
              files: fresh.configFiles,
            };
          }
        } else if (prev.configFolder) {
          const freshOrphan = res.orphanFolders.find((o) => o.relativePath === prev.configFolder);
          if (freshOrphan) {
            return {
              title: freshOrphan.folderName,
              subtitle: `Config Folder: ${freshOrphan.relativePath}`,
              configFolder: freshOrphan.relativePath,
              files: freshOrphan.configFiles,
            };
          }
        }
        return prev;
      });
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to load plugins/mods');
    } finally {
      setLoading(false);
    }
  }, [server.id, onNotify]);

  useEffect(() => {
    setStudioTarget(null);
    setSelectedConfigPath(null);
    void loadAddons();
  }, [server.id, loadAddons]);

  // Auto-refresh list shortly after server stops so queued plugin deletions disappear automatically
  useEffect(() => {
    if (server.runtime.status === 'offline') {
      const t = window.setTimeout(() => void loadAddons(), 900);
      return () => window.clearTimeout(t);
    }
  }, [server.runtime.status, loadAddons]);

  const runModrinthSearch = useCallback(
    async (q: string, includeAll: boolean) => {
      setSearching(true);
      try {
        const res = await api.searchModrinth(server.id, q, includeAll);
        setSearchResults(res.hits);
      } catch (err) {
        onNotify('error', err instanceof Error ? err.message : 'Modrinth search failed');
      } finally {
        setSearching(false);
      }
    },
    [server.id, onNotify],
  );

  useEffect(() => {
    if (activeTab === 'browse' && searchResults.length === 0) {
      void runModrinthSearch('', allVersions);
    }
  }, [activeTab, allVersions, runModrinthSearch, searchResults.length]);

  const openAddonConfigStudio = (addon: InstalledAddon) => {
    setStudioTarget({
      title: addon.manifest.name,
      subtitle: `Manifest: ${addon.manifest.manifestSource} • Folder: ${addon.configFolder || `${addonDir}/${addon.manifest.name}`}`,
      addonFileName: addon.fileName,
      configFolder: addon.configFolder,
      files: addon.configFiles,
    });
    const firstEditable = addon.configFiles.find((f) => !f.isBinary) || addon.configFiles[0];
    setSelectedConfigPath(firstEditable ? firstEditable.relativePath : null);
  };

  const openOrphanConfigStudio = (orphan: OrphanConfigFolder) => {
    setStudioTarget({
      title: orphan.folderName,
      subtitle: `Config Folder: ${orphan.relativePath}`,
      configFolder: orphan.relativePath,
      files: orphan.configFiles,
    });
    const firstEditable = orphan.configFiles.find((f) => !f.isBinary) || orphan.configFiles[0];
    setSelectedConfigPath(firstEditable ? firstEditable.relativePath : null);
  };

  const handleUploadJar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await api.uploadAddon(server.id, file);
      onNotify('success', `Uploaded ${file.name}`);
      await loadAddons();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleToggleAddon = async (addon: InstalledAddon) => {
    try {
      await api.toggleAddon(server.id, addon.fileName);
      onNotify('info', `${addon.enabled ? 'Disabled' : 'Enabled'} ${addon.manifest.name}`);
      await loadAddons();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to toggle addon');
    }
  };

  const handleDeleteAddon = async () => {
    if (!deleteTarget || deleting) return;
    const target = deleteTarget;
    const withConfigs = deleteWithConfigs;
    setDeleting(true);
    try {
      const res = await api.deleteAddon(server.id, target.fileName, withConfigs, target.configFolder);
      setDeleteTarget(null);
      setDeleteWithConfigs(false);
      onNotify(
        res.queued ? 'warn' : 'success',
        res.message || `Removed ${target.manifest.name}`,
      );
      await loadAddons();
    } catch (err) {
      setDeleteTarget(null);
      setDeleteWithConfigs(false);
      onNotify('error', err instanceof Error ? err.message : 'Failed to delete plugin/mod');
    } finally {
      setDeleting(false);
    }
  };

  const handleCancelPendingDelete = async (addon: InstalledAddon) => {
    try {
      await api.cancelPendingAddonDelete(server.id, addon.fileName);
      onNotify('info', `Cancelled queued removal for ${addon.manifest.name}`);
      await loadAddons();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to cancel removal');
    }
  };

  const openVersionPicker = async (proj: ModrinthSearchResult) => {
    setVersionPickerProject(proj);
    setProjectVersions([]);
    setLoadingProjectVersions(true);
    try {
      const res = await api.listModrinthVersions(server.id, proj.projectId);
      setProjectVersions(res.versions);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Could not fetch versions');
    } finally {
      setLoadingProjectVersions(false);
    }
  };

  const handleInstallVersion = async (v: ModrinthVersionInfo) => {
    setInstallingVersionId(v.id);
    try {
      await api.installModrinth(server.id, v.downloadUrl, v.fileName);
      onNotify('success', `Installed ${v.fileName} into /${addonDir}/`);
      setVersionPickerProject(null);
      await loadAddons();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Install failed');
    } finally {
      setInstallingVersionId(null);
    }
  };

  const handleCreatePluginConfigFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studioTarget || !newFileSubPath.trim()) return;
    const baseFolder = studioTarget.configFolder || `${addonDir}/${studioTarget.title}`;
    const fullRel = `${baseFolder}/${newFileSubPath.trim().replace(/^\/+/, '')}`;
    try {
      await api.createConfigFile(server.id, fullRel);
      onNotify('success', `Created ${fullRel}`);
      setNewFileModalOpen(false);
      await loadAddons();
      setSelectedConfigPath(fullRel);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to create config file');
    }
  };

  const handleSaveFolderOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studioTarget?.addonFileName) return;
    try {
      await api.setAddonConfigFolder(server.id, studioTarget.addonFileName, folderOverrideValue.trim());
      onNotify('success', 'Updated plugin config folder mapping');
      setFolderOverrideModalOpen(false);
      await loadAddons();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to update mapping');
    }
  };

  // Group config files in Config Studio by Root Folder vs Nested Subfolders
  const groupedStudioFiles = useMemo(() => {
    if (!studioTarget) return [];
    const map = new Map<string, AddonConfigFile[]>();
    for (const f of studioTarget.files) {
      const grp = f.folder || '__root__';
      const arr = map.get(grp) || [];
      arr.push(f);
      map.set(grp, arr);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === '__root__') return -1;
      if (b === '__root__') return 1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({
      folderKey: k,
      label: k === '__root__' ? 'Plugin Root Folder' : k,
      files: map.get(k)!,
    }));
  }, [studioTarget]);

  const kindPlural = kind === 'mod' ? 'Mods' : 'Plugins';
  const kindSingular = kind === 'mod' ? 'Mod' : 'Plugin';

  // ---------- Integrated Plugin/Mod Config Studio View ----------
  if (studioTarget) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.85rem',
            flexWrap: 'wrap',
            padding: '0.85rem 1.15rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setStudioTarget(null);
                setSelectedConfigPath(null);
              }}
            >
              <ArrowLeft size={15} aria-hidden="true" />
              Back to {kindPlural}
            </button>
            <div>
              <h2 style={{ fontSize: '1.22rem' }}>{studioTarget.title} — Config Studio</h2>
              <div className="field-hint mono" style={{ fontSize: '0.78rem' }}>
                {studioTarget.subtitle}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {studioTarget.addonFileName && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  const rawFolder = studioTarget.configFolder?.replace(/^(plugins|config)\//, '') || studioTarget.title;
                  setFolderOverrideValue(rawFolder);
                  setFolderOverrideModalOpen(true);
                }}
              >
                <FolderCog size={14} aria-hidden="true" />
                Map Folder
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setNewFileSubPath('config.yml');
                setNewFileModalOpen(true);
              }}
            >
              <FilePlus2 size={14} aria-hidden="true" />
              New Config File
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadAddons()}>
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="studio-layout">
          <aside className="studio-sidebar" aria-label="Plugin configuration files">
            <div className="studio-sidebar-header">
              <strong style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem' }}>
                Config Files ({studioTarget.files.filter((f) => !f.isBinary).length})
              </strong>
              <span className="field-hint">Root and subfolder config files.</span>
            </div>

            <div className="studio-sidebar-list scroller">
              {groupedStudioFiles.length === 0 ? (
                <div style={{ padding: '1rem', fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
                  No configuration files detected yet. Start the server once so the {kindSingular.toLowerCase()} generates
                  its folder, map a custom folder name above, or create a new config file.
                </div>
              ) : (
                groupedStudioFiles.map((group) => (
                  <div key={group.folderKey}>
                    <div className="studio-group-label">
                      <FolderOpen size={13} aria-hidden="true" />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{group.label}</span>
                    </div>
                    {group.files.map((f) => (
                      <button
                        key={f.relativePath}
                        type="button"
                        disabled={f.isBinary}
                        className={`studio-file-btn ${selectedConfigPath === f.relativePath ? 'active' : ''} ${f.isBinary ? 'missing' : ''}`}
                        onClick={() => setSelectedConfigPath(f.relativePath)}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div className="mono" style={{ fontSize: '0.83rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {f.fileName}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {formatBytes(f.sizeBytes)}
                          </div>
                        </div>
                        <span className={`badge ${f.isBinary ? 'badge-neutral' : 'badge-accent'}`} style={{ fontSize: '0.68rem' }}>
                          {f.isBinary ? 'BIN' : f.format.toUpperCase()}
                        </span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </aside>

          <div>
            {selectedConfigPath ? (
              <VisualConfigEditor
                key={selectedConfigPath}
                serverId={server.id}
                relativePath={selectedConfigPath}
                onNotify={onNotify}
              />
            ) : (
              <div className="card">
                <div className="empty-state" style={{ border: 0 }}>
                  <Settings2 size={38} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
                  <h3>Select or create a configuration file</h3>
                  <p style={{ margin: 0, maxWidth: '480px', color: 'var(--text-secondary)' }}>
                    YAML, JSON, TOML, and Properties files open in the Beautified Visual Editor (with Raw Code toggle).
                    Other formats open directly in the Raw Code Editor.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <ModalDialog
          open={newFileModalOpen}
          onClose={() => setNewFileModalOpen(false)}
          title={`Create Config File in ${studioTarget.title}`}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setNewFileModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" form="new-plugin-cfg-form" className="btn btn-primary">
                Create File
              </button>
            </>
          }
        >
          <form id="new-plugin-cfg-form" onSubmit={(e) => void handleCreatePluginConfigFile(e)} className="field">
            <label htmlFor="new-cfg-subpath">File path (relative to plugin config folder)</label>
            <input
              id="new-cfg-subpath"
              type="text"
              className="input mono"
              required
              autoFocus
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="config.yml or locales/en_US.yml"
              value={newFileSubPath}
              onChange={(e) => setNewFileSubPath(e.target.value)}
            />
            <span className="field-hint">
              Nested paths like <code>menus/shop.yml</code> or <code>modules/combat.json</code> automatically create
              subfolders.
            </span>
          </form>
        </ModalDialog>

        <ModalDialog
          open={folderOverrideModalOpen}
          onClose={() => setFolderOverrideModalOpen(false)}
          title={`Map Config Folder for ${studioTarget.title}`}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setFolderOverrideModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" form="override-folder-form" className="btn btn-primary">
                Save Mapping
              </button>
            </>
          }
        >
          <form id="override-folder-form" onSubmit={(e) => void handleSaveFolderOverride(e)} className="field">
            <label htmlFor="override-folder-input">Config folder name inside /{addonDir === 'mods' ? 'config' : 'plugins'}/</label>
            <input
              id="override-folder-input"
              type="text"
              className="input mono"
              autoFocus
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Leave blank to auto-detect from manifest"
              value={folderOverrideValue}
              onChange={(e) => setFolderOverrideValue(e.target.value)}
            />
            <span className="field-hint">
              Override the auto-detected config folder name.
            </span>
          </form>
        </ModalDialog>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div className="tablist" role="tablist" aria-label="Plugins and mods tabs" style={{ borderBottom: 0 }}>
          <button
            type="button"
            role="tab"
            id="tab-installed-addons"
            className="tab-btn"
            aria-selected={activeTab === 'installed'}
            onClick={() => setActiveTab('installed')}
          >
            <Puzzle size={16} aria-hidden="true" />
            Installed {kindPlural} ({addons.length})
          </button>
          <button
            type="button"
            role="tab"
            id="tab-browse-addons"
            className="tab-btn"
            aria-selected={activeTab === 'browse'}
            onClick={() => setActiveTab('browse')}
          >
            <Download size={16} aria-hidden="true" />
            Browse Modrinth
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".jar"
            className="visually-hidden"
            aria-label={`Upload ${kindSingular} JAR`}
            onChange={(e) => void handleUploadJar(e)}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={15} aria-hidden="true" />
            {uploading ? 'Uploading...' : `Upload ${kindSingular} .jar`}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void loadAddons()}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {activeTab === 'installed' ? (
        <div role="tabpanel" aria-labelledby="tab-installed-addons" style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
          {addons.length === 0 ? (
            <div className="empty-state">
              <Package size={42} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
              <h3>No {kindPlural.toLowerCase()} installed in /{addonDir}/</h3>
              <p style={{ margin: 0, maxWidth: '460px', color: 'var(--text-secondary)' }}>
                Browse Modrinth or upload a <code>.jar</code> file.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                <button type="button" className="btn btn-primary" onClick={() => setActiveTab('browse')}>
                  <Download size={15} aria-hidden="true" />
                  Browse Modrinth
                </button>
                <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={15} aria-hidden="true" />
                  Upload .jar
                </button>
              </div>
            </div>
          ) : (
            <div tabIndex={0} role="region" aria-labelledby="addons-table-cap" className="table-wrapper">
              <table className="data-table responsive-stack">
                <caption id="addons-table-cap">
                  Installed {kindPlural} in /{addonDir}/
                </caption>
                <thead>
                  <tr>
                    <th>{kindSingular} &amp; Manifest</th>
                    <th>Version</th>
                    <th>Config Folder &amp; Files</th>
                    <th>Enabled</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {addons.map((addon) => {
                    const editableCount = addon.configFiles.filter((f) => !f.isBinary).length;
                    const subfolderCount = new Set(addon.configFiles.map((f) => f.folder).filter(Boolean)).size;
                    return (
                      <tr key={addon.fileName}>
                        <td data-label={kindSingular}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                              <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.02rem' }}>
                                {addon.manifest.name}
                              </strong>
                              <span className="badge badge-neutral mono" style={{ fontSize: '0.7rem' }}>
                                {addon.manifest.manifestSource}
                              </span>
                              {addon.pendingDeletion && (
                                <span className="badge badge-warn" style={{ fontSize: '0.72rem' }}>
                                  Pending removal (on stop)
                                </span>
                              )}
                            </div>
                            <span className="mono" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                              {addon.fileName} ({formatBytes(addon.sizeBytes)})
                            </span>
                            {addon.manifest.description && (
                              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '420px' }}>
                                {addon.manifest.description}
                              </span>
                            )}
                          </div>
                        </td>
                        <td data-label="Version" className="mono">
                          {addon.manifest.version}
                        </td>
                        <td data-label="Configs">
                          {addon.configFolder ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                              <span className="mono" style={{ fontSize: '0.82rem', color: 'var(--accent-bright)' }}>
                                {addon.configFolder}
                              </span>
                              <span className="field-hint">
                                {editableCount} {editableCount === 1 ? 'file' : 'files'}
                                {subfolderCount > 0 ? ` (${subfolderCount} nested folder${subfolderCount > 1 ? 's' : ''})` : ''}
                              </span>
                            </div>
                          ) : (
                            <span className="field-hint">No folder yet</span>
                          )}
                        </td>
                        <td data-label="Enabled">
                          <Switch
                            checked={addon.enabled}
                            onChange={() => void handleToggleAddon(addon)}
                            label={addon.enabled ? 'On' : 'Off'}
                          />
                        </td>
                        <td data-label="Actions">
                          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openAddonConfigStudio(addon)}
                            >
                              <Settings2 size={14} aria-hidden="true" />
                              Configure ({editableCount})
                            </button>
                            {addon.pendingDeletion ? (
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => void handleCancelPendingDelete(addon)}
                              >
                                Undo Delete
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                aria-label={`Delete ${addon.manifest.name}`}
                                onClick={() => {
                                  setDeleteTarget(addon);
                                  setDeleteWithConfigs(false);
                                }}
                              >
                                <Trash2 size={15} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Extra / Unmatched Config Folders */}
          {orphans.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <Folder size={18} aria-hidden="true" />
                  Additional Config Folders ({orphans.length})
                </h3>
                <span className="field-hint">
                  Folders inside /{addonDir === 'mods' ? 'config' : 'plugins'}/ without a matching JAR filename
                </span>
              </div>
              <div className="grid-3">
                {orphans.map((o) => {
                  const editable = o.configFiles.filter((f) => !f.isBinary).length;
                  return (
                    <div
                      key={o.relativePath}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.6rem',
                        padding: '0.7rem 0.85rem',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-surface-subtle)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="mono" style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                          {o.folderName}
                        </div>
                        <div className="field-hint">{editable} config files</div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openOrphanConfigStudio(o)}
                      >
                        <Settings2 size={14} aria-hidden="true" />
                        Edit
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-labelledby="tab-browse-addons" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <search>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runModrinthSearch(searchQuery, allVersions);
              }}
              style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'center' }}
            >
              <label htmlFor="modrinth-q" className="visually-hidden">
                Search Modrinth {kindPlural}
              </label>
              <div style={{ flex: '1 1 280px', position: 'relative' }}>
                <Search
                  size={16}
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    insetInlineStart: '0.75rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                    pointerEvents: 'none',
                  }}
                />
                <input
                  id="modrinth-q"
                  type="search"
                  className="input"
                  style={{ paddingInlineStart: '2.25rem' }}
                  placeholder={`Search Modrinth ${kindPlural.toLowerCase()} for ${server.software} ${server.mcVersion}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Switch
                checked={allVersions}
                onChange={(val) => {
                  setAllVersions(val);
                  void runModrinthSearch(searchQuery, val);
                }}
                label="All MC versions"
              />
              <button type="submit" className="btn btn-primary" disabled={searching}>
                {searching ? 'Searching...' : 'Search'}
              </button>
            </form>
          </search>

          {searchResults.length === 0 && !searching ? (
            <div className="empty-state">
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                No matching {kindPlural.toLowerCase()} found for {server.software} {server.mcVersion}. Try enabling
                &ldquo;All MC versions&rdquo;.
              </p>
            </div>
          ) : (
            <div className="grid-2">
              {searchResults.map((hit) => (
                <article key={hit.projectId} className="addon-card">
                  {hit.iconUrl ? (
                    <img src={hit.iconUrl} alt="" className="addon-icon" loading="lazy" />
                  ) : (
                    <div className="addon-icon">
                      <Puzzle size={22} aria-hidden="true" />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.08rem' }}>{hit.title}</strong>
                      <span className="badge badge-neutral" style={{ fontSize: '0.74rem' }}>
                        {hit.downloads.toLocaleString()} DLs
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)' }}>{hit.description}</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginTop: '0.25rem' }}>
                      <span className="field-hint">by {hit.author}</span>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => void openVersionPicker(hit)}
                      >
                        <Download size={14} aria-hidden="true" />
                        Install
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Version Picker Modal for Modrinth Install */}
      <ModalDialog
        open={Boolean(versionPickerProject)}
        onClose={() => setVersionPickerProject(null)}
        title={versionPickerProject ? `Install ${versionPickerProject.title}` : 'Install'}
      >
        {loadingProjectVersions ? (
          <p style={{ color: 'var(--text-secondary)' }}>Loading compatible builds...</p>
        ) : projectVersions.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>
            No compatible builds found for {server.software}.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            {projectVersions.map((v) => (
              <div
                key={v.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  padding: '0.7rem 0.85rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{v.name}</div>
                  <div className="mono" style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    {v.fileName} • {formatBytes(v.fileSize)}
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                    {v.gameVersions.slice(0, 5).map((gv) => (
                      <span key={gv} className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>
                        {gv}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={installingVersionId !== null}
                  onClick={() => void handleInstallVersion(v)}
                >
                  {installingVersionId === v.id ? 'Installing...' : 'Install'}
                </button>
              </div>
            ))}
          </div>
        )}
      </ModalDialog>

      {/* Delete Addon Confirmation */}
      <ModalDialog
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title={`Remove ${deleteTarget?.manifest.name || ''}?`}
        footer={
          <>
            <button type="button" className="btn" autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" disabled={deleting} onClick={() => void handleDeleteAddon()}>
              {deleting ? 'Removing...' : serverRunning ? `Remove ${kindSingular} (or Queue)` : `Remove ${kindSingular}`}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            This will delete <code>{deleteTarget?.fileName}</code> from <code>/{addonDir}/</code>.
          </p>
          {serverRunning && (
            <div className="banner banner-warn">
              <span>
                The server is currently running. If the <code>.jar</code> is locked by Java, it will be automatically
                deleted as soon as the server stops.
              </span>
            </div>
          )}
          {deleteTarget?.configFolder && (
            <Switch
              checked={deleteWithConfigs}
              onChange={setDeleteWithConfigs}
              label={`Also permanently delete config folder (${deleteTarget.configFolder})`}
            />
          )}
        </div>
      </ModalDialog>
    </div>
  );
}
