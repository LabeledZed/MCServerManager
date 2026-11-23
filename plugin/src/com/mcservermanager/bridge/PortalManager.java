package com.mcservermanager.bridge;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.world.PortalCreateEvent;
import org.bukkit.plugin.Plugin;

/**
 * Manages group-linked Nether/End portals, shared-Nether portal ownership routing
 * (stepping through Group 2's portal in a shared Nether sends any player to Group 2's Overworld),
 * and colored DUST/REDSTONE particle effects matching each group's assigned hex color.
 */
public final class PortalManager {

    private final Plugin plugin;
    private final WorldController worlds;
    private final File portalsFile;
    private final Logger logger;

    private final List<RealmsConfig.TrackedPortal> portals = new ArrayList<>();
    private final Map<UUID, PendingPortalTag> pendingTags = new ConcurrentHashMap<>();
    private Object particleTaskHandle = null;

    // Cached reflection handles for colored particles (MC 1.13 - 26.3+)
    private boolean particlesInitialized = false;
    private boolean particlesAvailable = false;
    private Object dustParticleEnum;
    private Method colorFromRgbMethod;
    private Constructor<?> dustOptionsCtor;
    private Method worldSpawnParticleMethod;

    private static final class PendingPortalTag {
        final String groupId;
        final String targetOverworld;
        final String targetNether;
        final long expiresAt;

        PendingPortalTag(String groupId, String targetOverworld, String targetNether) {
            this.groupId = groupId;
            this.targetOverworld = targetOverworld;
            this.targetNether = targetNether;
            this.expiresAt = System.currentTimeMillis() + 8000L;
        }
    }

    public PortalManager(Plugin plugin, WorldController worlds, File dataFolder, Logger logger) {
        this.plugin = plugin;
        this.worlds = worlds;
        this.portalsFile = new File(dataFolder, "portals.json");
        this.logger = logger;
        loadPortals();
    }

    public synchronized List<RealmsConfig.TrackedPortal> getPortalsSnapshot() {
        return new ArrayList<>(portals);
    }

    public synchronized void loadPortals() {
        portals.clear();
        if (!portalsFile.exists()) return;
        try {
            String raw = RealmsConfig.readTextFile(portalsFile);
            Map<String, Object> root = JsonUtil.parseObject(raw);
            List<Object> list = JsonUtil.asList(root.get("portals"));
            if (list != null) {
                for (Object item : list) {
                    RealmsConfig.TrackedPortal tp = RealmsConfig.TrackedPortal.fromMap(JsonUtil.asMap(item));
                    if (!tp.world.isEmpty() && !tp.groupId.isEmpty()) {
                        portals.add(tp);
                    }
                }
            }
        } catch (Exception ex) {
            logger.warning("[Realms] Failed loading portals.json: " + ex.getMessage());
        }
    }

    public synchronized void savePortals() {
        try {
            if (portalsFile.getParentFile() != null && !portalsFile.getParentFile().exists()) {
                portalsFile.getParentFile().mkdirs();
            }
            Map<String, Object> root = new LinkedHashMap<>();
            List<Object> list = new ArrayList<>();
            for (RealmsConfig.TrackedPortal tp : portals) {
                list.add(tp.toMap());
            }
            root.put("portals", list);
            RealmsConfig.writeTextFile(portalsFile, JsonUtil.stringify(root));
        } catch (IOException ex) {
            logger.warning("[Realms] Failed saving portals.json: " + ex.getMessage());
        }
    }

    public synchronized boolean removePortalById(String portalId) {
        boolean removed = portals.removeIf(p -> p.id.equals(portalId));
        if (removed) savePortals();
        return removed;
    }

    public synchronized void clearAllPortals() {
        portals.clear();
        savePortals();
    }

    public void startParticleTask(final RealmsConfigSupplier configSupplier) {
        stopParticleTask();
        particleTaskHandle = FoliaCompat.runGlobalTimer(plugin, new Runnable() {
            @Override
            public void run() {
                tickColoredPortals(configSupplier.get());
            }
        }, 20L, 10L);
    }

    public void stopParticleTask() {
        if (particleTaskHandle != null) {
            FoliaCompat.cancelTask(particleTaskHandle);
            particleTaskHandle = null;
        }
    }

    public interface RealmsConfigSupplier {
        RealmsConfig get();
    }

    public void handlePortalCreate(PortalCreateEvent event, RealmsConfig config) {
        if (event.isCancelled() || !config.enabled || !config.ownedColoredPortals) return;
        World world = event.getWorld();
        if (world == null) return;

        String reasonName = BukkitCompat.getPortalCreateReasonName(event);
        if ("END_PLATFORM".equals(reasonName)) return;

        List<BukkitCompat.PortalBlockPos> blocks = BukkitCompat.getPortalCreateBlocks(event);
        if (blocks.isEmpty()) return;

        // Calculate center of NETHER_PORTAL / PORTAL blocks (or all portal blocks for NETHER_PAIR / OBC_DESTINATION)
        long sumX = 0, sumY = 0, sumZ = 0;
        int count = 0;
        boolean sawNetherPortal = "NETHER_PAIR".equals(reasonName) || "OBC_DESTINATION".equals(reasonName);
        for (BukkitCompat.PortalBlockPos bs : blocks) {
            if (BukkitCompat.isNetherPortalMaterial(bs.type)) {
                sawNetherPortal = true;
                sumX += bs.x;
                sumY += bs.y;
                sumZ += bs.z;
                count++;
            }
        }
        if (!sawNetherPortal) return;
        if (count == 0) {
            for (BukkitCompat.PortalBlockPos bs : blocks) {
                sumX += bs.x;
                sumY += bs.y;
                sumZ += bs.z;
                count++;
            }
        }
        if (count == 0) return;

        int cx = (int) Math.round((double) sumX / count);
        int cy = (int) Math.round((double) sumY / count);
        int cz = (int) Math.round((double) sumZ / count);

        // Determine creator entity reflectively (Entity getter exists on MC 1.14+)
        Entity creator = readPortalCreatorReflective(event);
        RealmsConfig.WorldGroup ownerGroup = null;

        if (creator instanceof Player) {
            Player p = (Player) creator;
            PendingPortalTag pending = pendingTags.get(p.getUniqueId());
            if (pending != null && pending.expiresAt > System.currentTimeMillis()
                    && world.getName().equalsIgnoreCase(pending.targetNether)) {
                ownerGroup = config.findGroupById(pending.groupId);
            }
            if (ownerGroup == null && world.getEnvironment() == World.Environment.NORMAL) {
                ownerGroup = config.findGroupByOverworld(world.getName());
            }
            if (ownerGroup == null) {
                ownerGroup = config.findGroupForPlayer(p);
            }
        } else if (world.getEnvironment() == World.Environment.NORMAL) {
            ownerGroup = config.findGroupByOverworld(world.getName());
        }

        if (ownerGroup == null || ownerGroup.overworld == null || ownerGroup.overworld.isEmpty()) {
            return;
        }

        registerPortal(world.getName(), cx, cy, cz, ownerGroup.id, ownerGroup.overworld, true);
    }

    public void handlePlayerPortal(PlayerPortalEvent event, RealmsConfig config) {
        if (event.isCancelled() || !config.enabled) return;
        Player player = event.getPlayer();
        Location from = event.getFrom();
        if (player == null || from == null || from.getWorld() == null) return;

        World fromWorld = from.getWorld();
        PlayerTeleportEvent.TeleportCause cause = event.getCause();
        String causeName = cause != null ? cause.name() : "";

        if ("NETHER_PORTAL".equals(causeName)) {
            handleNetherPortal(event, player, from, fromWorld, config);
        } else if ("END_PORTAL".equals(causeName)) {
            handleEndPortal(event, player, fromWorld, config);
        }
    }

    private void handleNetherPortal(
            PlayerPortalEvent event,
            Player player,
            Location from,
            World fromWorld,
            RealmsConfig config
    ) {
        World.Environment env = fromWorld.getEnvironment();

        if (env == World.Environment.NORMAL) {
            // Overworld -> Nether
            RealmsConfig.WorldGroup group = null;
            if (config.ownedColoredPortals) {
                RealmsConfig.TrackedPortal enteredPortal = findNearestTrackedPortal(
                    fromWorld.getName(), from.getBlockX(), from.getBlockY(), from.getBlockZ(), 6.5
                );
                if (enteredPortal != null) {
                    group = config.findGroupById(enteredPortal.groupId);
                }
            }
            if (group == null) {
                group = config.findGroupByOverworld(fromWorld.getName());
            }
            if (group == null) {
                List<RealmsConfig.WorldGroup> owners = config.findGroupsContainingWorld(fromWorld.getName());
                if (owners.size() == 1) group = owners.get(0);
            }
            if (group == null || !group.separation.portalsAndRespawn) return;
            if (group.nether == null || group.nether.isEmpty()) return;

            World targetNether = worlds.getWorld(group.nether);
            if (targetNether == null) return;

            double destX = from.getX() / 8.0;
            double destY = Math.max(10.0, Math.min(118.0, from.getY()));
            double destZ = from.getZ() / 8.0;

            if (config.ownedColoredPortals) {
                // Prefer an existing active Nether portal owned by THIS overworld's group so a player
                // entering List 1's portal never snaps into a nearby List 2 portal in a shared Nether!
                RealmsConfig.TrackedPortal ownNetherPortal = findNearestTrackedPortalForGroup(
                    targetNether, group.id, destX, destY, destZ, 128.0
                );
                if (ownNetherPortal != null) {
                    destX = ownNetherPortal.x + 0.5;
                    destY = ownNetherPortal.y;
                    destZ = ownNetherPortal.z + 0.5;
                    BukkitCompat.setPortalSearchRadius(event, 2);
                } else if (hasOtherGroupPortalNearby(targetNether.getName(), group.id, destX, destY, destZ, 16.0)) {
                    // Another group already has a portal right here — offset slightly so Bukkit creates a separate portal for this group
                    destX += 18.0;
                    BukkitCompat.setPortalSearchRadius(event, 4);
                }
            }

            Location dest = new Location(targetNether, destX, destY, destZ, from.getYaw(), from.getPitch());
            event.setTo(dest);
            BukkitCompat.setPortalCanCreate(event, true);

            if (config.ownedColoredPortals) {
                // Tag departure overworld portal too so both sides glow in the group's color
                tagNearestPortalBlock(fromWorld, from.getBlockX(), from.getBlockY(), from.getBlockZ(), group.id, group.overworld, false);

                // Tag destination portal in the Nether 2 ticks after arrival
                final String gId = group.id;
                final String gOverworld = group.overworld;
                final String gNether = targetNether.getName();
                pendingTags.put(player.getUniqueId(), new PendingPortalTag(gId, gOverworld, gNether));
                FoliaCompat.runForEntity(plugin, player, new Runnable() {
                    @Override
                    public void run() {
                        pendingTags.remove(player.getUniqueId());
                        if (!player.isOnline()) return;
                        Location arrived = player.getLocation();
                        if (arrived == null || arrived.getWorld() == null) return;
                        if (!arrived.getWorld().getName().equalsIgnoreCase(gNether)) return;
                        tagNearestPortalBlock(
                            arrived.getWorld(),
                            arrived.getBlockX(),
                            arrived.getBlockY(),
                            arrived.getBlockZ(),
                            gId,
                            gOverworld,
                            false
                        );
                    }
                }, 2L);
            }
            return;
        }

        if (env == World.Environment.NETHER) {
            // Nether -> Overworld
            World targetOverworld = null;
            RealmsConfig.WorldGroup portalOwnerGroup = null;

            // 1. If Owned & Colored Portals is enabled, check whether this Nether portal belongs to a specific group!
            if (config.ownedColoredPortals) {
                RealmsConfig.TrackedPortal owned = findNearestTrackedPortal(
                    fromWorld.getName(), from.getBlockX(), from.getBlockY(), from.getBlockZ(), 6.5
                );
                if (owned != null) {
                    portalOwnerGroup = config.findGroupById(owned.groupId);
                    String targetName = (portalOwnerGroup != null && portalOwnerGroup.overworld != null && !portalOwnerGroup.overworld.isEmpty())
                            ? portalOwnerGroup.overworld
                            : owned.targetOverworld;
                    targetOverworld = worlds.getWorld(targetName);
                }
            }

            // 2. Otherwise, fall back to the group(s) linked to this Nether world
            if (targetOverworld == null) {
                List<RealmsConfig.WorldGroup> linkedGroups = config.findGroupsContainingWorld(fromWorld.getName());
                if (linkedGroups.isEmpty()) return;

                RealmsConfig.WorldGroup chosen = null;
                RealmsConfig.WorldGroup playerGroup = config.findGroupForPlayer(player);
                if (playerGroup != null) {
                    for (RealmsConfig.WorldGroup g : linkedGroups) {
                        if (g.id.equalsIgnoreCase(playerGroup.id)) {
                            chosen = g;
                            break;
                        }
                    }
                }
                if (chosen == null) chosen = linkedGroups.get(0);
                if (!chosen.separation.portalsAndRespawn) return;
                targetOverworld = worlds.getWorld(chosen.overworld);
                portalOwnerGroup = chosen;
            }

            if (targetOverworld == null) return;

            double destX = from.getX() * 8.0;
            double destY = Math.max(-50.0, Math.min(250.0, from.getY()));
            double destZ = from.getZ() * 8.0;

            if (config.ownedColoredPortals && portalOwnerGroup != null) {
                RealmsConfig.TrackedPortal ownOverworldPortal = findNearestTrackedPortalForGroup(
                    targetOverworld, portalOwnerGroup.id, destX, destY, destZ, 128.0
                );
                if (ownOverworldPortal != null) {
                    destX = ownOverworldPortal.x + 0.5;
                    destY = ownOverworldPortal.y;
                    destZ = ownOverworldPortal.z + 0.5;
                    BukkitCompat.setPortalSearchRadius(event, 2);
                }
            }

            Location dest = new Location(targetOverworld, destX, destY, destZ, from.getYaw(), from.getPitch());
            event.setTo(dest);
            BukkitCompat.setPortalCanCreate(event, true);

            if (config.ownedColoredPortals && portalOwnerGroup != null) {
                RealmsConfig.WorldGroup playerGroup = config.findGroupForPlayer(player);
                if (playerGroup == null || !playerGroup.id.equalsIgnoreCase(portalOwnerGroup.id)) {
                    String cc = RealmsConfig.hexToChatColor(portalOwnerGroup.color);
                    player.sendMessage("\u00A77Entering " + cc + portalOwnerGroup.name + "\u00A77 portal \u2192 \u00A7f" + targetOverworld.getName());
                }
            }
        }
    }

    private void handleEndPortal(
            PlayerPortalEvent event,
            Player player,
            World fromWorld,
            RealmsConfig config
    ) {
        World.Environment env = fromWorld.getEnvironment();
        List<RealmsConfig.WorldGroup> owners = config.findGroupsContainingWorld(fromWorld.getName());
        if (owners.isEmpty()) return;

        RealmsConfig.WorldGroup group = null;
        RealmsConfig.WorldGroup playerGroup = config.findGroupForPlayer(player);
        if (playerGroup != null) {
            for (RealmsConfig.WorldGroup g : owners) {
                if (g.id.equalsIgnoreCase(playerGroup.id)) {
                    group = g;
                    break;
                }
            }
        }
        if (group == null) group = owners.get(0);
        if (!group.separation.portalsAndRespawn) return;

        if (env == World.Environment.NORMAL) {
            if (group.end == null || group.end.isEmpty()) return;
            World targetEnd = worlds.getWorld(group.end);
            if (targetEnd == null) return;
            event.setTo(new Location(targetEnd, 100.5, 49.0, 0.5));
            BukkitCompat.setPortalCanCreate(event, true);
        } else if (env == World.Environment.THE_END) {
            World targetOverworld = worlds.getWorld(group.overworld);
            if (targetOverworld == null) return;
            Location bed = getPlayerRespawnLocationReflective(player);
            if (bed != null && bed.getWorld() != null && group.containsWorld(bed.getWorld().getName())) {
                event.setTo(bed);
            } else {
                event.setTo(targetOverworld.getSpawnLocation());
            }
        }
    }

    private void tagNearestPortalBlock(
            World world,
            int bx,
            int by,
            int bz,
            String groupId,
            String targetOverworld,
            boolean overwriteExisting
    ) {
        long sumX = 0, sumY = 0, sumZ = 0;
        int count = 0;
        for (int dx = -4; dx <= 4; dx++) {
            for (int dy = -3; dy <= 4; dy++) {
                for (int dz = -4; dz <= 4; dz++) {
                    Block b = world.getBlockAt(bx + dx, by + dy, bz + dz);
                    if (b != null && BukkitCompat.isNetherPortalMaterial(b.getType())) {
                        sumX += (bx + dx);
                        sumY += (by + dy);
                        sumZ += (bz + dz);
                        count++;
                    }
                }
            }
        }
        if (count == 0) return;
        int cx = (int) Math.round((double) sumX / count);
        int cy = (int) Math.round((double) sumY / count);
        int cz = (int) Math.round((double) sumZ / count);
        registerPortal(world.getName(), cx, cy, cz, groupId, targetOverworld, overwriteExisting);
    }

    private synchronized void registerPortal(
            String worldName,
            int x,
            int y,
            int z,
            String groupId,
            String targetOverworld,
            boolean overwriteExisting
    ) {
        RealmsConfig.TrackedPortal existing = findNearestTrackedPortalLocked(worldName, x, y, z, 6.0);
        if (existing != null) {
            if (!overwriteExisting) return;
            existing.x = x;
            existing.y = y;
            existing.z = z;
            existing.groupId = groupId;
            existing.targetOverworld = targetOverworld;
            savePortals();
            return;
        }
        RealmsConfig.TrackedPortal tp = new RealmsConfig.TrackedPortal();
        tp.id = worldName + ":" + x + ":" + y + ":" + z;
        tp.world = worldName;
        tp.x = x;
        tp.y = y;
        tp.z = z;
        tp.groupId = groupId;
        tp.targetOverworld = targetOverworld;
        portals.add(tp);
        savePortals();
    }

    private synchronized RealmsConfig.TrackedPortal findNearestTrackedPortal(String worldName, int x, int y, int z, double maxDist) {
        return findNearestTrackedPortalLocked(worldName, x, y, z, maxDist);
    }

    private RealmsConfig.TrackedPortal findNearestTrackedPortalForGroup(
            World world, String groupId, double x, double y, double z, double maxDist
    ) {
        if (world == null || groupId == null || groupId.isEmpty()) return null;
        String worldName = world.getName();
        double bestSq = maxDist * maxDist;
        RealmsConfig.TrackedPortal best = null;
        List<RealmsConfig.TrackedPortal> snapshot = getPortalsSnapshot();
        for (RealmsConfig.TrackedPortal tp : snapshot) {
            if (!WorldController.areSameWorld(tp.world, worldName)) continue;
            if (!tp.groupId.equalsIgnoreCase(groupId)) continue;
            double dx = tp.x - x;
            double dy = tp.y - y;
            double dz = tp.z - z;
            double dSq = dx * dx + dy * dy + dz * dz;
            if (dSq <= bestSq && hasActivePortalBlockNear(world, tp.x, tp.y, tp.z)) {
                bestSq = dSq;
                best = tp;
            }
        }
        return best;
    }

    private synchronized boolean hasOtherGroupPortalNearby(
            String worldName, String myGroupId, double x, double y, double z, double maxDist
    ) {
        double maxSq = maxDist * maxDist;
        for (RealmsConfig.TrackedPortal tp : portals) {
            if (!WorldController.areSameWorld(tp.world, worldName)) continue;
            if (tp.groupId.equalsIgnoreCase(myGroupId)) continue;
            double dx = tp.x - x;
            double dy = tp.y - y;
            double dz = tp.z - z;
            if (dx * dx + dy * dy + dz * dz <= maxSq) {
                return true;
            }
        }
        return false;
    }

    private static boolean hasActivePortalBlockNear(World w, int cx, int cy, int cz) {
        for (int dx = -3; dx <= 3; dx++) {
            for (int dy = -3; dy <= 4; dy++) {
                for (int dz = -3; dz <= 3; dz++) {
                    Block b = w.getBlockAt(cx + dx, cy + dy, cz + dz);
                    if (b != null && BukkitCompat.isNetherPortalMaterial(b.getType())) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private RealmsConfig.TrackedPortal findNearestTrackedPortalLocked(String worldName, int x, int y, int z, double maxDist) {
        double bestSq = maxDist * maxDist;
        RealmsConfig.TrackedPortal best = null;
        for (RealmsConfig.TrackedPortal tp : portals) {
            if (!WorldController.areSameWorld(tp.world, worldName)) continue;
            double dx = tp.x - x;
            double dy = tp.y - y;
            double dz = tp.z - z;
            double dSq = dx * dx + dy * dy + dz * dz;
            if (dSq <= bestSq) {
                bestSq = dSq;
                best = tp;
            }
        }
        return best;
    }

    private void tickColoredPortals(RealmsConfig config) {
        if (config == null || !config.enabled || !config.ownedColoredPortals) return;
        if (!BukkitCompat.hasOnlinePlayers()) return;

        ensureParticleReflection();
        if (!particlesAvailable) return;

        if (FoliaCompat.isFolia()) {
            // On Folia, dispatch per-portal block scan & particle spawn to the owning region thread
            List<RealmsConfig.TrackedPortal> snapshot = getPortalsSnapshot();
            for (final RealmsConfig.TrackedPortal tp : snapshot) {
                final RealmsConfig.WorldGroup group = config.findGroupById(tp.groupId);
                if (group == null) {
                    removePortalById(tp.id);
                    continue;
                }
                final World w = worlds.getWorld(tp.world);
                if (w == null) continue;
                final Location center = new Location(w, tp.x + 0.5, tp.y + 0.5, tp.z + 0.5);
                FoliaCompat.runAtLocation(plugin, center, new Runnable() {
                    @Override
                    public void run() {
                        List<Block> activePortalBlocks = new ArrayList<>();
                        for (int dx = -3; dx <= 3; dx++) {
                            for (int dy = -3; dy <= 4; dy++) {
                                for (int dz = -3; dz <= 3; dz++) {
                                    Block b = w.getBlockAt(tp.x + dx, tp.y + dy, tp.z + dz);
                                    if (b != null && BukkitCompat.isNetherPortalMaterial(b.getType())) {
                                        activePortalBlocks.add(b);
                                    }
                                }
                            }
                        }
                        if (activePortalBlocks.isEmpty()) {
                            removePortalById(tp.id);
                            return;
                        }
                        int[] rgb = RealmsConfig.parseHexRgb(group.color);
                        spawnColoredPortalDust(w, activePortalBlocks, rgb[0], rgb[1], rgb[2]);
                    }
                });
            }
            return;
        }

        boolean dirty = false;
        synchronized (this) {
            Iterator<RealmsConfig.TrackedPortal> it = portals.iterator();
            while (it.hasNext()) {
                RealmsConfig.TrackedPortal tp = it.next();
                RealmsConfig.WorldGroup group = config.findGroupById(tp.groupId);
                if (group == null) {
                    it.remove();
                    dirty = true;
                    continue;
                }

                World w = worlds.getWorld(tp.world);
                if (w == null) continue;
                List<Player> worldPlayers = w.getPlayers();
                if (worldPlayers == null || worldPlayers.isEmpty()) continue;

                Location center = new Location(w, tp.x + 0.5, tp.y + 0.5, tp.z + 0.5);
                boolean playerNearby = false;
                for (Player p : worldPlayers) {
                    Location pl = p.getLocation();
                    if (pl != null && pl.getWorld() == w && pl.distanceSquared(center) <= 36.0 * 36.0) {
                        playerNearby = true;
                        break;
                    }
                }
                if (!playerNearby) continue;

                // Scan for active NETHER_PORTAL blocks around center
                List<Block> activePortalBlocks = new ArrayList<>();
                for (int dx = -3; dx <= 3; dx++) {
                    for (int dy = -3; dy <= 4; dy++) {
                        for (int dz = -3; dz <= 3; dz++) {
                            Block b = w.getBlockAt(tp.x + dx, tp.y + dy, tp.z + dz);
                            if (b != null && BukkitCompat.isNetherPortalMaterial(b.getType())) {
                                activePortalBlocks.add(b);
                            }
                        }
                    }
                }

                if (activePortalBlocks.isEmpty()) {
                    // Portal was broken/extinguished — auto-prune!
                    it.remove();
                    dirty = true;
                    continue;
                }

                int[] rgb = RealmsConfig.parseHexRgb(group.color);
                spawnColoredPortalDust(w, activePortalBlocks, rgb[0], rgb[1], rgb[2]);
            }
        }
        if (dirty) savePortals();
    }

    private void ensureParticleReflection() {
        if (particlesInitialized) return;
        particlesInitialized = true;
        try {
            Class<?> particleCls = Class.forName("org.bukkit.Particle");
            try {
                dustParticleEnum = Enum.valueOf(particleCls.asSubclass(Enum.class), "DUST");
            } catch (IllegalArgumentException ignored) {
                dustParticleEnum = Enum.valueOf(particleCls.asSubclass(Enum.class), "REDSTONE");
            }
            Class<?> colorCls = Class.forName("org.bukkit.Color");
            colorFromRgbMethod = colorCls.getMethod("fromRGB", int.class, int.class, int.class);
            Class<?> dustOptsCls = Class.forName("org.bukkit.Particle$DustOptions");
            dustOptionsCtor = dustOptsCls.getConstructor(colorCls, float.class);
            worldSpawnParticleMethod = World.class.getMethod(
                "spawnParticle",
                particleCls,
                double.class,
                double.class,
                double.class,
                int.class,
                double.class,
                double.class,
                double.class,
                Object.class
            );
            particlesAvailable = true;
        } catch (Throwable ex) {
            logger.warning("[Realms] Colored portal particles unavailable on this server version: " + ex.getMessage());
            particlesAvailable = false;
        }
    }

    private void spawnColoredPortalDust(World w, List<Block> blocks, int r, int g, int b) {
        try {
            Object color = colorFromRgbMethod.invoke(null, r, g, b);
            Object dustOpts = dustOptionsCtor.newInstance(color, Float.valueOf(1.5f));
            // Cap particle spawns per portal per tick to keep network traffic light even for huge portals
            int step = Math.max(1, blocks.size() / 14);
            for (int i = 0; i < blocks.size(); i += step) {
                Block blk = blocks.get(i);
                worldSpawnParticleMethod.invoke(
                    w,
                    dustParticleEnum,
                    Double.valueOf(blk.getX() + 0.5),
                    Double.valueOf(blk.getY() + 0.5),
                    Double.valueOf(blk.getZ() + 0.5),
                    Integer.valueOf(2),
                    Double.valueOf(0.35),
                    Double.valueOf(0.45),
                    Double.valueOf(0.35),
                    dustOpts
                );
            }
        } catch (Throwable ignored) {}
    }

    private static Entity readPortalCreatorReflective(PortalCreateEvent event) {
        try {
            Method m = event.getClass().getMethod("getEntity");
            Object res = m.invoke(event);
            if (res instanceof Entity) return (Entity) res;
        } catch (Throwable ignored) {}
        return null;
    }

    public static Location getPlayerRespawnLocationReflective(Player player) {
        try {
            Method m = player.getClass().getMethod("getRespawnLocation");
            Object res = m.invoke(player);
            if (res instanceof Location) return (Location) res;
        } catch (Throwable ignored) {}
        try {
            Method m = player.getClass().getMethod("getBedSpawnLocation");
            Object res = m.invoke(player);
            if (res instanceof Location) return (Location) res;
        } catch (Throwable ignored) {}
        return null;
    }
}
