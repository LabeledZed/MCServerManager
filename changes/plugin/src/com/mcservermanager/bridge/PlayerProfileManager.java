package com.mcservermanager.bridge;

import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;

/**
 * Persists and swaps per-group / per-standalone-world player inventories, ender chests,
 * health, hunger, XP, gamemode, and last locations using Bukkit's native YamlConfiguration
 * (preserving all modern ItemStack NBT / Paper Data Components across MC 1.13 - 26.3+).
 */
public final class PlayerProfileManager {

    public static final class BackLocation {
        public final String world;
        public final double x;
        public final double y;
        public final double z;
        public final float yaw;
        public final float pitch;
        public final String reason;
        public final long timestamp;

        public BackLocation(String world, double x, double y, double z, float yaw, float pitch, String reason, long timestamp) {
            this.world = world;
            this.x = x;
            this.y = y;
            this.z = z;
            this.yaw = yaw;
            this.pitch = pitch;
            this.reason = reason;
            this.timestamp = timestamp;
        }
    }

    private final File profilesRoot;
    private final Logger logger;
    private final Map<UUID, String> activeScopes = new ConcurrentHashMap<>();
    private final Map<UUID, BackLocation> backCache = new ConcurrentHashMap<>();

    public PlayerProfileManager(File dataFolder, Logger logger) {
        this.profilesRoot = new File(dataFolder, "profiles");
        this.logger = logger;
    }

    public String getActiveScope(UUID uuid) {
        return activeScopes.get(uuid);
    }

    public void setActiveScope(UUID uuid, String scope) {
        if (scope == null || scope.isEmpty()) {
            activeScopes.remove(uuid);
        } else {
            activeScopes.put(uuid, scope);
        }
    }

    public String readLastAssignedGroup(UUID uuid) {
        File meta = getMetaFile(uuid);
        if (!meta.exists()) return "";
        YamlConfiguration cfg = YamlConfiguration.loadConfiguration(meta);
        return cfg.getString("lastAssignedGroup", "");
    }

    public void writeLastAssignedGroup(UUID uuid, String groupId) {
        File meta = getMetaFile(uuid);
        YamlConfiguration cfg = meta.exists() ? YamlConfiguration.loadConfiguration(meta) : new YamlConfiguration();
        cfg.set("lastAssignedGroup", groupId != null ? groupId : "");
        try {
            if (!meta.getParentFile().exists()) meta.getParentFile().mkdirs();
            cfg.save(meta);
        } catch (IOException ex) {
            logger.warning("[Realms] Failed saving player meta for " + uuid + ": " + ex.getMessage());
        }
    }

    /**
     * Persists the player's /back location (last teleport or most recent death) directly to disk
     * so it survives player logoff/logon cycles and full server restarts.
     */
    public void saveBackLocation(UUID uuid, Location loc, String reason) {
        if (uuid == null || loc == null || loc.getWorld() == null) return;
        BackLocation bl = new BackLocation(
            loc.getWorld().getName(),
            loc.getX(),
            loc.getY(),
            loc.getZ(),
            loc.getYaw(),
            loc.getPitch(),
            reason != null ? reason : "teleport",
            System.currentTimeMillis()
        );
        backCache.put(uuid, bl);

        File meta = getMetaFile(uuid);
        YamlConfiguration cfg = meta.exists() ? YamlConfiguration.loadConfiguration(meta) : new YamlConfiguration();
        cfg.set("back.world", bl.world);
        cfg.set("back.x", bl.x);
        cfg.set("back.y", bl.y);
        cfg.set("back.z", bl.z);
        cfg.set("back.yaw", (double) bl.yaw);
        cfg.set("back.pitch", (double) bl.pitch);
        cfg.set("back.reason", bl.reason);
        cfg.set("back.timestamp", bl.timestamp);
        try {
            if (!meta.getParentFile().exists()) meta.getParentFile().mkdirs();
            cfg.save(meta);
        } catch (IOException ex) {
            logger.warning("[Realms] Failed saving /back location for " + uuid + ": " + ex.getMessage());
        }
    }

    public BackLocation loadBackLocation(UUID uuid) {
        if (uuid == null) return null;
        BackLocation cached = backCache.get(uuid);
        if (cached != null) return cached;

        File meta = getMetaFile(uuid);
        if (!meta.exists()) return null;
        YamlConfiguration cfg = YamlConfiguration.loadConfiguration(meta);
        String worldName = cfg.getString("back.world");
        if (worldName == null || worldName.isEmpty()) return null;

        BackLocation loaded = new BackLocation(
            worldName,
            cfg.getDouble("back.x", 0.0),
            cfg.getDouble("back.y", 64.0),
            cfg.getDouble("back.z", 0.0),
            (float) cfg.getDouble("back.yaw", 0.0),
            (float) cfg.getDouble("back.pitch", 0.0),
            cfg.getString("back.reason", "teleport"),
            (long) cfg.getDouble("back.timestamp", 0.0)
        );
        backCache.put(uuid, loaded);
        return loaded;
    }

    public Location loadSavedLocation(UUID uuid, String scopeKey, WorldController worlds) {
        if (scopeKey == null || scopeKey.isEmpty()) return null;
        File file = getProfileFile(uuid, scopeKey);
        if (!file.exists()) return null;
        YamlConfiguration cfg = YamlConfiguration.loadConfiguration(file);
        String worldName = cfg.getString("location.world");
        if (worldName == null || worldName.isEmpty()) return null;
        World w = worlds.getWorld(worldName);
        if (w == null) return null;
        double x = cfg.getDouble("location.x", 0.0);
        double y = cfg.getDouble("location.y", 64.0);
        double z = cfg.getDouble("location.z", 0.0);
        float yaw = (float) cfg.getDouble("location.yaw", 0.0);
        float pitch = (float) cfg.getDouble("location.pitch", 0.0);
        return new Location(w, x, y, z, yaw, pitch);
    }

    public void initPlayerOnJoin(Player player, RealmsConfig config) {
        String scope = config.getScopeKeyForWorld(player.getWorld().getName());
        if (scope == null) {
            // Joined inside a shared dimension — fall back to their assigned group's scope if any
            RealmsConfig.WorldGroup g = config.findGroupForPlayer(player);
            scope = g != null ? "group_" + RealmsConfig.sanitizeKey(g.id) : "world_" + RealmsConfig.sanitizeKey(player.getWorld().getName());
        }
        activeScopes.put(player.getUniqueId(), scope);
    }

    public void handleWorldChange(Player player, World fromWorld, World toWorld, RealmsConfig config) {
        if (player == null || fromWorld == null || toWorld == null) return;
        if (fromWorld.getName().equalsIgnoreCase(toWorld.getName())) return;

        String fromName = fromWorld.getName();
        String toName = toWorld.getName();

        String currentScope = activeScopes.get(player.getUniqueId());
        if (currentScope == null) {
            currentScope = config.getScopeKeyForWorld(fromName);
        }

        String targetScope = config.getScopeKeyForWorld(toName);
        if (targetScope == null) {
            // Target is a shared dimension (e.g., shared Nether) — keep current active scope and gear!
            if (currentScope != null) {
                saveProfile(player, currentScope);
            }
            return;
        }

        if (targetScope.equals(currentScope)) {
            return;
        }

        RealmsConfig.SeparationOptions fromSep = config.getEffectiveSeparation(fromName);
        RealmsConfig.SeparationOptions toSep = config.getEffectiveSeparation(toName);

        if (fromSep.inventory || toSep.inventory) {
            if (currentScope != null) {
                saveProfile(player, currentScope);
            }
            loadOrResetProfile(player, targetScope);
        }

        activeScopes.put(player.getUniqueId(), targetScope);
    }

    public void saveCurrentProfile(Player player, RealmsConfig config) {
        if (player == null) return;
        String scope = activeScopes.get(player.getUniqueId());
        if (scope == null) {
            scope = config.getScopeKeyForWorld(player.getWorld().getName());
        }
        if (scope != null) {
            saveProfile(player, scope);
        }
    }

    public void saveProfile(Player player, String scopeKey) {
        if (player == null || scopeKey == null || scopeKey.isEmpty()) return;
        File file = getProfileFile(player.getUniqueId(), scopeKey);
        if (!file.getParentFile().exists()) {
            file.getParentFile().mkdirs();
        }
        YamlConfiguration cfg = new YamlConfiguration();

        PlayerInventory inv = player.getInventory();
        Inventory ender = BukkitCompat.getEnderChest(player);
        ItemStack[] invContents = inv.getContents();
        cfg.set("inventory", Arrays.asList(invContents));
        if (invContents.length <= 36) {
            // MC 1.2.5 - 1.8.8: armor is separate from getContents()
            try {
                ItemStack[] armor = inv.getArmorContents();
                if (armor != null) cfg.set("armor", Arrays.asList(armor));
            } catch (Throwable ignored) {}
        }
        if (ender != null) {
            cfg.set("enderChest", Arrays.asList(ender.getContents()));
        }
        cfg.set("health", BukkitCompat.getHealth(player));
        cfg.set("food", player.getFoodLevel());
        cfg.set("saturation", (double) player.getSaturation());
        cfg.set("exhaustion", (double) player.getExhaustion());
        cfg.set("level", player.getLevel());
        cfg.set("exp", (double) player.getExp());
        cfg.set("totalExperience", player.getTotalExperience());
        cfg.set("fireTicks", player.getFireTicks());
        if (player.getGameMode() != null) {
            cfg.set("gameMode", player.getGameMode().name());
        }

        Location loc = player.getLocation();
        if (loc != null && loc.getWorld() != null) {
            cfg.set("location.world", loc.getWorld().getName());
            cfg.set("location.x", loc.getX());
            cfg.set("location.y", loc.getY());
            cfg.set("location.z", loc.getZ());
            cfg.set("location.yaw", (double) loc.getYaw());
            cfg.set("location.pitch", (double) loc.getPitch());
        }

        try {
            cfg.save(file);
        } catch (IOException ex) {
            logger.warning("[Realms] Failed saving inventory profile '" + scopeKey + "' for " + player.getName() + ": " + ex.getMessage());
        }
    }

    private void loadOrResetProfile(Player player, String scopeKey) {
        File file = getProfileFile(player.getUniqueId(), scopeKey);
        PlayerInventory inv = player.getInventory();
        Inventory ender = BukkitCompat.getEnderChest(player);

        if (!file.exists()) {
            // Fresh profile for first time entering this isolated realm/world
            inv.clear();
            try {
                inv.setArmorContents(new ItemStack[4]);
            } catch (Throwable ignored) {}
            if (ender != null) ender.clear();
            double maxH = safeMaxHealth(player);
            BukkitCompat.setHealth(player, maxH);
            player.setFoodLevel(20);
            player.setSaturation(5.0f);
            player.setExhaustion(0.0f);
            player.setLevel(0);
            player.setExp(0.0f);
            player.setTotalExperience(0);
            player.setFireTicks(0);
            return;
        }

        YamlConfiguration cfg = YamlConfiguration.loadConfiguration(file);
        applyInventoryList(inv, cfg.getList("inventory"));
        if (inv.getContents().length <= 36) {
            try {
                List<?> rawArmor = cfg.getList("armor");
                ItemStack[] armor = new ItemStack[4];
                if (rawArmor != null) {
                    int limit = Math.min(rawArmor.size(), armor.length);
                    for (int i = 0; i < limit; i++) {
                        Object item = rawArmor.get(i);
                        if (item instanceof ItemStack) armor[i] = (ItemStack) item;
                    }
                }
                inv.setArmorContents(armor);
            } catch (Throwable ignored) {}
        }
        if (ender != null) {
            applyInventoryList(ender, cfg.getList("enderChest"));
        }

        double maxH = safeMaxHealth(player);
        double health = cfg.getDouble("health", maxH);
        BukkitCompat.setHealth(player, Math.max(1.0, Math.min(maxH, health)));
        player.setFoodLevel(Math.max(0, Math.min(20, cfg.getInt("food", 20))));
        player.setSaturation((float) cfg.getDouble("saturation", 5.0));
        player.setExhaustion((float) cfg.getDouble("exhaustion", 0.0));
        player.setTotalExperience(Math.max(0, cfg.getInt("totalExperience", 0)));
        player.setLevel(Math.max(0, cfg.getInt("level", 0)));
        player.setExp((float) Math.max(0.0, Math.min(1.0, cfg.getDouble("exp", 0.0))));
        player.setFireTicks(Math.max(0, cfg.getInt("fireTicks", 0)));

        String gmStr = cfg.getString("gameMode");
        if (gmStr != null && !gmStr.isEmpty()) {
            try {
                player.setGameMode(GameMode.valueOf(gmStr));
            } catch (IllegalArgumentException ignored) {}
        }
    }

    private static void applyInventoryList(Inventory target, List<?> rawList) {
        ItemStack[] current = target.getContents();
        ItemStack[] next = new ItemStack[current.length];
        if (rawList != null) {
            int limit = Math.min(rawList.size(), next.length);
            for (int i = 0; i < limit; i++) {
                Object item = rawList.get(i);
                if (item instanceof ItemStack) {
                    next[i] = (ItemStack) item;
                }
            }
        }
        target.setContents(next);
    }

    private static double safeMaxHealth(Player p) {
        return BukkitCompat.getMaxHealth(p);
    }

    private File getProfileFile(UUID uuid, String scopeKey) {
        File playerDir = new File(profilesRoot, uuid.toString());
        return new File(playerDir, RealmsConfig.sanitizeKey(scopeKey) + ".yml");
    }

    private File getMetaFile(UUID uuid) {
        File playerDir = new File(profilesRoot, uuid.toString());
        return new File(playerDir, "meta.yml");
    }
}
