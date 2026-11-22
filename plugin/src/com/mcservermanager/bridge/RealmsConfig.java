package com.mcservermanager.bridge;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.bukkit.entity.Player;

/**
 * Configuration model and lookup helpers for MCServerManager Realms, World Groups,
 * Colored Owned Portals, and Per-World Plugins.
 */
public final class RealmsConfig {

    public static final class SeparationOptions {
        public boolean inventory = true;
        public boolean chat = false;
        public boolean visibility = false;
        public boolean portalsAndRespawn = true;

        public SeparationOptions() {}

        public SeparationOptions(boolean inventory, boolean chat, boolean visibility, boolean portalsAndRespawn) {
            this.inventory = inventory;
            this.chat = chat;
            this.visibility = visibility;
            this.portalsAndRespawn = portalsAndRespawn;
        }

        public static SeparationOptions fromMap(Map<String, Object> m, SeparationOptions defaults) {
            SeparationOptions s = new SeparationOptions(
                defaults.inventory, defaults.chat, defaults.visibility, defaults.portalsAndRespawn
            );
            if (m == null) return s;
            s.inventory = JsonUtil.asBoolean(m.get("inventory"), s.inventory);
            s.chat = JsonUtil.asBoolean(m.get("chat"), s.chat);
            s.visibility = JsonUtil.asBoolean(m.get("visibility"), s.visibility);
            s.portalsAndRespawn = JsonUtil.asBoolean(m.get("portalsAndRespawn"), s.portalsAndRespawn);
            return s;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("inventory", inventory);
            m.put("chat", chat);
            m.put("visibility", visibility);
            m.put("portalsAndRespawn", portalsAndRespawn);
            return m;
        }
    }

    public static final class ManagedWorldConfig {
        public String name = "";
        public String environment = "NORMAL";
        public String worldType = "NORMAL";
        public String seed = "";
        public boolean generateStructures = true;
        public String generator = "";
        public boolean autoLoad = true;
        public String defaultGameMode = "";
        public SeparationOptions standaloneSeparation = new SeparationOptions(false, false, false, false);
        public String color = "";

        public static ManagedWorldConfig fromMap(Map<String, Object> m) {
            ManagedWorldConfig w = new ManagedWorldConfig();
            if (m == null) return w;
            w.name = JsonUtil.asString(m.get("name"), "").trim();
            w.environment = JsonUtil.asString(m.get("environment"), "NORMAL").toUpperCase(Locale.ROOT);
            w.worldType = JsonUtil.asString(m.get("worldType"), "NORMAL").toUpperCase(Locale.ROOT);
            w.seed = JsonUtil.asString(m.get("seed"), "").trim();
            w.generateStructures = JsonUtil.asBoolean(m.get("generateStructures"), true);
            w.generator = JsonUtil.asString(m.get("generator"), "").trim();
            w.autoLoad = JsonUtil.asBoolean(m.get("autoLoad"), true);
            w.defaultGameMode = JsonUtil.asString(m.get("defaultGameMode"), "").trim().toUpperCase(Locale.ROOT);
            w.standaloneSeparation = SeparationOptions.fromMap(
                JsonUtil.asMap(m.get("standaloneSeparation")),
                new SeparationOptions(false, false, false, false)
            );
            w.color = JsonUtil.asString(m.get("color"), "").trim();
            return w;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", name);
            m.put("environment", environment);
            m.put("worldType", worldType);
            if (seed != null && !seed.isEmpty()) m.put("seed", seed);
            m.put("generateStructures", generateStructures);
            if (generator != null && !generator.isEmpty()) m.put("generator", generator);
            m.put("autoLoad", autoLoad);
            if (defaultGameMode != null && !defaultGameMode.isEmpty()) m.put("defaultGameMode", defaultGameMode);
            m.put("standaloneSeparation", standaloneSeparation.toMap());
            if (color != null && !color.isEmpty()) m.put("color", color);
            return m;
        }
    }

    public static final class WorldGroup {
        public String id = "";
        public String name = "";
        public String color = "#37abc8";
        public String overworld = "";
        public String nether = "";
        public String end = "";
        public List<String> extraWorlds = new ArrayList<>();
        public String defaultGameMode = "";
        public List<String> players = new ArrayList<>();
        public List<String> allowedTpaGroups = new ArrayList<>();
        public SeparationOptions separation = new SeparationOptions(true, true, true, true);

        public boolean allowsTpaTo(String targetGroupId) {
            if (targetGroupId == null || targetGroupId.isEmpty()) return false;
            if (targetGroupId.equalsIgnoreCase(this.id)) return true;
            for (String allowed : allowedTpaGroups) {
                if (allowed != null && allowed.equalsIgnoreCase(targetGroupId)) return true;
            }
            return false;
        }

        public boolean containsWorld(String worldName) {
            if (worldName == null || worldName.isEmpty()) return false;
            if (WorldController.areSameWorld(worldName, overworld)) return true;
            if (nether != null && !nether.isEmpty() && WorldController.areSameWorld(worldName, nether)) return true;
            if (end != null && !end.isEmpty() && WorldController.areSameWorld(worldName, end)) return true;
            for (String extra : extraWorlds) {
                if (WorldController.areSameWorld(worldName, extra)) return true;
            }
            return false;
        }

        public Set<String> allWorldsLower() {
            Set<String> set = new HashSet<>();
            if (overworld != null && !overworld.isEmpty()) set.add(WorldController.toComparisonKey(overworld));
            if (nether != null && !nether.isEmpty()) set.add(WorldController.toComparisonKey(nether));
            if (end != null && !end.isEmpty()) set.add(WorldController.toComparisonKey(end));
            for (String extra : extraWorlds) {
                if (extra != null && !extra.isEmpty()) set.add(WorldController.toComparisonKey(extra));
            }
            return set;
        }

        public boolean hasPlayer(String playerName, String uuid) {
            for (String entry : players) {
                if (entry == null || entry.isEmpty()) continue;
                if (playerName != null && entry.equalsIgnoreCase(playerName)) return true;
                if (uuid != null && entry.equalsIgnoreCase(uuid)) return true;
            }
            return false;
        }

        public static WorldGroup fromMap(Map<String, Object> m) {
            WorldGroup g = new WorldGroup();
            if (m == null) return g;
            g.id = JsonUtil.asString(m.get("id"), "").trim();
            g.name = JsonUtil.asString(m.get("name"), g.id).trim();
            g.color = normalizeHexColor(JsonUtil.asString(m.get("color"), "#37abc8"));
            g.overworld = WorldController.normalizeConfiguredWorldName(JsonUtil.asString(m.get("overworld"), "").trim());
            g.nether = WorldController.normalizeConfiguredWorldName(JsonUtil.asString(m.get("nether"), "").trim());
            g.end = WorldController.normalizeConfiguredWorldName(JsonUtil.asString(m.get("end"), "").trim());
            g.extraWorlds = JsonUtil.asStringList(m.get("extraWorlds"));
            g.defaultGameMode = JsonUtil.asString(m.get("defaultGameMode"), "").trim().toUpperCase(Locale.ROOT);
            g.players = JsonUtil.asStringList(m.get("players"));
            g.allowedTpaGroups = JsonUtil.asStringList(m.get("allowedTpaGroups"));
            g.separation = SeparationOptions.fromMap(
                JsonUtil.asMap(m.get("separation")),
                new SeparationOptions(true, true, true, true)
            );
            return g;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            m.put("name", name);
            m.put("color", color);
            m.put("overworld", overworld);
            if (nether != null && !nether.isEmpty()) m.put("nether", nether);
            if (end != null && !end.isEmpty()) m.put("end", end);
            if (!extraWorlds.isEmpty()) m.put("extraWorlds", extraWorlds);
            if (defaultGameMode != null && !defaultGameMode.isEmpty()) m.put("defaultGameMode", defaultGameMode);
            m.put("players", players);
            m.put("allowedTpaGroups", allowedTpaGroups);
            m.put("separation", separation.toMap());
            return m;
        }
    }

    public static final class PluginWorldRule {
        public String mode = "all"; // "all" | "allow" | "deny"
        public List<String> worlds = new ArrayList<>();
        public List<String> groups = new ArrayList<>();

        public static PluginWorldRule fromMap(Map<String, Object> m) {
            PluginWorldRule r = new PluginWorldRule();
            if (m == null) return r;
            String mode = JsonUtil.asString(m.get("mode"), "all").toLowerCase(Locale.ROOT);
            if (!"allow".equals(mode) && !"deny".equals(mode)) mode = "all";
            r.mode = mode;
            r.worlds = JsonUtil.asStringList(m.get("worlds"));
            r.groups = JsonUtil.asStringList(m.get("groups"));
            return r;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("mode", mode);
            m.put("worlds", worlds);
            m.put("groups", groups);
            return m;
        }
    }

    public static final class TrackedPortal {
        public String id = "";
        public String world = "";
        public int x;
        public int y;
        public int z;
        public String groupId = "";
        public String targetOverworld = "";

        public static TrackedPortal fromMap(Map<String, Object> m) {
            TrackedPortal p = new TrackedPortal();
            if (m == null) return p;
            p.id = JsonUtil.asString(m.get("id"), "");
            p.world = JsonUtil.asString(m.get("world"), "");
            p.x = JsonUtil.asInt(m.get("x"), 0);
            p.y = JsonUtil.asInt(m.get("y"), 64);
            p.z = JsonUtil.asInt(m.get("z"), 0);
            p.groupId = JsonUtil.asString(m.get("groupId"), "");
            p.targetOverworld = JsonUtil.asString(m.get("targetOverworld"), "");
            if (p.id.isEmpty()) {
                p.id = p.world + ":" + p.x + ":" + p.y + ":" + p.z;
            }
            return p;
        }

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            m.put("world", world);
            m.put("x", x);
            m.put("y", y);
            m.put("z", z);
            m.put("groupId", groupId);
            m.put("targetOverworld", targetOverworld);
            return m;
        }
    }

    public boolean enabled = true;
    public String defaultJoinWorld = "world";
    public boolean forceDefaultJoinForUnassigned = false;
    public boolean ownedColoredPortals = true;
    public boolean tpaEnabled = true;
    public int tpaTimeoutSeconds = 60;
    public boolean backEnabled = true;
    public List<ManagedWorldConfig> worlds = new ArrayList<>();
    public List<WorldGroup> groups = new ArrayList<>();
    public Map<String, PluginWorldRule> pluginRules = new LinkedHashMap<>();

    public RealmsConfig() {
        ensureDefaultGroup();
    }

    public static WorldGroup createDefaultWorldGroup() {
        boolean modern = WorldController.isUsingNewDimensionStorage();
        WorldGroup g = new WorldGroup();
        g.id = "default";
        g.name = "Default World";
        g.color = "#10b981";
        g.overworld = modern ? "minecraft:overworld" : "world";
        g.nether = modern ? "minecraft:the_nether" : "world_nether";
        g.end = modern ? "minecraft:the_end" : "world_the_end";
        g.separation = new SeparationOptions(true, true, true, true);
        return g;
    }

    public void ensureDefaultGroup() {
        if (groups.isEmpty()) {
            groups.add(createDefaultWorldGroup());
        }
    }

    public static RealmsConfig load(File file) {
        if (file == null || !file.exists()) {
            return new RealmsConfig();
        }
        try {
            String raw = readTextFile(file);
            return fromMap(JsonUtil.parseObject(raw));
        } catch (Exception ex) {
            return new RealmsConfig();
        }
    }

    public synchronized void save(File file) throws IOException {
        if (file.getParentFile() != null && !file.getParentFile().exists()) {
            file.getParentFile().mkdirs();
        }
        writeTextFile(file, JsonUtil.stringify(toMap()));
    }

    public static RealmsConfig fromMap(Map<String, Object> m) {
        RealmsConfig cfg = new RealmsConfig();
        if (m == null) return cfg;
        cfg.enabled = JsonUtil.asBoolean(m.get("enabled"), true);
        String defWorldRaw = JsonUtil.asString(m.get("defaultJoinWorld"), "world").trim();
        cfg.defaultJoinWorld = WorldController.normalizeConfiguredWorldName(defWorldRaw.isEmpty() ? "world" : defWorldRaw);
        cfg.forceDefaultJoinForUnassigned = JsonUtil.asBoolean(m.get("forceDefaultJoinForUnassigned"), false);
        cfg.ownedColoredPortals = JsonUtil.asBoolean(m.get("ownedColoredPortals"), true);
        cfg.tpaEnabled = JsonUtil.asBoolean(m.get("tpaEnabled"), true);
        cfg.tpaTimeoutSeconds = Math.max(10, Math.min(300, JsonUtil.asInt(m.get("tpaTimeoutSeconds"), 60)));
        cfg.backEnabled = JsonUtil.asBoolean(m.get("backEnabled"), true);

        List<Object> wList = JsonUtil.asList(m.get("worlds"));
        if (wList != null) {
            for (Object item : wList) {
                ManagedWorldConfig w = ManagedWorldConfig.fromMap(JsonUtil.asMap(item));
                if (!w.name.isEmpty()) cfg.worlds.add(w);
            }
        }

        List<Object> gList = JsonUtil.asList(m.get("groups"));
        if (gList != null) {
            cfg.groups.clear();
            for (Object item : gList) {
                WorldGroup g = WorldGroup.fromMap(JsonUtil.asMap(item));
                if (!g.id.isEmpty()) cfg.groups.add(g);
            }
        }
        cfg.ensureDefaultGroup();

        Map<String, Object> pMap = JsonUtil.asMap(m.get("pluginRules"));
        if (pMap != null) {
            for (Map.Entry<String, Object> e : pMap.entrySet()) {
                PluginWorldRule rule = PluginWorldRule.fromMap(JsonUtil.asMap(e.getValue()));
                cfg.pluginRules.put(e.getKey(), rule);
            }
        }
        return cfg;
    }

    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", enabled);
        m.put("defaultJoinWorld", defaultJoinWorld);
        m.put("forceDefaultJoinForUnassigned", forceDefaultJoinForUnassigned);
        m.put("ownedColoredPortals", ownedColoredPortals);
        m.put("tpaEnabled", tpaEnabled);
        m.put("tpaTimeoutSeconds", tpaTimeoutSeconds);
        m.put("backEnabled", backEnabled);

        List<Object> wList = new ArrayList<>();
        for (ManagedWorldConfig w : worlds) wList.add(w.toMap());
        m.put("worlds", wList);

        List<Object> gList = new ArrayList<>();
        for (WorldGroup g : groups) gList.add(g.toMap());
        m.put("groups", gList);

        Map<String, Object> pMap = new LinkedHashMap<>();
        for (Map.Entry<String, PluginWorldRule> e : pluginRules.entrySet()) {
            pMap.put(e.getKey(), e.getValue().toMap());
        }
        m.put("pluginRules", pMap);
        return m;
    }

    public WorldGroup findGroupById(String id) {
        if (id == null || id.isEmpty()) return null;
        for (WorldGroup g : groups) {
            if (g.id.equalsIgnoreCase(id)) return g;
        }
        return null;
    }

    public WorldGroup getDefaultGroup() {
        ensureDefaultGroup();
        if (defaultJoinWorld != null && !defaultJoinWorld.isEmpty()) {
            WorldGroup byOw = findGroupByOverworld(defaultJoinWorld);
            if (byOw != null) return byOw;
            List<WorldGroup> containing = findGroupsContainingWorld(defaultJoinWorld);
            if (!containing.isEmpty()) return containing.get(0);
        }
        WorldGroup byId = findGroupById("default");
        if (byId != null) return byId;
        return groups.get(0);
    }

    public WorldGroup findExplicitGroupForPlayerName(String name, String uuid) {
        for (WorldGroup g : groups) {
            if (g.hasPlayer(name, uuid)) return g;
        }
        return null;
    }

    public WorldGroup findGroupForPlayer(Player player) {
        if (player == null) return getDefaultGroup();
        return findGroupForPlayerName(player.getName(), player.getUniqueId().toString());
    }

    /**
     * Every player belongs to a list at all times: if not explicitly listed in a group,
     * they inherit the default world's group.
     */
    public WorldGroup findGroupForPlayerName(String name, String uuid) {
        WorldGroup explicit = findExplicitGroupForPlayerName(name, uuid);
        return explicit != null ? explicit : getDefaultGroup();
    }

    /**
     * Checks whether a sender's list has permission to exchange /tpa and /tpahere requests with a target's list.
     * Own list is always allowed; cross-list requires targetGroup.id in senderGroup.allowedTpaGroups.
     */
    public boolean canGroupsExchangeTpa(WorldGroup senderGroup, WorldGroup targetGroup) {
        if (senderGroup == null || targetGroup == null) return true;
        return senderGroup.allowsTpaTo(targetGroup.id);
    }

    public List<WorldGroup> findGroupsContainingWorld(String worldName) {
        List<WorldGroup> out = new ArrayList<>();
        if (worldName == null || worldName.isEmpty()) return out;
        for (WorldGroup g : groups) {
            if (g.containsWorld(worldName)) out.add(g);
        }
        return out;
    }

    public WorldGroup findGroupByOverworld(String worldName) {
        if (worldName == null || worldName.isEmpty()) return null;
        for (WorldGroup g : groups) {
            if (WorldController.areSameWorld(worldName, g.overworld)) return g;
        }
        return null;
    }

    public ManagedWorldConfig findManagedWorld(String worldName) {
        if (worldName == null || worldName.isEmpty()) return null;
        for (ManagedWorldConfig w : worlds) {
            if (WorldController.areSameWorld(w.name, worldName)) return w;
        }
        return null;
    }

    public void upsertManagedWorld(ManagedWorldConfig cfg) {
        for (int i = 0; i < worlds.size(); i++) {
            if (WorldController.areSameWorld(worlds.get(i).name, cfg.name)) {
                worlds.set(i, cfg);
                return;
            }
        }
        worlds.add(cfg);
    }

    public void removeManagedWorld(String worldName) {
        worlds.removeIf(w -> WorldController.areSameWorld(w.name, worldName));
    }

    /**
     * Returns the inventory/chat/visibility scope identifier for a world:
     * - Exclusively owned by 1 group -> "group_<id>"
     * - Shared across 2+ groups (e.g. shared Nether) -> null (preserves player's active scope)
     * - Standalone world -> "world_<name>"
     */
    public String getScopeKeyForWorld(String worldName) {
        if (worldName == null || worldName.isEmpty()) return "world_default";
        List<WorldGroup> owners = findGroupsContainingWorld(worldName);
        if (owners.size() == 1) {
            return "group_" + sanitizeKey(owners.get(0).id);
        }
        if (owners.size() > 1) {
            return null;
        }
        return "world_" + sanitizeKey(worldName.toLowerCase(Locale.ROOT));
    }

    public SeparationOptions getEffectiveSeparation(String worldName) {
        List<WorldGroup> owners = findGroupsContainingWorld(worldName);
        if (owners.size() == 1) {
            return owners.get(0).separation;
        }
        if (owners.size() > 1) {
            // Shared dimension: portals & respawn enabled if any owning group enables it;
            // inventory/chat/visibility stay shared among groups sharing this dimension unless all isolate
            boolean portals = false;
            boolean chat = true;
            boolean vis = true;
            for (WorldGroup g : owners) {
                if (g.separation.portalsAndRespawn) portals = true;
                if (!g.separation.chat) chat = false;
                if (!g.separation.visibility) vis = false;
            }
            return new SeparationOptions(false, chat, vis, portals);
        }
        ManagedWorldConfig mw = findManagedWorld(worldName);
        if (mw != null && mw.standaloneSeparation != null) {
            return mw.standaloneSeparation;
        }
        return new SeparationOptions(false, false, false, false);
    }

    public String getDefaultGameModeForWorld(String worldName) {
        List<WorldGroup> owners = findGroupsContainingWorld(worldName);
        if (owners.size() == 1 && owners.get(0).defaultGameMode != null && !owners.get(0).defaultGameMode.isEmpty()) {
            return owners.get(0).defaultGameMode;
        }
        ManagedWorldConfig mw = findManagedWorld(worldName);
        if (mw != null && mw.defaultGameMode != null && !mw.defaultGameMode.isEmpty()) {
            return mw.defaultGameMode;
        }
        return "";
    }

    public boolean canPlayersInteractInScope(String worldA, String worldB, boolean checkVisibility) {
        if (worldA == null || worldB == null) return true;
        if (WorldController.areSameWorld(worldA, worldB)) return true;

        List<WorldGroup> groupsA = findGroupsContainingWorld(worldA);
        List<WorldGroup> groupsB = findGroupsContainingWorld(worldB);

        // If they share at least one WorldGroup, they are in the same virtual server!
        for (WorldGroup ga : groupsA) {
            for (WorldGroup gb : groupsB) {
                if (ga.id.equalsIgnoreCase(gb.id)) {
                    return true;
                }
            }
        }

        SeparationOptions sepA = getEffectiveSeparation(worldA);
        SeparationOptions sepB = getEffectiveSeparation(worldB);
        boolean isolatedA = checkVisibility ? sepA.visibility : sepA.chat;
        boolean isolatedB = checkVisibility ? sepB.visibility : sepB.chat;
        return !isolatedA && !isolatedB;
    }

    public PluginWorldRule findPluginRule(String pluginName) {
        if (pluginName == null) return null;
        PluginWorldRule exact = pluginRules.get(pluginName);
        if (exact != null) return exact;
        for (Map.Entry<String, PluginWorldRule> e : pluginRules.entrySet()) {
            if (e.getKey().equalsIgnoreCase(pluginName)) return e.getValue();
        }
        return null;
    }

    public boolean isPluginAllowedInWorld(String pluginName, String worldName) {
        if (!enabled || pluginName == null || worldName == null) return true;
        if ("MCServerManagerBridge".equalsIgnoreCase(pluginName)) return true;

        PluginWorldRule rule = findPluginRule(pluginName);
        if (rule == null || "all".equalsIgnoreCase(rule.mode)) return true;

        Set<String> targetWorlds = new HashSet<>();
        for (String w : rule.worlds) {
            if (w != null && !w.isEmpty()) targetWorlds.add(WorldController.toComparisonKey(w));
        }
        for (String groupId : rule.groups) {
            WorldGroup g = findGroupById(groupId);
            if (g != null) {
                targetWorlds.addAll(g.allWorldsLower());
            }
        }

        boolean inTargets = targetWorlds.contains(WorldController.toComparisonKey(worldName));
        if ("allow".equalsIgnoreCase(rule.mode)) {
            return inTargets;
        }
        if ("deny".equalsIgnoreCase(rule.mode)) {
            return !inTargets;
        }
        return true;
    }

    public static String normalizeHexColor(String color) {
        if (color == null) return "#37abc8";
        String c = color.trim();
        if (!c.startsWith("#")) c = "#" + c;
        if (c.matches("^#[0-9a-fA-F]{6}$")) return c.toLowerCase(Locale.ROOT);
        return "#37abc8";
    }

    public static int[] parseHexRgb(String hex) {
        String c = normalizeHexColor(hex);
        int rgb = Integer.parseInt(c.substring(1), 16);
        return new int[] { (rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF };
    }

    public static String hexToChatColor(String hex) {
        String c = normalizeHexColor(hex).substring(1);
        // §x§R§R§G§G§B§B works on Spigot/Paper 1.16+; cleanly degrades if unsupported
        StringBuilder sb = new StringBuilder("\u00A7x");
        for (int i = 0; i < 6; i++) {
            sb.append('\u00A7').append(c.charAt(i));
        }
        return sb.toString();
    }

    public static String sanitizeKey(String raw) {
        if (raw == null || raw.isEmpty()) return "default";
        return raw.replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    public static String readTextFile(File file) throws IOException {
        try (FileInputStream fis = new FileInputStream(file);
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = fis.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            return new String(baos.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    public static void writeTextFile(File file, String content) throws IOException {
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        File tmp = new File(file.getParentFile(), file.getName() + ".tmp");
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(bytes);
        }
        if (file.exists() && !file.delete()) {
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(bytes);
            }
            tmp.delete();
        } else if (!tmp.renameTo(file)) {
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(bytes);
            }
            tmp.delete();
        }
    }
}
