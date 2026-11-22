package com.mcservermanager.bridge.mod;

import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import net.fabricmc.api.DedicatedServerModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.fabricmc.loader.api.metadata.ModMetadata;

public final class FabricBridgeEntrypoint implements DedicatedServerModInitializer {

    private ReflectiveMinecraftServerBridge bridge;

    @Override
    public void onInitializeServer() {
        File configDir = FabricLoader.getInstance().getConfigDir().toFile();
        this.bridge = new ReflectiveMinecraftServerBridge(
            "Fabric",
            configDir,
            FabricBridgeEntrypoint::listLoadedMods,
            System.out::println
        );

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            if (bridge != null) bridge.stop();
        }, "MCServerManagerBridge-Shutdown"));

        boolean hookedFabricApi = tryHookFabricLifecycleEvents();
        if (!hookedFabricApi) {
            startGameInstanceWatcher();
        }
    }

    private boolean tryHookFabricLifecycleEvents() {
        try {
            Class<?> eventsCls = Class.forName("net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents");
            Field startedField = eventsCls.getField("SERVER_STARTED");
            Field stoppingField = eventsCls.getField("SERVER_STOPPING");
            Object startedEvent = startedField.get(null);
            Object stoppingEvent = stoppingField.get(null);

            Class<?> startedIface = Class.forName("net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents$ServerStarted");
            Class<?> stoppingIface = Class.forName("net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents$ServerStopping");

            Object startedProxy = Proxy.newProxyInstance(
                startedIface.getClassLoader(),
                new Class<?>[]{startedIface},
                (proxy, method, args) -> {
                    if (args != null && args.length == 1 && args[0] != null) {
                        bridge.attachAndStart(args[0]);
                    }
                    return null;
                }
            );
            Object stoppingProxy = Proxy.newProxyInstance(
                stoppingIface.getClassLoader(),
                new Class<?>[]{stoppingIface},
                (proxy, method, args) -> {
                    bridge.stop();
                    return null;
                }
            );

            Method regStarted = startedEvent.getClass().getMethod("register", Object.class);
            Method regStopping = stoppingEvent.getClass().getMethod("register", Object.class);
            regStarted.invoke(startedEvent, startedProxy);
            regStopping.invoke(stoppingEvent, stoppingProxy);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private void startGameInstanceWatcher() {
        Thread watcher = new Thread(() -> {
            for (int i = 0; i < 240; i++) {
                try {
                    @SuppressWarnings("deprecation")
                    Object game = FabricLoader.getInstance().getGameInstance();
                    if (game != null) {
                        bridge.attachAndStart(game);
                        return;
                    }
                    Thread.sleep(500L);
                } catch (InterruptedException ex) {
                    return;
                } catch (Throwable ignored) {}
            }
        }, "MCServerManagerBridge-FabricWatcher");
        watcher.setDaemon(true);
        watcher.start();
    }

    private static List<ReflectiveMinecraftServerBridge.ModEntry> listLoadedMods() {
        List<ReflectiveMinecraftServerBridge.ModEntry> list = new ArrayList<>();
        for (ModContainer c : FabricLoader.getInstance().getAllMods()) {
            ModMetadata meta = c.getMetadata();
            String id = meta.getId();
            if ("java".equals(id) || "minecraft".equals(id) || "fabricloader".equals(id)) continue;
            list.add(new ReflectiveMinecraftServerBridge.ModEntry(
                meta.getName() != null && !meta.getName().isEmpty() ? meta.getName() : id,
                meta.getVersion() != null ? meta.getVersion().getFriendlyString() : "",
                true
            ));
        }
        return list;
    }
}
