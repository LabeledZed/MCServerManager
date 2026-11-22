import { useCallback, useEffect, useMemo, useState } from 'react';
import { FilePlus2, FileText, FolderTree, RefreshCw, Sliders } from 'lucide-react';
import { api } from '../api/client';
import { VisualConfigEditor } from '../components/VisualConfigEditor';
import type { ServerConfigFileEntry, ServerSummary } from '../../../shared/types';

interface ConfigsPageProps {
  server: ServerSummary;
  initialFilePath?: string | null;
  onServerUpdated?: () => void;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

const CATEGORY_LABELS: Record<ServerConfigFileEntry['category'], string> = {
  core: 'Core / Vanilla',
  'bukkit-spigot': 'Bukkit & Spigot',
  'paper-purpur': 'Paper / Purpur / Leaf / Folia',
  world: 'Per-World Overrides',
  modloader: 'Fabric / Forge / NeoForge',
  proxy: 'Proxy (Velocity / Bungee)',
  other: 'Other Root Configs',
};

const CATEGORY_ORDER: ServerConfigFileEntry['category'][] = [
  'core',
  'paper-purpur',
  'bukkit-spigot',
  'world',
  'modloader',
  'proxy',
  'other',
];

export function ConfigsPage({ server, initialFilePath, onServerUpdated, onNotify }: ConfigsPageProps) {
  const isVelocity = server.software === 'velocity';
  const primaryConfigPath = isVelocity ? 'velocity.toml' : 'server.properties';
  const [activeTab, setActiveTab] = useState<'options' | 'all'>(
    initialFilePath && initialFilePath !== primaryConfigPath ? 'all' : 'options',
  );
  const [configs, setConfigs] = useState<ServerConfigFileEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>(initialFilePath || primaryConfigPath);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listServerConfigs(server.id);
      setConfigs(res.configs);
      if (initialFilePath) {
        setSelectedPath(initialFilePath);
        setActiveTab(initialFilePath === primaryConfigPath ? 'options' : 'all');
      } else if (res.configs.length > 0 && !res.configs.some((c) => c.relativePath === selectedPath)) {
        const firstExisting = res.configs.find((c) => c.exists) || res.configs[0];
        setSelectedPath(firstExisting.relativePath);
      }
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to list server configs');
    } finally {
      setLoading(false);
    }
  }, [server.id, initialFilePath, primaryConfigPath, onNotify, selectedPath]);

  useEffect(() => {
    void loadConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, initialFilePath]);

  const grouped = useMemo(() => {
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      items: configs.filter((c) => c.category === cat),
    })).filter((g) => g.items.length > 0);
  }, [configs]);

  const selectedEntry = configs.find((c) => c.relativePath === selectedPath);
  const hasPrimaryConfig = configs.some((c) => c.relativePath === primaryConfigPath && c.exists);

  const handleCreateMissing = async (relPath: string) => {
    setCreating(true);
    try {
      await api.createConfigFile(server.id, relPath);
      onNotify('success', `Created ${relPath}`);
      await loadConfigs();
      setSelectedPath(relPath);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to create file');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Tabs (non-navigation view switcher) */}
      <div className="tablist" role="tablist" aria-label="Server configuration views">
        <button
          type="button"
          role="tab"
          id="tab-options"
          className="tab-btn"
          aria-selected={activeTab === 'options'}
          onClick={() => setActiveTab('options')}
        >
          <Sliders size={16} aria-hidden="true" />
          {isVelocity ? 'Proxy Options (velocity.toml)' : 'Server Options (server.properties)'}
        </button>
        <button
          type="button"
          role="tab"
          id="tab-all-configs"
          className="tab-btn"
          aria-selected={activeTab === 'all'}
          onClick={() => setActiveTab('all')}
        >
          <FolderTree size={16} aria-hidden="true" />
          All {isVelocity ? 'Proxy' : 'Server'} Configs ({configs.filter((c) => c.exists).length})
        </button>
      </div>

      {activeTab === 'options' ? (
        <div role="tabpanel" aria-labelledby="tab-options">
          {hasPrimaryConfig ? (
            <VisualConfigEditor
              key={primaryConfigPath}
              serverId={server.id}
              relativePath={primaryConfigPath}
              groupByCategory={!isVelocity}
              onSaved={() => onServerUpdated?.()}
              onNotify={onNotify}
            />
          ) : (
            <div className="empty-state">
              <FileText size={36} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
              <h3>{primaryConfigPath} not found yet</h3>
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                Start the {isVelocity ? 'proxy' : 'server'} once to generate {primaryConfigPath}, or initialize one right
                now.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={creating}
                  onClick={() => void handleCreateMissing(primaryConfigPath)}
                >
                  <FilePlus2 size={15} aria-hidden="true" />
                  Initialize {primaryConfigPath}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div role="tabpanel" aria-labelledby="tab-all-configs" className="studio-layout">
          <aside className="studio-sidebar" aria-label="Server configuration files">
            <div className="studio-sidebar-header">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong style={{ fontFamily: 'var(--font-display)', fontSize: '0.96rem' }}>
                  Server Config Registry
                </strong>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label="Refresh config list"
                  onClick={() => void loadConfigs()}
                >
                  <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
                </button>
              </div>
              <span className="field-hint">Server configuration files.</span>
            </div>

            <div className="studio-sidebar-list scroller">
              {grouped.map((group) => (
                <div key={group.category}>
                  <div className="studio-group-label">{group.label}</div>
                  {group.items.map((item) => (
                    <button
                      key={item.relativePath}
                      type="button"
                      className={`studio-file-btn ${selectedPath === item.relativePath ? 'active' : ''} ${!item.exists ? 'missing' : ''}`}
                      onClick={() => setSelectedPath(item.relativePath)}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="mono" style={{ fontSize: '0.84rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.label}
                        </div>
                        <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                          {item.relativePath}
                        </div>
                      </div>
                      <span className={`badge ${item.exists ? 'badge-accent' : 'badge-neutral'}`} style={{ fontSize: '0.7rem' }}>
                        {item.exists ? item.format.toUpperCase() : 'Pending'}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>

          <div>
            {selectedEntry && !selectedEntry.exists ? (
              <div className="card">
                <div className="empty-state" style={{ border: 0 }}>
                  <FileText size={38} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
                  <h3 className="mono">{selectedEntry.relativePath}</h3>
                  <p style={{ margin: 0, maxWidth: '500px', color: 'var(--text-secondary)' }}>
                    {selectedEntry.description}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                    This file hasn&apos;t been generated yet (typically created automatically when you start the{' '}
                    {selectedEntry.softwareHint} server for the first time).
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={creating}
                    onClick={() => void handleCreateMissing(selectedEntry.relativePath)}
                  >
                    <FilePlus2 size={16} aria-hidden="true" />
                    Create Empty {selectedEntry.fileName} Now
                  </button>
                </div>
              </div>
            ) : selectedPath ? (
              <VisualConfigEditor
                key={selectedPath}
                serverId={server.id}
                relativePath={selectedPath}
                groupByCategory={selectedPath === 'server.properties'}
                onSaved={() => onServerUpdated?.()}
                onNotify={onNotify}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
