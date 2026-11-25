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
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
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
 * Works across Mojang-mapped (NeoForge, Forge 1.20.6+, Fabric 26.1+), Intermediary-mapped
 * (Fabric 1.14-1.21.x & Legacy Fabric), Official SRG (Forge 1.17-1.20.5), and MCP SRG
 * (Forge 1.4.7-1.16.5) dedicated servers without compile-time NMS/mapping linkage.
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
    private volatile File configDir;
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
        this.configDir = configDir != null ? configDir : new File("config");
        this.modListSupplier = modListSupplier;
        this.logger = logger;
    }

    public void setConfigDir(File configDir) {
        if (configDir != null) {
            this.configDir = configDir;
        }
    }

    public boolean isStarted() {
        return httpServer != null && minecraftServer != null;
    }

    public synchronized void attachAndStart(Object mcServer) {
        if (mcServer != null) {
            this.minecraftServer = mcServer;
        }
        if (httpServer != null) return;

        File baseCfg = this.configDir != null ? this.configDir : new File("config");
        File propsFile = new File(new File(baseCfg, "mcservermanagerbridge"), "bridge.properties");
        if (!propsFile.exists()) {
            File alt = new File(new File(baseCfg, "MCServerManagerBridge"), "bridge.properties");
            if (alt.exists()) propsFile = alt;
        }
        if (!propsFile.exists()) {
            File fallback = new File(new File("config", "mcservermanagerbridge"), "bridge.properties");
            if (fallback.exists()) propsFile = fallback;
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
        // Try MinecraftServer#execute(Runnable) (MC 1.14+ Executor) or addScheduledTask(Runnable) (MC 1.8-1.12.2)
        try {
            Method exec = findMethod(
                srv.getClass(),
                new String[]{"execute", "method_20493", "addScheduledTask", "func_152344_a"},
                Runnable.class
            );
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

    private String readMcVersion(Object srv) {
        if (srv == null) return "";
        Object v = invokeAny(srv, "getServerVersion", "getMinecraftVersion", "method_3827", "m_130001_", "func_71249_w");
        return v != null ? String.valueOf(v) : "";
    }

    /**
     * Parses Minecraft version into major*10000 + minor*100 + patch for command-syntax compatibility
     * (e.g. 1.7.10 -> 10710, 1.12.2 -> 11202, 1.13 -> 11300, 1.21.4 -> 12104, 26.1 -> 260100).
     * Returns -1 if unknown (defaults to modern 1.13+ syntax).
     */
    private static int parseVersionCode(String version) {
        if (version == null || version.isEmpty()) return -1;
        String[] parts = version.trim().split("[^0-9]+");
        if (parts.length < 2) return -1;
        try {
            int a = Integer.parseInt(parts[0]);
            int b = Integer.parseInt(parts[1]);
            int c = parts.length >= 3 && !parts[2].isEmpty() ? Integer.parseInt(parts[2]) : 0;
            return a * 10000 + b * 100 + Math.min(99, c);
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }

    private String buildStatusJson() {
        Runtime rt = Runtime.getRuntime();
        long heapUsedMb = (rt.totalMemory() - rt.freeMemory()) / (1024L * 1024L);
        long heapMaxMb = rt.maxMemory() / (1024L * 1024L);

        Object srv = this.minecraftServer;
        String mcVersion = readMcVersion(srv);

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

    /**
     * Collects all loaded worlds/levels across MC 1.4.7-1.12.2 (WorldServer[] array field)
     * and MC 1.13-26.3+ (Iterable&lt;ServerLevel&gt;).
     */
    private static List<Object> collectServerLevels(Object srv) {
        List<Object> levels = new ArrayList<>();
        if (srv == null) return levels;

        Object levelsObj = invokeAny(srv, "getAllLevels", "getWorlds", "method_3732", "m_129785_", "func_212370_w");
        if (levelsObj == null) {
            levelsObj = readField(srv, "worlds", "worldServers", "field_71305_c");
        }
        if (levelsObj == null) {
            // Structural fallback for Notch-obfuscated 1.4.7: look for an array field of WorldServer-like objects
            levelsObj = findWorldArrayField(srv);
        }

        if (levelsObj instanceof Iterable) {
            for (Object lvl : (Iterable<?>) levelsObj) {
                if (lvl != null) levels.add(lvl);
            }
        } else if (levelsObj != null && levelsObj.getClass().isArray()) {
            int len = Array.getLength(levelsObj);
            for (int i = 0; i < len; i++) {
                Object lvl = Array.get(levelsObj, i);
                if (lvl != null) levels.add(lvl);
            }
        }
        return levels;
    }

    private static Object findWorldArrayField(Object srv) {
        Class<?> cur = srv.getClass();
        while (cur != null && cur != Object.class) {
            for (Field f : cur.getDeclaredFields()) {
                Class<?> t = f.getType();
                if (!t.isArray()) continue;
                Class<?> comp = t.getComponentType();
                if (comp == null || comp.isPrimitive() || comp == String.class) continue;
                String cn = comp.getName();
                if (cn.contains("World") || cn.contains("Level") || cn.contains("class_3218")) {
                    try {
                        f.setAccessible(true);
                        Object arr = f.get(srv);
                        if (arr != null && Array.getLength(arr) > 0) return arr;
                    } catch (Throwable ignored) {}
                }
            }
            cur = cur.getSuperclass();
        }
        return null;
    }

    private List<Object> buildWorldsList(Object srv) {
        List<Object> out = new ArrayList<>();
        if (srv == null) return out;
        List<Object> levels = collectServerLevels(srv);
        if (levels.isEmpty()) return out;

        String difficulty = readServerDifficulty(srv, levels.get(0));
        boolean pvp = readServerPvp(srv);

        int idx = 0;
        for (Object lvl : levels) {
            String dimId = readLevelDimensionId(lvl, idx++);
            String lowerDim = dimId.toLowerCase(Locale.ROOT);
            String env = lowerDim.contains("nether") ? "NETHER" : (lowerDim.contains("end") ? "THE_END" : "NORMAL");
            long time = asLong(invokeAny(lvl, "getDayTime", "getTimeOfDay", "getWorldTime", "method_8532", "m_46468_", "func_72820_D"), 0L);
            boolean raining = asBool(invokeAny(lvl, "isRaining", "method_8419", "m_46471_", "func_72896_J"), false);
            boolean thundering = asBool(invokeAny(lvl, "isThundering", "method_8546", "m_46470_", "func_72911_I"), false);
            String weather = thundering ? "thunder" : (raining ? "rain" : "clear");
            long seed = asLong(invokeAny(lvl, "getSeed", "method_8412", "m_7328_", "func_72905_C"), 0L);

            double borderSize = 59999968.0;
            Object wb = invokeAny(lvl, "getWorldBorder", "method_8621", "m_6857_", "func_175723_af");
            if (wb != null) {
                borderSize = asDouble(invokeAny(wb, "getSize", "getDiameter", "method_11965", "m_61941_", "func_177741_h"), borderSize);
            }

            int playerCount = 0;
            Object playersCol = invokeAny(lvl, "players", "getPlayers", "method_18456", "m_6907_", "func_217369_A");
            if (playersCol == null) {
                playersCol = readField(lvl, "playerEntities", "field_73010_i");
            }
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
        Object playerList = invokeAny(
            srv,
            "getPlayerList", "getPlayerManager", "getConfigurationManager",
            "method_3760", "m_6846_", "func_184103_al", "func_71203_ab"
        );
        if (playerList == null) return out;

        Object playersObj = invokeAny(
            playerList,
            "getPlayers", "getPlayerList",
            "method_14571", "m_11314_", "func_181057_v"
        );
        if (playersObj == null) {
            playersObj = readField(playerList, "playerEntityList", "field_72404_b", "players", "field_14358", "f_11196_");
        }
        if (!(playersObj instanceof Iterable)) return out;

        for (Object p : (Iterable<?>) playersObj) {
            if (p == null) continue;
            String name = readPlayerName(p);
            Object uuidRaw = invokeAny(p, "getStringUUID", "getUuidAsString", "getCachedUniqueIdString", "method_5845", "m_20149_", "func_189512_bd");
            String uuid = uuidRaw != null ? String.valueOf(uuidRaw) : "";
            if (uuid.isEmpty() || "null".equals(uuid)) {
                Object uObj = invokeAny(p, "getUUID", "getUuid", "getUniqueID", "method_5667", "m_20148_", "func_110124_au");
                uuid = uObj != null ? uObj.toString() : "";
            }

            Object lvl = invokeAny(
                p,
                "level", "serverLevel", "getWorld", "getServerWorld", "getEntityWorld",
                "method_37908", "method_5770", "m_9236_", "func_130014_f_", "func_71121_q"
            );
            if (lvl == null) {
                lvl = readField(p, "level", "world", "worldObj", "field_70170_p", "field_6002", "f_19853_");
            }
            String worldName = lvl != null ? readLevelDimensionId(lvl, 0) : "minecraft:overworld";

            double x = readCoord(p,
                new String[]{"getX", "getPosX", "method_23317", "m_20185_", "func_226277_ct_"},
                new String[]{"posX", "field_70165_t", "field_6014"}
            );
            double y = readCoord(p,
                new String[]{"getY", "getPosY", "method_23318", "m_20186_", "func_226278_cu_"},
                new String[]{"posY", "field_70163_u", "field_6036"}
            );
            double z = readCoord(p,
                new String[]{"getZ", "getPosZ", "method_23321", "m_20189_", "func_226281_cx_"},
                new String[]{"posZ", "field_70161_v", "field_5969"}
            );

            double health = asDouble(invokeAny(p, "getHealth", "method_6032", "m_21223_", "func_110143_aJ"), 20.0);
            double maxHealth = asDouble(invokeAny(p, "getMaxHealth", "method_6063", "m_21233_", "func_110138_aP"), 20.0);

            int food = 20;
            Object foodData = invokeAny(p, "getFoodData", "getHungerManager", "getFoodStats", "method_7344", "m_36324_", "func_71024_bL");
            if (foodData != null) {
                food = (int) asLong(invokeAny(foodData, "getFoodLevel", "method_7586", "m_38702_", "func_75116_a"), 20L);
            }

            String gm = "SURVIVAL";
            Object gameModeMgr = readField(p, "gameMode", "interactionManager", "theItemInWorldManager", "field_13974", "f_8941_", "field_71134_c");
            if (gameModeMgr != null) {
                Object gmObj = invokeAny(gameModeMgr, "getGameModeForPlayer", "getGameMode", "getGameType", "method_14257", "m_9290_", "func_73081_b");
                if (gmObj != null) {
                    gm = gmObj.toString().toUpperCase(Locale.ROOT);
                }
            }

            int ping = readPlayerPing(p);
            boolean isOp = readPlayerIsOp(p, playerList);

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

    private static double readCoord(Object entity, String[] getterNames, String[] fieldNames) {
        Object v = invokeAny(entity, getterNames);
        if (v instanceof Number) return ((Number) v).doubleValue();
        Object f = readField(entity, fieldNames);
        if (f instanceof Number) return ((Number) f).doubleValue();
        return 0.0;
    }

    private static int readPlayerPing(Object p) {
        // MC 1.20.2+: ServerPlayer.connection.latency()
        Object conn = readField(p, "connection", "networkHandler", "field_13987", "f_8906_", "playerNetServerHandler", "field_71135_a");
        if (conn != null) {
            Object lat = invokeAny(conn, "latency", "getLatency", "method_52396", "m_293012_");
            if (lat instanceof Number) return ((Number) lat).intValue();
        }
        // MC 1.4.7-1.20.1: ServerPlayer.latency / ping / pingMilliseconds field
        Object direct = readField(p, "latency", "ping", "pingMilliseconds", "f_8943_", "field_13967", "field_71138_i");
        if (direct instanceof Number) return ((Number) direct).intValue();
        return 0;
    }

    private static boolean readPlayerIsOp(Object p, Object playerList) {
        // MC 1.14+: hasPermissions(int) / hasPermissionLevel(int)
        try {
            Method m = findMethod(p.getClass(), new String[]{"hasPermissions", "hasPermissionLevel", "method_5687", "m_20310_", "func_211513_k"}, int.class);
            if (m != null) {
                Object res = m.invoke(p, Integer.valueOf(2));
                if (res instanceof Boolean) return ((Boolean) res).booleanValue();
            }
        } catch (Throwable ignored) {}
        // MC 1.7-1.12.2: canUseCommand(int, String)
        try {
            Method m = findMethod(p.getClass(), new String[]{"canUseCommand", "func_70003_b"}, int.class, String.class);
            if (m != null) {
                Object res = m.invoke(p, Integer.valueOf(2), "");
                if (res instanceof Boolean) return ((Boolean) res).booleanValue();
            }
        } catch (Throwable ignored) {}
        // PlayerList#isOp(GameProfile)
        try {
            Object profile = invokeAny(p, "getGameProfile", "method_7334", "m_36316_", "func_146103_bH");
            if (profile != null && playerList != null) {
                Method m = findMethod(playerList.getClass(), new String[]{"isOp", "isOperator", "canSendCommands", "method_14569", "m_11303_", "func_152596_g"}, profile.getClass());
                if (m != null) {
                    Object res = m.invoke(playerList, profile);
                    if (res instanceof Boolean) return ((Boolean) res).booleanValue();
                }
            }
        } catch (Throwable ignored) {}
        return false;
    }

    private String buildGamerulesJson(String worldName) {
        List<Object> rows = new ArrayList<>();
        Object srv = this.minecraftServer;
        if (srv != null) {
            Object gameRulesObj = null;
            List<Object> levels = collectServerLevels(srv);
            int idx = 0;
            for (Object lvl : levels) {
                String dimId = readLevelDimensionId(lvl, idx++);
                if (worldName.equalsIgnoreCase(dimId) || gameRulesObj == null) {
                    gameRulesObj = invokeAny(lvl, "getGameRules", "method_8450", "m_46469_", "func_82736_K");
                    if (worldName.equalsIgnoreCase(dimId) && gameRulesObj != null) break;
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
        // 1. MC 1.4.2-1.12.2 legacy GameRules API: getRules() -> String[] + getString(String)
        try {
            Object namesObj = invokeAny(gameRulesObj, "getRules", "func_82763_b");
            if (namesObj instanceof String[]) {
                Method getStr = findMethod(gameRulesObj.getClass(), new String[]{"getString", "getGameRuleStringValue", "func_82767_a"}, String.class);
                if (getStr != null) {
                    for (String ruleName : (String[]) namesObj) {
                        if (ruleName == null || ruleName.isEmpty()) continue;
                        Object val = getStr.invoke(gameRulesObj, ruleName);
                        if (val == null) continue;
                        appendGameruleRow(rows, ruleName, String.valueOf(val));
                    }
                    if (!rows.isEmpty()) return;
                }
            }
        } catch (Throwable ignored) {}

        // 2. Universal Map field scan (works on MC 1.13-26.3+ Key->Value AND 1.4.2-1.12.2 TreeMap<String, Value>)
        try {
            Class<?> cur = gameRulesObj.getClass();
            while (cur != null && cur != Object.class) {
                for (Field f : cur.getDeclaredFields()) {
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
                            appendGameruleRow(rows, keyName, strVal);
                        }
                        if (!rows.isEmpty()) return;
                    }
                }
                cur = cur.getSuperclass();
            }
        } catch (Throwable ignored) {}
    }

    private static void appendGameruleRow(List<Object> rows, String keyName, String strVal) {
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

    private static String readGameruleKeyName(Object keyObj) {
        if (keyObj instanceof String) return (String) keyObj;
        Object id = invokeAny(keyObj, "getId", "getName", "id", "method_20771", "m_46328_", "func_223576_a");
        if (id != null) return String.valueOf(id);
        String s = keyObj.toString();
        if (s != null && !s.contains("@")) return s;
        return null;
    }

    private static String readGameruleValueString(Object valObj) {
        if (valObj instanceof String || valObj instanceof Boolean || valObj instanceof Number) {
            return String.valueOf(valObj);
        }
        Object serialized = invokeAny(valObj, "serialize", "getString", "getGameRuleStringValue", "method_20779", "m_46223_", "func_82756_a");
        if (serialized != null) return String.valueOf(serialized);
        Object raw = invokeAny(valObj, "get", "method_20753", "m_46273_");
        if (raw != null) return String.valueOf(raw);
        String s = valObj.toString();
        if (s != null && !s.contains("@")) return s;
        return null;
    }

    private String applyWorldEnvironment(String worldName, Map<String, Object> body) {
        int verCode = parseVersionCode(readMcVersion(this.minecraftServer));
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
            if (size >= 1.0 && size <= 60000000.0 && (verCode < 0 || verCode >= 10800)) {
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

        int verCode = parseVersionCode(readMcVersion(this.minecraftServer));
        boolean isPre113 = verCode > 0 && verCode < 11300;
        boolean isPre18 = verCode > 0 && verCode < 10800;

        switch (action) {
            case "gamemode": {
                String gm = JsonUtil.asString(body.get("value"), "survival").toLowerCase(Locale.ROOT);
                executeServerCommand("gamemode " + gm + " " + safePlayer);
                return null;
            }
            case "heal": {
                if (isPre18) {
                    // MC 1.5 - 1.7.10: numeric effect IDs (6 = Instant Health, 23 = Saturation)
                    executeServerCommand("effect " + safePlayer + " 6 1 10");
                    executeServerCommand("effect " + safePlayer + " 23 1 10");
                } else if (isPre113) {
                    // MC 1.8 - 1.12.2: named effects without 'give' subcommand
                    executeServerCommand("effect " + safePlayer + " minecraft:instant_health 1 10 true");
                    executeServerCommand("effect " + safePlayer + " minecraft:saturation 1 10 true");
                } else {
                    executeServerCommand("effect give " + safePlayer + " minecraft:instant_health 1 10 true");
                    executeServerCommand("effect give " + safePlayer + " minecraft:saturation 1 10 true");
                }
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
                    if (!w.isEmpty() && !isPre113) {
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
                if (isPre113) {
                    executeServerCommand("xp " + levels + "L " + safePlayer);
                } else {
                    executeServerCommand("xp add " + safePlayer + " " + levels + " levels");
                }
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
            Object commands = invokeAny(
                srv,
                "getCommands", "getCommandManager",
                "method_3734", "m_129892_", "func_195571_aL", "func_71187_D"
            );
            Object source = invokeAny(
                srv,
                "createCommandSourceStack", "getCommandSource",
                "method_3739", "m_129898_", "func_195573_aM"
            );
            // MC 1.3.2 - 1.12.2: MinecraftServer itself implements ICommandSender
            if (source == null) {
                source = srv;
            }

            if (commands != null) {
                String[] preferredMethods = new String[]{
                    // MC 1.19+
                    "performPrefixedCommand", "executeWithPrefix", "method_44252", "m_230957_",
                    // MC 1.13 - 1.18.2
                    "performCommand", "handleCommand", "execute", "m_82117_", "func_197059_a", "method_9249",
                    // MC 1.3.2 - 1.12.2
                    "executeCommand", "func_71556_a"
                };
                for (String targetName : preferredMethods) {
                    for (Method m : commands.getClass().getMethods()) {
                        if (!targetName.equals(m.getName())) continue;
                        Class<?>[] pts = m.getParameterTypes();
                        if (pts.length == 2 && pts[1] == String.class && pts[0].isAssignableFrom(source.getClass())) {
                            m.setAccessible(true);
                            m.invoke(commands, source, command);
                            return true;
                        }
                    }
                }
                // Structural fallback for Notch-obfuscated 1.4.7: any 2-arg (ICommandSender, String) method on CommandHandler
                for (Method m : commands.getClass().getMethods()) {
                    Class<?>[] pts = m.getParameterTypes();
                    if (pts.length == 2 && pts[1] == String.class && pts[0] != Object.class && pts[0].isAssignableFrom(source.getClass())) {
                        Class<?> ret = m.getReturnType();
                        if (ret == int.class || ret == void.class) {
                            m.setAccessible(true);
                            m.invoke(commands, source, command);
                            return true;
                        }
                    }
                }
            }

            // Fallback: DedicatedServer#addPendingCommand(String, ICommandSender) / handleConsoleInput(String, CommandSourceStack)
            String[] queueMethods = new String[]{"addPendingCommand", "handleConsoleInput", "func_71331_a", "func_195581_a", "m_139645_", "method_13947"};
            for (String qm : queueMethods) {
                for (Method m : srv.getClass().getMethods()) {
                    if (!qm.equals(m.getName())) continue;
                    Class<?>[] pts = m.getParameterTypes();
                    if (pts.length == 2 && pts[0] == String.class && pts[1].isAssignableFrom(source.getClass())) {
                        m.setAccessible(true);
                        m.invoke(srv, command, source);
                        return true;
                    }
                }
            }
        } catch (Throwable ex) {
            log("Command execution failed (" + command + "): " + ex.getMessage());
        }
        return false;
    }

    private static double readServerTps(Object srv) {
        if (srv == null) return 0.0;
        // MC 1.20.3+: getAverageTickTimeNanos()
        Object avgNanos = invokeAny(srv, "getAverageTickTimeNanos", "method_53536", "m_306331_");
        if (avgNanos instanceof Number) {
            double mspt = ((Number) avgNanos).doubleValue() / 1_000_000.0;
            if (mspt > 0.0) return Math.min(20.0, 1000.0 / Math.max(50.0, mspt));
        }
        // MC 1.14 - 1.20.2: getAverageTickTime() / getTickTime() (milliseconds)
        Object avgMs = invokeAny(srv, "getAverageTickTime", "getTickTime", "method_3755", "m_129909_", "func_211149_aT");
        if (avgMs instanceof Number) {
            double mspt = ((Number) avgMs).doubleValue();
            if (mspt > 0.0) return Math.min(20.0, 1000.0 / Math.max(50.0, mspt));
        }
        // MC 1.4.7 - 1.16.5: tickTimeArray (long[] in nanoseconds)
        Object tickArr = readField(srv, "tickTimeArray", "tickTimes", "lastTickLengths", "field_71311_j", "field_4547", "f_129727_");
        if (tickArr instanceof long[]) {
            long[] arr = (long[]) tickArr;
            long sum = 0L;
            int nonZero = 0;
            for (long t : arr) {
                if (t > 0L) {
                    sum += t;
                    nonZero++;
                }
            }
            if (nonZero > 0) {
                double mspt = ((double) sum / nonZero) / 1_000_000.0;
                if (mspt > 0.0) return Math.min(20.0, 1000.0 / Math.max(50.0, mspt));
            }
        }
        return 20.0;
    }

    private static String readServerDifficulty(Object srv, Object firstLevel) {
        Object worldData = invokeAny(srv, "getWorldData", "getSaveProperties", "method_27728", "m_129910_", "func_240793_aU_");
        if (worldData != null) {
            Object d = invokeAny(worldData, "getDifficulty", "method_207", "m_5472_", "func_176130_y");
            if (d != null) return normalizeDifficulty(d.toString());
        }
        Object direct = invokeAny(srv, "getDifficulty", "method_3809", "func_147135_j");
        if (direct != null) return normalizeDifficulty(direct.toString());
        if (firstLevel != null) {
            Object ld = invokeAny(firstLevel, "getDifficulty", "func_175659_aa");
            if (ld != null) return normalizeDifficulty(ld.toString());
        }
        return "NORMAL";
    }

    private static String normalizeDifficulty(String raw) {
        if (raw == null) return "NORMAL";
        String u = raw.toUpperCase(Locale.ROOT);
        if (u.contains("PEACEFUL") || "0".equals(u)) return "PEACEFUL";
        if (u.contains("EASY") || "1".equals(u)) return "EASY";
        if (u.contains("HARD") || "3".equals(u)) return "HARD";
        return "NORMAL";
    }

    private static boolean readServerPvp(Object srv) {
        Object pvp = invokeAny(srv, "isPvpAllowed", "isPvpEnabled", "isPVPEnabled", "method_3775", "m_129799_", "func_71219_W");
        return !(pvp instanceof Boolean) || ((Boolean) pvp).booleanValue();
    }

    private static String readLevelDimensionId(Object lvl, int fallbackIndex) {
        // MC 1.16+: ServerLevel#dimension().location()
        Object key = invokeAny(lvl, "dimension", "getRegistryKey", "method_27983", "m_46472_", "func_234923_W_");
        if (key != null) {
            Object loc = invokeAny(key, "location", "getValue", "identifier", "method_29177", "m_135782_", "func_240901_a_");
            if (loc != null) return loc.toString();
        }
        // MC 1.13 - 1.15.2: World#getDimension().getType()
        Object dim = invokeAny(lvl, "getDimension", "func_201675_m");
        if (dim != null) {
            Object dimType = invokeAny(dim, "getType", "func_186058_p");
            if (dimType != null) {
                Object regName = invokeAny(dimType, "getRegistryName", "getId", "func_186068_a");
                if (regName instanceof Number) {
                    return dimIdNumberToName(((Number) regName).intValue());
                }
                if (regName != null) return regName.toString();
            }
        }
        // MC 1.4.7 - 1.12.2: World.provider (WorldProvider) -> getDimension() / dimensionId (int)
        Object provider = readField(lvl, "provider", "field_73011_w");
        if (provider != null) {
            Object dimNum = invokeAny(provider, "getDimension", "getDimensionId");
            if (dimNum instanceof Number) {
                return dimIdNumberToName(((Number) dimNum).intValue());
            }
            Object dimType = invokeAny(provider, "getDimensionType", "func_186058_p");
            if (dimType != null) {
                Object idNum = invokeAny(dimType, "getId", "func_186068_a");
                if (idNum instanceof Number) {
                    return dimIdNumberToName(((Number) idNum).intValue());
                }
            }
            Object dimField = readField(provider, "dimensionId", "field_76574_g");
            if (dimField instanceof Number) {
                return dimIdNumberToName(((Number) dimField).intValue());
            }
        }
        if (fallbackIndex == 1) return "minecraft:the_nether";
        if (fallbackIndex == 2) return "minecraft:the_end";
        return "minecraft:overworld";
    }

    private static String dimIdNumberToName(int id) {
        if (id == 0) return "minecraft:overworld";
        if (id == -1) return "minecraft:the_nether";
        if (id == 1) return "minecraft:the_end";
        return "dimension:" + id;
    }

    private static String readPlayerName(Object p) {
        Object profile = invokeAny(p, "getGameProfile", "method_7334", "m_36316_", "func_146103_bH");
        if (profile != null) {
            Object n = invokeAny(profile, "getName", "name");
            if (n != null) return String.valueOf(n);
        }
        Object score = invokeAny(p, "getScoreboardName", "getNameForScoreboard", "getCommandSenderName", "getEntityName", "getName", "method_5820", "m_6302_", "func_70005_c_");
        if (score instanceof String) return (String) score;
        if (score != null) {
            Object str = invokeAny(score, "getString", "getUnformattedText");
            if (str != null) return String.valueOf(str);
            return String.valueOf(score);
        }
        return "Player";
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

    private static Object readField(Object target, String... names) {
        if (target == null) return null;
        Class<?> cls = target.getClass();
        for (String name : names) {
            Class<?> cur = cls;
            while (cur != null && cur != Object.class) {
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
