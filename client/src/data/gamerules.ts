/**
 * Human-readable descriptions for Minecraft gamerules across MC 1.4.2 - 26.3+
 * (supports both classic camelCase and 26.1+ snake_case/namespaced gamerule keys).
 */
const GAMERULE_DESCRIPTIONS: Record<string, string> = {
  announceAdvancements: 'Announce player advancements in chat.',
  blockExplosionDropDecay: 'Whether block explosions drop fewer items based on distance from center.',
  commandBlockOutput: 'Broadcast command block output to online operators.',
  commandModificationBlockLimit: 'Maximum number of blocks altered in a single /clone, /fill, or /fillbiome command.',
  disableElytraMovementCheck: 'Skip server movement speed checks while players glide with Elytra.',
  disablePlayerMovementCheck: 'Skip server movement speed checks for players.',
  disableRaids: 'Prevent raids from triggering in villages.',
  doDaylightCycle: 'Advance the day-night cycle and moon phases.',
  doEntityDrops: 'Allow non-mob entities (minecarts, paintings, item frames) to drop items when broken.',
  doFireTick: 'Allow fire to spread and naturally extinguish.',
  doImmediateRespawn: 'Respawn players instantly without showing the death screen.',
  doInsomnia: 'Allow phantoms to spawn for players who have not slept.',
  doLimitedCrafting: 'Require players to unlock recipes before crafting them.',
  doMobLoot: 'Allow mobs to drop items and experience when killed.',
  doMobSpawning: 'Allow mobs to spawn naturally (does not affect spawners).',
  doPatrolSpawning: 'Allow pillager patrols to spawn naturally.',
  doTileDrops: 'Allow blocks to drop items when broken.',
  doTraderSpawning: 'Allow wandering traders to spawn naturally.',
  doVinesSpread: 'Allow vines to spread to adjacent blocks.',
  doWardenSpawning: 'Allow wardens to emerge when sculk shriekers activate.',
  doWeatherCycle: 'Allow weather to change naturally between clear, rain, and thunder.',
  drowningDamage: 'Enable damage from drowning.',
  enderPearlsVanishOnDeath: 'Remove thrown ender pearls when the player who threw them dies.',
  fallDamage: 'Enable fall damage.',
  fireDamage: 'Enable fire and lava damage.',
  forgiveDeadPlayers: 'Neutral mobs stop being angry at players who die nearby.',
  freezeDamage: 'Enable freezing damage from powder snow.',
  globalSoundEvents: 'Play boss/portal sound events (Wither, Ender Dragon, End Portal) globally.',
  keepInventory: 'Players retain their inventory and experience after dying.',
  lavaSourceConversion: 'Allow flowing lava to form new lava source blocks.',
  locatorBar: 'Show other players on the HUD locator bar.',
  logAdminCommands: 'Write admin commands to the server log.',
  maxCommandChainLength: 'Maximum number of chain command blocks executed in a single tick.',
  maxCommandForkCount: 'Maximum number of execution contexts created by a single command.',
  maxEntityCramming: 'Maximum number of pushable entities in one space before suffocation damage occurs.',
  mobExplosionDropDecay: 'Whether mob explosions drop fewer items based on distance from center.',
  mobGriefing: 'Allow mobs to destroy blocks, pick up items, or trample farmland.',
  naturalRegeneration: 'Allow players to regenerate health naturally when hunger is full.',
  playersNetherPortalCreativeDelay: 'Ticks a creative-mode player must stand in a Nether portal before teleporting.',
  playersNetherPortalDefaultDelay: 'Ticks a survival/adventure player must stand in a Nether portal before teleporting.',
  playersSleepingPercentage: 'Percentage of online players required to sleep to skip the night.',
  projectilesCanBreakBlocks: 'Allow projectiles to break fragile blocks like chorus flowers and decorated pots.',
  pvp: 'Allow players to damage each other.',
  randomTickSpeed: 'Frequency of random block ticks (crop growth, leaf decay, fire spread). Set 0 to disable.',
  reducedDebugInfo: 'Hide coordinates and detailed info from the client F3 debug screen.',
  sendCommandFeedback: 'Display feedback in chat when players execute commands.',
  showDeathMessages: 'Broadcast player and tamed pet death messages in chat.',
  snowAccumulationHeight: 'Maximum number of snow layers that accumulate during snowfall.',
  spawnChunkRadius: 'Radius of chunks kept loaded around world spawn.',
  spawnRadius: 'Distance around world spawn where players without a bed/anchor can spawn.',
  spectatorsGenerateChunks: 'Allow spectators to generate new chunks.',
  tntExplodes: 'Allow TNT to ignite and explode.',
  tntExplosionDropDecay: 'Whether TNT explosions drop fewer items based on distance from center.',
  universalAnger: 'Angered neutral mobs attack any nearby player, not only the one who provoked them.',
  waterSourceConversion: 'Allow flowing water to form new water source blocks.',
};

const NORMALIZED_LOOKUP: Record<string, string> = Object.fromEntries(
  Object.entries(GAMERULE_DESCRIPTIONS).map(([k, v]) => [k.toLowerCase(), v]),
);

export function getGameruleDescription(ruleName: string): string | undefined {
  if (!ruleName) return undefined;
  const direct = GAMERULE_DESCRIPTIONS[ruleName];
  if (direct) return direct;
  const stripped = ruleName.replace(/^minecraft:/i, '').replace(/[_-]/g, '').toLowerCase();
  return NORMALIZED_LOOKUP[stripped];
}
