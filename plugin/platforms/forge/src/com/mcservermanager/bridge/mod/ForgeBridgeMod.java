package com.mcservermanager.bridge.mod;

import java.io.File;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.function.BiPredicate;
import java.util.function.Consumer;
import java.util.function.Supplier;
import net.minecraftforge.fml.common.Mod;

/**
 * Forge 1.13.2 - 1.21.x+ (and NeoForge 1.20.1) bridge mod entrypoint.
 * Supports FMLServerStartedEvent (1.13-1.17), ServerStartedEvent (1.18-1.21+),
 * EventBus 7 per-event BUS (1.21.6+), and ServerLifecycleHooks fallback.
 */
@Mod("mcservermanagerbridge")
public final class ForgeBridgeMod {

    private final ReflectiveMinecraftServerBridge bridge;

    public ForgeBridgeMod() {
        this.bridge = new ReflectiveMinecraftServerBridge(
            "Forge",
            resolveConfigDir(),
            ForgeBridgeMod::listLoadedMods,
            System.out::println
        );
        Runtime.getRuntime().addShutdownHook(new Thread(bridge::stop, "MCServerManagerBridge-Shutdown"));
        registerServerOnlyDisplayTest();
        if (!registerLifecycleListeners()) {
            startServerLifecycleHooksWatcher();
        }
    }

    /**
     * Marks this mod as server-only on Forge 1.14 - 1.20.4 so clients without the bridge mod can join cleanly.
     */
    private static void registerServerOnlyDisplayTest() {
        // Forge 1.17 - 1.20.x: ModLoadingContext.get().registerExtensionPoint(IExtensionPoint.DisplayTest.class, ...)
        try {
            Class<?> ctxCls = Class.forName("net.minecraftforge.fml.ModLoadingContext");
            Object ctx = ctxCls.getMethod("get").invoke(null);
            Class<?> dtCls = Class.forName("net.minecraftforge.fml.IExtensionPoint$DisplayTest");
            String ignoreVal = "OHNOES\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31\uD83D\uDE31";
            try {
                Class<?> netConst = Class.forName("net.minecraftforge.network.NetworkConstants");
                Object v = netConst.getField("IGNORESERVERONLY").get(null);
                if (v instanceof String) ignoreVal = (String) v;
            } catch (Throwable ignored) {
                try {
                    Class<?> netConst = Class.forName("net.minecraftforge.fmllegacy.network.FMLNetworkConstants");
                    Object v = netConst.getField("IGNORESERVERONLY").get(null);
                    if (v instanceof String) ignoreVal = (String) v;
                } catch (Throwable ignored2) {}
            }
            final String finalIgnore = ignoreVal;
            Constructor<?> ctor = dtCls.getConstructor(Supplier.class, BiPredicate.class);
            Supplier<String> verSup = () -> finalIgnore;
            BiPredicate<String, Boolean> acceptAll = (remote, isNet) -> true;
            Object displayTest = ctor.newInstance(verSup, acceptAll);
            Method reg = ctx.getClass().getMethod("registerExtensionPoint", Class.class, Supplier.class);
            reg.invoke(ctx, dtCls, (Supplier<Object>) () -> displayTest);
            return;
        } catch (Throwable ignored) {}

        // Forge 1.14 - 1.16.5: ModLoadingContext.get().registerExtensionPoint(ExtensionPoint.DISPLAYTEST, () -> Pair.of(...))
        try {
            Class<?> ctxCls = Class.forName("net.minecraftforge.fml.ModLoadingContext");
            Object ctx = ctxCls.getMethod("get").invoke(null);
            Class<?> extCls = Class.forName("net.minecraftforge.fml.ExtensionPoint");
            Object dtPoint = extCls.getField("DISPLAYTEST").get(null);
            Class<?> netConst = Class.forName("net.minecraftforge.fml.network.FMLNetworkConstants");
            final String ignoreVal = String.valueOf(netConst.getField("IGNORESERVERONLY").get(null));
            Class<?> pairCls = Class.forName("org.apache.commons.lang3.tuple.Pair");
            Method pairOf = pairCls.getMethod("of", Object.class, Object.class);
            Supplier<String> verSup = () -> ignoreVal;
            BiPredicate<String, Boolean> acceptAll = (remote, isNet) -> true;
            Object pair = pairOf.invoke(null, verSup, acceptAll);
            Method reg = ctx.getClass().getMethod("registerExtensionPoint", extCls, Supplier.class);
            reg.invoke(ctx, dtPoint, (Supplier<Object>) () -> pair);
        } catch (Throwable ignored) {}
    }

    private boolean registerLifecycleListeners() {
        Class<?> startedCls = findFirstClass(
            "net.minecraftforge.event.server.ServerStartedEvent",
            "net.minecraftforge.fml.event.server.FMLServerStartedEvent"
        );
        Class<?> stoppingCls = findFirstClass(
            "net.minecraftforge.event.server.ServerStoppingEvent",
            "net.minecraftforge.fml.event.server.FMLServerStoppingEvent"
        );
        if (startedCls == null) return false;

        Consumer<Object> onStart = evt -> {
            try {
                Object srv = evt.getClass().getMethod("getServer").invoke(evt);
                if (srv != null) bridge.attachAndStart(srv);
            } catch (Throwable ignored) {}
        };
        Consumer<Object> onStop = evt -> bridge.stop();

        // 1. Forge 1.21.6+ EventBus 7: static BUS field on event class itself
        if (tryRegisterPerEventBus(startedCls, onStart)) {
            if (stoppingCls != null) tryRegisterPerEventBus(stoppingCls, onStop);
            return true;
        }

        // 2. Classic MinecraftForge.EVENT_BUS (Forge 1.13.2 - 1.21.5)
        try {
            Class<?> forgeCls = Class.forName("net.minecraftforge.common.MinecraftForge");
            Field busField = forgeCls.getField("EVENT_BUS");
            Object eventBus = busField.get(null);
            registerBusEvent(eventBus, startedCls, onStart, "net.minecraftforge.eventbus.api.EventPriority");
            if (stoppingCls != null) {
                registerBusEvent(eventBus, stoppingCls, onStop, "net.minecraftforge.eventbus.api.EventPriority");
            }
            return true;
        } catch (Throwable ex) {
            System.out.println("[MCServerManagerBridge] Forge event registration fallback: " + ex.getMessage());
            return false;
        }
    }

    private static boolean tryRegisterPerEventBus(Class<?> eventCls, Consumer<Object> listener) {
        try {
            Field busField = eventCls.getField("BUS");
            Object bus = busField.get(null);
            if (bus == null) return false;
            for (Method m : bus.getClass().getMethods()) {
                if ("addListener".equals(m.getName()) && m.getParameterCount() == 1 && m.getParameterTypes()[0] == Consumer.class) {
                    m.invoke(bus, listener);
                    return true;
                }
            }
        } catch (Throwable ignored) {}
        return false;
    }

    private void startServerLifecycleHooksWatcher() {
        Thread watcher = new Thread(() -> {
            for (int i = 0; i < 240; i++) {
                try {
                    if (bridge.isStarted()) return;
                    Class<?> hooks = findFirstClass(
                        "net.minecraftforge.server.ServerLifecycleHooks",
                        "net.minecraftforge.fml.server.ServerLifecycleHooks"
                    );
                    if (hooks != null) {
                        Object srv = hooks.getMethod("getCurrentServer").invoke(null);
                        if (srv != null) {
                            bridge.attachAndStart(srv);
                            return;
                        }
                    }
                    Thread.sleep(500L);
                } catch (InterruptedException ex) {
                    return;
                } catch (Throwable ignored) {
                    try { Thread.sleep(500L); } catch (InterruptedException ie) { return; }
                }
            }
        }, "MCServerManagerBridge-ForgeWatcher");
        watcher.setDaemon(true);
        watcher.start();
    }

    private static Class<?> findFirstClass(String... names) {
        for (String name : names) {
            try {
                return Class.forName(name);
            } catch (Throwable ignored) {}
        }
        return null;
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
            Class<?> pathsCls = Class.forName("net.minecraftforge.fml.loading.FMLPaths");
            Object cfgEnum = pathsCls.getField("CONFIGDIR").get(null);
            Object p = cfgEnum.getClass().getMethod("get").invoke(cfgEnum);
            if (p instanceof Path) return ((Path) p).toFile();
        } catch (Throwable ignored) {}
        return new File("config");
    }

    private static List<ReflectiveMinecraftServerBridge.ModEntry> listLoadedMods() {
        List<ReflectiveMinecraftServerBridge.ModEntry> list = new ArrayList<>();
        try {
            Class<?> modListCls = Class.forName("net.minecraftforge.fml.ModList");
            Object ml = modListCls.getMethod("get").invoke(null);
            Object modsObj = ml.getClass().getMethod("getMods").invoke(ml);
            if (modsObj instanceof Collection) {
                for (Object info : (Collection<?>) modsObj) {
                    String id = String.valueOf(info.getClass().getMethod("getModId").invoke(info));
                    if ("minecraft".equals(id) || "forge".equals(id)) continue;
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
