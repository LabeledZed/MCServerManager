package com.mcservermanager.bridge;

import java.io.File;
import java.lang.reflect.Method;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.WorldType;
import org.bukkit.entity.Player;

/**
 * Native multi-world lifecycle manager inspired by Multiverse-Core,
 * compatible with Spigot/Paper/Purpur/Leaf 1.13 through 26.3+ (including Paper 26.1+ NamespacedKey dimension storage).
 */
public final class WorldController {

    private final Logger logger;

    public WorldController(Logger logger) {
        this.logger = logger;
    }

    public static boolean isValidWorldName(String name) {
        return name != null && name.matches("^(?:[a-z0-9_.-]+:)?[a-zA-Z0-9_.-]{1,64}$");
    }

    /**
     * Normalizes a world name or namespaced key into a canonical comparison key so that:
     * - "world", "overworld", "minecraft:overworld" all match "minecraft:overworld"
     * - "world_nether", "the_nether", "minecraft:the_nether" all match "minecraft:the_nether"
     * - "world_the_end", "the_end", "minecraft:the_end" all match "minecraft:the_end"
     * - "world_2" and "minecraft:world_2" both match "minecraft:world_2"
     */
    public static String toComparisonKey(String raw) {
        if (raw == null) return "";
        String lower = raw.trim().toLowerCase(Locale.ROOT);
        if (lower.isEmpty()) return "";
        if ("world".equals(lower) || "overworld".equals(lower) || "minecraft:overworld".equals(lower) || "minecraft:world".equals(lower)) {
            return "minecraft:overworld";
        }
        if ("world_nether".equals(lower) || "the_nether".equals(lower) || "minecraft:the_nether".equals(lower) || "minecraft:world_nether".equals(lower)) {
            return "minecraft:the_nether";
        }
        if ("world_the_end".equals(lower) || "the_end".equals(lower) || "minecraft:the_end".equals(lower) || "minecraft:world_the_end".equals(lower)) {
            return "minecraft:the_end";
        }
        if (!lower.contains(":")) {
            return "minecraft:" + lower;
        }
        return lower;
    }

    public static boolean areSameWorld(String a, String b) {
        if (a == null || b == null) return false;
        String ka = toComparisonKey(a);
        String kb = toComparisonKey(b);
        return !ka.isEmpty() && ka.equals(kb);
    }

    /**
     * Converts a raw world name/key into the preferred display/config identifier for the active server version:
     * - On 26.1+ (new dimension storage): default dimensions use "minecraft:overworld", "minecraft:the_nether", "minecraft:the_end".
     * - On pre-26.1: default dimensions use "world", "world_nether", "world_the_end".
     */
    public static String normalizeConfiguredWorldName(String raw) {
        if (raw == null) return "";
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) return "";
        boolean modern = isUsingNewDimensionStorage();
        String cmp = toComparisonKey(trimmed);
        if (modern) {
            if ("minecraft:overworld".equals(cmp)) return "minecraft:overworld";
            if ("minecraft:the_nether".equals(cmp)) return "minecraft:the_nether";
            if ("minecraft:the_end".equals(cmp)) return "minecraft:the_end";
            if (trimmed.toLowerCase(Locale.ROOT).startsWith("minecraft:")) {
                return trimmed.substring("minecraft:".length());
            }
            return trimmed;
        } else {
            if ("minecraft:overworld".equals(cmp)) return "world";
            if ("minecraft:the_nether".equals(cmp)) return "world_nether";
            if ("minecraft:the_end".equals(cmp)) return "world_the_end";
            if (trimmed.toLowerCase(Locale.ROOT).startsWith("minecraft:")) {
                return trimmed.substring("minecraft:".length());
            }
            return trimmed;
        }
    }

    /**
     * Returns the canonical identifier for a loaded Bukkit World.
     * On Paper 26.1+ (new dimension storage), returns "minecraft:overworld", "minecraft:the_nether", "minecraft:the_end"
     * for the default dimensions instead of "world", "world_nether", "world_the_end".
     */
    public static String getCanonicalWorldName(World w) {
        if (w == null) return "";
        if (isUsingNewDimensionStorage()) {
            try {
                Method getKey = w.getClass().getMethod("getKey");
                Object keyObj = getKey.invoke(w);
                if (keyObj != null) {
                    String keyStr = keyObj.toString().toLowerCase(Locale.ROOT);
                    if ("minecraft:overworld".equals(keyStr)
                            || "minecraft:the_nether".equals(keyStr)
                            || "minecraft:the_end".equals(keyStr)) {
                        return keyStr;
                    }
                    if (keyStr.startsWith("minecraft:")) {
                        return keyStr.substring("minecraft:".length());
                    }
                    return keyStr;
                }
            } catch (Throwable ignored) {}
            return normalizeConfiguredWorldName(w.getName());
        }
        return w.getName();
    }

    /**
     * Maps any world identifier to its <key> folder name under world/dimensions/minecraft/<key>.
     */
    public static String toMinecraftDimensionKeyPart(String nameOrKey) {
        String cmp = toComparisonKey(nameOrKey);
        if (cmp.startsWith("minecraft:")) {
            return cmp.substring("minecraft:".length());
        }
        int colon = cmp.indexOf(':');
        return colon >= 0 ? cmp.substring(colon + 1) : cmp;
    }

    /**
     * Maps any world identifier to the traditional Bukkit world name ("world", "world_nether", "world_the_end", etc.).
     */
    public static String toLegacyBukkitWorldName(String nameOrKey) {
        String cmp = toComparisonKey(nameOrKey);
        if ("minecraft:overworld".equals(cmp)) return "world";
        if ("minecraft:the_nether".equals(cmp)) return "world_nether";
        if ("minecraft:the_end".equals(cmp)) return "world_the_end";
        if (cmp.startsWith("minecraft:")) return cmp.substring("minecraft:".length());
        return nameOrKey != null ? nameOrKey.trim() : "";
    }

    public World getWorld(String name) {
        if (name == null || name.isEmpty()) return null;
        World w = Bukkit.getWorld(name);
        if (w != null) return w;

        String legacyName = toLegacyBukkitWorldName(name);
        if (!legacyName.isEmpty() && !legacyName.equals(name)) {
            w = Bukkit.getWorld(legacyName);
            if (w != null) return w;
        }

        // Match among loaded worlds using canonical comparison
        for (World loaded : Bukkit.getWorlds()) {
            if (areSameWorld(loaded.getName(), name) || areSameWorld(getCanonicalWorldName(loaded), name)) {
                return loaded;
            }
        }

        // Paper 26.1+ NamespacedKey lookup via reflection
        try {
            Class<?> keyCls = Class.forName("org.bukkit.NamespacedKey");
            Method fromString = keyCls.getMethod("fromString", String.class);
            String fullKeyStr = toComparisonKey(name);
            Object key = fromString.invoke(null, fullKeyStr);
            if (key != null) {
                Method getWorldByKey = Bukkit.class.getMethod("getWorld", keyCls);
                Object found = getWorldByKey.invoke(null, key);
                if (found instanceof World) return (World) found;
            }
        } catch (Throwable ignored) {}
        return null;
    }

    public void autoLoadConfiguredWorlds(RealmsConfig config) {
        if (config == null || !config.enabled) return;

        Set<String> alreadyTried = new HashSet<>();
        for (RealmsConfig.ManagedWorldConfig mw : config.worlds) {
            if (!mw.autoLoad || mw.name.isEmpty()) continue;
            alreadyTried.add(toComparisonKey(mw.name));
            if (getWorld(mw.name) != null) continue;
            try {
                World loaded = createOrLoadWorld(mw);
                if (loaded != null) {
                    logger.info("[Realms] Auto-loaded world '" + getCanonicalWorldName(loaded) + "' (" + mw.environment + ")");
                }
            } catch (Throwable ex) {
                logger.warning("[Realms] Failed to auto-load world '" + mw.name + "': " + ex.getMessage());
            }
        }

        // Also ensure any world referenced by a group or defaultJoinWorld that exists on disk is loaded
        Set<String> referenced = new HashSet<>();
        if (config.defaultJoinWorld != null && !config.defaultJoinWorld.isEmpty()) {
            referenced.add(config.defaultJoinWorld);
        }
        for (RealmsConfig.WorldGroup g : config.groups) {
            if (g.overworld != null && !g.overworld.isEmpty()) referenced.add(g.overworld);
            if (g.nether != null && !g.nether.isEmpty()) referenced.add(g.nether);
            if (g.end != null && !g.end.isEmpty()) referenced.add(g.end);
            referenced.addAll(g.extraWorlds);
        }

        List<String> onDisk = discoverUnloadedWorldFolders();
        Set<String> onDiskKeys = new HashSet<>();
        for (String d : onDisk) onDiskKeys.add(toComparisonKey(d));

        for (String ref : referenced) {
            String refKey = toComparisonKey(ref);
            if (alreadyTried.contains(refKey)) continue;
            if (getWorld(ref) != null) continue;
            if (!onDiskKeys.contains(refKey)) continue;
            RealmsConfig.ManagedWorldConfig inferred = new RealmsConfig.ManagedWorldConfig();
            inferred.name = normalizeConfiguredWorldName(ref);
            inferred.environment = inferEnvironmentFromName(ref);
            try {
                World loaded = createOrLoadWorld(inferred);
                if (loaded != null) {
                    logger.info("[Realms] Loaded referenced world '" + getCanonicalWorldName(loaded) + "'");
                }
            } catch (Throwable ex) {
                logger.warning("[Realms] Could not load referenced world '" + ref + "': " + ex.getMessage());
            }
        }
    }

    public World createOrLoadWorld(RealmsConfig.ManagedWorldConfig cfg) {
        if (!isValidWorldName(cfg.name)) {
            throw new IllegalArgumentException("Invalid world name (use letters, numbers, _, - or namespace:key): " + cfg.name);
        }
        World existing = getWorld(cfg.name);
        if (existing != null) {
            return existing;
        }

        if (FoliaCompat.isFolia()) {
            throw new UnsupportedOperationException("Folia does not support dynamically creating or loading new worlds at runtime.");
        }

        WorldCreator creator = buildCompatibleWorldCreator(cfg.name);
        creator.environment(parseEnvironment(cfg.environment));
        creator.type(parseWorldType(cfg.worldType));
        try {
            creator.generateStructures(cfg.generateStructures);
        } catch (Throwable ignored) {}

        if (cfg.seed != null && !cfg.seed.trim().isEmpty()) {
            creator.seed(parseSeed(cfg.seed.trim()));
        }
        if (cfg.generator != null && !cfg.generator.trim().isEmpty()) {
            creator.generator(cfg.generator.trim());
        }

        World created = Bukkit.createWorld(creator);
        if (created == null) {
            throw new IllegalStateException("Bukkit returned null when creating/loading world: " + cfg.name);
        }
        return created;
    }

    /**
     * Builds a WorldCreator compatible with both PaperMC 26.1+ NamespacedKey dimension storage
     * and classic Spigot/Paper 1.13-1.21 world containers (modeled after Multiverse-Core's WorldCreatorCompatibility).
     */
    private WorldCreator buildCompatibleWorldCreator(String worldName) {
        boolean newDimStorage = isUsingNewDimensionStorage();
        String bukkitName = toLegacyBukkitWorldName(worldName);
        String keyPart = toMinecraftDimensionKeyPart(worldName);
        try {
            Class<?> keyCls = Class.forName("org.bukkit.NamespacedKey");
            Method fromStringMethod = keyCls.getMethod("fromString", String.class);
            String fullKey = worldName.contains(":") ? toComparisonKey(worldName) : ("minecraft:" + keyPart);
            Object nsKey = fromStringMethod.invoke(null, fullKey);
            if (nsKey != null) {
                if (!newDimStorage || fullKey.startsWith("minecraft:")) {
                    try {
                        Method ofNameAndKey = WorldCreator.class.getMethod("ofNameAndKey", String.class, keyCls);
                        Object wc = ofNameAndKey.invoke(null, bukkitName, nsKey);
                        if (wc instanceof WorldCreator) return (WorldCreator) wc;
                    } catch (NoSuchMethodException ignored) {}
                }
                if (newDimStorage) {
                    try {
                        Method ofKey = WorldCreator.class.getMethod("ofKey", keyCls);
                        Object wc = ofKey.invoke(null, nsKey);
                        if (wc instanceof WorldCreator) return (WorldCreator) wc;
                    } catch (NoSuchMethodException ignored) {}
                }
            }
        } catch (Throwable ignored) {}
        return WorldCreator.name(bukkitName);
    }

    public String unloadWorld(String worldName, boolean save, String fallbackWorldName) {
        World target = getWorld(worldName);
        if (target == null) return "World is not loaded: " + worldName;

        List<World> all = Bukkit.getWorlds();
        if (!all.isEmpty() && all.get(0).getName().equalsIgnoreCase(target.getName())) {
            return "Cannot unload the server's primary default world (" + getCanonicalWorldName(target) + ").";
        }

        World fallback = getWorld(fallbackWorldName);
        if (fallback == null || fallback.getName().equalsIgnoreCase(target.getName())) {
            for (World w : all) {
                if (!w.getName().equalsIgnoreCase(target.getName())) {
                    fallback = w;
                    break;
                }
            }
        }

        if (fallback != null) {
            Location safeLoc = fallback.getSpawnLocation();
            for (Player p : new ArrayList<>(target.getPlayers())) {
                FoliaCompat.teleportSafe(p, safeLoc);
                p.sendMessage("\u00A7eWorld '" + getCanonicalWorldName(target) + "' is unloading — moved to " + getCanonicalWorldName(fallback) + ".");
            }
        }

        boolean ok = Bukkit.unloadWorld(target, save);
        return ok ? null : "Bukkit refused to unload world '" + getCanonicalWorldName(target) + "' (players or spawn chunks may still be active).";
    }

    public String deleteWorld(String worldName, String fallbackWorldName) {
        if (!isValidWorldName(worldName)) return "Invalid world name";

        if ("minecraft:overworld".equals(toComparisonKey(worldName))) {
            return "Cannot delete the server's primary Overworld (minecraft:overworld) from Realms.";
        }

        World loaded = getWorld(worldName);
        File folderToDelete = null;
        if (loaded != null) {
            folderToDelete = loaded.getWorldFolder();
            String err = unloadWorld(worldName, false, fallbackWorldName);
            if (err != null) return err;
        }

        File levelDir = getLevelDirectory();
        boolean deletedAny = false;
        if (folderToDelete != null && folderToDelete.exists()) {
            // Never delete the top-level 26.1+ level container folder itself!
            if (levelDir == null || !folderToDelete.getAbsolutePath().equalsIgnoreCase(levelDir.getAbsolutePath())) {
                deletedAny = deleteRecursively(folderToDelete);
            }
        }

        if (isUsingNewDimensionStorage()) {
            File dimDir = getNewDimensionStorageMinecraftDir();
            if (dimDir != null) {
                String keyPart = toMinecraftDimensionKeyPart(worldName);
                File modernFolder = new File(dimDir, keyPart);
                if (modernFolder.exists() && modernFolder.isDirectory()) {
                    deletedAny = deleteRecursively(modernFolder) || deletedAny;
                }
            }
        } else {
            String legacyName = toLegacyBukkitWorldName(worldName);
            File classicFolder = new File(Bukkit.getWorldContainer(), legacyName);
            if (classicFolder.exists() && classicFolder.isDirectory()) {
                deletedAny = deleteRecursively(classicFolder) || deletedAny;
            }
        }

        return deletedAny || loaded != null ? null : "World folder not found: " + worldName;
    }

    /**
     * Scans both classic world container and Paper 26.1+ [level]/dimensions/minecraft/ for unloaded world folders.
     */
    public List<String> discoverUnloadedWorldFolders() {
        Set<String> loadedKeys = new HashSet<>();
        for (World w : Bukkit.getWorlds()) {
            loadedKeys.add(toComparisonKey(w.getName()));
            loadedKeys.add(toComparisonKey(getCanonicalWorldName(w)));
        }

        Set<String> found = new HashSet<>();
        if (isUsingNewDimensionStorage()) {
            File dimDir = getNewDimensionStorageMinecraftDir();
            if (dimDir != null && dimDir.isDirectory()) {
                File[] children = dimDir.listFiles();
                if (children != null) {
                    for (File f : children) {
                        if (!f.isDirectory()) continue;
                        String name = f.getName();
                        String candidate = ("overworld".equalsIgnoreCase(name)
                                || "the_nether".equalsIgnoreCase(name)
                                || "the_end".equalsIgnoreCase(name))
                                ? ("minecraft:" + name.toLowerCase(Locale.ROOT))
                                : name;
                        if (loadedKeys.contains(toComparisonKey(candidate))) continue;
                        if (looksLikeWorldFolder(f)) {
                            found.add(candidate);
                        }
                    }
                }
            }
        } else {
            File container = Bukkit.getWorldContainer();
            if (container != null && container.isDirectory()) {
                File[] children = container.listFiles();
                if (children != null) {
                    for (File f : children) {
                        if (!f.isDirectory()) continue;
                        String name = f.getName();
                        if (loadedKeys.contains(toComparisonKey(name))) continue;
                        if (looksLikeWorldFolder(f)) {
                            found.add(name);
                        }
                    }
                }
            }
        }

        List<String> list = new ArrayList<>(found);
        Collections.sort(list, String.CASE_INSENSITIVE_ORDER);
        return list;
    }

    private static boolean looksLikeWorldFolder(File dir) {
        return new File(dir, "level.dat").exists()
            || new File(dir, "region").isDirectory()
            || new File(dir, "DIM-1").isDirectory()
            || new File(dir, "DIM1").isDirectory()
            || new File(dir, "entities").isDirectory();
    }

    public static boolean isUsingNewDimensionStorage() {
        return getLevelDirectory() != null;
    }

    private static File getLevelDirectory() {
        try {
            Method m = Bukkit.getServer().getClass().getMethod("getLevelDirectory");
            Object out = m.invoke(Bukkit.getServer());
            if (out instanceof Path) return ((Path) out).toFile();
            if (out instanceof File) return (File) out;
        } catch (Throwable ignored) {}
        return null;
    }

    private static File getNewDimensionStorageMinecraftDir() {
        File levelDir = getLevelDirectory();
        if (levelDir == null) return null;
        return new File(new File(levelDir, "dimensions"), "minecraft");
    }

    public static World.Environment parseEnvironment(String env) {
        if (env == null) return World.Environment.NORMAL;
        try {
            return World.Environment.valueOf(env.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            return World.Environment.NORMAL;
        }
    }

    public static WorldType parseWorldType(String type) {
        if (type == null) return WorldType.NORMAL;
        try {
            return WorldType.valueOf(type.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            return WorldType.NORMAL;
        }
    }

    public static String inferEnvironmentFromName(String worldName) {
        if (worldName == null) return "NORMAL";
        String lower = worldName.toLowerCase(Locale.ROOT);
        if (lower.contains("nether")) return "NETHER";
        if (lower.endsWith("_end") || lower.contains("the_end")) return "THE_END";
        return "NORMAL";
    }

    private static long parseSeed(String raw) {
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException ex) {
            return (long) raw.hashCode();
        }
    }

    private static boolean deleteRecursively(File f) {
        if (f == null || !f.exists()) return false;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) {
                for (File c : children) {
                    deleteRecursively(c);
                }
            }
        }
        return f.delete();
    }
}
