export type ServerSoftware =
  | 'paper'
  | 'purpur'
  | 'leaf'
  | 'vanilla'
  | 'fabric'
  | 'neoforge'
  | 'forge'
  | 'folia'
  | 'velocity'
  | 'spigot'
  | 'custom';

export type ServerStatus = 'offline' | 'starting' | 'online' | 'stopping' | 'crashed' | 'installing';

export type JvmPreset = 'aikar' | 'g1gc' | 'zgc' | 'custom';

export interface PendingAddonDeletion {
  fileName: string;
  deleteConfigs: boolean;
  configFolder?: string | null;
}

export interface ServerConfig {
  id: string;
  name: string;
  software: ServerSoftware;
  mcVersion: string;
  build?: string;
  jarFile: string;
  port: number;
  minRamMb: number;
  maxRamMb: number;
  javaPath: string; // 'auto' or absolute path to java binary
  jvmPreset: JvmPreset;
  customJvmArgs: string;
  autoStart?: boolean;
  autoRestart: boolean;
  maxRestartAttempts: number;
  stopCommand: string;
  eulaAccepted: boolean;
  createdAt: string;
  lastStartedAt?: string;
  lastPid?: number | null;
  /** Optional custom folder overrides per plugin/mod jar filename */
  pluginConfigFolderOverrides?: Record<string, string>;
  /** Plugins/mods locked by Java while running, queued for automatic removal when server stops */
  pendingAddonDeletions?: PendingAddonDeletion[];
  /** Companion management bridge plugin/mod settings */
  bridgeEnabled?: boolean;
  bridgePort?: number;
  bridgeToken?: string;
  /** Geyser Standalone sidecar settings (used on Vanilla & Forge) */
  geyserStandaloneEnabled?: boolean;
  geyserBedrockPort?: number;
}

export interface TelemetryPoint {
  ts: number;
  cpuPercent: number;
  memoryMb: number;
  playersOnline: number;
  tps: number | null;
}

export interface ServerRuntimeState {
  id: string;
  status: ServerStatus;
  pid: number | null;
  startedAt: number | null;
  uptimeSeconds: number;
  cpuPercent: number;
  memoryMb: number;
  playersOnline: number;
  maxPlayers: number;
  onlinePlayerNames: string[];
  tps: number | null;
  motd: string;
  lastExitCode: number | null;
  restartAttempts: number;
  history: TelemetryPoint[];
  installProgress?: {
    stage: string;
    percent: number;
    message: string;
    recentLines?: string[];
  } | null;
}

export interface ServerSummary extends ServerConfig {
  runtime: ServerRuntimeState;
  directory: string;
  diskSizeBytes?: number;
}

export interface ConsoleLine {
  id: number;
  ts: number;
  stream: 'stdout' | 'stderr' | 'system' | 'command';
  level: 'info' | 'warn' | 'error' | 'chat' | 'system' | 'command';
  text: string;
}

export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface LogSearchMatch {
  file: string;
  lineNumber: number;
  text: string;
}

export interface LogSearchResponse {
  matches: LogSearchMatch[];
  filesSearched: number;
  truncated: boolean;
  totalMatches: number;
}

// ---------- Beautified Config Tree Types ----------

export type ConfigFormat = 'yaml' | 'json' | 'toml' | 'properties' | 'raw';

export type ConfigValueKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface ConfigTreeNode {
  key: string;
  path: (string | number)[];
  kind: ConfigValueKind;
  value?: string | number | boolean | null;
  children?: ConfigTreeNode[];
  comment?: string;
  inlineComment?: string;
  /** Optional curated UI metadata (e.g., server.properties descriptions & options) */
  meta?: {
    label?: string;
    description?: string;
    category?: string;
    options?: string[];
    min?: number;
    max?: number;
    placeholder?: string;
  };
}

export interface ParsedConfigDocument {
  relativePath: string;
  fileName: string;
  format: ConfigFormat;
  raw: string;
  supportsVisual: boolean;
  parseError?: string;
  tree?: ConfigTreeNode[];
  sizeBytes: number;
  modifiedAt: string;
}

export interface ServerConfigFileEntry {
  id: string;
  relativePath: string;
  fileName: string;
  label: string;
  category: 'core' | 'bukkit-spigot' | 'paper-purpur' | 'world' | 'modloader' | 'proxy' | 'other';
  softwareHint: string;
  description: string;
  format: ConfigFormat;
  exists: boolean;
  sizeBytes: number;
  modifiedAt?: string;
}

// ---------- Plugins & Mods ----------

export type AddonKind = 'plugin' | 'mod';

export interface AddonManifestInfo {
  name: string;
  id: string;
  version: string;
  description?: string;
  authors?: string[];
  website?: string;
  apiVersion?: string;
  manifestSource: string; // e.g., "paper-plugin.yml", "plugin.yml", "manifest.json", "fabric.mod.json", "neoforge.mods.toml"
}

export interface AddonConfigFile {
  /** Path relative to server root (used for read/write API) */
  relativePath: string;
  /** Path relative to the plugin/mod config root (e.g. "config.yml", "worlds/world/config.yml") */
  subPath: string;
  /** Directory relative to config root ("" for root, "worlds/world" for nested) */
  folder: string;
  fileName: string;
  format: ConfigFormat;
  sizeBytes: number;
  modifiedAt: string;
  isBinary: boolean;
}

export interface InstalledAddon {
  fileName: string;
  kind: AddonKind;
  enabled: boolean;
  sizeBytes: number;
  modifiedAt: string;
  manifest: AddonManifestInfo;
  /** Detected config folder relative to server root, e.g. "plugins/Essentials" or "config/sodium" */
  configFolder: string | null;
  /** Whether a user override is active */
  configFolderOverride?: string;
  /** True when the plugin is queued to be deleted as soon as the server stops */
  pendingDeletion?: boolean;
  configFiles: AddonConfigFile[];
}

export interface OrphanConfigFolder {
  folderName: string;
  relativePath: string;
  configFiles: AddonConfigFile[];
}

export interface ModrinthSearchResult {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
  categories: string[];
  versions: string[];
  projectType: 'mod' | 'plugin' | string;
}

export interface ModrinthVersionInfo {
  id: string;
  name: string;
  versionNumber: string;
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  fileName: string;
  downloadUrl: string;
  fileSize: number;
}

// ---------- Players ----------

export interface WhitelistEntry {
  uuid: string;
  name: string;
}

export interface OpEntry {
  uuid: string;
  name: string;
  level: number;
  bypassesPlayerLimit: boolean;
}

export interface BannedPlayerEntry {
  uuid: string;
  name: string;
  created: string;
  source: string;
  expires: string;
  reason: string;
}

export interface BannedIpEntry {
  ip: string;
  created: string;
  source: string;
  expires: string;
  reason: string;
}

export interface PlayersState {
  online: string[];
  whitelistEnabled: boolean;
  whitelist: WhitelistEntry[];
  ops: OpEntry[];
  bannedPlayers: BannedPlayerEntry[];
  bannedIps: BannedIpEntry[];
}

// ---------- Files ----------

export interface FileEntry {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  format: ConfigFormat;
  isBinary: boolean;
}

// ---------- Worlds & Backups ----------

export type WorldLayoutFormat = '26.1+' | 'legacy-vanilla' | 'legacy-bukkit';

export interface WorldDimensionEntry {
  /** Dimension ID, e.g. 'minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end' */
  id: string;
  label: string;
  dimension: 'overworld' | 'nether' | 'end' | 'custom';
  /** Path relative to the world root, e.g. 'dimensions/minecraft/overworld', 'DIM-1', 'DIM1', or '.' */
  subPath: string;
  /** Path relative to server root, e.g. 'world/dimensions/minecraft/overworld' */
  relativePath: string;
  /** Context note explaining how this path relates to 26.1+ vs pre-26.1 Bukkit/Paper or Vanilla */
  legacyPathHint?: string;
  exists: boolean;
  sizeBytes: number;
  hasRegion: boolean;
  hasEntities: boolean;
  hasPoi: boolean;
  hasData: boolean;
  hasPaperWorldConfig?: boolean;
}

export interface WorldSharedDataInfo {
  /** Top-level <world>/data folder reserved for data shared across dimensions */
  subPath: string;
  relativePath: string;
  exists: boolean;
  sizeBytes: number;
  fileCount: number;
}

export interface WorldInfo {
  name: string;
  relativePath: string;
  dimension: 'overworld' | 'nether' | 'end' | 'custom';
  layoutFormat?: WorldLayoutFormat;
  sizeBytes: number;
  modifiedAt: string;
  hasPaperWorldConfig: boolean;
  hasServerConfigDir: boolean;
  dimensions?: WorldDimensionEntry[];
  sharedData?: WorldSharedDataInfo;
}

export interface BackupInfo {
  id: string;
  serverId: string;
  fileName: string;
  label: string;
  scope: 'full' | 'worlds';
  sizeBytes: number;
  createdAt: string;
}

// ---------- Native Built-in Task Scheduler ----------

export type ScheduleAction = 'command' | 'backup' | 'backup_worlds' | 'restart' | 'start' | 'stop';

export type ScheduleTriggerType = 'once' | 'interval' | 'daily' | 'weekly' | 'on_start';
export type IntervalUnit = 'minutes' | 'hours';

export interface ScheduleTrigger {
  type: ScheduleTriggerType;
  /** For 'once': local ISO datetime e.g. "2026-11-20T04:00" */
  runAt?: string;
  /** For 'interval': positive integer e.g. 2 */
  everyValue?: number;
  /** For 'interval': 'minutes' | 'hours' */
  everyUnit?: IntervalUnit;
  /** For 'daily' and 'weekly': 24-hour time "HH:MM" */
  timeOfDay?: string;
  /** For 'weekly': days of week 0 (Sun) .. 6 (Sat) */
  daysOfWeek?: number[];
}

export interface ScheduledTask {
  id: string;
  serverId: string;
  name: string;
  trigger: ScheduleTrigger;
  action: ScheduleAction;
  payload?: string; // command text or backup label
  /** Skip execution when the server is offline (default true for backups/commands/restarts) */
  onlyWhenRunning: boolean;
  enabled: boolean;
  lastRunAt?: string;
  lastResult?: 'ok' | 'skipped' | 'error';
  lastMessage?: string;
  nextRunAt?: string;
  /** Legacy field preserved only for automatic migration */
  cron?: string;
}

// ---------- Companion Bridge Plugin (Spigot / Paper / Purpur / Leaf) ----------

export interface BridgeWorldInfo {
  name: string;
  environment: string;
  time: number;
  weather: 'clear' | 'rain' | 'thunder';
  difficulty: 'PEACEFUL' | 'EASY' | 'NORMAL' | 'HARD';
  pvp: boolean;
  seed: string;
  borderSize: number;
  loadedChunks: number;
  entityCount: number;
  playerCount: number;
}

export interface BridgePlayerInfo {
  name: string;
  uuid: string;
  world: string;
  x: number;
  y: number;
  z: number;
  health: number;
  maxHealth: number;
  food: number;
  gamemode: 'SURVIVAL' | 'CREATIVE' | 'ADVENTURE' | 'SPECTATOR';
  op: boolean;
  ping: number;
}

export interface VelocityBridgeServerInfo {
  name: string;
  address: string;
  playerCount: number;
  players: string[];
}

export interface BridgeStatusResponse {
  supported: boolean;
  installed: boolean;
  enabled: boolean;
  connected: boolean;
  bridgePort?: number;
  serverName?: string;
  bukkitVersion?: string;
  tps?: number[] | null;
  heapUsedMb?: number;
  heapMaxMb?: number;
  pluginCount?: number;
  worlds: BridgeWorldInfo[];
  players: BridgePlayerInfo[];
  proxyServers?: VelocityBridgeServerInfo[];
  plugins?: BridgePluginRuntimeInfo[];
  error?: string;
}

export interface BridgeGamerule {
  name: string;
  value: string;
  type: 'boolean' | 'integer' | 'string';
  defaultValue: string;
}

export interface SeparationOptions {
  /** Isolate inventory, armor, offhand, ender chest, XP, health, food, and gamemode */
  inventory: boolean;
  /** Players only see chat messages from players in the same group/world */
  chat: boolean;
  /** Players only see players in the same group/world in-game and in the Tab list */
  visibility: boolean;
  /** Enforce group-linked Nether/End portals and group-scoped respawn */
  portalsAndRespawn: boolean;
}

export type RealmWorldEnvironment = 'NORMAL' | 'NETHER' | 'THE_END';
export type RealmWorldType = 'NORMAL' | 'FLAT' | 'LARGE_BIOMES' | 'AMPLIFIED';
export type RealmGameMode = 'SURVIVAL' | 'CREATIVE' | 'ADVENTURE' | 'SPECTATOR' | '';

export interface ManagedWorldConfig {
  name: string;
  environment: RealmWorldEnvironment;
  worldType: RealmWorldType;
  seed?: string;
  generateStructures?: boolean;
  generator?: string;
  autoLoad: boolean;
  defaultGameMode?: RealmGameMode;
  standaloneSeparation?: SeparationOptions;
  color?: string;
}

export interface WorldGroup {
  id: string;
  name: string;
  /** Hex color, e.g. "#3b82f6" */
  color: string;
  overworld: string;
  nether?: string;
  end?: string;
  extraWorlds?: string[];
  defaultGameMode?: RealmGameMode;
  /** Assigned player usernames (case-insensitive) or UUIDs */
  players: string[];
  /** Other WorldGroup IDs this list is allowed to exchange /tpa & /tpahere requests with (own list is always allowed) */
  allowedTpaGroups?: string[];
  separation: SeparationOptions;
}

export interface PluginWorldRule {
  mode: 'all' | 'allow' | 'deny';
  worlds: string[];
  groups: string[];
}

export interface RealmsConfig {
  enabled: boolean;
  defaultJoinWorld: string;
  forceDefaultJoinForUnassigned: boolean;
  ownedColoredPortals: boolean;
  tpaEnabled: boolean;
  tpaTimeoutSeconds: number;
  backEnabled: boolean;
  worlds: ManagedWorldConfig[];
  groups: WorldGroup[];
  pluginRules: Record<string, PluginWorldRule>;
}

export interface TrackedPortalInfo {
  id: string;
  world: string;
  x: number;
  y: number;
  z: number;
  groupId: string;
  targetOverworld: string;
}

export interface BridgePluginRuntimeInfo {
  name: string;
  version: string;
  enabled: boolean;
}

export interface RealmsStateResponse {
  supported: boolean;
  installed: boolean;
  connected: boolean;
  config: RealmsConfig;
  loadedWorlds: BridgeWorldInfo[];
  unloadedFolders: string[];
  plugins: BridgePluginRuntimeInfo[];
  onlinePlayers: BridgePlayerInfo[];
  portals: TrackedPortalInfo[];
  error?: string;
}

// ---------- Geyser & Floodgate (Bedrock Cross-Play) ----------

export type GeyserInstallMode = 'plugin' | 'mod' | 'standalone';

export interface GeyserConfigValues {
  bedrockPort: number;
  cloneRemotePort: boolean;
  motd1: string;
  motd2: string;
  serverName: string;
  authType: 'floodgate' | 'online' | 'offline';
  remoteAddress: string;
  remotePort: number;
}

export interface FloodgateConfigValues {
  usernamePrefix: string;
  replaceSpaces: boolean;
  defaultLocale: string;
  sendFloodgateData: boolean;
  playerLinkEnabled: boolean;
  requireLinking: boolean;
  enableOwnLinking: boolean;
  enableGlobalLinking: boolean;
}

export interface GeyserStatusResponse {
  software: ServerSoftware;
  installMode: GeyserInstallMode;
  geyserInstalled: boolean;
  geyserFileName: string | null;
  geyserConfigPath: string | null;
  geyserPendingDeletion?: boolean;
  floodgateSupported: boolean;
  floodgateInstalled: boolean;
  floodgateFileName: string | null;
  floodgateConfigPath: string | null;
  floodgatePendingDeletion?: boolean;
  floodgateKeyExists: boolean;
  floodgateNote?: string;
  floodgateConfig: FloodgateConfigValues | null;
  standaloneEnabled: boolean;
  standaloneRunning: boolean;
  config: GeyserConfigValues;
}

// ---------- Velocity Proxy Network ----------

export type VelocityForwardingMode = 'modern' | 'bungeeguard' | 'legacy' | 'none';

export interface VelocityBackendEntry {
  alias: string;
  address: string;
  inTryOrder: boolean;
  managedServerId?: string | null;
  managedServerName?: string | null;
  managedServerSoftware?: ServerSoftware | null;
  managedServerStatus?: ServerStatus | null;
  livePlayers?: string[];
}

export interface VelocityManagedCandidate {
  id: string;
  name: string;
  software: ServerSoftware;
  mcVersion: string;
  port: number;
  status: ServerStatus;
  alreadyLinkedAs?: string | null;
}

export interface VelocityNetworkState {
  configExists: boolean;
  bind: string;
  motd: string;
  showMaxPlayers: number;
  onlineMode: boolean;
  forwardingMode: VelocityForwardingMode;
  forwardingSecret: string;
  servers: VelocityBackendEntry[];
  tryOrder: string[];
  forcedHosts: Record<string, string[]>;
  managedCandidates: VelocityManagedCandidate[];
  floodgateKeyAvailable: boolean;
  bridgeConnected: boolean;
  livePlayers: BridgePlayerInfo[];
}

// ---------- Java Runtimes ----------

export interface JavaRuntimeInfo {
  id: string;
  path: string;
  version: string;
  major: number;
  vendor: string;
  source: 'managed' | 'system';
}

export interface JavaDownloadStatus {
  major: number;
  stage: 'idle' | 'downloading' | 'extracting' | 'done' | 'error';
  percent: number;
  message: string;
}

// ---------- Auth & Users ----------

export type UserRole = 'owner' | 'admin' | 'operator' | 'viewer';

export type Permission =
  | 'console'
  | 'power'
  | 'configs'
  | 'plugins'
  | 'files'
  | 'players'
  | 'backups'
  | 'schedules'
  | 'settings'
  | 'users';

export interface UserAccount {
  id: string;
  username: string;
  role: UserRole;
  permissions: Permission[];
  createdAt: string;
}

export interface PanelSettings {
  requireAuth: boolean;
  defaultBackupRetention: number;
  hostPort: number;
}

export interface AuthSessionInfo {
  authenticated: boolean;
  requireAuth: boolean;
  user: UserAccount | null;
}

// ---------- WebSocket Events ----------

export type WsServerMessage =
  | { type: 'console:history'; serverId: string; lines: ConsoleLine[] }
  | { type: 'console:line'; serverId: string; line: ConsoleLine }
  | { type: 'server:state'; serverId: string; runtime: ServerRuntimeState }
  | { type: 'servers:all'; states: Record<string, ServerRuntimeState> }
  | { type: 'java:download'; status: JavaDownloadStatus };
