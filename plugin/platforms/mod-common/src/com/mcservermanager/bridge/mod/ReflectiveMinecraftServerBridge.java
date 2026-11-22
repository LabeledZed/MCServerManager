package com.mcservermanager.bridge.mod;

import com.mcservermanager.bridge.JsonUtil;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
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
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * Shared pure-reflection loopback management bridge for Fabric, NeoForge, and Forge servers.
 * Works across both Mojang-mapped (NeoForge, Forge, MC 26.1+ Fabric) and Intermediary-mapped
 * (pre-26.1 Fabric) dedicated servers without hard compile-time NMS/mapping linkage.
 */
public final class ReflectiveMinecraftServerBridge {

    public static final class ModEntry {
        public final String name;
        public final String version;
        public final boolean enabled;

        public ModEntry(String name, String version, boolean enabled) {
            this.name = name;
            this.version = version;
            this.enabled = enabled;
        }
    }

    private final String platformLabel;
    private final File configDir;
    private final Supplier<List<ModEntry>> modListSupplier;
    private final Consumer<String> logger;

    private volatile Object minecraftServer;
    private HttpServer httpServer;
    private ExecutorService executor;
    private String authToken;

    public ReflectiveMinecraftServerBridge(
            String platformLabel,
            File configDir,
            Supplier<List<ModEntry>> modListSupplier,
            Consumer<String> logger
    ) {
        this.platformLabel = platformLabel;
        this.configDir = configDir;
        this.modListSupplier = modListSupplier;
        this.logger = logger;
    }

    public synchronized void attachAndStart(Object mcServer) {
        this.minecraftServer = mcServer;
        if (httpServer != null) return;

        File propsFile = new File(new File(configDir, "mcservermanagerbridge"), "bridge.properties");
        if (!propsFile.exists()) {
            File alt = new File(new File(configDir, "MCServerManagerBridge"), "bridge.properties");
            if (alt.exists()) propsFile = alt;
        }
        if (!propsFile.exists()) {
            log("bridge.properties not found yet — waiting for MCServerManager configuration.");
            return;
        }

        Properties props = new Properties();
        try (FileInputStream fis = new FileInputStream(propsFile)) {
            props.load(fis);
        } catch (IOException ex) {
            log("Failed to load bridge.properties: " + ex.getMessage());
            return;
        }

        int port;
        try {
            port = Integer.parseInt(props.getProperty("port", "35565").trim());
        } catch (NumberFormatException ex) {
            log("Invalid port in bridge.properties");
            return;
        }
        this.authToken = props.getProperty("token", "").trim();
        if (this.authToken.isEmpty()) {
            log("Missing token in bridge.properties — bridge disabled.");
            return;
        }

        try {
            httpServer = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 16);
            executor = Executors.newFixedThreadPool(4);
            httpServer.setExecutor(executor);
            httpServer.createContext("/", this::handleRequest);
            httpServer.start();
            log("MCServerManagerBridge (" + platformLabel + ") listening on 127.0.0.1:" + port);
        } catch (IOException ex) {
            log("Could not bind bridge on 127.0.0.1:" + port + ": " + ex.getMessage());
        }
    }

    public synchronized void stop() {
        if (httpServer != null) {
            httpServer.stop(0);
            httpServer = null;
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
        this.minecraftServer = null;
    }

    private void log(String msg) {
        try {
            logger.accept("[MCServerManagerBridge] " + msg);
        } catch (Throwable ignored) {}
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
                String json = runOnServerThread(this::buildStatusJson, 8);
                sendJson(ex, 200, json);
                return;
            }

            if ("GET".equals(method) && "/plugins".equals(rawPath)) {
                Map<String, Object> root = new LinkedHashMap<>();
                root.put("plugins", buildModsList());
                sendJson(ex, 200, JsonUtil.stringify(root));
                return;
            }

            if ("POST".equals(method) && "/broadcast".equals(rawPath)) {
                Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                String msg = JsonUtil.asString(body.get("message"), "").trim();
                if (msg.isEmpty()) {
                    sendJson(ex, 400, "{\"error\":\"message is required\"}");
                    return;
                }
                String cleaned = stripColorCodes(msg);
                runOnServerThread(() -> {
                    executeServerCommand("say " + cleaned);
                    return Boolean.TRUE;
                }, 8);
                sendJson(ex, 200, "{\"ok\":true}");
                return;
            }

            if (rawPath.startsWith("/worlds/")) {
                String rest = rawPath.substring("/worlds/".length());
                int slash = rest.indexOf('/');
                if (slash > 0) {
                    final String worldName = URLDecoder.decode(rest.substring(0, slash), "UTF-8");
                    String sub = rest.substring(slash);

                    if ("GET".equals(method) && "/gamerules".equals(sub)) {
                        String json = runOnServerThread(() -> buildGamerulesJson(worldName), 8);
                        sendJson(ex, 200, json);
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
                        String err = runOnServerThread(() -> {
                            boolean ok = executeServerCommand("gamerule " + ruleName + " " + ruleVal);
                            return ok ? null : "Failed to run gamerule command";
                        }, 8);
                        if (err != null) {
                            sendJson(ex, 400, "{\"error\":" + JsonUtil.quote(err) + "}");
                        } else {
                            sendJson(ex, 200, "{\"ok\":true,\"name\":" + JsonUtil.quote(ruleName) + ",\"value\":" + JsonUtil.quote(ruleVal) + "}");
                        }
                        return;
                    }

                    if ("PUT".equals(method) && "/environment".equals(sub)) {
                        final Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                        String err = runOnServerThread(() -> applyWorldEnvironment(worldName, body), 8);
                        if (err != null) {
                            sendJson(ex, 400, "{\"error\":" + JsonUtil.quote(err) + "}");
                        } else {
                            sendJson(ex, 200, "{\"ok\":true}");
                        }
                        return;
                    }
                }
            }

            if ("POST".equals(method) && rawPath.startsWith("/players/") && rawPath.endsWith("/action")) {
                String mid = rawPath.substring("/players/".length(), rawPath.length() - "/action".length());
                final String playerName = URLDecoder.decode(mid, "UTF-8");
                final Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                String err = runOnServerThread(() -> applyPlayerAction(playerName, body), 8);
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

    private <T> T runOnServerThread(Callable<T> task, int timeoutSeconds) throws Exception {
        Object srv = this.minecraftServer;
        if (srv == null) {
            return task.call();
        }
        // Try MinecraftServer#execute(Runnable) (Executor interface)
        try {
            Method exec = findMethod(srv.getClass(), new String[]{"execute", "method_20493"}, Runnable.class);
            if (exec != null) {
                CompletableFuture<T> fut = new CompletableFuture<>();
                Runnable wrapped = () -> {
                    try {
                        fut.complete(task.call());
                    } catch (Throwable t) {
                        fut.completeExceptionally(t);
                    }
                };
                exec.invoke(srv, wrapped);
                return fut.get(timeoutSeconds, TimeUnit.SECONDS);
            }
        } catch (Throwable ignored) {}
        return task.call();
    }

    private String buildStatusJson() {
        Runtime rt = Runtime.getRuntime();
        long heapUsedMb = (rt.totalMemory() - rt.freeMemory()) / (1024L * 1024L);
        long heapMaxMb = rt.maxMemory() / (1024L * 1024L);

        Object srv = this.minecraftServer;
        String mcVersion = "";
        if (srv != null) {
            Object v = invokeAny(srv, "getServerVersion", "method_3827", "m_130001_");
            if (v != null) mcVersion = String.valueOf(v);
        }

        double tps = readServerTps(srv);
        List<Double> tpsList = null;
        if (tps > 0.0) {
            double rounded = Math.round(Math.min(20.0, tps) * 100.0) / 100.0;
            tpsList = new ArrayList<>();
            tpsList.add(rounded);
            tpsList.add(rounded);
            tpsList.add(rounded);
        }

        List<Object> mods = buildModsList();

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("ok", Boolean.TRUE);
        root.put("serverName", platformLabel);
        root.put("bukkitVersion", platformLabel + (mcVersion.isEmpty() ? "" : (" " + mcVersion)));
        root.put("heapUsedMb", heapUsedMb);
        root.put("heapMaxMb", heapMaxMb);
        root.put("pluginCount", mods.size());
        root.put("tps", tpsList);
        root.put("worlds", buildWorldsList(srv));
        root.put("players", buildPlayersList(srv));
        return JsonUtil.stringify(root);
    }

    private List<Object> buildModsList() {
        List<Object> out = new ArrayList<>();
        try {
            List<ModEntry> mods = modListSupplier.get();
            if (mods != null) {
                for (ModEntry m : mods) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("name", m.name);
                    row.put("version", m.version);
                    row.put("enabled", Boolean.valueOf(m.enabled));
                    out.add(row);
                }
            }
        } catch (Throwable ignored) {}
        return out;
    }

    private List<Object> buildWorldsList(Object srv) {
        List<Object> out = new ArrayList<>();
        if (srv == null) return out;
        Object levelsObj = invokeAny(srv, "getAllLevels", "getWorlds", "method_3732", "m_129785_");
        if (!(levelsObj instanceof Iterable)) return out;

        String difficulty = readServerDifficulty(srv);
        boolean pvp = readServerPvp(srv);

        for (Object lvl : (Iterable<?>) levelsObj) {
            if (lvl == null) continue;
            String dimId = readLevelDimensionId(lvl);
            String env = dimId.contains("nether") ? "NETHER" : (dimId.contains("end") ? "THE_END" : "NORMAL");
            long time = asLong(invokeAny(lvl, "getDayTime", "getTimeOfDay", "method_8532", "m_46468_"), 0L);
            boolean raining = asBool(invokeAny(lvl, "isRaining", "method_8419", "m_46471_"), false);
            boolean thundering = asBool(invokeAny(lvl, "isThundering", "method_8546", "m_46470_"), false);
            String weather = thundering ? "thunder" : (raining ? "rain" : "clear");
            long seed = asLong(invokeAny(lvl, "getSeed", "method_8412", "m_7328_"), 0L);

            double borderSize = 59999968.0;
            Object wb = invokeAny(lvl, "getWorldBorder", "method_8621", "m_6857_");
            if (wb != null) {
                borderSize = asDouble(invokeAny(wb, "getSize", "method_11965", "m_61941_"), borderSize);
            }

            int playerCount = 0;
            Object playersCol = invokeAny(lvl, "players", "getPlayers", "method_18456", "m_6907_");
            if (playersCol instanceof Collection) {
                playerCount = ((Collection<?>) playersCol).size();
            }

            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", dimId);
            m.put("environment", env);
            m.put("time", time);
            m.put("weather", weather);
            m.put("difficulty", difficulty);
            m.put("pvp", Boolean.valueOf(pvp));
            m.put("seed", Long.toString(seed));
            m.put("borderSize", Math.round(borderSize * 100.0) / 100.0);
            m.put("loadedChunks", 0);
            m.put("entityCount", 0);
            m.put("playerCount", playerCount);
            out.add(m);
        }
        return out;
    }

    private List<Object> buildPlayersList(Object srv) {
        List<Object> out = new ArrayList<>();
        if (srv == null) return out;
        Object playerList = invokeAny(srv, "getPlayerList", "getPlayerManager", "method_3760", "m_6846_");
        if (playerList == null) return out;
        Object playersObj = invokeAny(playerList, "getPlayers", "getPlayerList", "method_14571", "m_11314_");
        if (!(playersObj instanceof Iterable)) return out;

        for (Object p : (Iterable<?>) playersObj) {
            if (p == null) continue;
            String name = readPlayerName(p);
            String uuid = String.valueOf(invokeAny(p, "getStringUUID", "getUuidAsString", "method_5845", "m_20149_"));
            if ("null".equals(uuid)) {
                Object uObj = invokeAny(p, "getUUID", "getUuid", "method_5667", "m_20148_");
                uuid = uObj != null ? uObj.toString() : "";
            }
            Object lvl = invokeAny(p, "level", "serverLevel", "getWorld", "getServerWorld", "method_37908", "m_9236_");
            String worldName = lvl != null ? readLevelDimensionId(lvl) : "minecraft:overworld";

            double x = asDouble(invokeAny(p, "getX", "method_23317", "m_20185_"), 0.0);
            double y = asDouble(invokeAny(p, "getY", "method_23318", "m_20186_"), 0.0);
            double z = asDouble(invokeAny(p, "getZ", "method_23321", "m_20189_"), 0.0);
            double health = asDouble(invokeAny(p, "getHealth", "method_6032", "m_21223_"), 20.0);
            double maxHealth = asDouble(invokeAny(p, "getMaxHealth", "method_6063", "m_21233_"), 20.0);

            int food = 20;
            Object foodData = invokeAny(p, "getFoodData", "getHungerManager", "method_7344", "m_36324_");
            if (foodData != null) {
                food = (int) asLong(invokeAny(foodData, "getFoodLevel", "method_7586", "m_38702_"), 20L);
            }

            String gm = "SURVIVAL";
            Object gameModeMgr = readFieldOrInvoke(p, new String[]{"gameMode", "interactionManager", "field_13987", "f_8941_"});
            if (gameModeMgr != null) {
                Object gmObj = invokeAny(gameModeMgr, "getGameModeForPlayer", "getGameMode", "method_14257", "m_9290_");
                if (gmObj != null) {
                    gm = gmObj.toString().toUpperCase(Locale.ROOT);
                }
            }

            int ping = 0;
            Object conn = readFieldOrInvoke(p, new String[]{"connection", "networkHandler", "field_13987", "f_8906_"});
            if (conn != null) {
                ping = (int) asLong(invokeAny(conn, "latency", "getLatency", "method_52396", "m_293012_"), 0L);
            }

            boolean isOp = false;
            Object perm = invokeAny(p, "hasPermissions", "hasPermissionLevel", "method_5687", "m_20310_");
            if (perm instanceof Boolean) isOp = ((Boolean) perm).booleanValue();

            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", name);
            m.put("uuid", uuid);
            m.put("world", worldName);
            m.put("x", Math.round(x));
            m.put("y", Math.round(y));
            m.put("z", Math.round(z));
            m.put("health", Math.round(health * 100.0) / 100.0);
            m.put("maxHealth", Math.round(Math.max(1.0, maxHealth) * 100.0) / 100.0);
            m.put("food", food);
            m.put("gamemode", normalizeGameMode(gm));
            m.put("op", Boolean.valueOf(isOp));
            m.put("ping", ping);
            out.add(m);
        }
        return out;
    }

    private String buildGamerulesJson(String worldName) {
        List<Object> rows = new ArrayList<>();
        Object srv = this.minecraftServer;
        if (srv != null) {
            Object gameRulesObj = null;
            Object levelsObj = invokeAny(srv, "getAllLevels", "getWorlds", "method_3732", "m_129785_");
            if (levelsObj instanceof Iterable) {
                for (Object lvl : (Iterable<?>) levelsObj) {
                    if (lvl == null) continue;
                    if (worldName.equalsIgnoreCase(readLevelDimensionId(lvl)) || gameRulesObj == null) {
                        gameRulesObj = invokeAny(lvl, "getGameRules", "method_8450", "m_46469_");
                        if (worldName.equalsIgnoreCase(readLevelDimensionId(lvl))) break;
                    }
                }
            }
            if (gameRulesObj == null) {
                gameRulesObj = invokeAny(srv, "getGameRules", "method_3790", "m_129900_");
            }
            if (gameRulesObj != null) {
                extractGamerulesReflective(gameRulesObj, rows);
            }
        }

        // If reflection couldn't enumerate gamerules on this mapping version, provide standard editable Minecraft gamerules
        if (rows.isEmpty()) {
            addFallbackGamerule(rows, "keepInventory", "false", "boolean");
            addFallbackGamerule(rows, "doDaylightCycle", "true", "boolean");
            addFallbackGamerule(rows, "doWeatherCycle", "true", "boolean");
            addFallbackGamerule(rows, "mobGriefing", "true", "boolean");
            addFallbackGamerule(rows, "doFireTick", "true", "boolean");
            addFallbackGamerule(rows, "naturalRegeneration", "true", "boolean");
            addFallbackGamerule(rows, "doMobSpawning", "true", "boolean");
            addFallbackGamerule(rows, "doInsomnia", "true", "boolean");
            addFallbackGamerule(rows, "announceAdvancements", "true", "boolean");
            addFallbackGamerule(rows, "randomTickSpeed", "3", "integer");
            addFallbackGamerule(rows, "playersSleepingPercentage", "100", "integer");
            addFallbackGamerule(rows, "spawnRadius", "10", "integer");
        }

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("world", worldName);
        root.put("gamerules", rows);
        return JsonUtil.stringify(root);
    }

    private static void addFallbackGamerule(List<Object> rows, String name, String def, String type) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("name", name);
        r.put("value", def);
        r.put("type", type);
        r.put("defaultValue", def);
        rows.add(r);
    }

    private void extractGamerulesReflective(Object gameRulesObj, List<Object> rows) {
        try {
            // Find GameRules.rules Map<?, ?> field (holds Key -> Value in Mojang/Intermediary/SRG!)
            for (Field f : gameRulesObj.getClass().getDeclaredFields()) {
                f.setAccessible(true);
                Object val = f.get(gameRulesObj);
                if (val instanceof Map) {
                    Map<?, ?> map = (Map<?, ?>) val;
                    for (Map.Entry<?, ?> e : map.entrySet()) {
                        if (e.getKey() == null || e.getValue() == null) continue;
                        String keyName = readGameruleKeyName(e.getKey());
                        if (keyName == null || keyName.isEmpty()) continue;
                        String strVal = readGameruleValueString(e.getValue());
                        if (strVal == null) continue;
                        String kind = ("true".equalsIgnoreCase(strVal) || "false".equalsIgnoreCase(strVal))
                                ? "boolean"
                                : (strVal.matches("-?\\d+") ? "integer" : "string");
                        Map<String, Object> r = new LinkedHashMap<>();
                        r.put("name", keyName);
                        r.put("value", strVal);
                        r.put("type", kind);
                        r.put("defaultValue", "");
                        rows.add(r);
                    }
                    if (!rows.isEmpty()) return;
                }
            }
        } catch (Throwable ignored) {}
    }

    private static String readGameruleKeyName(Object keyObj) {
        Object id = invokeAny(keyObj, "getId", "getName", "id", "method_20771", "m_46328_");
        if (id != null) return String.valueOf(id);
        String s = keyObj.toString();
        if (s != null && !s.contains("@")) return s;
        return null;
    }

    private static String readGameruleValueString(Object valObj) {
        Object serialized = invokeAny(valObj, "serialize", "method_20779", "m_46223_");
        if (serialized != null) return String.valueOf(serialized);
        Object raw = invokeAny(valObj, "get", "method_20753", "m_46273_");
        if (raw != null) return String.valueOf(raw);
        if (valObj instanceof Boolean || valObj instanceof Number) return String.valueOf(valObj);
        return null;
    }

    private String applyWorldEnvironment(String worldName, Map<String, Object> body) {
        if (body.containsKey("time")) {
            long ticks = asLong(body.get("time"), -1L);
            if (ticks >= 0) executeServerCommand("time set " + ticks);
        }
        if (body.containsKey("weather")) {
            String w = JsonUtil.asString(body.get("weather"), "").toLowerCase(Locale.ROOT);
            if ("clear".equals(w) || "rain".equals(w) || "thunder".equals(w)) {
                executeServerCommand("weather " + w);
            }
        }
        if (body.containsKey("difficulty")) {
            String d = JsonUtil.asString(body.get("difficulty"), "").toLowerCase(Locale.ROOT);
            if ("peaceful".equals(d) || "easy".equals(d) || "normal".equals(d) || "hard".equals(d)) {
                executeServerCommand("difficulty " + d);
            }
        }
        if (body.containsKey("borderSize")) {
            double size = JsonUtil.asDouble(body.get("borderSize"), -1.0);
            if (size >= 1.0 && size <= 60000000.0) {
                executeServerCommand("worldborder set " + Math.round(size));
            }
        }
        if (JsonUtil.asBoolean(body.get("save"), false)) {
            executeServerCommand("save-all");
        }
        return null;
    }

    private String applyPlayerAction(String playerName, Map<String, Object> body) {
        String action = JsonUtil.asString(body.get("action"), "").toLowerCase(Locale.ROOT);
        String safePlayer = playerName.replaceAll("[^a-zA-Z0-9_.-]", "");
        if (safePlayer.isEmpty()) return "Invalid player name";

        switch (action) {
            case "gamemode": {
                String gm = JsonUtil.asString(body.get("value"), "survival").toLowerCase(Locale.ROOT);
                executeServerCommand("gamemode " + gm + " " + safePlayer);
                return null;
            }
            case "heal": {
                executeServerCommand("effect give " + safePlayer + " minecraft:instant_health 1 10 true");
                executeServerCommand("effect give " + safePlayer + " minecraft:saturation 1 10 true");
                return null;
            }
            case "spawn": {
                executeServerCommand("tp " + safePlayer + " 0 100 0");
                return null;
            }
            case "tp": {
                if (body.containsKey("x") && body.containsKey("y") && body.containsKey("z")) {
                    double x = JsonUtil.asDouble(body.get("x"), 0.0);
                    double y = JsonUtil.asDouble(body.get("y"), 64.0);
                    double z = JsonUtil.asDouble(body.get("z"), 0.0);
                    String w = JsonUtil.asString(body.get("world"), "").trim();
                    if (!w.isEmpty()) {
                        executeServerCommand("execute in " + w + " run tp " + safePlayer + " " + x + " " + y + " " + z);
                    } else {
                        executeServerCommand("tp " + safePlayer + " " + x + " " + y + " " + z);
                    }
                    return null;
                }
                return "x, y, z coordinates required";
            }
            case "xp": {
                int levels = JsonUtil.asInt(body.get("value"), 0);
                executeServerCommand("xp add " + safePlayer + " " + levels + " levels");
                return null;
            }
            case "message": {
                String msg = stripColorCodes(JsonUtil.asString(body.get("value"), ""));
                if (!msg.isEmpty()) executeServerCommand("tell " + safePlayer + " " + msg);
                return null;
            }
            case "kick": {
                String reason = stripColorCodes(JsonUtil.asString(body.get("value"), "Kicked via MCServerManager"));
                executeServerCommand("kick " + safePlayer + " " + reason);
                return null;
            }
            default:
                return "Unsupported player action: " + action;
        }
    }

    private boolean executeServerCommand(String command) {
        Object srv = this.minecraftServer;
        if (srv == null) return false;
        try {
            Object commands = invokeAny(srv, "getCommands", "getCommandManager", "method_3734", "m_129892_");
            Object source = invokeAny(srv, "createCommandSourceStack", "getCommandSource", "method_3739", "m_129898_");
            if (commands == null || source == null) return false;

            // Try performPrefixedCommand(CommandSourceStack, String) / executeWithPrefix(ServerCommandSource, String)
            for (Method m : commands.getClass().getMethods()) {
                String name = m.getName();
                if (("performPrefixedCommand".equals(name) || "executeWithPrefix".equals(name)
                        || "method_44252".equals(name) || "m_230957_".equals(name))
                        && m.getParameterCount() == 2
                        && m.getParameterTypes()[1] == String.class) {
                    m.invoke(commands, source, command);
                    return true;
                }
            }
        } catch (Throwable ex) {
            log("Command execution failed (" + command + "): " + ex.getMessage());
        }
        return false;
    }

    private static double readServerTps(Object srv) {
        if (srv == null) return 0.0;
        Object avgNanos = invokeAny(srv, "getAverageTickTimeNanos", "method_53536", "m_306331_");
        if (avgNanos instanceof Number) {
            double mspt = ((Number) avgNanos).doubleValue() / 1_000_000.0;
            if (mspt > 0.0) return Math.min(20.0, 1000.0 / Math.max(50.0, mspt));
        }
        Object avgMs = invokeAny(srv, "getAverageTickTime", "getTickTime", "method_3755", "m_129909_");
        if (avgMs instanceof Number) {
            double mspt = ((Number) avgMs).doubleValue();
            if (mspt > 0.0) return Math.min(20.0, 1000.0 / Math.max(50.0, mspt));
        }
        return 20.0;
    }

    private static String readServerDifficulty(Object srv) {
        Object worldData = invokeAny(srv, "getWorldData", "getSaveProperties", "method_27728", "m_129910_");
        if (worldData != null) {
            Object d = invokeAny(worldData, "getDifficulty", "method_207", "m_5472_");
            if (d != null) return d.toString().toUpperCase(Locale.ROOT);
        }
        return "NORMAL";
    }

    private static boolean readServerPvp(Object srv) {
        Object pvp = invokeAny(srv, "isPvpAllowed", "isPvpEnabled", "method_3775", "m_129799_");
        return !(pvp instanceof Boolean) || ((Boolean) pvp).booleanValue();
    }

    private static String readLevelDimensionId(Object lvl) {
        Object key = invokeAny(lvl, "dimension", "getRegistryKey", "method_27983", "m_46472_");
        if (key != null) {
            Object loc = invokeAny(key, "location", "getValue", "identifier", "method_29177", "m_135782_");
            if (loc != null) return loc.toString();
        }
        return "minecraft:overworld";
    }

    private static String readPlayerName(Object p) {
        Object profile = invokeAny(p, "getGameProfile", "method_7334", "m_36316_");
        if (profile != null) {
            Object n = invokeAny(profile, "getName", "name");
            if (n != null) return String.valueOf(n);
        }
        Object score = invokeAny(p, "getScoreboardName", "getNameForScoreboard", "method_5820", "m_6302_");
        return score != null ? String.valueOf(score) : "Player";
    }

    private static String normalizeGameMode(String raw) {
        if (raw == null) return "SURVIVAL";
        String u = raw.toUpperCase(Locale.ROOT);
        if (u.contains("CREATIVE")) return "CREATIVE";
        if (u.contains("ADVENTURE")) return "ADVENTURE";
        if (u.contains("SPECTATOR")) return "SPECTATOR";
        return "SURVIVAL";
    }

    private static Object invokeAny(Object target, String... names) {
        if (target == null) return null;
        Class<?> cls = target.getClass();
        for (String name : names) {
            try {
                Method m = cls.getMethod(name);
                m.setAccessible(true);
                return m.invoke(target);
            } catch (Throwable ignored) {}
        }
        return null;
    }

    private static Object readFieldOrInvoke(Object target, String[] names) {
        if (target == null) return null;
        Class<?> cls = target.getClass();
        for (String name : names) {
            Class<?> cur = cls;
            while (cur != null) {
                try {
                    Field f = cur.getDeclaredField(name);
                    f.setAccessible(true);
                    return f.get(target);
                } catch (Throwable ignored) {}
                cur = cur.getSuperclass();
            }
        }
        return null;
    }

    private static Method findMethod(Class<?> cls, String[] names, Class<?>... params) {
        for (String name : names) {
            try {
                Method m = cls.getMethod(name, params);
                m.setAccessible(true);
                return m;
            } catch (Throwable ignored) {}
        }
        return null;
    }

    private static long asLong(Object o, long def) {
        if (o instanceof Number) return ((Number) o).longValue();
        if (o instanceof String) {
            try { return Long.parseLong(((String) o).trim()); } catch (NumberFormatException ignored) {}
        }
        return def;
    }

    private static double asDouble(Object o, double def) {
        if (o instanceof Number) return ((Number) o).doubleValue();
        if (o instanceof String) {
            try { return Double.parseDouble(((String) o).trim()); } catch (NumberFormatException ignored) {}
        }
        return def;
    }

    private static boolean asBool(Object o, boolean def) {
        if (o instanceof Boolean) return ((Boolean) o).booleanValue();
        return def;
    }

    private static String stripColorCodes(String input) {
        return input.replaceAll("[&\u00A7][0-9A-Fa-fK-Ok-oRr]", "");
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
