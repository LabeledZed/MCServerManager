package com.mcservermanager.bridge;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.bukkit.Bukkit;
import org.bukkit.Difficulty;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.WorldBorder;
import org.bukkit.command.PluginCommand;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Loopback management bridge plugin installed by MCServerManager on Spigot/Paper/Purpur/Leaf servers.
 * Exposes authenticated 127.0.0.1 endpoints for live gamerules, world environment, TPS, broadcasts,
 * player controls, native Multiverse-style multi-world realms, colored owned portals, and per-world plugins.
 */
public class MCServerManagerBridgePlugin extends JavaPlugin {
    private HttpServer httpServer;
    private ExecutorService executor;
    private String authToken;

    private File realmsFile;
    private volatile RealmsConfig realmsConfig = new RealmsConfig();
    private WorldController worldController;
    private PlayerProfileManager profileManager;
    private PortalManager portalManager;
    private PluginScopeManager pluginScopeManager;
    private TpaManager tpaManager;
    private RealmsListener realmsListener;

    public RealmsConfig getRealmsConfig() {
        return realmsConfig;
    }

    @Override
    public void onEnable() {
        File folder = getDataFolder();
        if (!folder.exists()) {
            folder.mkdirs();
        }

        // Initialize Realms, Multi-World, Colored Portals, and Per-World Plugins engine
        this.realmsFile = new File(folder, "realms.json");
        this.realmsConfig = RealmsConfig.load(this.realmsFile);
        this.worldController = new WorldController(getLogger());
        this.profileManager = new PlayerProfileManager(folder, getLogger());
        this.portalManager = new PortalManager(this, this.worldController, folder, getLogger());
        this.pluginScopeManager = new PluginScopeManager(this, this.realmsConfig, getLogger());
        this.tpaManager = new TpaManager(this, this.worldController, this.profileManager);
        this.realmsListener = new RealmsListener(
            this, this.worldController, this.profileManager, this.portalManager, this.pluginScopeManager, this.tpaManager
        );

        Bukkit.getPluginManager().registerEvents(this.realmsListener, this);
        this.pluginScopeManager.registerCommandSendHook(this.realmsListener);

        PluginCommand mvCmd = getCommand("mv");
        if (mvCmd != null) {
            mvCmd.setExecutor(new RealmsCommand(this, this.worldController));
        }

        // Dynamically register TPA & /back commands only when enabled so third-party TPA plugins never conflict
        this.tpaManager.syncCommandRegistration(this.realmsConfig);

        // Defer world auto-loading and plugin listener wrapping by 1-2 ticks so all other plugins enable first
        FoliaCompat.runGlobalDelayed(this, new Runnable() {
            @Override
            public void run() {
                if (!FoliaCompat.isFolia()) {
                    worldController.autoLoadConfiguredWorlds(realmsConfig);
                }
                pluginScopeManager.syncAllListeners();
                realmsListener.refreshVisibilityForAll();
                tpaManager.startExpirationTask();
                portalManager.startParticleTask(new PortalManager.RealmsConfigSupplier() {
                    @Override
                    public RealmsConfig get() {
                        return realmsConfig;
                    }
                });
            }
        }, 2L);

        // Start authenticated loopback HTTP bridge
        File propsFile = new File(folder, "bridge.properties");
        if (!propsFile.exists()) {
            getLogger().info("bridge.properties not found yet — waiting for MCServerManager configuration.");
            return;
        }

        Properties props = new Properties();
        try (FileInputStream fis = new FileInputStream(propsFile)) {
            props.load(fis);
        } catch (IOException ex) {
            getLogger().warning("Failed to load bridge.properties: " + ex.getMessage());
            return;
        }

        int port;
        try {
            port = Integer.parseInt(props.getProperty("port", "35565").trim());
        } catch (NumberFormatException ex) {
            getLogger().warning("Invalid port in bridge.properties");
            return;
        }
        this.authToken = props.getProperty("token", "").trim();
        if (this.authToken.isEmpty()) {
            getLogger().warning("Missing token in bridge.properties — bridge disabled for safety.");
            return;
        }

        try {
            httpServer = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 16);
            executor = Executors.newFixedThreadPool(4);
            httpServer.setExecutor(executor);
            httpServer.createContext("/", this::handleRequest);
            httpServer.start();
            getLogger().info("MCServerManagerBridge listening on 127.0.0.1:" + port);
        } catch (IOException ex) {
            getLogger().warning("Could not bind bridge HTTP server on 127.0.0.1:" + port + ": " + ex.getMessage());
        }
    }

    @Override
    public void onDisable() {
        if (tpaManager != null) {
            tpaManager.stopExpirationTask();
            tpaManager.unregisterAllCommands();
        }
        if (portalManager != null) {
            portalManager.stopParticleTask();
            portalManager.savePortals();
        }
        if (profileManager != null) {
            for (Player p : Bukkit.getOnlinePlayers()) {
                profileManager.saveCurrentProfile(p, realmsConfig);
            }
        }
        if (realmsListener != null) {
            realmsListener.showAllPlayersToEveryone();
        }
        if (pluginScopeManager != null) {
            pluginScopeManager.unwrapAllListeners();
        }
        if (httpServer != null) {
            httpServer.stop(0);
            httpServer = null;
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    public void reloadRealmsFromDisk() {
        RealmsConfig next = RealmsConfig.load(this.realmsFile);
        this.realmsConfig = next;
        this.pluginScopeManager.setConfig(next);
        this.tpaManager.syncCommandRegistration(next);
        if (!FoliaCompat.isFolia()) {
            this.worldController.autoLoadConfiguredWorlds(next);
        }
        this.pluginScopeManager.syncAllListeners();
        this.realmsListener.refreshVisibilityForAll();
    }

    private void handleRequest(HttpExchange ex) throws IOException {
        try {
            String provided = ex.getRequestHeaders().getFirst("X-Bridge-Token");
            if (provided == null || authToken == null || !MessageDigest.isEqual(
                    provided.getBytes(StandardCharsets.UTF_8),
                    authToken.getBytes(StandardCharsets.UTF_8))) {
                sendJson(ex, 401, "{\"error\":\"Unauthorized\"}");
                return;
            }

            String method = ex.getRequestMethod().toUpperCase(Locale.ROOT);
            String rawPath = ex.getRequestURI().getRawPath();
            if (rawPath == null) rawPath = "/";

            if ("GET".equals(method) && "/status".equals(rawPath)) {
                String json = runSync(this::buildStatusJson, 8);
                sendJson(ex, 200, json);
                return;
            }

            if ("GET".equals(method) && "/plugins".equals(rawPath)) {
                String json = runSync(this::buildPluginsJson, 8);
                sendJson(ex, 200, json);
                return;
            }

            if ("POST".equals(method) && "/broadcast".equals(rawPath)) {
                Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                final String msg = JsonUtil.asString(body.get("message"), "").trim();
                if (msg.isEmpty()) {
                    sendJson(ex, 400, "{\"error\":\"message is required\"}");
                    return;
                }
                final String colored = translateColorCodes(msg);
                runSync(() -> {
                    Bukkit.broadcastMessage(colored);
                    return Boolean.TRUE;
                }, 8);
                sendJson(ex, 200, "{\"ok\":true}");
                return;
            }

            // ---------- Realms / Multiverse / Per-World Plugins endpoints ----------
            if ("GET".equals(method) && "/realms/state".equals(rawPath)) {
                String json = runSync(this::buildRealmsStateJson, 10);
                sendJson(ex, 200, json);
                return;
            }

            if ("POST".equals(method) && "/realms/reload".equals(rawPath)) {
                final String bodyText = readBody(ex).trim();
                String json = runSync(() -> {
                    if (!bodyText.isEmpty() && bodyText.startsWith("{")) {
                        Map<String, Object> parsed = JsonUtil.parseObject(bodyText);
                        RealmsConfig next = RealmsConfig.fromMap(parsed);
                        next.save(realmsFile);
                        realmsConfig = next;
                        pluginScopeManager.setConfig(next);
                        tpaManager.syncCommandRegistration(next);
                        if (!FoliaCompat.isFolia()) {
                            worldController.autoLoadConfiguredWorlds(next);
                        }
                        pluginScopeManager.syncAllListeners();
                        realmsListener.refreshVisibilityForAll();
                    } else {
                        reloadRealmsFromDisk();
                    }
                    return buildRealmsStateJson();
                }, 30);
                sendJson(ex, 200, json);
                return;
            }

            if ("POST".equals(method) && "/realms/worlds/create".equals(rawPath)) {
                final Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                String json = runSync(() -> handleCreateWorldRequest(body), 45);
                sendJson(ex, 200, json);
                return;
            }

            if (rawPath.startsWith("/realms/worlds/")) {
                String rest = rawPath.substring("/realms/worlds/".length());
                int slash = rest.indexOf('/');
                if (slash > 0) {
                    final String worldName = URLDecoder.decode(rest.substring(0, slash), "UTF-8");
                    String sub = rest.substring(slash);

                    if ("POST".equals(method) && "/load".equals(sub)) {
                        final Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                        String json = runSync(() -> handleLoadWorldRequest(worldName, body), 30);
                        sendJson(ex, 200, json);
                        return;
                    }

                    if ("POST".equals(method) && "/unload".equals(sub)) {
                        final Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                        final boolean save = JsonUtil.asBoolean(body.get("save"), true);
                        String err = runSync(() -> {
                            String res = worldController.unloadWorld(worldName, save, realmsConfig.defaultJoinWorld);
                            if (res == null) {
                                RealmsConfig.ManagedWorldConfig mw = realmsConfig.findManagedWorld(worldName);
                                if (mw != null) {
                                    mw.autoLoad = false;
                                    realmsConfig.save(realmsFile);
                                }
                            }
                            return res;
                        }, 20);
                        if (err != null) {
                            sendJson(ex, 400, "{\"error\":" + JsonUtil.quote(err) + "}");
                        } else {
                            sendJson(ex, 200, "{\"ok\":true}");
                        }
                        return;
                    }
                } else if ("DELETE".equals(method) && !rest.isEmpty()) {
                    final String worldName = URLDecoder.decode(rest, "UTF-8");
                    String err = runSync(() -> {
                        String res = worldController.deleteWorld(worldName, realmsConfig.defaultJoinWorld);
                        if (res == null) {
                            realmsConfig.removeManagedWorld(worldName);
                            realmsConfig.save(realmsFile);
                        }
                        return res;
                    }, 25);
                    if (err != null) {
                        sendJson(ex, 400, "{\"error\":" + JsonUtil.quote(err) + "}");
                    } else {
                        sendJson(ex, 200, "{\"ok\":true}");
                    }
                    return;
                }
            }

            if ("POST".equals(method) && rawPath.startsWith("/realms/players/") && rawPath.endsWith("/move")) {
                String mid = rawPath.substring("/realms/players/".length(), rawPath.length() - "/move".length());
                final String playerName = URLDecoder.decode(mid, "UTF-8");
                final Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                Player onlineTarget = Bukkit.getPlayerExact(playerName);
                String err = (FoliaCompat.isFolia() && onlineTarget != null)
                        ? FoliaCompat.callForEntitySync(this, onlineTarget, () -> handleMovePlayerRequest(playerName, body), 10)
                        : runSync(() -> handleMovePlayerRequest(playerName, body), 10);
                if (err != null) {
                    sendJson(ex, 400, "{\"error\":" + JsonUtil.quote(err) + "}");
                } else {
                    sendJson(ex, 200, "{\"ok\":true}");
                }
                return;
            }

            if ("DELETE".equals(method) && "/realms/portals".equals(rawPath)) {
                runSync(() -> {
                    portalManager.clearAllPortals();
                    return Boolean.TRUE;
                }, 8);
                sendJson(ex, 200, "{\"ok\":true}");
                return;
            }

            if ("DELETE".equals(method) && rawPath.startsWith("/realms/portals/")) {
                final String portalId = URLDecoder.decode(rawPath.substring("/realms/portals/".length()), "UTF-8");
                boolean removed = runSync(() -> portalManager.removePortalById(portalId), 8);
                sendJson(ex, 200, "{\"ok\":" + removed + "}");
                return;
            }

            // ---------- Existing /worlds/{worldName}/gamerules or /environment ----------
            if (rawPath.startsWith("/worlds/")) {
                String rest = rawPath.substring("/worlds/".length());
                int slash = rest.indexOf('/');
                if (slash > 0) {
                    final String worldName = URLDecoder.decode(rest.substring(0, slash), "UTF-8");
                    String sub = rest.substring(slash);

                    if ("GET".equals(method) && "/gamerules".equals(sub)) {
                        String json = runSync(() -> buildGamerulesJson(worldName), 8);
                        if (json == null) {
                            sendJson(ex, 404, "{\"error\":\"World not found\"}");
                        } else {
                            sendJson(ex, 200, json);
                        }
                        return;
                    }

                    if ("PUT".equals(method) && "/gamerules".equals(sub)) {
                        final Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                        final String ruleName = JsonUtil.asString(body.get("name"), null);
                        final String ruleVal = JsonUtil.asString(body.get("value"), null);
                        if (ruleName == null || ruleVal == null) {
                            sendJson(ex, 400, "{\"error\":\"name and value are required\"}");
                            return;
                        }
                        String err = runSync(() -> applyGamerule(worldName, ruleName, ruleVal), 8);
                        if (err != null) {
                            sendJson(ex, 400, "{\"error\":" + JsonUtil.quote(err) + "}");
                        } else {
                            sendJson(ex, 200, "{\"ok\":true,\"name\":" + JsonUtil.quote(ruleName) + ",\"value\":" + JsonUtil.quote(ruleVal) + "}");
                        }
                        return;
                    }

                    if ("PUT".equals(method) && "/environment".equals(sub)) {
                        final Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                        String err = runSync(() -> applyWorldEnvironment(worldName, body), 8);
                        if (err != null) {
                            sendJson(ex, 400, "{\"error\":" + JsonUtil.quote(err) + "}");
                        } else {
                            sendJson(ex, 200, "{\"ok\":true}");
                        }
                        return;
                    }
                }
            }

            // ---------- Existing /players/{playerName}/action ----------
            if ("POST".equals(method) && rawPath.startsWith("/players/") && rawPath.endsWith("/action")) {
                String mid = rawPath.substring("/players/".length(), rawPath.length() - "/action".length());
                final String playerName = URLDecoder.decode(mid, "UTF-8");
                final Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                Player onlineTarget = Bukkit.getPlayerExact(playerName);
                String err = (FoliaCompat.isFolia() && onlineTarget != null)
                        ? FoliaCompat.callForEntitySync(this, onlineTarget, () -> applyPlayerAction(playerName, body), 8)
                        : runSync(() -> applyPlayerAction(playerName, body), 8);
                if (err != null) {
                    sendJson(ex, 400, "{\"error\":" + JsonUtil.quote(err) + "}");
                } else {
                    sendJson(ex, 200, "{\"ok\":true}");
                }
                return;
            }

            sendJson(ex, 404, "{\"error\":\"Not found\"}");
        } catch (Exception err) {
            Throwable cause = err.getCause() != null ? err.getCause() : err;
            String msg = cause.getMessage();
            sendJson(ex, 500, "{\"error\":" + JsonUtil.quote(msg != null ? msg : "Internal bridge error") + "}");
        }
    }

    private <T> T runSync(Callable<T> task, int timeoutSeconds) throws Exception {
        return FoliaCompat.callGlobalSync(this, task, timeoutSeconds);
    }

    private String handleCreateWorldRequest(Map<String, Object> body) throws IOException {
        boolean bundle = JsonUtil.asBoolean(body.get("bundle"), false);
        String name = JsonUtil.asString(body.get("name"), "").trim();
        String seed = JsonUtil.asString(body.get("seed"), "").trim();
        String worldType = JsonUtil.asString(body.get("worldType"), "NORMAL").toUpperCase(Locale.ROOT);
        boolean generateStructures = JsonUtil.asBoolean(body.get("generateStructures"), true);
        String generator = JsonUtil.asString(body.get("generator"), "").trim();
        String defaultGameMode = JsonUtil.asString(body.get("defaultGameMode"), "").trim().toUpperCase(Locale.ROOT);

        if (!WorldController.isValidWorldName(name)) {
            throw new IllegalArgumentException("Invalid world name (use letters, numbers, _ or -)");
        }

        List<String> createdNames = new ArrayList<>();
        if (bundle) {
            String owName = name;
            String netherName = JsonUtil.asString(body.get("netherName"), name + "_nether").trim();
            String endName = JsonUtil.asString(body.get("endName"), name + "_the_end").trim();
            boolean createNether = JsonUtil.asBoolean(body.get("createNether"), true);
            boolean createEnd = JsonUtil.asBoolean(body.get("createEnd"), true);

            RealmsConfig.ManagedWorldConfig ow = new RealmsConfig.ManagedWorldConfig();
            ow.name = owName;
            ow.environment = "NORMAL";
            ow.worldType = worldType;
            ow.seed = seed;
            ow.generateStructures = generateStructures;
            ow.generator = generator;
            ow.autoLoad = true;
            ow.defaultGameMode = defaultGameMode;
            worldController.createOrLoadWorld(ow);
            realmsConfig.upsertManagedWorld(ow);
            createdNames.add(owName);

            if (createNether && WorldController.isValidWorldName(netherName)) {
                RealmsConfig.ManagedWorldConfig nw = new RealmsConfig.ManagedWorldConfig();
                nw.name = netherName;
                nw.environment = "NETHER";
                nw.worldType = "NORMAL";
                nw.seed = seed;
                nw.generateStructures = generateStructures;
                nw.autoLoad = true;
                worldController.createOrLoadWorld(nw);
                realmsConfig.upsertManagedWorld(nw);
                createdNames.add(netherName);
            }

            if (createEnd && WorldController.isValidWorldName(endName)) {
                RealmsConfig.ManagedWorldConfig ew = new RealmsConfig.ManagedWorldConfig();
                ew.name = endName;
                ew.environment = "THE_END";
                ew.worldType = "NORMAL";
                ew.seed = seed;
                ew.generateStructures = generateStructures;
                ew.autoLoad = true;
                worldController.createOrLoadWorld(ew);
                realmsConfig.upsertManagedWorld(ew);
                createdNames.add(endName);
            }
        } else {
            RealmsConfig.ManagedWorldConfig cfg = new RealmsConfig.ManagedWorldConfig();
            cfg.name = name;
            cfg.environment = JsonUtil.asString(body.get("environment"), "NORMAL").toUpperCase(Locale.ROOT);
            cfg.worldType = worldType;
            cfg.seed = seed;
            cfg.generateStructures = generateStructures;
            cfg.generator = generator;
            cfg.autoLoad = JsonUtil.asBoolean(body.get("autoLoad"), true);
            cfg.defaultGameMode = defaultGameMode;
            cfg.standaloneSeparation = RealmsConfig.SeparationOptions.fromMap(
                JsonUtil.asMap(body.get("standaloneSeparation")),
                new RealmsConfig.SeparationOptions(false, false, false, false)
            );
            cfg.color = JsonUtil.asString(body.get("color"), "").trim();
            worldController.createOrLoadWorld(cfg);
            realmsConfig.upsertManagedWorld(cfg);
            createdNames.add(name);
        }

        realmsConfig.save(realmsFile);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", Boolean.TRUE);
        out.put("created", createdNames);
        return JsonUtil.stringify(out);
    }

    private String handleLoadWorldRequest(String worldName, Map<String, Object> body) throws IOException {
        RealmsConfig.ManagedWorldConfig existing = realmsConfig.findManagedWorld(worldName);
        RealmsConfig.ManagedWorldConfig cfg = existing != null ? existing : new RealmsConfig.ManagedWorldConfig();
        cfg.name = worldName;
        if (body.containsKey("environment")) {
            cfg.environment = JsonUtil.asString(body.get("environment"), WorldController.inferEnvironmentFromName(worldName)).toUpperCase(Locale.ROOT);
        } else if (existing == null) {
            cfg.environment = WorldController.inferEnvironmentFromName(worldName);
        }
        cfg.autoLoad = true;
        World loaded = worldController.createOrLoadWorld(cfg);
        realmsConfig.upsertManagedWorld(cfg);
        realmsConfig.save(realmsFile);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", Boolean.TRUE);
        out.put("world", loaded.getName());
        return JsonUtil.stringify(out);
    }

    private String handleMovePlayerRequest(String playerName, Map<String, Object> body) {
        Player player = Bukkit.getPlayerExact(playerName);
        if (player == null) return "Player is not online: " + playerName;

        String targetWorldName = JsonUtil.asString(body.get("world"), "").trim();
        String groupId = JsonUtil.asString(body.get("groupId"), "").trim();

        Location dest = null;
        if (!groupId.isEmpty()) {
            RealmsConfig.WorldGroup g = realmsConfig.findGroupById(groupId);
            if (g == null) return "Group not found: " + groupId;
            String scopeKey = "group_" + RealmsConfig.sanitizeKey(g.id);
            dest = profileManager.loadSavedLocation(player.getUniqueId(), scopeKey, worldController);
            if (dest == null || dest.getWorld() == null || !g.containsWorld(dest.getWorld().getName())) {
                World ow = worldController.getWorld(g.overworld);
                if (ow == null) return "Group overworld is not loaded: " + g.overworld;
                dest = ow.getSpawnLocation();
            }
            profileManager.writeLastAssignedGroup(player.getUniqueId(), g.id);
        } else if (!targetWorldName.isEmpty()) {
            World w = worldController.getWorld(targetWorldName);
            if (w == null) return "World is not loaded: " + targetWorldName;
            dest = w.getSpawnLocation();
        } else {
            return "world or groupId is required";
        }

        FoliaCompat.teleportSafe(player, dest);
        return null;
    }

    private String buildRealmsStateJson() {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("ok", Boolean.TRUE);
        root.put("config", realmsConfig.toMap());
        root.put("loadedWorlds", buildWorldsList());
        root.put("unloadedFolders", worldController.discoverUnloadedWorldFolders());
        root.put("plugins", buildPluginsList());
        root.put("onlinePlayers", buildPlayersList());

        List<Object> portalList = new ArrayList<>();
        for (RealmsConfig.TrackedPortal tp : portalManager.getPortalsSnapshot()) {
            portalList.add(tp.toMap());
        }
        root.put("portals", portalList);
        return JsonUtil.stringify(root);
    }

    private List<Object> buildWorldsList() {
        List<Object> out = new ArrayList<>();
        for (World w : Bukkit.getWorlds()) {
            String weather = w.isThundering() ? "thunder" : (w.hasStorm() ? "rain" : "clear");
            double borderSize = 0;
            try {
                WorldBorder wb = w.getWorldBorder();
                if (wb != null) borderSize = wb.getSize();
            } catch (Throwable ignored) {}
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", WorldController.getCanonicalWorldName(w));
            m.put("environment", w.getEnvironment() != null ? w.getEnvironment().name() : "NORMAL");
            m.put("time", w.getTime());
            m.put("weather", weather);
            m.put("difficulty", w.getDifficulty() != null ? w.getDifficulty().name() : "NORMAL");
            m.put("pvp", w.getPVP());
            m.put("seed", Long.toString(w.getSeed()));
            m.put("borderSize", Math.round(borderSize * 100.0) / 100.0);
            m.put("loadedChunks", FoliaCompat.isFolia() ? 0 : invokeArrayOrCollectionSize(w, "getLoadedChunks"));
            m.put("entityCount", FoliaCompat.isFolia() ? 0 : invokeArrayOrCollectionSize(w, "getEntities"));
            m.put("playerCount", w.getPlayers().size());
            out.add(m);
        }
        return out;
    }

    private List<Object> buildPlayersList() {
        List<Object> out = new ArrayList<>();
        for (Player p : Bukkit.getOnlinePlayers()) {
            Location loc = p.getLocation();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", p.getName());
            m.put("uuid", p.getUniqueId().toString());
            m.put("world", p.getWorld() != null ? WorldController.getCanonicalWorldName(p.getWorld()) : "");
            m.put("x", loc != null ? Math.round(loc.getX()) : 0);
            m.put("y", loc != null ? Math.round(loc.getY()) : 0);
            m.put("z", loc != null ? Math.round(loc.getZ()) : 0);
            m.put("health", Math.round(p.getHealth() * 100.0) / 100.0);
            m.put("maxHealth", Math.round(readPlayerMaxHealth(p) * 100.0) / 100.0);
            m.put("food", p.getFoodLevel());
            m.put("gamemode", p.getGameMode() != null ? p.getGameMode().name() : "SURVIVAL");
            m.put("op", p.isOp());
            m.put("ping", readPlayerPing(p));
            out.add(m);
        }
        return out;
    }

    private List<Object> buildPluginsList() {
        List<Object> out = new ArrayList<>();
        for (Plugin pl : Bukkit.getPluginManager().getPlugins()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", pl.getName());
            m.put("version", pl.getDescription() != null ? pl.getDescription().getVersion() : "");
            m.put("enabled", pl.isEnabled());
            out.add(m);
        }
        return out;
    }

    private String buildStatusJson() {
        Runtime rt = Runtime.getRuntime();
        long heapUsedMb = (rt.totalMemory() - rt.freeMemory()) / (1024L * 1024L);
        long heapMaxMb = rt.maxMemory() / (1024L * 1024L);
        double[] tps = readTpsReflective();

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("ok", Boolean.TRUE);
        root.put("serverName", Bukkit.getName());
        root.put("bukkitVersion", Bukkit.getBukkitVersion());
        root.put("heapUsedMb", heapUsedMb);
        root.put("heapMaxMb", heapMaxMb);
        root.put("pluginCount", Bukkit.getPluginManager().getPlugins().length);
        if (tps != null && tps.length >= 3) {
            List<Double> tpsList = new ArrayList<>();
            tpsList.add(Math.round(Math.min(20.0, tps[0]) * 100.0) / 100.0);
            tpsList.add(Math.round(Math.min(20.0, tps[1]) * 100.0) / 100.0);
            tpsList.add(Math.round(Math.min(20.0, tps[2]) * 100.0) / 100.0);
            root.put("tps", tpsList);
        } else {
            root.put("tps", null);
        }
        root.put("worlds", buildWorldsList());
        root.put("players", buildPlayersList());
        return JsonUtil.stringify(root);
    }

    private String buildPluginsJson() {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("plugins", buildPluginsList());
        return JsonUtil.stringify(root);
    }

    private String buildGamerulesJson(String worldName) {
        World world = worldController.getWorld(worldName);
        if (world == null) return null;

        List<Object> rows = new ArrayList<>();
        boolean usedModernApi = false;

        try {
            Class<?> gameRuleCls = Class.forName("org.bukkit.GameRule");
            Method valuesMethod = gameRuleCls.getMethod("values");
            Method getNameMethod = gameRuleCls.getMethod("getName");
            Method getTypeMethod = gameRuleCls.getMethod("getType");
            Method getValMethod = World.class.getMethod("getGameRuleValue", gameRuleCls);
            Method getDefMethod = World.class.getMethod("getGameRuleDefault", gameRuleCls);

            Object[] rules = (Object[]) valuesMethod.invoke(null);
            if (rules != null && rules.length > 0) {
                usedModernApi = true;
                for (Object ruleObj : rules) {
                    String name = String.valueOf(getNameMethod.invoke(ruleObj));
                    Class<?> typeCls = (Class<?>) getTypeMethod.invoke(ruleObj);
                    Object curVal = null;
                    Object defVal = null;
                    try { curVal = getValMethod.invoke(world, ruleObj); } catch (Throwable ignored) {}
                    try { defVal = getDefMethod.invoke(world, ruleObj); } catch (Throwable ignored) {}
                    if (curVal == null) continue;

                    String kind = (typeCls == Boolean.class || typeCls == boolean.class)
                            ? "boolean"
                            : (typeCls == Integer.class || typeCls == int.class ? "integer" : "string");
                    Map<String, Object> r = new LinkedHashMap<>();
                    r.put("name", name);
                    r.put("value", String.valueOf(curVal));
                    r.put("type", kind);
                    r.put("defaultValue", defVal != null ? String.valueOf(defVal) : "");
                    rows.add(r);
                }
            }
        } catch (Throwable ignored) {
            usedModernApi = false;
        }

        if (!usedModernApi) {
            String[] names = world.getGameRules();
            if (names != null) {
                for (String name : names) {
                    String val = world.getGameRuleValue(name);
                    if (val == null) continue;
                    String kind = ("true".equalsIgnoreCase(val) || "false".equalsIgnoreCase(val))
                            ? "boolean"
                            : (val.matches("-?\\d+") ? "integer" : "string");
                    Map<String, Object> r = new LinkedHashMap<>();
                    r.put("name", name);
                    r.put("value", val);
                    r.put("type", kind);
                    r.put("defaultValue", "");
                    rows.add(r);
                }
            }
        }

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("world", world.getName());
        root.put("gamerules", rows);
        return JsonUtil.stringify(root);
    }

    private String applyGamerule(String worldName, String ruleName, String rawValue) {
        World world = worldController.getWorld(worldName);
        if (world == null) return "World not found: " + worldName;

        try {
            Class<?> gameRuleCls = Class.forName("org.bukkit.GameRule");
            Method getByName = gameRuleCls.getMethod("getByName", String.class);
            Object ruleObj = getByName.invoke(null, ruleName);
            if (ruleObj != null) {
                Method getType = gameRuleCls.getMethod("getType");
                Class<?> typeCls = (Class<?>) getType.invoke(ruleObj);
                Method setRule = World.class.getMethod("setGameRule", gameRuleCls, Object.class);
                Object typedVal;
                if (typeCls == Boolean.class || typeCls == boolean.class) {
                    typedVal = Boolean.valueOf(Boolean.parseBoolean(rawValue));
                } else if (typeCls == Integer.class || typeCls == int.class) {
                    typedVal = Integer.valueOf(Integer.parseInt(rawValue.trim()));
                } else {
                    typedVal = rawValue;
                }
                Object ok = setRule.invoke(world, ruleObj, typedVal);
                if (Boolean.TRUE.equals(ok)) return null;
            }
        } catch (NumberFormatException nfe) {
            return "Invalid integer value for " + ruleName;
        } catch (Throwable ignored) {}

        boolean ok = world.setGameRuleValue(ruleName, rawValue);
        return ok ? null : "Could not apply gamerule " + ruleName;
    }

    private String applyWorldEnvironment(String worldName, Map<String, Object> body) {
        World world = worldController.getWorld(worldName);
        if (world == null) return "World not found: " + worldName;

        if (body.containsKey("time")) {
            try {
                world.setTime(Long.parseLong(JsonUtil.asString(body.get("time"), "").trim()));
            } catch (NumberFormatException ex) {
                return "Invalid time value";
            }
        }
        if (body.containsKey("weather")) {
            String w = JsonUtil.asString(body.get("weather"), "").toLowerCase(Locale.ROOT);
            if ("clear".equals(w)) {
                world.setStorm(false);
                world.setThundering(false);
            } else if ("rain".equals(w)) {
                world.setStorm(true);
                world.setThundering(false);
            } else if ("thunder".equals(w)) {
                world.setStorm(true);
                world.setThundering(true);
            }
        }
        if (body.containsKey("difficulty")) {
            try {
                world.setDifficulty(Difficulty.valueOf(JsonUtil.asString(body.get("difficulty"), "").toUpperCase(Locale.ROOT)));
            } catch (IllegalArgumentException ex) {
                return "Invalid difficulty";
            }
        }
        if (body.containsKey("pvp")) {
            world.setPVP(JsonUtil.asBoolean(body.get("pvp"), true));
        }
        if (body.containsKey("borderSize")) {
            try {
                double size = JsonUtil.asDouble(body.get("borderSize"), -1.0);
                if (size >= 1.0 && size <= 60000000.0 && world.getWorldBorder() != null) {
                    world.getWorldBorder().setSize(size);
                }
            } catch (Exception ex) {
                return "Invalid world border size";
            }
        }
        if (JsonUtil.asBoolean(body.get("save"), false)) {
            world.save();
        }
        return null;
    }

    private String applyPlayerAction(String playerName, Map<String, Object> body) {
        Player player = Bukkit.getPlayerExact(playerName);
        if (player == null) return "Player is not online: " + playerName;

        String action = JsonUtil.asString(body.get("action"), null);
        if (action == null) return "action is required";

        switch (action.toLowerCase(Locale.ROOT)) {
            case "gamemode": {
                String val = JsonUtil.asString(body.get("value"), null);
                if (val == null) return "gamemode value is required";
                try {
                    player.setGameMode(GameMode.valueOf(val.toUpperCase(Locale.ROOT)));
                    return null;
                } catch (IllegalArgumentException ex) {
                    return "Invalid gamemode: " + val;
                }
            }
            case "heal": {
                double maxH = readPlayerMaxHealth(player);
                player.setHealth(maxH);
                player.setFoodLevel(20);
                player.setSaturation(20.0f);
                player.setFireTicks(0);
                return null;
            }
            case "spawn": {
                FoliaCompat.teleportSafe(player, player.getWorld().getSpawnLocation());
                return null;
            }
            case "tp": {
                try {
                    String wName = JsonUtil.asString(body.get("world"), "");
                    World targetW = !wName.isEmpty() ? worldController.getWorld(wName) : player.getWorld();
                    if (targetW == null) targetW = player.getWorld();
                    if (body.containsKey("x") && body.containsKey("y") && body.containsKey("z")) {
                        double x = JsonUtil.asDouble(body.get("x"), 0.0);
                        double y = JsonUtil.asDouble(body.get("y"), 64.0);
                        double z = JsonUtil.asDouble(body.get("z"), 0.0);
                        FoliaCompat.teleportSafe(player, new Location(targetW, x, y, z));
                    } else {
                        FoliaCompat.teleportSafe(player, targetW.getSpawnLocation());
                    }
                    return null;
                } catch (Exception ex) {
                    return "Invalid teleport coordinates";
                }
            }
            case "xp": {
                int levels = JsonUtil.asInt(body.get("value"), 0);
                player.giveExpLevels(levels);
                return null;
            }
            case "message": {
                String msg = JsonUtil.asString(body.get("value"), "");
                if (!msg.isEmpty()) {
                    player.sendMessage(translateColorCodes(msg));
                }
                return null;
            }
            case "kick": {
                String reason = JsonUtil.asString(body.get("value"), "");
                player.kickPlayer(translateColorCodes(!reason.isEmpty() ? reason : "Kicked via MCServerManager"));
                return null;
            }
            default:
                return "Unsupported player action: " + action;
        }
    }

    private static double[] readTpsReflective() {
        try {
            Method m = Bukkit.class.getMethod("getTPS");
            Object out = m.invoke(null);
            if (out instanceof double[]) return (double[]) out;
        } catch (Throwable ignored) {}
        try {
            Object srv = Bukkit.getServer();
            Method m = srv.getClass().getMethod("getTPS");
            Object out = m.invoke(srv);
            if (out instanceof double[]) return (double[]) out;
        } catch (Throwable ignored) {}
        return null;
    }

    private static int readPlayerPing(Player p) {
        try {
            Method m = p.getClass().getMethod("getPing");
            Object out = m.invoke(p);
            if (out instanceof Number) return ((Number) out).intValue();
        } catch (Throwable ignored) {}
        return -1;
    }

    private static double readPlayerMaxHealth(Player p) {
        try {
            return Math.max(1.0, p.getMaxHealth());
        } catch (Throwable ignored) {
            return 20.0;
        }
    }

    private static int invokeArrayOrCollectionSize(Object target, String methodName) {
        try {
            Method m = target.getClass().getMethod(methodName);
            Object res = m.invoke(target);
            if (res instanceof Collection) return ((Collection<?>) res).size();
            if (res instanceof Object[]) return ((Object[]) res).length;
        } catch (Throwable ignored) {}
        return 0;
    }

    private static String translateColorCodes(String input) {
        char[] b = input.toCharArray();
        for (int i = 0; i < b.length - 1; i++) {
            if (b[i] == '&' && "0123456789AaBbCcDdEeFfKkLlMmNnOoRr".indexOf(b[i + 1]) > -1) {
                b[i] = '\u00A7';
                b[i + 1] = Character.toLowerCase(b[i + 1]);
            }
        }
        return new String(b);
    }

    private static String readBody(HttpExchange ex) throws IOException {
        try (InputStream is = ex.getRequestBody(); ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            int total = 0;
            while ((n = is.read(buf)) != -1 && total < 1024 * 1024) {
                baos.write(buf, 0, n);
                total += n;
            }
            return new String(baos.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static void sendJson(HttpExchange ex, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }
}
