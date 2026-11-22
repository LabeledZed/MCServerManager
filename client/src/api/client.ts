import type {
  AddonKind,
  AuthSessionInfo,
  BackupInfo,
  BridgeGamerule,
  BridgeStatusResponse,
  ConfigTreeNode,
  ConsoleLine,
  FileEntry,
  FloodgateConfigValues,
  GeyserConfigValues,
  GeyserStatusResponse,
  InstalledAddon,
  JavaDownloadStatus,
  JavaRuntimeInfo,
  LogFileInfo,
  LogSearchResponse,
  ModrinthSearchResult,
  ModrinthVersionInfo,
  OrphanConfigFolder,
  PanelSettings,
  ParsedConfigDocument,
  Permission,
  PlayersState,
  RealmsConfig,
  RealmsStateResponse,
  RealmGameMode,
  RealmWorldEnvironment,
  RealmWorldType,
  ScheduleAction,
  ScheduledTask,
  ScheduleTrigger,
  SeparationOptions,
  ServerConfig,
  ServerConfigFileEntry,
  ServerRuntimeState,
  ServerSoftware,
  ServerSummary,
  UserAccount,
  UserRole,
  VelocityForwardingMode,
  VelocityNetworkState,
  WorldInfo,
} from '../../../shared/types';

export interface HostStats {
  platform: string;
  arch: string;
  hostname: string;
  cpuModel: string;
  cpuCores: number;
  totalMemMb: number;
  usedMemMb: number;
  freeMemMb: number;
  uptimeSeconds: number;
}

export interface InspectedExistingServer {
  sourcePath: string;
  suggestedName: string;
  software: ServerSoftware;
  mcVersion: string;
  jarFile: string;
  jarCandidates: string[];
  port: number;
  eulaAccepted: boolean;
  isSpigotCompatible: boolean;
  worldCount: number;
  pluginOrModCount: number;
  sizeBytes: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: init?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const errMsg = (data as { error?: string } | null)?.error || `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return data as T;
}

export const api = {
  // Auth & Users
  getSession: () => request<AuthSessionInfo>('/api/auth/session'),
  login: (username: string, password: string) =>
    request<AuthSessionInfo>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  getPanelSettings: () => request<PanelSettings>('/api/auth/settings'),
  updatePanelSettings: (patch: Partial<PanelSettings>) =>
    request<PanelSettings>('/api/auth/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  listUsers: () => request<UserAccount[]>('/api/auth/users'),
  createUser: (payload: { username: string; password: string; role: UserRole; permissions: Permission[] }) =>
    request<UserAccount>('/api/auth/users', { method: 'POST', body: JSON.stringify(payload) }),
  updateUser: (
    id: string,
    payload: { username?: string; password?: string; role?: UserRole; permissions?: Permission[] },
  ) =>
    request<UserAccount>(`/api/auth/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteUser: (id: string) =>
    request<{ ok: boolean }>(`/api/auth/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Host & Servers
  getHostStats: () => request<HostStats>('/api/servers/host/stats'),
  listServers: () => request<ServerSummary[]>('/api/servers'),
  getNextServerPort: () => request<{ port: number }>('/api/servers/next-port'),
  getServer: (id: string) => request<ServerSummary>(`/api/servers/${encodeURIComponent(id)}`),
  createServer: (payload: {
    name: string;
    software: ServerSoftware;
    mcVersion: string;
    port: number;
    minRamMb: number;
    maxRamMb: number;
    javaPath: string;
    jvmPreset: ServerConfig['jvmPreset'];
    eulaAccepted: boolean;
    motd?: string;
    skipDownload?: boolean;
  }) => request<ServerSummary>('/api/servers', { method: 'POST', body: JSON.stringify(payload) }),
  pickImportFolder: () =>
    request<{ path: string | null }>('/api/servers/import/pick-folder', { method: 'POST' }),
  inspectImportFolder: (sourcePath: string) =>
    request<InspectedExistingServer>('/api/servers/import/inspect', {
      method: 'POST',
      body: JSON.stringify({ sourcePath }),
    }),
  importServer: (payload: {
    sourcePath: string;
    transferMode: 'move' | 'copy';
    name: string;
    software: ServerSoftware;
    mcVersion: string;
    jarFile: string;
    port: number;
    minRamMb: number;
    maxRamMb: number;
    javaPath: string;
    jvmPreset: ServerConfig['jvmPreset'];
    installBridge: boolean;
  }) => request<ServerSummary>('/api/servers/import', { method: 'POST', body: JSON.stringify(payload) }),
  updateServer: (id: string, patch: Partial<ServerConfig>) =>
    request<ServerSummary>(`/api/servers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  reinstallServer: (id: string, software: ServerSoftware, mcVersion: string) =>
    request<{ ok: boolean }>(`/api/servers/${encodeURIComponent(id)}/reinstall`, {
      method: 'POST',
      body: JSON.stringify({ software, mcVersion }),
    }),
  deleteServer: (id: string, deleteFiles = true) =>
    request<{ ok: boolean }>(`/api/servers/${encodeURIComponent(id)}?deleteFiles=${deleteFiles}`, {
      method: 'DELETE',
    }),
  powerServer: (id: string, action: 'start' | 'stop' | 'restart' | 'kill') =>
    request<{ ok: boolean; runtime?: ServerRuntimeState }>(`/api/servers/${encodeURIComponent(id)}/power`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  sendCommand: (id: string, command: string) =>
    request<{ ok: boolean }>(`/api/servers/${encodeURIComponent(id)}/command`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    }),
  getConsole: (id: string) =>
    request<{ lines: ConsoleLine[] }>(`/api/servers/${encodeURIComponent(id)}/console`),
  listLogFiles: (id: string) =>
    request<{ files: LogFileInfo[] }>(`/api/servers/${encodeURIComponent(id)}/logs`),
  searchLogs: (
    id: string,
    payload: {
      query: string;
      regex?: boolean;
      caseSensitive?: boolean;
      files?: string[];
      maxResults?: number;
    },
  ) =>
    request<LogSearchResponse>(`/api/servers/${encodeURIComponent(id)}/logs/search`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Catalog & Java
  listSoftwareVersions: (software: ServerSoftware) =>
    request<{ software: ServerSoftware; versions: string[] }>(`/api/catalog/versions/${software}`),
  listJavaRuntimes: () =>
    request<{ runtimes: JavaRuntimeInfo[]; downloads: JavaDownloadStatus[] }>('/api/java'),
  recommendJava: (mcVersion: string) =>
    request<{ major: number }>(`/api/java/recommend/${encodeURIComponent(mcVersion)}`),
  downloadJava: (major: number) =>
    request<{ ok: boolean; major: number }>('/api/java/download', {
      method: 'POST',
      body: JSON.stringify({ major }),
    }),

  // Configs (All server types + plugin/mod YAML/JSON/TOML/Properties/Raw)
  listServerConfigs: (serverId: string) =>
    request<{ configs: ServerConfigFileEntry[] }>(`/api/servers/${encodeURIComponent(serverId)}/configs`),
  readConfigFile: (serverId: string, relPath: string) =>
    request<ParsedConfigDocument>(
      `/api/servers/${encodeURIComponent(serverId)}/configs/file?path=${encodeURIComponent(relPath)}`,
    ),
  saveConfigTree: (serverId: string, relPath: string, tree: ConfigTreeNode[]) =>
    request<ParsedConfigDocument>(`/api/servers/${encodeURIComponent(serverId)}/configs/file`, {
      method: 'PUT',
      body: JSON.stringify({ path: relPath, mode: 'tree', tree }),
    }),
  saveConfigRaw: (serverId: string, relPath: string, raw: string) =>
    request<ParsedConfigDocument>(`/api/servers/${encodeURIComponent(serverId)}/configs/file`, {
      method: 'PUT',
      body: JSON.stringify({ path: relPath, mode: 'raw', raw }),
    }),
  createConfigFile: (serverId: string, relPath: string, initialContent?: string) =>
    request<ParsedConfigDocument>(`/api/servers/${encodeURIComponent(serverId)}/configs/create`, {
      method: 'POST',
      body: JSON.stringify({ path: relPath, initialContent }),
    }),

  // Plugins & Mods
  listAddons: (serverId: string) =>
    request<{
      kind: AddonKind;
      addonDir: string;
      addons: InstalledAddon[];
      orphanFolders: OrphanConfigFolder[];
    }>(`/api/servers/${encodeURIComponent(serverId)}/addons`),
  uploadAddon: (serverId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ ok: boolean; fileName: string }>(
      `/api/servers/${encodeURIComponent(serverId)}/addons/upload`,
      { method: 'POST', body: fd },
    );
  },
  toggleAddon: (serverId: string, fileName: string) =>
    request<{ ok: boolean; fileName: string }>(
      `/api/servers/${encodeURIComponent(serverId)}/addons/${encodeURIComponent(fileName)}/toggle`,
      { method: 'POST' },
    ),
  setAddonConfigFolder: (serverId: string, fileName: string, folderName: string) =>
    request<{ ok: boolean }>(
      `/api/servers/${encodeURIComponent(serverId)}/addons/${encodeURIComponent(fileName)}/config-folder`,
      { method: 'PUT', body: JSON.stringify({ folderName }) },
    ),
  deleteAddon: (serverId: string, fileName: string, deleteConfigs = false, configFolder?: string | null) => {
    const params = new URLSearchParams({ deleteConfigs: String(deleteConfigs) });
    if (configFolder) params.set('configFolder', configFolder);
    return request<{ ok: boolean; queued?: boolean; message?: string }>(
      `/api/servers/${encodeURIComponent(serverId)}/addons/${encodeURIComponent(fileName)}?${params}`,
      { method: 'DELETE' },
    );
  },
  cancelPendingAddonDelete: (serverId: string, fileName: string) =>
    request<{ ok: boolean }>(
      `/api/servers/${encodeURIComponent(serverId)}/addons/${encodeURIComponent(fileName)}/pending`,
      { method: 'DELETE' },
    ),
  searchModrinth: (serverId: string, query: string, allVersions = false) =>
    request<{ hits: ModrinthSearchResult[] }>(
      `/api/servers/${encodeURIComponent(serverId)}/addons/modrinth/search?q=${encodeURIComponent(query)}&allVersions=${allVersions}`,
    ),
  listModrinthVersions: (serverId: string, projectId: string) =>
    request<{ versions: ModrinthVersionInfo[] }>(
      `/api/servers/${encodeURIComponent(serverId)}/addons/modrinth/${encodeURIComponent(projectId)}/versions`,
    ),
  installModrinth: (serverId: string, downloadUrl: string, fileName: string) =>
    request<{ ok: boolean; fileName: string }>(
      `/api/servers/${encodeURIComponent(serverId)}/addons/modrinth/install`,
      { method: 'POST', body: JSON.stringify({ downloadUrl, fileName }) },
    ),

  // Files
  listFiles: (serverId: string, relPath = '') =>
    request<{ path: string; entries: FileEntry[] }>(
      `/api/servers/${encodeURIComponent(serverId)}/files?path=${encodeURIComponent(relPath)}`,
    ),
  mkdir: (serverId: string, relPath: string) =>
    request<{ ok: boolean }>(`/api/servers/${encodeURIComponent(serverId)}/files/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path: relPath }),
    }),
  touchFile: (serverId: string, relPath: string, content = '') =>
    request<{ ok: boolean }>(`/api/servers/${encodeURIComponent(serverId)}/files/touch`, {
      method: 'POST',
      body: JSON.stringify({ path: relPath, content }),
    }),
  uploadFiles: (serverId: string, dirRelPath: string, files: FileList | File[]) => {
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    return request<{ ok: boolean; files: string[] }>(
      `/api/servers/${encodeURIComponent(serverId)}/files/upload?path=${encodeURIComponent(dirRelPath)}`,
      { method: 'POST', body: fd },
    );
  },
  renameFile: (serverId: string, from: string, to: string) =>
    request<{ ok: boolean }>(`/api/servers/${encodeURIComponent(serverId)}/files/rename`, {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),
  extractZip: (serverId: string, relPath: string) =>
    request<{ ok: boolean }>(`/api/servers/${encodeURIComponent(serverId)}/files/extract`, {
      method: 'POST',
      body: JSON.stringify({ path: relPath }),
    }),
  deleteFile: (serverId: string, relPath: string) =>
    request<{ ok: boolean }>(
      `/api/servers/${encodeURIComponent(serverId)}/files?path=${encodeURIComponent(relPath)}`,
      { method: 'DELETE' },
    ),

  // Players
  getPlayers: (serverId: string) =>
    request<PlayersState>(`/api/servers/${encodeURIComponent(serverId)}/players`),
  setWhitelistEnabled: (serverId: string, enabled: boolean) =>
    request<{ ok: boolean }>(`/api/servers/${encodeURIComponent(serverId)}/players/whitelist/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    }),
  addWhitelist: (serverId: string, username: string) =>
    request(`/api/servers/${encodeURIComponent(serverId)}/players/whitelist`, {
      method: 'POST',
      body: JSON.stringify({ username }),
    }),
  removeWhitelist: (serverId: string, username: string) =>
    request(`/api/servers/${encodeURIComponent(serverId)}/players/whitelist/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    }),
  addOp: (serverId: string, username: string, level: number) =>
    request(`/api/servers/${encodeURIComponent(serverId)}/players/ops`, {
      method: 'POST',
      body: JSON.stringify({ username, level }),
    }),
  removeOp: (serverId: string, username: string) =>
    request(`/api/servers/${encodeURIComponent(serverId)}/players/ops/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    }),
  banPlayer: (serverId: string, username: string, reason: string) =>
    request(`/api/servers/${encodeURIComponent(serverId)}/players/bans`, {
      method: 'POST',
      body: JSON.stringify({ username, reason }),
    }),
  unbanPlayer: (serverId: string, username: string) =>
    request(`/api/servers/${encodeURIComponent(serverId)}/players/bans/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    }),
  banIp: (serverId: string, ip: string, reason: string) =>
    request(`/api/servers/${encodeURIComponent(serverId)}/players/ban-ips`, {
      method: 'POST',
      body: JSON.stringify({ ip, reason }),
    }),
  unbanIp: (serverId: string, ip: string) =>
    request(`/api/servers/${encodeURIComponent(serverId)}/players/ban-ips/${encodeURIComponent(ip)}`, {
      method: 'DELETE',
    }),
  kickPlayer: (serverId: string, username: string, reason: string) =>
    request(`/api/servers/${encodeURIComponent(serverId)}/players/kick`, {
      method: 'POST',
      body: JSON.stringify({ username, reason }),
    }),

  // Worlds, Backups & Schedules
  listWorlds: (serverId: string) =>
    request<{ worlds: WorldInfo[] }>(`/api/servers/${encodeURIComponent(serverId)}/worlds`),
  uploadWorld: (
    serverId: string,
    worldName: string,
    file: File,
    subPath?: string,
    options?: { registerRealmWorld?: string; environment?: 'NORMAL' | 'NETHER' | 'THE_END' },
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    const params = new URLSearchParams();
    if (subPath) params.set('subPath', subPath);
    if (options?.registerRealmWorld) params.set('registerRealmWorld', options.registerRealmWorld);
    if (options?.environment) params.set('environment', options.environment);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<{ ok: boolean }>(
      `/api/servers/${encodeURIComponent(serverId)}/worlds/${encodeURIComponent(worldName)}/upload${qs}`,
      { method: 'POST', body: fd },
    );
  },
  deleteWorld: (serverId: string, worldName: string, subPath?: string) => {
    const qs = subPath ? `?subPath=${encodeURIComponent(subPath)}` : '';
    return request<{ ok: boolean }>(
      `/api/servers/${encodeURIComponent(serverId)}/worlds/${encodeURIComponent(worldName)}${qs}`,
      { method: 'DELETE' },
    );
  },
  listBackups: (serverId: string) =>
    request<{ backups: BackupInfo[] }>(`/api/servers/${encodeURIComponent(serverId)}/backups`),
  createBackup: (serverId: string, label: string, scope: 'full' | 'worlds') =>
    request<BackupInfo>(`/api/servers/${encodeURIComponent(serverId)}/backups`, {
      method: 'POST',
      body: JSON.stringify({ label, scope }),
    }),
  restoreBackup: (serverId: string, backupId: string) =>
    request<{ ok: boolean }>(
      `/api/servers/${encodeURIComponent(serverId)}/backups/${encodeURIComponent(backupId)}/restore`,
      { method: 'POST' },
    ),
  deleteBackup: (serverId: string, backupId: string) =>
    request<{ ok: boolean }>(
      `/api/servers/${encodeURIComponent(serverId)}/backups/${encodeURIComponent(backupId)}`,
      { method: 'DELETE' },
    ),
  listSchedules: (serverId: string) =>
    request<{ tasks: ScheduledTask[] }>(`/api/servers/${encodeURIComponent(serverId)}/schedules`),
  createSchedule: (
    serverId: string,
    payload: {
      name: string;
      trigger: ScheduleTrigger;
      action: ScheduleAction;
      payload?: string;
      onlyWhenRunning: boolean;
      enabled?: boolean;
    },
  ) =>
    request<ScheduledTask>(`/api/servers/${encodeURIComponent(serverId)}/schedules`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSchedule: (serverId: string, taskId: string, patch: Partial<ScheduledTask>) =>
    request<ScheduledTask>(
      `/api/servers/${encodeURIComponent(serverId)}/schedules/${encodeURIComponent(taskId)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    ),
  runSchedule: (serverId: string, taskId: string) =>
    request<{ ok: boolean; skipped?: boolean; message: string }>(
      `/api/servers/${encodeURIComponent(serverId)}/schedules/${encodeURIComponent(taskId)}/run`,
      { method: 'POST' },
    ),
  deleteSchedule: (serverId: string, taskId: string) =>
    request<{ ok: boolean }>(
      `/api/servers/${encodeURIComponent(serverId)}/schedules/${encodeURIComponent(taskId)}`,
      { method: 'DELETE' },
    ),

  // Companion Bridge Plugin (Live Gamerules, World Environment, Players, Broadcast)
  getBridgeStatus: (serverId: string) =>
    request<BridgeStatusResponse>(`/api/servers/${encodeURIComponent(serverId)}/bridge/status`),
  installBridge: (serverId: string) =>
    request<{ ok: boolean; port: number }>(`/api/servers/${encodeURIComponent(serverId)}/bridge/install`, {
      method: 'POST',
    }),
  uninstallBridge: (serverId: string) =>
    request<{ ok: boolean }>(`/api/servers/${encodeURIComponent(serverId)}/bridge/install`, {
      method: 'DELETE',
    }),
  getGamerules: (serverId: string, world: string) =>
    request<{ world: string; gamerules: BridgeGamerule[] }>(
      `/api/servers/${encodeURIComponent(serverId)}/bridge/worlds/${encodeURIComponent(world)}/gamerules`,
    ),
  setGamerule: (serverId: string, world: string, name: string, value: string | number | boolean) =>
    request<{ ok: boolean; name: string; value: string }>(
      `/api/servers/${encodeURIComponent(serverId)}/bridge/worlds/${encodeURIComponent(world)}/gamerules`,
      { method: 'PUT', body: JSON.stringify({ name, value }) },
    ),
  updateWorldEnvironment: (
    serverId: string,
    world: string,
    patch: {
      time?: number;
      weather?: 'clear' | 'rain' | 'thunder';
      difficulty?: 'PEACEFUL' | 'EASY' | 'NORMAL' | 'HARD';
      pvp?: boolean;
      borderSize?: number;
      save?: boolean;
    },
  ) =>
    request<{ ok: boolean }>(
      `/api/servers/${encodeURIComponent(serverId)}/bridge/worlds/${encodeURIComponent(world)}/environment`,
      { method: 'PUT', body: JSON.stringify(patch) },
    ),
  bridgePlayerAction: (
    serverId: string,
    player: string,
    payload: {
      action: 'gamemode' | 'heal' | 'spawn' | 'tp' | 'xp' | 'message' | 'kick' | 'send';
      value?: string | number;
      x?: number;
      y?: number;
      z?: number;
      world?: string;
    },
  ) =>
    request<{ ok: boolean }>(
      `/api/servers/${encodeURIComponent(serverId)}/bridge/players/${encodeURIComponent(player)}/action`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  bridgeBroadcast: (serverId: string, message: string) =>
    request<{ ok: boolean }>(`/api/servers/${encodeURIComponent(serverId)}/bridge/broadcast`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  // Realms, Multi-World, Colored Portals & Per-World Plugins
  getRealmsState: (serverId: string) =>
    request<RealmsStateResponse>(`/api/servers/${encodeURIComponent(serverId)}/bridge/realms`),
  saveRealmsConfig: (serverId: string, config: RealmsConfig) =>
    request<RealmsStateResponse>(`/api/servers/${encodeURIComponent(serverId)}/bridge/realms`, {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  createRealmWorld: (
    serverId: string,
    payload: {
      bundle?: boolean;
      name: string;
      environment?: RealmWorldEnvironment;
      worldType?: RealmWorldType;
      seed?: string;
      generateStructures?: boolean;
      generator?: string;
      defaultGameMode?: RealmGameMode;
      standaloneSeparation?: SeparationOptions;
      color?: string;
      createNether?: boolean;
      createEnd?: boolean;
      netherName?: string;
      endName?: string;
      createGroup?: boolean;
      groupName?: string;
      groupColor?: string;
      groupSeparation?: SeparationOptions;
    },
  ) =>
    request<{ ok: boolean; created: string[]; live: boolean; state: RealmsStateResponse }>(
      `/api/servers/${encodeURIComponent(serverId)}/bridge/realms/worlds`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  loadRealmWorld: (serverId: string, worldName: string, environment?: RealmWorldEnvironment) =>
    request<RealmsStateResponse>(
      `/api/servers/${encodeURIComponent(serverId)}/bridge/realms/worlds/${encodeURIComponent(worldName)}/load`,
      { method: 'POST', body: JSON.stringify(environment ? { environment } : {}) },
    ),
  unloadRealmWorld: (serverId: string, worldName: string, save = true) =>
    request<RealmsStateResponse>(
      `/api/servers/${encodeURIComponent(serverId)}/bridge/realms/worlds/${encodeURIComponent(worldName)}/unload`,
      { method: 'POST', body: JSON.stringify({ save }) },
    ),
  deleteRealmWorld: (serverId: string, worldName: string) =>
    request<RealmsStateResponse>(
      `/api/servers/${encodeURIComponent(serverId)}/bridge/realms/worlds/${encodeURIComponent(worldName)}`,
      { method: 'DELETE' },
    ),
  moveRealmPlayer: (
    serverId: string,
    playerName: string,
    payload: { world?: string; groupId?: string; assignToGroup?: boolean },
  ) =>
    request<RealmsStateResponse>(
      `/api/servers/${encodeURIComponent(serverId)}/bridge/realms/players/${encodeURIComponent(playerName)}/move`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  clearTrackedPortals: (serverId: string, portalId?: string) =>
    request<RealmsStateResponse>(
      portalId
        ? `/api/servers/${encodeURIComponent(serverId)}/bridge/realms/portals/${encodeURIComponent(portalId)}`
        : `/api/servers/${encodeURIComponent(serverId)}/bridge/realms/portals`,
      { method: 'DELETE' },
    ),

  // Bedrock Cross-Play (Geyser & Floodgate — all server types)
  getGeyserStatus: (serverId: string) =>
    request<GeyserStatusResponse>(`/api/servers/${encodeURIComponent(serverId)}/geyser`),
  installGeyser: (serverId: string) =>
    request<GeyserStatusResponse>(`/api/servers/${encodeURIComponent(serverId)}/geyser/install`, {
      method: 'POST',
    }),
  uninstallGeyser: (serverId: string) =>
    request<GeyserStatusResponse>(`/api/servers/${encodeURIComponent(serverId)}/geyser/install`, {
      method: 'DELETE',
    }),
  cancelPendingGeyserUninstall: (serverId: string) =>
    request<GeyserStatusResponse>(`/api/servers/${encodeURIComponent(serverId)}/geyser/install/pending`, {
      method: 'DELETE',
    }),
  installFloodgate: (serverId: string) =>
    request<GeyserStatusResponse>(`/api/servers/${encodeURIComponent(serverId)}/geyser/floodgate/install`, {
      method: 'POST',
    }),
  uninstallFloodgate: (serverId: string) =>
    request<GeyserStatusResponse>(`/api/servers/${encodeURIComponent(serverId)}/geyser/floodgate/install`, {
      method: 'DELETE',
    }),
  cancelPendingFloodgateUninstall: (serverId: string) =>
    request<GeyserStatusResponse>(`/api/servers/${encodeURIComponent(serverId)}/geyser/floodgate/install/pending`, {
      method: 'DELETE',
    }),
  updateGeyserConfig: (
    serverId: string,
    patch: Partial<GeyserConfigValues> & { standaloneEnabled?: boolean },
  ) =>
    request<GeyserStatusResponse>(`/api/servers/${encodeURIComponent(serverId)}/geyser/config`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  updateFloodgateConfig: (serverId: string, patch: Partial<FloodgateConfigValues>) =>
    request<GeyserStatusResponse>(`/api/servers/${encodeURIComponent(serverId)}/geyser/floodgate/config`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  // Velocity Proxy Network
  getVelocityNetwork: (serverId: string) =>
    request<VelocityNetworkState>(`/api/servers/${encodeURIComponent(serverId)}/velocity`),
  updateVelocityConfig: (
    serverId: string,
    patch: {
      bind?: string;
      motd?: string;
      showMaxPlayers?: number;
      onlineMode?: boolean;
      forwardingMode?: VelocityForwardingMode;
      servers?: Array<{ alias: string; address: string }>;
      tryOrder?: string[];
      forcedHosts?: Record<string, string[]>;
    },
  ) =>
    request<VelocityNetworkState>(`/api/servers/${encodeURIComponent(serverId)}/velocity/config`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  linkVelocityManagedServer: (
    serverId: string,
    payload: {
      targetServerId: string;
      alias?: string;
      addToTry?: boolean;
      autoConfigureForwarding?: boolean;
      syncFloodgateKey?: boolean;
    },
  ) =>
    request<{ state: VelocityNetworkState; notes: string[] }>(
      `/api/servers/${encodeURIComponent(serverId)}/velocity/link-managed`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  regenerateVelocitySecret: (serverId: string) =>
    request<VelocityNetworkState>(`/api/servers/${encodeURIComponent(serverId)}/velocity/secret/regenerate`, {
      method: 'POST',
    }),
  syncVelocityFloodgateKey: (serverId: string, targetServerId: string) =>
    request<{ copiedTo: string }>(
      `/api/servers/${encodeURIComponent(serverId)}/velocity/sync-floodgate-key/${encodeURIComponent(targetServerId)}`,
      { method: 'POST' },
    ),
};

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
