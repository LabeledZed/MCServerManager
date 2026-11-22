import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  CheckCircle2,
  Download,
  Globe,
  Home,
  Layers,
  Play,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Square,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import { ConfirmDialog, ModalDialog } from '../components/ModalDialog';
import { Switch } from '../components/Switch';
import type {
  ManagedWorldConfig,
  PluginWorldRule,
  RealmGameMode,
  RealmsConfig,
  RealmsStateResponse,
  RealmWorldEnvironment,
  RealmWorldType,
  SeparationOptions,
  ServerSummary,
  WorldGroup,
} from '../../../shared/types';

interface RealmsPageProps {
  server: ServerSummary;
  onNotify: (tone: 'info' | 'success' | 'warn' | 'error', text: string) => void;
}

const PRESET_COLORS = [
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f97316', // Orange
];

const DEFAULT_GROUP_SEPARATION: SeparationOptions = {
  inventory: true,
  chat: true,
  visibility: true,
  portalsAndRespawn: true,
};

const DEFAULT_STANDALONE_SEPARATION: SeparationOptions = {
  inventory: false,
  chat: false,
  visibility: false,
  portalsAndRespawn: false,
};

export function RealmsPage({ server, onNotify }: RealmsPageProps) {
  const [state, setState] = useState<RealmsStateResponse | null>(null);
  const [draft, setDraft] = useState<RealmsConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [subTab, setSubTab] = useState<'groups' | 'worlds' | 'plugins'>('groups');

  // Player-to-group add inputs
  const [playerInputs, setPlayerInputs] = useState<Record<string, string>>({});
  const [moveTargets, setMoveTargets] = useState<Record<string, string>>({});

  // Create World / Realm Modal state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'bundle' | 'single'>('bundle');
  const [creatingWorld, setCreatingWorld] = useState(false);
  const [wName, setWName] = useState('');
  const [wEnv, setWEnv] = useState<RealmWorldEnvironment>('NORMAL');
  const [wType, setWType] = useState<RealmWorldType>('NORMAL');
  const [wSeed, setWSeed] = useState('');
  const [wStructures, setWStructures] = useState(true);
  const [wGameMode, setWGameMode] = useState<RealmGameMode>('');
  const [wCreateNether, setWCreateNether] = useState(true);
  const [wCreateEnd, setWCreateEnd] = useState(true);
  const [wNetherName, setWNetherName] = useState('');
  const [wEndName, setWEndName] = useState('');
  const [wCreateGroup, setWCreateGroup] = useState(true);
  const [wGroupName, setWGroupName] = useState('');
  const [wGroupColor, setWGroupColor] = useState('#3b82f6');
  const [wStandaloneSep, setWStandaloneSep] = useState<SeparationOptions>(DEFAULT_STANDALONE_SEPARATION);

  const is26Plus = /^(?:2[6-9]|[3-9]\d)(?:\.|w|-)/i.test((server.mcVersion || '').trim());
  const defaultOverworldName = is26Plus ? 'minecraft:overworld' : 'world';
  const defaultNetherName = is26Plus ? 'minecraft:the_nether' : 'world_nether';
  const defaultEndName = is26Plus ? 'minecraft:the_end' : 'world_the_end';

  // Create Group Modal state
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#ef4444');
  const [newGroupOverworld, setNewGroupOverworld] = useState(defaultOverworldName);
  const [newGroupNether, setNewGroupNether] = useState(defaultNetherName);
  const [newGroupEnd, setNewGroupEnd] = useState(defaultEndName);

  // Delete world confirmation
  const [deleteWorldName, setDeleteWorldName] = useState<string | null>(null);
  const [pluginSearch, setPluginSearch] = useState('');
  const [busyWorld, setBusyWorld] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const pollInFlightRef = useRef(false);

  const loadState = useCallback(
    async (silent = false) => {
      if (silent && pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      if (!silent) setLoading(true);
      try {
        const res = await api.getRealmsState(server.id);
        setState(res);
        if (!silent || !dirtyRef.current) {
          setDraft(res.config);
          if (!silent) setDirty(false);
        }
      } catch (err) {
        if (!silent) {
          onNotify('error', err instanceof Error ? err.message : 'Failed to load Realms configuration');
        }
      } finally {
        pollInFlightRef.current = false;
        if (!silent) setLoading(false);
      }
    },
    [server.id, onNotify],
  );

  useEffect(() => {
    void loadState(false);
  }, [loadState, server.runtime.status]);

  // Keep online players, loaded worlds, and tracked portals updated near real-time
  useEffect(() => {
    if (server.runtime.status !== 'online' && server.runtime.status !== 'starting') return;
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void loadState(true);
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [loadState, server.runtime.status]);

  useEffect(() => {
    if (state?.connected) {
      void loadState(true);
    }
  }, [server.runtime.playersOnline, loadState, state?.connected]);

  const updateDraft = (updater: (prev: RealmsConfig) => RealmsConfig) => {
    setDraft((prev) => {
      if (!prev) return prev;
      setDirty(true);
      return updater(prev);
    });
  };

  // All known world names (loaded + managed + unloaded disk folders + referenced in groups)
  const allKnownWorldNames = useMemo(() => {
    const set = new Set<string>();
    if (state) {
      for (const w of state.loadedWorlds) set.add(w.name);
      for (const f of state.unloadedFolders) set.add(f);
    }
    if (draft) {
      if (draft.defaultJoinWorld) set.add(draft.defaultJoinWorld);
      for (const w of draft.worlds) set.add(w.name);
      for (const g of draft.groups) {
        if (g.overworld) set.add(g.overworld);
        if (g.nether) set.add(g.nether);
        if (g.end) set.add(g.end);
        for (const e of g.extraWorlds || []) set.add(e);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [state, draft]);

  const loadedWorldMap = useMemo(() => {
    const map = new Map<string, RealmsStateResponse['loadedWorlds'][number]>();
    for (const w of state?.loadedWorlds || []) {
      map.set(w.name.toLowerCase(), w);
    }
    return map;
  }, [state]);

  const onlinePlayerSet = useMemo(() => {
    return new Set((state?.onlinePlayers || []).map((p) => p.name.toLowerCase()));
  }, [state]);

  const scopedPluginCount = useMemo(() => {
    if (!draft) return 0;
    return Object.values(draft.pluginRules).filter((r) => r.mode !== 'all').length;
  }, [draft]);

  const visiblePlugins = useMemo(() => {
    const q = pluginSearch.trim().toLowerCase();
    const list = (state?.plugins || []).filter(
      (p) => p.name.toLowerCase() !== 'mcservermanagerbridge',
    );
    // Also include any plugins referenced in draft.pluginRules that aren't currently in plugins list
    const seen = new Set(list.map((p) => p.name.toLowerCase()));
    if (draft) {
      for (const key of Object.keys(draft.pluginRules)) {
        if (!seen.has(key.toLowerCase()) && key.toLowerCase() !== 'mcservermanagerbridge') {
          list.push({ name: key, version: '', enabled: false });
          seen.add(key.toLowerCase());
        }
      }
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return list;
    return list.filter((p) => p.name.toLowerCase().includes(q));
  }, [state, draft, pluginSearch]);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const updated = await api.saveRealmsConfig(server.id, draft);
      setState(updated);
      setDraft(updated.config);
      setDirty(false);
      onNotify(
        'success',
        updated.connected
          ? 'Realms configuration saved and applied live.'
          : 'Realms configuration saved to disk (will apply when server starts).',
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to save Realms configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleInstallBridge = async () => {
    setInstalling(true);
    try {
      await api.installBridge(server.id);
      onNotify('success', 'Installed MCServerManagerBridge.jar. Start or restart the server to activate live controls.');
      await loadState();
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to install bridge plugin');
    } finally {
      setInstalling(false);
    }
  };

  const openCreateModal = (mode: 'bundle' | 'single') => {
    setCreateMode(mode);
    const nextIdx = (draft?.groups.length || 0) + 1;
    setWName(mode === 'bundle' ? `world_${nextIdx}` : 'custom_world');
    setWEnv('NORMAL');
    setWType('NORMAL');
    setWSeed('');
    setWStructures(true);
    setWGameMode('');
    setWCreateNether(true);
    setWCreateEnd(true);
    setWNetherName('');
    setWEndName('');
    setWCreateGroup(true);
    setWGroupName(`Survival ${nextIdx}`);
    setWGroupColor(PRESET_COLORS[nextIdx % PRESET_COLORS.length]);
    setWStandaloneSep(
      mode === 'single'
        ? { inventory: true, chat: false, visibility: false, portalsAndRespawn: true }
        : DEFAULT_STANDALONE_SEPARATION,
    );
    setCreateModalOpen(true);
  };

  const handleCreateWorld = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = wName.trim();
    if (!/^(?:[a-z0-9_.-]+:)?[a-zA-Z0-9_.-]{1,64}$/.test(trimmed)) {
      onNotify('error', 'World name may only contain letters, numbers, underscores, hyphens, and an optional namespace:');
      return;
    }

    setCreatingWorld(true);
    try {
      // Persist any pending unsaved edits before creating so nothing is overwritten
      if (dirty && draft) {
        await api.saveRealmsConfig(server.id, draft);
      }

      const res = await api.createRealmWorld(server.id, {
        bundle: createMode === 'bundle',
        name: trimmed,
        environment: wEnv,
        worldType: wType,
        seed: wSeed.trim() || undefined,
        generateStructures: wStructures,
        defaultGameMode: wGameMode,
        standaloneSeparation: createMode === 'single' ? wStandaloneSep : undefined,
        createNether: wCreateNether,
        createEnd: wCreateEnd,
        netherName: wNetherName.trim() || undefined,
        endName: wEndName.trim() || undefined,
        createGroup: createMode === 'bundle' && wCreateGroup,
        groupName: wGroupName.trim() || trimmed,
        groupColor: wGroupColor,
        groupSeparation: DEFAULT_GROUP_SEPARATION,
      });

      setState(res.state);
      setDraft(res.state.config);
      setDirty(false);
      setCreateModalOpen(false);
      onNotify(
        'success',
        res.live
          ? `Created & loaded live: ${res.created.join(', ')}`
          : `Queued world(s) ${res.created.join(', ')} to generate automatically on next server start.`,
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to create world');
    } finally {
      setCreatingWorld(false);
    }
  };

  const handleAddGroup = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newGroupName.trim();
    if (!label || !draft) return;
    const baseId = label.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'group';
    const id = draft.groups.some((g) => g.id === baseId)
      ? `${baseId}_${Date.now().toString(36).slice(-4)}`
      : baseId;
    const nextGroup: WorldGroup = {
      id,
      name: label,
      color: newGroupColor,
      overworld: newGroupOverworld,
      nether: newGroupNether,
      end: newGroupEnd,
      extraWorlds: [],
      defaultGameMode: '',
      players: [],
      separation: { ...DEFAULT_GROUP_SEPARATION },
    };
    updateDraft((prev) => ({ ...prev, groups: [...prev.groups, nextGroup] }));
    setGroupModalOpen(false);
    setNewGroupName('');
  };

  const updateGroup = (groupId: string, updater: (g: WorldGroup) => WorldGroup) => {
    updateDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => (g.id === groupId ? updater(g) : g)),
    }));
  };

  const removeGroup = (groupId: string) => {
    updateDraft((prev) => ({
      ...prev,
      groups: prev.groups.filter((g) => g.id !== groupId),
    }));
  };

  const addPlayerToGroup = (groupId: string, rawPlayer: string) => {
    const player = rawPlayer.trim();
    if (!player) return;
    const lower = player.toLowerCase();
    updateDraft((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => {
        const cleaned = g.players.filter((p) => p.toLowerCase() !== lower);
        if (g.id === groupId) {
          return { ...g, players: [...cleaned, player] };
        }
        return { ...g, players: cleaned };
      }),
    }));
    setPlayerInputs((prev) => ({ ...prev, [groupId]: '' }));
  };

  const toggleGroupTpaTarget = (groupId: string, targetGroupId: string) => {
    updateGroup(groupId, (g) => {
      const cur = g.allowedTpaGroups || [];
      const next = cur.includes(targetGroupId)
        ? cur.filter((id) => id !== targetGroupId)
        : [...cur, targetGroupId];
      return { ...g, allowedTpaGroups: next };
    });
  };

  const removePlayerFromGroup = (groupId: string, playerName: string) => {
    const lower = playerName.toLowerCase();
    updateGroup(groupId, (g) => ({
      ...g,
      players: g.players.filter((p) => p.toLowerCase() !== lower),
    }));
  };

  const handleMovePlayer = async (
    playerName: string,
    payload: { world?: string; groupId?: string; assignToGroup?: boolean },
  ) => {
    try {
      const next = await api.moveRealmPlayer(server.id, playerName, payload);
      setState(next);
      if (payload.assignToGroup) {
        setDraft(next.config);
        setDirty(false);
      }
      onNotify(
        'success',
        payload.world
          ? `Moved ${playerName} to ${payload.world}`
          : `Moved ${playerName} to their realm`,
      );
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to move player');
    }
  };

  const handleLoadWorld = async (worldName: string) => {
    setBusyWorld(worldName);
    try {
      const next = await api.loadRealmWorld(server.id, worldName);
      setState(next);
      setDraft(next.config);
      setDirty(false);
      onNotify('success', `Loaded world "${worldName}"`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to load world');
    } finally {
      setBusyWorld(null);
    }
  };

  const handleUnloadWorld = async (worldName: string) => {
    setBusyWorld(worldName);
    try {
      const next = await api.unloadRealmWorld(server.id, worldName, true);
      setState(next);
      setDraft(next.config);
      setDirty(false);
      onNotify('info', `Saved and unloaded world "${worldName}"`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to unload world');
    } finally {
      setBusyWorld(null);
    }
  };

  const handleDeleteWorld = async () => {
    if (!deleteWorldName) return;
    const target = deleteWorldName;
    setDeleteWorldName(null);
    setBusyWorld(target);
    try {
      const next = await api.deleteRealmWorld(server.id, target);
      setState(next);
      setDraft(next.config);
      setDirty(false);
      onNotify('warn', `Deleted world "${target}"`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to delete world');
    } finally {
      setBusyWorld(null);
    }
  };

  const updateStandaloneWorld = (worldName: string, patch: Partial<ManagedWorldConfig>) => {
    updateDraft((prev) => {
      const existing = prev.worlds.find((w) => w.name.toLowerCase() === worldName.toLowerCase());
      if (existing) {
        return {
          ...prev,
          worlds: prev.worlds.map((w) =>
            w.name.toLowerCase() === worldName.toLowerCase() ? { ...w, ...patch } : w,
          ),
        };
      }
      const loaded = loadedWorldMap.get(worldName.toLowerCase());
      const env = (loaded?.environment === 'NETHER' || loaded?.environment === 'THE_END'
        ? loaded.environment
        : 'NORMAL') as RealmWorldEnvironment;
      return {
        ...prev,
        worlds: [
          ...prev.worlds,
          {
            name: worldName,
            environment: env,
            worldType: 'NORMAL',
            autoLoad: true,
            standaloneSeparation: { ...DEFAULT_STANDALONE_SEPARATION },
            ...patch,
          },
        ],
      };
    });
  };

  const getPluginRule = (pluginName: string): PluginWorldRule => {
    return draft?.pluginRules[pluginName] || { mode: 'all', worlds: [], groups: [] };
  };

  const updatePluginRule = (pluginName: string, nextRule: PluginWorldRule) => {
    updateDraft((prev) => {
      const nextRules = { ...prev.pluginRules };
      if (nextRule.mode === 'all') {
        delete nextRules[pluginName];
      } else {
        nextRules[pluginName] = nextRule;
      }
      return { ...prev, pluginRules: nextRules };
    });
  };

  const togglePluginTarget = (pluginName: string, kind: 'worlds' | 'groups', value: string) => {
    const cur = getPluginRule(pluginName);
    const list = cur[kind];
    const nextList = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    updatePluginRule(pluginName, { ...cur, [kind]: nextList });
  };

  const findGroupsForWorld = (worldName: string): WorldGroup[] => {
    if (!draft) return [];
    const lower = worldName.toLowerCase();
    return draft.groups.filter(
      (g) =>
        g.overworld.toLowerCase() === lower ||
        (g.nether || '').toLowerCase() === lower ||
        (g.end || '').toLowerCase() === lower ||
        (g.extraWorlds || []).some((e) => e.toLowerCase() === lower),
    );
  };

  const defaultGroup = useMemo(() => {
    if (!draft || draft.groups.length === 0) return undefined;
    const defWorld = (draft.defaultJoinWorld || '').toLowerCase();
    return (
      draft.groups.find((g) => g.overworld.toLowerCase() === defWorld) ||
      draft.groups.find(
        (g) =>
          (g.nether || '').toLowerCase() === defWorld ||
          (g.end || '').toLowerCase() === defWorld ||
          (g.extraWorlds || []).some((e) => e.toLowerCase() === defWorld),
      ) ||
      draft.groups.find((g) => g.id === 'default') ||
      draft.groups[0]
    );
  }, [draft]);

  const findExplicitGroupForPlayer = (playerName: string): WorldGroup | undefined => {
    if (!draft) return undefined;
    const lower = playerName.toLowerCase();
    return draft.groups.find((g) => g.players.some((p) => p.toLowerCase() === lower));
  };

  const findEffectiveGroupForPlayer = (playerName: string): { group?: WorldGroup; inherited: boolean } => {
    const explicit = findExplicitGroupForPlayer(playerName);
    if (explicit) return { group: explicit, inherited: false };
    return { group: defaultGroup, inherited: true };
  };

  if (loading && !state) {
    return <div className="card">Loading Realms &amp; Multi-World configuration...</div>;
  }

  if (state && !state.supported) {
    return (
      <div className="card">
        <div className="empty-state" style={{ border: 0 }}>
          <Plug size={38} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
          <h3>Realms &amp; Per-World Plugins Unavailable on {server.software.toUpperCase()}</h3>
          <p style={{ margin: 0, maxWidth: '520px', color: 'var(--text-secondary)' }}>
            Multi-world realms, colored portals, and per-world plugin isolation are powered by{' '}
            <code>MCServerManagerBridge.jar</code> on Spigot-compatible servers (Paper, Purpur, Leaf, Folia, Spigot).
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
      {server.software === 'folia' && (
        <div className="banner banner-warn">
          <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Folia Regionized Threading Active:</strong>{' '}
            <code>MCServerManagerBridge</code> runs using Folia&apos;s Global/Entity/Region schedulers and async
            teleports. Note that Folia itself does not allow dynamically creating or unloading worlds at runtime;
            world-group isolation, colored portals, <code>/tpa</code>, <code>/back</code>, and per-world plugin scoping
            remain fully supported on Folia&apos;s loaded dimensions.
          </div>
        </div>
      )}
      {/* Header & Global Controls */}
      <section className="card card-accent" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <h2 className="card-title">
                <Layers size={20} aria-hidden="true" />
                Realms, Multi-World &amp; Per-World Plugins
              </h2>
              {state?.connected ? (
                <span className="badge badge-online">
                  <CheckCircle2 size={13} aria-hidden="true" />
                  Live Bridge Connected
                </span>
              ) : state?.installed ? (
                <span className="badge badge-warn">Offline — Editing Saved Config</span>
              ) : (
                <span className="badge badge-offline">Bridge Not Installed</span>
              )}
              {dirty && <span className="badge badge-warn">Unsaved Changes</span>}
            </div>
            <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              Run isolated survival realms, standalone worlds, shared-Nether colored portals, and per-world plugin scoping inside one JVM.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {!state?.installed && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={installing}
                onClick={() => void handleInstallBridge()}
              >
                <Download size={14} aria-hidden="true" />
                {installing ? 'Installing...' : 'Install Bridge Plugin'}
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => void loadState()}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
              Refresh
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!dirty || saving}
              onClick={() => void handleSave()}
            >
              <Save size={14} aria-hidden="true" />
              {saving ? 'Applying...' : state?.connected ? 'Save & Apply Live' : 'Save Config'}
            </button>
          </div>
        </div>

        {/* Summary Metrics */}
        <div className="grid-4">
          <div className="stat-tile">
            <span className="stat-label">Worlds (Loaded / Total)</span>
            <span className="stat-value">
              {state?.loadedWorlds.length ?? 0} / {allKnownWorldNames.length}
            </span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Player World Groups</span>
            <span className="stat-value">{draft?.groups.length ?? 0}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Scoped Plugins</span>
            <span className="stat-value">{scopedPluginCount}</span>
          </div>
          <div className="stat-tile">
            <span className="stat-label">Colored Nether Portals</span>
            <span className="stat-value">{state?.portals.length ?? 0}</span>
          </div>
        </div>

        {/* Global Default World & Portal Options */}
        {draft && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '0.9rem',
              padding: '0.85rem 1rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface-subtle)',
              border: '1px solid var(--border-subtle)',
              alignItems: 'center',
            }}
          >
            <div className="field">
              <label htmlFor="realms-default-world">Default World (for players not in another list)</label>
              <select
                id="realms-default-world"
                name="defaultJoinWorld"
                className="select mono"
                style={{ minHeight: '36px', padding: '0.3rem 0.65rem' }}
                value={draft.defaultJoinWorld}
                onChange={(e) => updateDraft((p) => ({ ...p, defaultJoinWorld: e.target.value }))}
              >
                {allKnownWorldNames.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                Players not listed in another group join here and inherit the default world&apos;s group list.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              <Switch
                checked={draft.enabled}
                onChange={(enabled) => updateDraft((p) => ({ ...p, enabled }))}
                label="Enable Realms & Isolation Engine"
              />
              <Switch
                checked={draft.forceDefaultJoinForUnassigned}
                onChange={(forceDefaultJoinForUnassigned) =>
                  updateDraft((p) => ({ ...p, forceDefaultJoinForUnassigned }))
                }
                label="Always spawn default-list players at Default World on join"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <Switch
                checked={draft.ownedColoredPortals}
                onChange={(ownedColoredPortals) => updateDraft((p) => ({ ...p, ownedColoredPortals }))}
                label="Owned & Colored Nether Portals"
              />
              <span className="field-hint">
                Portals glow with their creator group&apos;s color; entering another group&apos;s Nether portal sends you to their Overworld.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <Switch
                checked={draft.tpaEnabled}
                onChange={(tpaEnabled) => updateDraft((p) => ({ ...p, tpaEnabled }))}
                label="Built-in /tpa, /tpahere & /tpahereall commands"
              />
              <span className="field-hint">
                Disable to completely unregister built-in TPA commands so you can use a third-party TPA plugin without conflicts.
              </span>
              <Switch
                checked={draft.backEnabled}
                onChange={(backEnabled) => updateDraft((p) => ({ ...p, backEnabled }))}
                label="Built-in persistent /back (teleport & death)"
              />
              {draft.tpaEnabled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label htmlFor="realms-tpa-timeout" style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    TPA timeout (sec):
                  </label>
                  <input
                    id="realms-tpa-timeout"
                    type="number"
                    min={10}
                    max={300}
                    className="input mono"
                    style={{ width: '80px', minHeight: '30px', padding: '0.2rem 0.45rem', fontSize: '0.82rem' }}
                    value={draft.tpaTimeoutSeconds}
                    onChange={(e) =>
                      updateDraft((p) => ({
                        ...p,
                        tpaTimeoutSeconds: Math.max(10, Math.min(300, Number(e.target.value) || 60)),
                      }))
                    }
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Sub-navigation Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div className="mode-segmented" role="group" aria-label="Realms sections">
          <button
            type="button"
            className={subTab === 'groups' ? 'active' : ''}
            aria-pressed={subTab === 'groups'}
            onClick={() => setSubTab('groups')}
          >
            <Users size={14} aria-hidden="true" />
            Player Groups ({draft?.groups.length ?? 0})
          </button>
          <button
            type="button"
            className={subTab === 'worlds' ? 'active' : ''}
            aria-pressed={subTab === 'worlds'}
            onClick={() => setSubTab('worlds')}
          >
            <Globe size={14} aria-hidden="true" />
            Worlds ({allKnownWorldNames.length})
          </button>
          <button
            type="button"
            className={subTab === 'plugins' ? 'active' : ''}
            aria-pressed={subTab === 'plugins'}
            onClick={() => setSubTab('plugins')}
          >
            <Puzzle size={14} aria-hidden="true" />
            Per-World Plugins ({visiblePlugins.length})
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {subTab === 'groups' && (
            <>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const nextIdx = (draft?.groups.length || 0) + 1;
                  setNewGroupName(`Survival ${nextIdx}`);
                  setNewGroupColor(PRESET_COLORS[(nextIdx - 1) % PRESET_COLORS.length]);
                  setNewGroupOverworld(allKnownWorldNames[0] || defaultOverworldName);
                  setNewGroupNether(
                    allKnownWorldNames.find((w) => w.toLowerCase().includes('nether')) || defaultNetherName,
                  );
                  setNewGroupEnd(
                    allKnownWorldNames.find((w) => w.toLowerCase().includes('end')) || defaultEndName,
                  );
                  setGroupModalOpen(true);
                }}
              >
                <Plus size={14} aria-hidden="true" />
                Add Player Group
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openCreateModal('bundle')}>
                <Sparkles size={14} aria-hidden="true" />
                New Survival Realm (3 Worlds + Group)
              </button>
            </>
          )}
          {subTab === 'worlds' && (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openCreateModal('single')}>
                <Home size={14} aria-hidden="true" />
                Create Singular World (Standalone)
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openCreateModal('bundle')}>
                <Plus size={14} aria-hidden="true" />
                Create Survival Realm (Overworld + Nether + End)
              </button>
            </>
          )}
        </div>
      </div>

      {/* ==================== TAB 1: PLAYER GROUPS ==================== */}
      {subTab === 'groups' && draft && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {draft.groups.length === 0 ? (
            <div className="empty-state">
              <Users size={38} style={{ color: 'var(--accent-bright)' }} aria-hidden="true" />
              <h3>No Player World Groups Yet</h3>
              <p style={{ margin: 0, maxWidth: '560px', color: 'var(--text-secondary)' }}>
                Create a World Group to bind an Overworld, Nether, and End to a list of players — with custom colors,
                optional inventory/chat/visibility separation, and colored Nether portals.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => openCreateModal('bundle')}>
                  <Sparkles size={14} aria-hidden="true" />
                  Create Survival Realm (3 Worlds + Group)
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openCreateModal('single')}>
                  <Home size={14} aria-hidden="true" />
                  Create Standalone World
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              {draft.groups.map((group) => {
                const isDefaultGroup = defaultGroup?.id === group.id;
                return (
                <article
                  key={group.id}
                  className="card realm-group-card"
                  style={{ borderInlineStart: `4px solid ${group.color}` }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', flex: '1 1 280px' }}>
                      <span
                        className="color-dot-indicator"
                        style={{ backgroundColor: group.color }}
                        aria-hidden="true"
                      />
                      <label htmlFor={`grp-name-${group.id}`} className="visually-hidden">
                        Group name
                      </label>
                      <input
                        id={`grp-name-${group.id}`}
                        type="text"
                        className="input"
                        style={{ maxWidth: '220px', minHeight: '34px', fontWeight: 600 }}
                        value={group.name}
                        onChange={(e) => updateGroup(group.id, (g) => ({ ...g, name: e.target.value }))}
                      />
                      <span className="cfg-key-raw">{group.id}</span>
                      {isDefaultGroup && <span className="badge badge-accent">Default List</span>}

                      {/* Color picker + quick swatches */}
                      <div className="color-swatch-row" role="group" aria-label={`Color for ${group.name}`}>
                        <label htmlFor={`grp-color-${group.id}`} className="visually-hidden">
                          Group color hex
                        </label>
                        <input
                          id={`grp-color-${group.id}`}
                          type="color"
                          className="color-input-native"
                          value={group.color}
                          title={`Group & Portal color (${group.color})`}
                          onChange={(e) => updateGroup(group.id, (g) => ({ ...g, color: e.target.value }))}
                        />
                        {PRESET_COLORS.map((hex) => (
                          <button
                            key={hex}
                            type="button"
                            className={`color-dot-btn ${group.color.toLowerCase() === hex ? 'active' : ''}`}
                            style={{ backgroundColor: hex }}
                            aria-label={`Set color ${hex}`}
                            aria-pressed={group.color.toLowerCase() === hex}
                            onClick={() => updateGroup(group.id, (g) => ({ ...g, color: hex }))}
                          />
                        ))}
                      </div>
                    </div>

                    {draft.groups.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title={`Delete group ${group.name}`}
                        aria-label={`Delete group ${group.name}`}
                        onClick={() => removeGroup(group.id)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        Remove Group
                      </button>
                    )}
                  </div>

                  {/* Linked Dimensions & Gamemode */}
                  <div className="grid-4" style={{ marginTop: '0.85rem' }}>
                    <div className="field">
                      <label htmlFor={`grp-ow-${group.id}`}>Overworld</label>
                      <select
                        id={`grp-ow-${group.id}`}
                        className="select mono"
                        style={{ minHeight: '34px', padding: '0.25rem 0.55rem', fontSize: '0.85rem' }}
                        value={group.overworld}
                        onChange={(e) => updateGroup(group.id, (g) => ({ ...g, overworld: e.target.value }))}
                      >
                        <option value="">-- Select Overworld --</option>
                        {allKnownWorldNames.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`grp-nether-${group.id}`}>Nether (can be shared!)</label>
                      <select
                        id={`grp-nether-${group.id}`}
                        className="select mono"
                        style={{ minHeight: '34px', padding: '0.25rem 0.55rem', fontSize: '0.85rem' }}
                        value={group.nether || ''}
                        onChange={(e) => updateGroup(group.id, (g) => ({ ...g, nether: e.target.value }))}
                      >
                        <option value="">(None / Unlinked)</option>
                        {allKnownWorldNames.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`grp-end-${group.id}`}>The End</label>
                      <select
                        id={`grp-end-${group.id}`}
                        className="select mono"
                        style={{ minHeight: '34px', padding: '0.25rem 0.55rem', fontSize: '0.85rem' }}
                        value={group.end || ''}
                        onChange={(e) => updateGroup(group.id, (g) => ({ ...g, end: e.target.value }))}
                      >
                        <option value="">(None / Unlinked)</option>
                        {allKnownWorldNames.map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`grp-gm-${group.id}`}>Default Gamemode</label>
                      <select
                        id={`grp-gm-${group.id}`}
                        className="select"
                        style={{ minHeight: '34px', padding: '0.25rem 0.55rem', fontSize: '0.85rem' }}
                        value={group.defaultGameMode || ''}
                        onChange={(e) =>
                          updateGroup(group.id, (g) => ({
                            ...g,
                            defaultGameMode: e.target.value as RealmGameMode,
                          }))
                        }
                      >
                        <option value="">Keep Player&apos;s Mode</option>
                        <option value="SURVIVAL">Survival</option>
                        <option value="CREATIVE">Creative</option>
                        <option value="ADVENTURE">Adventure</option>
                        <option value="SPECTATOR">Spectator</option>
                      </select>
                    </div>
                  </div>

                  {/* Per-Group Isolation Options */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: '0.6rem',
                      marginTop: '0.85rem',
                      padding: '0.7rem 0.85rem',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-canvas)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <Switch
                      checked={group.separation.inventory}
                      onChange={(inventory) =>
                        updateGroup(group.id, (g) => ({
                          ...g,
                          separation: { ...g.separation, inventory },
                        }))
                      }
                      label="Separate Inventories & Stats"
                    />
                    <Switch
                      checked={group.separation.chat}
                      onChange={(chat) =>
                        updateGroup(group.id, (g) => ({
                          ...g,
                          separation: { ...g.separation, chat },
                        }))
                      }
                      label="Separate Chat"
                    />
                    <Switch
                      checked={group.separation.visibility}
                      onChange={(visibility) =>
                        updateGroup(group.id, (g) => ({
                          ...g,
                          separation: { ...g.separation, visibility },
                        }))
                      }
                      label="Separate Tab List & Visibility"
                    />
                    <Switch
                      checked={group.separation.portalsAndRespawn}
                      onChange={(portalsAndRespawn) =>
                        updateGroup(group.id, (g) => ({
                          ...g,
                          separation: { ...g.separation, portalsAndRespawn },
                        }))
                      }
                      label="Linked Portals & Respawn"
                    />
                  </div>

                  {/* Per-List TPA Permissions */}
                  {draft.tpaEnabled && (
                    <div
                      style={{
                        marginTop: '0.7rem',
                        padding: '0.65rem 0.85rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-surface-subtle)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.45rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.86rem' }}>
                          Allowed /tpa &amp; /tpahere Target Lists (used by <code>/tpa</code>, <code>/tpahere</code>, and <code>/tpahereall friendly</code>)
                        </strong>
                        <span className="field-hint" style={{ fontSize: '0.78rem' }}>
                          Own list is always allowed
                        </span>
                      </div>
                      {draft.groups.filter((other) => other.id !== group.id).length === 0 ? (
                        <span className="field-hint" style={{ fontSize: '0.8rem' }}>
                          Add another World Group to allow cross-list teleport requests.
                        </span>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                          {draft.groups
                            .filter((other) => other.id !== group.id)
                            .map((other) => {
                              const allowed = (group.allowedTpaGroups || []).includes(other.id);
                              return (
                                <button
                                  key={other.id}
                                  type="button"
                                  className={`scope-chip ${allowed ? 'active' : ''}`}
                                  style={allowed ? { borderColor: other.color, background: `${other.color}28` } : undefined}
                                  aria-pressed={allowed}
                                  onClick={() => toggleGroupTpaTarget(group.id, other.id)}
                                >
                                  <span className="color-dot-mini" style={{ backgroundColor: other.color }} />
                                  {other.name}
                                </button>
                              );
                            })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Default Assigned Player List */}
                  <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '0.9rem' }}>
                        Default Player List ({group.players.length})
                      </strong>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          addPlayerToGroup(group.id, playerInputs[group.id] || '');
                        }}
                        style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}
                      >
                        <label htmlFor={`add-player-${group.id}`} className="visually-hidden">
                          Add player username to {group.name}
                        </label>
                        <input
                          id={`add-player-${group.id}`}
                          type="text"
                          list="realms-online-players"
                          className="input mono"
                          style={{ width: '190px', minHeight: '32px', fontSize: '0.84rem' }}
                          placeholder="Username or UUID..."
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          value={playerInputs[group.id] || ''}
                          onChange={(e) =>
                            setPlayerInputs((prev) => ({ ...prev, [group.id]: e.target.value }))
                          }
                        />
                        <button type="submit" className="btn btn-secondary btn-sm">
                          <UserPlus size={13} aria-hidden="true" />
                          Add
                        </button>
                      </form>
                    </div>

                    {group.players.length === 0 ? (
                      <span className="field-hint">
                        {isDefaultGroup
                          ? 'Default list: all players not explicitly assigned to another list automatically inherit this group.'
                          : `No players explicitly listed yet. Add usernames above to route them to ${group.overworld || 'this realm'} by default.`}
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                        {group.players.map((pName) => {
                          const isOnline = onlinePlayerSet.has(pName.toLowerCase());
                          return (
                            <span key={pName} className="player-chip">
                              <span
                                className="status-dot"
                                style={{
                                  backgroundColor: isOnline ? 'var(--status-online)' : 'var(--status-offline)',
                                }}
                                title={isOnline ? 'Online' : 'Offline'}
                              />
                              <span className="mono">{pName}</span>
                              {isOnline && state?.connected && !dirty && (
                                <button
                                  type="button"
                                  className="chip-inline-action"
                                  title={`Teleport ${pName} to ${group.name} now`}
                                  onClick={() => void handleMovePlayer(pName, { groupId: group.id })}
                                >
                                  Move
                                </button>
                              )}
                              <button
                                type="button"
                                className="chip-inline-remove"
                                aria-label={`Remove ${pName} from ${group.name}`}
                                onClick={() => removePlayerFromGroup(group.id, pName)}
                              >
                                <X size={12} aria-hidden="true" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </article>
                );
              })}
            </div>
          )}

          <datalist id="realms-online-players">
            {(state?.onlinePlayers || []).map((p) => (
              <option key={p.uuid} value={p.name} />
            ))}
          </datalist>

          {/* Online Players Manual Mover */}
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="card-header" style={{ marginBottom: 0 }}>
              <div>
                <h3 className="card-title">
                  <ArrowRightLeft size={17} aria-hidden="true" />
                  Online Players — Manual Move &amp; List Assignment ({state?.onlinePlayers.length ?? 0})
                </h3>
                <span className="field-hint">
                  Move any online player manually to any world (including standalone worlds) or reassign them to another World Group.
                </span>
              </div>
            </div>

            {!state?.connected ? (
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                Start the server with the bridge connected to move online players live.
              </p>
            ) : state.onlinePlayers.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                No players currently online.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {state.onlinePlayers.map((p) => {
                  const { group: effectiveGroup, inherited } = findEffectiveGroupForPlayer(p.name);
                  const chosenWorld = moveTargets[p.name] ?? p.world;
                  return (
                    <div
                      key={p.uuid}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.65rem',
                        flexWrap: 'wrap',
                        padding: '0.65rem 0.85rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-surface-subtle)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                        <strong>{p.name}</strong>
                        <span className="badge badge-neutral mono">In: {p.world}</span>
                        {effectiveGroup && (
                          <span
                            className="badge"
                            style={{
                              borderColor: effectiveGroup.color,
                              background: `${effectiveGroup.color}22`,
                              color: 'var(--text-primary)',
                            }}
                          >
                            <span
                              className="color-dot-mini"
                              style={{ backgroundColor: effectiveGroup.color }}
                            />
                            {effectiveGroup.name}
                            {inherited ? ' (Default)' : ''}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <label htmlFor={`move-world-${p.uuid}`} className="visually-hidden">
                          Target world for {p.name}
                        </label>
                        <select
                          id={`move-world-${p.uuid}`}
                          className="select mono"
                          style={{ width: 'auto', minHeight: '32px', padding: '0.2rem 0.55rem', fontSize: '0.82rem' }}
                          value={chosenWorld}
                          onChange={(e) => setMoveTargets((prev) => ({ ...prev, [p.name]: e.target.value }))}
                        >
                          {state.loadedWorlds.map((w) => (
                            <option key={w.name} value={w.name}>
                              {w.name} ({w.environment})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => void handleMovePlayer(p.name, { world: chosenWorld })}
                        >
                          Move to World
                        </button>

                        {draft.groups.length > 0 && (
                          <>
                            <label htmlFor={`assign-grp-${p.uuid}`} className="visually-hidden">
                              Assign {p.name} to group
                            </label>
                            <select
                              id={`assign-grp-${p.uuid}`}
                              className="select"
                              style={{ width: 'auto', minHeight: '32px', padding: '0.2rem 0.55rem', fontSize: '0.82rem' }}
                              value={effectiveGroup?.id || draft.groups[0].id}
                              onChange={(e) => {
                                const gid = e.target.value;
                                void handleMovePlayer(p.name, {
                                  groupId: gid,
                                  assignToGroup: true,
                                });
                              }}
                            >
                              {draft.groups.map((g) => (
                                <option key={g.id} value={g.id}>
                                  List: {g.name}
                                </option>
                              ))}
                            </select>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Tracked Colored Nether Portals */}
          {draft.ownedColoredPortals && (
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="card-header" style={{ marginBottom: 0 }}>
                <div>
                  <h3 className="card-title">
                    <Sparkles size={17} aria-hidden="true" />
                    Tracked Colored Nether Portals ({state?.portals.length ?? 0})
                  </h3>
                  <span className="field-hint">
                    Automatically recorded when players create or travel through Nether portals; broken portals are pruned automatically.
                  </span>
                </div>
                {(state?.portals.length ?? 0) > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      void api
                        .clearTrackedPortals(server.id)
                        .then((next) => {
                          setState(next);
                          onNotify('info', 'Cleared all tracked portals');
                        })
                        .catch((err) => onNotify('error', err instanceof Error ? err.message : 'Failed to clear portals'))
                    }
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    Clear All
                  </button>
                )}
              </div>

              {(state?.portals.length ?? 0) === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
                  No owned portals tracked yet. When players light or enter a Nether portal, it will appear here and emit particles in their group&apos;s color.
                </p>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {(state?.portals || []).map((tp) => {
                    const g = draft.groups.find((x) => x.id === tp.groupId);
                    const color = g?.color || '#37abc8';
                    return (
                      <div
                        key={tp.id}
                        className="portal-pill"
                        style={{ borderColor: color }}
                      >
                        <span className="color-dot-mini" style={{ backgroundColor: color }} />
                        <span className="mono">
                          {tp.world} ({tp.x}, {tp.y}, {tp.z})
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>→</span>
                        <strong>{g ? g.name : tp.groupId}</strong>
                        <span className="mono field-hint">({tp.targetOverworld})</span>
                        <button
                          type="button"
                          className="chip-inline-remove"
                          aria-label={`Remove tracked portal ${tp.id}`}
                          onClick={() =>
                            void api
                              .clearTrackedPortals(server.id, tp.id)
                              .then((next) => setState(next))
                              .catch((err) => onNotify('error', err instanceof Error ? err.message : 'Failed'))
                          }
                        >
                          <X size={12} aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ==================== TAB 2: WORLDS ==================== */}
      {subTab === 'worlds' && draft && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div className="card-header" style={{ marginBottom: 0 }}>
              <div>
                <h3 className="card-title">
                  <Globe size={18} aria-hidden="true" />
                  Managed &amp; Loaded Worlds ({allKnownWorldNames.length})
                </h3>
                <span className="field-hint">
                  Create 3-dimension survival realms or singular standalone worlds (such as an arena or creative world).
                </span>
              </div>
            </div>

            <div className="grid-2">
              {allKnownWorldNames.map((worldName) => {
                const liveInfo = loadedWorldMap.get(worldName.toLowerCase());
                const managed = draft.worlds.find((w) => w.name.toLowerCase() === worldName.toLowerCase());
                const memberGroups = findGroupsForWorld(worldName);
                const isDefaultWorld = draft.defaultJoinWorld.toLowerCase() === worldName.toLowerCase();
                const isPrimaryBukkitWorld =
                  worldName.toLowerCase() === 'minecraft:overworld' ||
                  (!is26Plus && worldName.toLowerCase() === 'world') ||
                  state?.loadedWorlds[0]?.name.toLowerCase() === worldName.toLowerCase();
                const isBusy = busyWorld === worldName;
                const standaloneSep = managed?.standaloneSeparation || DEFAULT_STANDALONE_SEPARATION;

                return (
                  <article
                    key={worldName}
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-surface-subtle)',
                      padding: '0.95rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem',
                      borderInlineStart:
                        memberGroups.length === 1
                          ? `4px solid ${memberGroups[0].color}`
                          : isDefaultWorld
                            ? '4px solid var(--accent-bright)'
                            : undefined,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <strong className="mono" style={{ fontSize: '1rem' }}>
                          {worldName}
                        </strong>
                        <span className="badge badge-neutral">
                          {liveInfo?.environment || managed?.environment || 'NORMAL'}
                        </span>
                        {liveInfo ? (
                          <span className="badge badge-online">Loaded</span>
                        ) : (
                          <span className="badge badge-offline">Unloaded</span>
                        )}
                        {isDefaultWorld && <span className="badge badge-accent">Default World</span>}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      {memberGroups.length > 0 ? (
                        memberGroups.map((g) => (
                          <span
                            key={g.id}
                            className="badge"
                            style={{
                              borderColor: g.color,
                              background: `${g.color}22`,
                              color: 'var(--text-primary)',
                            }}
                          >
                            <span className="color-dot-mini" style={{ backgroundColor: g.color }} />
                            {g.name}
                          </span>
                        ))
                      ) : (
                        <span className="badge badge-neutral">Standalone (Not in a group)</span>
                      )}
                      {liveInfo && (
                        <span className="field-hint mono" style={{ fontSize: '0.78rem' }}>
                          Players: {liveInfo.playerCount} • Seed: {liveInfo.seed}
                        </span>
                      )}
                    </div>

                    {/* Standalone world separation settings (for worlds not in any group) */}
                    {memberGroups.length === 0 && (
                      <details className="standalone-details">
                        <summary>Standalone World Isolation &amp; Gamemode</summary>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingTop: '0.6rem' }}>
                          <div className="field">
                            <label htmlFor={`sw-gm-${worldName}`}>Default Gamemode</label>
                            <select
                              id={`sw-gm-${worldName}`}
                              className="select"
                              style={{ minHeight: '32px', padding: '0.2rem 0.5rem', fontSize: '0.82rem' }}
                              value={managed?.defaultGameMode || ''}
                              onChange={(e) =>
                                updateStandaloneWorld(worldName, {
                                  defaultGameMode: e.target.value as RealmGameMode,
                                })
                              }
                            >
                              <option value="">Keep Player&apos;s Mode</option>
                              <option value="SURVIVAL">Survival</option>
                              <option value="CREATIVE">Creative</option>
                              <option value="ADVENTURE">Adventure</option>
                              <option value="SPECTATOR">Spectator</option>
                            </select>
                          </div>
                          <Switch
                            checked={standaloneSep.inventory}
                            onChange={(inventory) =>
                              updateStandaloneWorld(worldName, {
                                standaloneSeparation: { ...standaloneSep, inventory },
                              })
                            }
                            label="Separate Inventory & Stats"
                          />
                          <Switch
                            checked={standaloneSep.chat}
                            onChange={(chat) =>
                              updateStandaloneWorld(worldName, {
                                standaloneSeparation: { ...standaloneSep, chat },
                              })
                            }
                            label="Separate Chat"
                          />
                          <Switch
                            checked={standaloneSep.visibility}
                            onChange={(visibility) =>
                              updateStandaloneWorld(worldName, {
                                standaloneSeparation: { ...standaloneSep, visibility },
                              })
                            }
                            label="Separate Tab List & Visibility"
                          />
                          <Switch
                            checked={standaloneSep.portalsAndRespawn}
                            onChange={(portalsAndRespawn) =>
                              updateStandaloneWorld(worldName, {
                                standaloneSeparation: { ...standaloneSep, portalsAndRespawn },
                              })
                            }
                            label="Respawn Inside This World"
                          />
                        </div>
                      </details>
                    )}

                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '0.25rem' }}>
                      {!isDefaultWorld && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => updateDraft((p) => ({ ...p, defaultJoinWorld: worldName }))}
                        >
                          <Home size={13} aria-hidden="true" />
                          Set as Default World
                        </button>
                      )}
                      {state?.connected && !liveInfo && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={isBusy}
                          onClick={() => void handleLoadWorld(worldName)}
                        >
                          <Play size={13} aria-hidden="true" />
                          {isBusy ? 'Loading...' : 'Load Live'}
                        </button>
                      )}
                      {state?.connected && liveInfo && !isPrimaryBukkitWorld && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={isBusy}
                          onClick={() => void handleUnloadWorld(worldName)}
                        >
                          <Square size={13} aria-hidden="true" />
                          Unload
                        </button>
                      )}
                      {!isPrimaryBukkitWorld && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={isBusy}
                          aria-label={`Delete world ${worldName}`}
                          title="Delete world"
                          onClick={() => setDeleteWorldName(worldName)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* Unloaded Disk Folders ready to import */}
          {state && state.connected && state.unloadedFolders.length > 0 && (
            <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h3 className="card-title">Unloaded World Folders Detected on Disk</h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {state.unloadedFolders.map((folder) => (
                  <div
                    key={folder}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.55rem',
                      padding: '0.45rem 0.7rem',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-surface-subtle)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <span className="mono">{folder}</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyWorld === folder}
                      onClick={() => void handleLoadWorld(folder)}
                    >
                      Import &amp; Load
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ==================== TAB 3: PER-WORLD PLUGINS ==================== */}
      {subTab === 'plugins' && draft && (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <div>
              <h3 className="card-title">
                <Puzzle size={18} aria-hidden="true" />
                Per-World Plugin Scoping
              </h3>
              <span className="field-hint">
                Controls which worlds and groups receive each plugin&apos;s Bukkit events, commands, and <code>/</code> tab-completions live without restarting.
              </span>
            </div>
            <search style={{ position: 'relative', width: '240px' }}>
              <label htmlFor="pwp-search" className="visually-hidden">
                Filter plugins
              </label>
              <Search
                size={14}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  insetInlineStart: '0.65rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                }}
              />
              <input
                id="pwp-search"
                type="search"
                className="input"
                style={{ paddingInlineStart: '2rem', minHeight: '34px', fontSize: '0.85rem' }}
                placeholder="Filter plugins..."
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={pluginSearch}
                onChange={(e) => setPluginSearch(e.target.value)}
              />
            </search>
          </div>

          <div className="banner" style={{ fontSize: '0.84rem' }}>
            <span>
              <strong>How isolation works:</strong> Each restricted plugin&apos;s Bukkit event listeners are wrapped per world,
              its commands are blocked in disallowed worlds, and disallowed commands are hidden from tab-completion automatically.
              (Note: background global timers or direct plugin-to-plugin API calls remain JVM-wide.)
            </span>
          </div>

          {visiblePlugins.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.8rem' }}>
              <Puzzle size={32} style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                No other plugins found yet. Install plugins in the <strong>Plugins &amp; Configs</strong> tab to scope them per world or group.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {visiblePlugins.map((pl) => {
                const rule = getPluginRule(pl.name);
                const targetCount = rule.groups.length + rule.worlds.length;
                return (
                  <div
                    key={pl.name}
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-canvas)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.7rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <strong>{pl.name}</strong>
                        {pl.version && <span className="cfg-key-raw">v{pl.version}</span>}
                        {rule.mode === 'all' ? (
                          <span className="badge badge-neutral">All Worlds</span>
                        ) : rule.mode === 'allow' ? (
                          <span className="badge badge-online">
                            Only Selected ({targetCount})
                          </span>
                        ) : (
                          <span className="badge badge-warn">
                            Blocked in Selected ({targetCount})
                          </span>
                        )}
                      </div>

                      <div className="mode-segmented" role="group" aria-label={`World scope mode for ${pl.name}`}>
                        <button
                          type="button"
                          className={rule.mode === 'all' ? 'active' : ''}
                          aria-pressed={rule.mode === 'all'}
                          onClick={() => updatePluginRule(pl.name, { ...rule, mode: 'all' })}
                        >
                          All Worlds
                        </button>
                        <button
                          type="button"
                          className={rule.mode === 'allow' ? 'active' : ''}
                          aria-pressed={rule.mode === 'allow'}
                          onClick={() => updatePluginRule(pl.name, { ...rule, mode: 'allow' })}
                        >
                          Only Selected
                        </button>
                        <button
                          type="button"
                          className={rule.mode === 'deny' ? 'active' : ''}
                          aria-pressed={rule.mode === 'deny'}
                          onClick={() => updatePluginRule(pl.name, { ...rule, mode: 'deny' })}
                        >
                          All Except Selected
                        </button>
                      </div>
                    </div>

                    {rule.mode !== 'all' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                        {draft.groups.length > 0 && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <span className="field-hint" style={{ minWidth: '85px' }}>
                              World Groups:
                            </span>
                            {draft.groups.map((g) => {
                              const selected = rule.groups.includes(g.id);
                              return (
                                <button
                                  key={g.id}
                                  type="button"
                                  className={`scope-chip ${selected ? 'active' : ''}`}
                                  style={selected ? { borderColor: g.color, background: `${g.color}28` } : undefined}
                                  aria-pressed={selected}
                                  onClick={() => togglePluginTarget(pl.name, 'groups', g.id)}
                                >
                                  <span className="color-dot-mini" style={{ backgroundColor: g.color }} />
                                  {g.name}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          <span className="field-hint" style={{ minWidth: '85px' }}>
                            Worlds:
                          </span>
                          {allKnownWorldNames.map((wName) => {
                            const selected = rule.worlds.includes(wName);
                            return (
                              <button
                                key={wName}
                                type="button"
                                className={`scope-chip mono ${selected ? 'active' : ''}`}
                                aria-pressed={selected}
                                onClick={() => togglePluginTarget(pl.name, 'worlds', wName)}
                              >
                                {wName}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ==================== MODAL: CREATE WORLD / REALM BUNDLE ==================== */}
      <ModalDialog
        open={createModalOpen}
        title={createMode === 'bundle' ? 'Create Survival Realm (Multi-Dimension)' : 'Create Singular World (Standalone)'}
        onClose={() => !creatingWorld && setCreateModalOpen(false)}
      >
        <form onSubmit={(e) => void handleCreateWorld(e)} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div className="mode-segmented" role="group" aria-label="Creation type">
            <button
              type="button"
              className={createMode === 'bundle' ? 'active' : ''}
              aria-pressed={createMode === 'bundle'}
              onClick={() => setCreateMode('bundle')}
            >
              Survival Realm (Overworld + Nether + End)
            </button>
            <button
              type="button"
              className={createMode === 'single' ? 'active' : ''}
              aria-pressed={createMode === 'single'}
              onClick={() => setCreateMode('single')}
            >
              Singular World (Standalone)
            </button>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="cw-name">
                {createMode === 'bundle' ? 'Overworld Name' : 'World Name'}
              </label>
              <input
                id="cw-name"
                name="worldName"
                type="text"
                required
                className="input mono"
                placeholder={createMode === 'bundle' ? 'world_2' : 'custom_world'}
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={wName}
                onChange={(e) => setWName(e.target.value)}
              />
            </div>

            {createMode === 'single' ? (
              <div className="field">
                <label htmlFor="cw-env">Dimension / Environment</label>
                <select
                  id="cw-env"
                  name="environment"
                  className="select"
                  value={wEnv}
                  onChange={(e) => setWEnv(e.target.value as RealmWorldEnvironment)}
                >
                  <option value="NORMAL">Overworld (NORMAL)</option>
                  <option value="NETHER">Nether (NETHER)</option>
                  <option value="THE_END">The End (THE_END)</option>
                </select>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="cw-type-b">World Type</label>
                <select
                  id="cw-type-b"
                  name="worldType"
                  className="select"
                  value={wType}
                  onChange={(e) => setWType(e.target.value as RealmWorldType)}
                >
                  <option value="NORMAL">Normal</option>
                  <option value="FLAT">Superflat</option>
                  <option value="LARGE_BIOMES">Large Biomes</option>
                  <option value="AMPLIFIED">Amplified</option>
                </select>
              </div>
            )}
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="cw-seed">Seed (optional)</label>
              <input
                id="cw-seed"
                name="seed"
                type="text"
                className="input mono"
                placeholder="Random seed if blank"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={wSeed}
                onChange={(e) => setWSeed(e.target.value)}
              />
            </div>

            {createMode === 'single' ? (
              <div className="field">
                <label htmlFor="cw-type-s">World Type</label>
                <select
                  id="cw-type-s"
                  name="worldType"
                  className="select"
                  value={wType}
                  onChange={(e) => setWType(e.target.value as RealmWorldType)}
                >
                  <option value="NORMAL">Normal</option>
                  <option value="FLAT">Superflat</option>
                  <option value="LARGE_BIOMES">Large Biomes</option>
                  <option value="AMPLIFIED">Amplified</option>
                </select>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="cw-gm">Default Gamemode</label>
                <select
                  id="cw-gm"
                  name="defaultGameMode"
                  className="select"
                  value={wGameMode}
                  onChange={(e) => setWGameMode(e.target.value as RealmGameMode)}
                >
                  <option value="">Keep Player&apos;s Mode</option>
                  <option value="SURVIVAL">Survival</option>
                  <option value="CREATIVE">Creative</option>
                  <option value="ADVENTURE">Adventure</option>
                </select>
              </div>
            )}
          </div>

          <Switch checked={wStructures} onChange={setWStructures} label="Generate structures (villages, fortresses, strongholds)" />

          {createMode === 'bundle' ? (
            <>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap' }}>
                  <Switch checked={wCreateNether} onChange={setWCreateNether} label={`Create Nether (${wNetherName || `${wName || 'world'}_nether`})`} />
                  <Switch checked={wCreateEnd} onChange={setWCreateEnd} label={`Create End (${wEndName || `${wName || 'world'}_the_end`})`} />
                </div>
                <span className="field-hint">
                  Tip: Uncheck &quot;Create Nether&quot; if you want this realm to share an existing Nether (such as{' '}
                  <code>{defaultNetherName}</code>) with colored portals!
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <Switch
                  checked={wCreateGroup}
                  onChange={setWCreateGroup}
                  label="Automatically create a Player World Group for this realm"
                />
                {wCreateGroup && (
                  <div className="grid-2">
                    <div className="field">
                      <label htmlFor="cw-gname">Group Display Name</label>
                      <input
                        id="cw-gname"
                        type="text"
                        className="input"
                        value={wGroupName}
                        onChange={(e) => setWGroupName(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="cw-gcolor">Group &amp; Portal Color</label>
                      <div className="color-swatch-row">
                        <input
                          id="cw-gcolor"
                          type="color"
                          className="color-input-native"
                          value={wGroupColor}
                          onChange={(e) => setWGroupColor(e.target.value)}
                        />
                        {PRESET_COLORS.map((hex) => (
                          <button
                            key={hex}
                            type="button"
                            className={`color-dot-btn ${wGroupColor.toLowerCase() === hex ? 'active' : ''}`}
                            style={{ backgroundColor: hex }}
                            aria-label={`Select color ${hex}`}
                            onClick={() => setWGroupColor(hex)}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.55rem',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <span className="field-hint">
                This world will not be assigned to any player group — move players here manually or set it as the default world.
              </span>
              <div className="field">
                <label htmlFor="cw-gm-s">Default Gamemode</label>
                <select
                  id="cw-gm-s"
                  className="select"
                  value={wGameMode}
                  onChange={(e) => setWGameMode(e.target.value as RealmGameMode)}
                >
                  <option value="">Keep Player&apos;s Mode</option>
                  <option value="ADVENTURE">Adventure</option>
                  <option value="SURVIVAL">Survival</option>
                  <option value="CREATIVE">Creative</option>
                  <option value="SPECTATOR">Spectator</option>
                </select>
              </div>
              <Switch
                checked={wStandaloneSep.inventory}
                onChange={(inventory) => setWStandaloneSep((s) => ({ ...s, inventory }))}
                label="Separate Inventory & Stats from Survival Realms"
              />
              <Switch
                checked={wStandaloneSep.chat}
                onChange={(chat) => setWStandaloneSep((s) => ({ ...s, chat }))}
                label="Separate Chat"
              />
              <Switch
                checked={wStandaloneSep.visibility}
                onChange={(visibility) => setWStandaloneSep((s) => ({ ...s, visibility }))}
                label="Separate Tab List & Visibility"
              />
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' }}>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={creatingWorld}
              onClick={() => setCreateModalOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={creatingWorld}>
              {creatingWorld ? 'Generating World(s)...' : createMode === 'bundle' ? 'Create Realm' : 'Create World'}
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* ==================== MODAL: ADD PLAYER GROUP ==================== */}
      <ModalDialog
        open={groupModalOpen}
        title="Add Player World Group (List)"
        onClose={() => setGroupModalOpen(false)}
      >
        <form onSubmit={handleAddGroup} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div className="field">
            <label htmlFor="ng-name">Group Name</label>
            <input
              id="ng-name"
              type="text"
              required
              className="input"
              placeholder="e.g. Survival Group 1"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="ng-color">Group &amp; Portal Color</label>
            <div className="color-swatch-row">
              <input
                id="ng-color"
                type="color"
                className="color-input-native"
                value={newGroupColor}
                onChange={(e) => setNewGroupColor(e.target.value)}
              />
              {PRESET_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  className={`color-dot-btn ${newGroupColor.toLowerCase() === hex ? 'active' : ''}`}
                  style={{ backgroundColor: hex }}
                  aria-label={`Select color ${hex}`}
                  onClick={() => setNewGroupColor(hex)}
                />
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="ng-ow">Overworld</label>
            <select
              id="ng-ow"
              className="select mono"
              value={newGroupOverworld}
              onChange={(e) => setNewGroupOverworld(e.target.value)}
            >
              {allKnownWorldNames.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="ng-nether">Nether (optional / shareable)</label>
              <select
                id="ng-nether"
                className="select mono"
                value={newGroupNether}
                onChange={(e) => setNewGroupNether(e.target.value)}
              >
                <option value="">(None)</option>
                {allKnownWorldNames.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ng-end">The End (optional)</label>
              <select
                id="ng-end"
                className="select mono"
                value={newGroupEnd}
                onChange={(e) => setNewGroupEnd(e.target.value)}
              >
                <option value="">(None)</option>
                {allKnownWorldNames.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setGroupModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Add Group
            </button>
          </div>
        </form>
      </ModalDialog>

      {/* ==================== CONFIRM DELETE WORLD ==================== */}
      <ConfirmDialog
        open={Boolean(deleteWorldName)}
        title={`Delete World "${deleteWorldName || ''}"?`}
        message="This will unload the world (evacuating any players safely) and permanently delete its world folder from disk. Make a backup first if you might need it later."
        confirmLabel="Delete World"
        danger
        onClose={() => setDeleteWorldName(null)}
        onConfirm={() => void handleDeleteWorld()}
      />
    </div>
  );
}
