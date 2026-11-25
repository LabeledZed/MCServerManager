package com.mcservermanager.bridge.velocity;

import com.google.inject.Inject;
import com.mcservermanager.bridge.JsonUtil;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.PluginContainer;
import com.velocitypowered.api.plugin.PluginDescription;
import com.velocitypowered.api.plugin.annotation.DataDirectory;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.ServerConnection;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.proxy.server.ServerInfo;
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
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;

@Plugin(
    id = "mcservermanagerbridge",
    name = "MCServerManagerBridge",
    version = "2.3.0",
    description = "Loopback management bridge for MCServerManager on Velocity proxy servers",
    authors = {"MCServerManager"}
)
public final class VelocityBridgePlugin {

    private final ProxyServer server;
    private final Logger logger;
    private final Path dataDirectory;

    private HttpServer httpServer;
    private ExecutorService executor;
    private String authToken;

    @Inject
    public VelocityBridgePlugin(ProxyServer server, Logger logger, @DataDirectory Path dataDirectory) {
        this.server = server;
        this.logger = logger;
        this.dataDirectory = dataDirectory;
    }

    @Subscribe
    public void onProxyInitialization(ProxyInitializeEvent event) {
        File folder = dataDirectory.toFile();
        if (!folder.exists()) {
            folder.mkdirs();
        }

        File propsFile = new File(folder, "bridge.properties");
        if (!propsFile.exists()) {
            // Also check capitalized folder name if created by older config
            File alt = new File(folder.getParentFile(), "MCServerManagerBridge/bridge.properties");
            if (alt.exists()) {
                propsFile = alt;
            }
        }
        if (!propsFile.exists()) {
            logger.info("MCServerManagerBridge: bridge.properties not found yet — waiting for MCServerManager configuration.");
            return;
        }

        Properties props = new Properties();
        try (FileInputStream fis = new FileInputStream(propsFile)) {
            props.load(fis);
        } catch (IOException ex) {
            logger.warn("MCServerManagerBridge: Failed to load bridge.properties: " + ex.getMessage());
            return;
        }

        int port;
        try {
            port = Integer.parseInt(props.getProperty("port", "35565").trim());
        } catch (NumberFormatException ex) {
            logger.warn("MCServerManagerBridge: Invalid port in bridge.properties");
            return;
        }
        this.authToken = props.getProperty("token", "").trim();
        if (this.authToken.isEmpty()) {
            logger.warn("MCServerManagerBridge: Missing token in bridge.properties — bridge disabled.");
            return;
        }

        try {
            httpServer = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 16);
            executor = Executors.newFixedThreadPool(4);
            httpServer.setExecutor(executor);
            httpServer.createContext("/", this::handleRequest);
            httpServer.start();
            logger.info("MCServerManagerBridge (Velocity) listening on 127.0.0.1:" + port);
        } catch (IOException ex) {
            logger.warn("MCServerManagerBridge: Could not bind bridge on 127.0.0.1:" + port + ": " + ex.getMessage());
        }
    }

    @Subscribe
    public void onProxyShutdown(ProxyShutdownEvent event) {
        if (httpServer != null) {
            httpServer.stop(0);
            httpServer = null;
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
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
                sendJson(ex, 200, buildStatusJson());
                return;
            }

            if ("GET".equals(method) && "/plugins".equals(rawPath)) {
                Map<String, Object> root = new LinkedHashMap<>();
                root.put("plugins", buildPluginsList());
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
                Object comp = makeAdventureComponent(translateColorCodes(msg));
                if (comp != null) {
                    sendComponentTo(server, comp);
                }
                sendJson(ex, 200, "{\"ok\":true}");
                return;
            }

            if ("POST".equals(method) && rawPath.startsWith("/players/") && rawPath.endsWith("/action")) {
                String mid = rawPath.substring("/players/".length(), rawPath.length() - "/action".length());
                String playerName = URLDecoder.decode(mid, "UTF-8");
                Map<String, Object> body = JsonUtil.parseObject(readBody(ex));
                String err = applyPlayerAction(playerName, body);
                if (err != null) {
                    sendJson(ex, 400, "{\"error\":" + JsonUtil.quote(err) + "}");
                } else {
                    sendJson(ex, 200, "{\"ok\":true}");
                }
                return;
            }

            sendJson(ex, 404, "{\"error\":\"Not found\"}");
        } catch (Exception err) {
            String msg = err.getMessage();
            sendJson(ex, 500, "{\"error\":" + JsonUtil.quote(msg != null ? msg : "Internal bridge error") + "}");
        }
    }

    private String buildStatusJson() {
        Runtime rt = Runtime.getRuntime();
        long heapUsedMb = (rt.totalMemory() - rt.freeMemory()) / (1024L * 1024L);
        long heapMaxMb = rt.maxMemory() / (1024L * 1024L);

        String proxyVersion = "Velocity";
        try {
            Object ver = server.getVersion();
            if (ver != null) {
                Method getVer = ver.getClass().getMethod("getVersion");
                Object vStr = getVer.invoke(ver);
                if (vStr != null) proxyVersion = "Velocity " + vStr;
            }
        } catch (Throwable ignored) {}

        List<Object> players = new ArrayList<>();
        for (Player p : server.getAllPlayers()) {
            String currentServer = "";
            Optional<ServerConnection> conn = p.getCurrentServer();
            if (conn.isPresent() && conn.get().getServerInfo() != null) {
                currentServer = conn.get().getServerInfo().getName();
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", p.getUsername());
            m.put("uuid", p.getUniqueId().toString());
            m.put("world", currentServer);
            m.put("x", 0);
            m.put("y", 0);
            m.put("z", 0);
            m.put("health", 20);
            m.put("maxHealth", 20);
            m.put("food", 20);
            m.put("gamemode", "SURVIVAL");
            m.put("op", false);
            m.put("ping", p.getPing());
            players.add(m);
        }

        List<Object> servers = new ArrayList<>();
        for (RegisteredServer rs : server.getAllServers()) {
            ServerInfo info = rs.getServerInfo();
            InetSocketAddress addr = info.getAddress();
            List<String> pNames = new ArrayList<>();
            for (Player p : rs.getPlayersConnected()) {
                pNames.add(p.getUsername());
            }
            Map<String, Object> sm = new LinkedHashMap<>();
            sm.put("name", info.getName());
            sm.put("address", addr != null ? (addr.getHostString() + ":" + addr.getPort()) : "");
            sm.put("playerCount", pNames.size());
            sm.put("players", pNames);
            servers.add(sm);
        }

        List<Object> plugins = buildPluginsList();

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("ok", Boolean.TRUE);
        root.put("serverName", "Velocity");
        root.put("bukkitVersion", proxyVersion);
        root.put("heapUsedMb", heapUsedMb);
        root.put("heapMaxMb", heapMaxMb);
        root.put("pluginCount", plugins.size());
        root.put("tps", null);
        root.put("worlds", new ArrayList<>());
        root.put("players", players);
        root.put("proxyServers", servers);
        root.put("plugins", plugins);
        return JsonUtil.stringify(root);
    }

    private List<Object> buildPluginsList() {
        List<Object> out = new ArrayList<>();
        for (PluginContainer pc : server.getPluginManager().getPlugins()) {
            PluginDescription desc = pc.getDescription();
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", desc.getName().orElse(desc.getId()));
            m.put("version", desc.getVersion().orElse(""));
            m.put("enabled", Boolean.TRUE);
            out.add(m);
        }
        return out;
    }

    private String applyPlayerAction(String playerName, Map<String, Object> body) {
        Optional<Player> opt = server.getPlayer(playerName);
        if (!opt.isPresent()) {
            return "Player is not online on proxy: " + playerName;
        }
        Player player = opt.get();
        String action = JsonUtil.asString(body.get("action"), "").toLowerCase(Locale.ROOT);
        if ("message".equals(action)) {
            String msg = JsonUtil.asString(body.get("value"), "");
            if (!msg.isEmpty()) {
                Object comp = makeAdventureComponent(translateColorCodes(msg));
                if (comp != null) sendComponentTo(player, comp);
            }
            return null;
        }
        if ("kick".equals(action)) {
            String reason = JsonUtil.asString(body.get("value"), "");
            String msg = translateColorCodes(!reason.isEmpty() ? reason : "Disconnected via MCServerManager");
            Object comp = makeAdventureComponent(msg);
            if (comp != null) {
                try {
                    Class<?> compCls = resolveComponentBaseClass(comp);
                    Method disconnect = player.getClass().getMethod("disconnect", compCls);
                    disconnect.invoke(player, comp);
                } catch (Throwable ex) {
                    return "Failed to disconnect player: " + ex.getMessage();
                }
            }
            return null;
        }
        if ("send".equals(action)) {
            String targetName = JsonUtil.asString(body.get("value"), JsonUtil.asString(body.get("world"), "")).trim();
            if (targetName.isEmpty()) return "Target backend server name is required";
            Optional<RegisteredServer> target = server.getServer(targetName);
            if (!target.isPresent()) {
                return "Backend server not registered in Velocity: " + targetName;
            }
            player.createConnectionRequest(target.get()).fireAndForget();
            return null;
        }
        return "Unsupported Velocity proxy player action: " + action;
    }

    private static Object makeAdventureComponent(String text) {
        // Velocity 3.x: net.kyori.adventure.text.*
        try {
            Class<?> serCls = Class.forName("net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer");
            Object ser = serCls.getMethod("legacySection").invoke(null);
            return serCls.getMethod("deserialize", String.class).invoke(ser, text);
        } catch (Throwable ignored) {}
        try {
            Class<?> compCls = Class.forName("net.kyori.adventure.text.Component");
            return compCls.getMethod("text", String.class).invoke(null, text);
        } catch (Throwable ignored) {}
        // Velocity 1.1.x: net.kyori.text.*
        try {
            Class<?> compCls = Class.forName("net.kyori.text.TextComponent");
            return compCls.getMethod("of", String.class).invoke(null, text);
        } catch (Throwable ignored) {}
        return null;
    }

    private static Class<?> resolveComponentBaseClass(Object comp) throws ClassNotFoundException {
        try {
            Class<?> adv = Class.forName("net.kyori.adventure.text.Component");
            if (adv.isInstance(comp)) return adv;
        } catch (Throwable ignored) {}
        return Class.forName("net.kyori.text.Component");
    }

    private static void sendComponentTo(Object audience, Object component) {
        try {
            Class<?> compCls = resolveComponentBaseClass(component);
            Method m = audience.getClass().getMethod("sendMessage", compCls);
            m.invoke(audience, component);
        } catch (Throwable ignored) {}
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
