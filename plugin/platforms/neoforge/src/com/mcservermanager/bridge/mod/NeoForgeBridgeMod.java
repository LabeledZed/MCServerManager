package com.mcservermanager.bridge.mod;

import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.function.Consumer;
import net.neoforged.fml.common.Mod;

@Mod("mcservermanagerbridge")
public final class NeoForgeBridgeMod {

    private final ReflectiveMinecraftServerBridge bridge;

    public NeoForgeBridgeMod() {
        this.bridge = new ReflectiveMinecraftServerBridge(
            "NeoForge",
            resolveConfigDir(),
            NeoForgeBridgeMod::listLoadedMods,
            System.out::println
        );
        Runtime.getRuntime().addShutdownHook(new Thread(bridge::stop, "MCServerManagerBridge-Shutdown"));
        if (!registerLifecycleListeners()) {
            startServerLifecycleHooksWatcher();
        }
    }

    private boolean registerLifecycleListeners() {
        try {
            Class<?> neoForgeCls = Class.forName("net.neoforged.neoforge.common.NeoForge");
            Field busField = neoForgeCls.getField("EVENT_BUS");
            Object eventBus = busField.get(null);

            Class<?> startedCls = Class.forName("net.neoforged.neoforge.event.server.ServerStartedEvent");
            Class<?> stoppingCls = Class.forName("net.neoforged.neoforge.event.server.ServerStoppingEvent");

            Consumer<Object> onStart = evt -> {
                try {
                    Object srv = evt.getClass().getMethod("getServer").invoke(evt);
                    if (srv != null) bridge.attachAndStart(srv);
                } catch (Throwable ignored) {}
            };
            Consumer<Object> onStop = evt -> bridge.stop();
            registerBusEvent(eventBus, startedCls, onStart, "net.neoforged.bus.api.EventPriority");
            registerBusEvent(eventBus, stoppingCls, onStop, "net.neoforged.bus.api.EventPriority");
            return true;
        } catch (Throwable ex) {
            System.out.println("[MCServerManagerBridge] NeoForge event registration fallback: " + ex.getMessage());
            return false;
        }
    }

    private void startServerLifecycleHooksWatcher() {
        Thread watcher = new Thread(() -> {
            for (int i = 0; i < 240; i++) {
                try {
                    if (bridge.isStarted()) return;
                    Class<?> hooks = Class.forName("net.neoforged.neoforge.server.ServerLifecycleHooks");
                    Object srv = hooks.getMethod("getCurrentServer").invoke(null);
                    if (srv != null) {
                        bridge.attachAndStart(srv);
                        return;
                    }
                    Thread.sleep(500L);
                } catch (InterruptedException ex) {
                    return;
                } catch (Throwable ignored) {
                    try { Thread.sleep(500L); } catch (InterruptedException ie) { return; }
                }
            }
        }, "MCServerManagerBridge-NeoForgeWatcher");
        watcher.setDaemon(true);
        watcher.start();
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static void registerBusEvent(Object eventBus, Class<?> eventCls, Consumer<Object> listener, String priorityClassName) throws Exception {
        for (Method m : eventBus.getClass().getMethods()) {
            if (!"addListener".equals(m.getName())) continue;
            Class<?>[] pts = m.getParameterTypes();
            if (pts.length == 2 && pts[0] == Class.class && pts[1] == Consumer.class) {
                m.invoke(eventBus, eventCls, listener);
                return;
            }
        }
        Class<?> prioCls = Class.forName(priorityClassName);
        Object normalPrio = Enum.valueOf((Class<? extends Enum>) prioCls, "NORMAL");
        for (Method m : eventBus.getClass().getMethods()) {
            if (!"addListener".equals(m.getName())) continue;
            Class<?>[] pts = m.getParameterTypes();
            if (pts.length == 4 && pts[0] == prioCls && pts[1] == boolean.class && pts[2] == Class.class && pts[3] == Consumer.class) {
                m.invoke(eventBus, normalPrio, Boolean.FALSE, eventCls, listener);
                return;
            }
        }
    }

    private static File resolveConfigDir() {
        try {
            Class<?> pathsCls = Class.forName("net.neoforged.fml.loading.FMLPaths");
            Object cfgEnum = pathsCls.getField("CONFIGDIR").get(null);
            Object p = cfgEnum.getClass().getMethod("get").invoke(cfgEnum);
            if (p instanceof Path) return ((Path) p).toFile();
        } catch (Throwable ignored) {}
        return new File("config");
    }

    private static List<ReflectiveMinecraftServerBridge.ModEntry> listLoadedMods() {
        List<ReflectiveMinecraftServerBridge.ModEntry> list = new ArrayList<>();
        try {
            Class<?> modListCls = Class.forName("net.neoforged.fml.ModList");
            Object ml = modListCls.getMethod("get").invoke(null);
            Object modsObj = ml.getClass().getMethod("getMods").invoke(ml);
            if (modsObj instanceof Collection) {
                for (Object info : (Collection<?>) modsObj) {
                    String id = String.valueOf(info.getClass().getMethod("getModId").invoke(info));
                    if ("minecraft".equals(id) || "neoforge".equals(id)) continue;
                    String display = String.valueOf(info.getClass().getMethod("getDisplayName").invoke(info));
                    Object ver = info.getClass().getMethod("getVersion").invoke(info);
                    list.add(new ReflectiveMinecraftServerBridge.ModEntry(
                        display != null && !display.isEmpty() ? display : id,
                        ver != null ? ver.toString() : "",
                        true
                    ));
                }
            }
        } catch (Throwable ignored) {}
        return list;
    }
}
