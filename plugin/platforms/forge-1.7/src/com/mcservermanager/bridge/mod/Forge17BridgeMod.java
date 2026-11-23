package com.mcservermanager.bridge.mod;

import cpw.mods.fml.common.Mod;
import cpw.mods.fml.common.event.FMLPreInitializationEvent;
import cpw.mods.fml.common.event.FMLServerStartedEvent;
import cpw.mods.fml.common.event.FMLServerStartingEvent;
import cpw.mods.fml.common.event.FMLServerStoppingEvent;
import java.io.File;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/**
 * Forge 1.7.2 - 1.7.10 bridge mod entrypoint (cpw.mods.fml.*).
 * Server-only (acceptableRemoteVersions="*") so vanilla/modded clients without the bridge connect cleanly.
 */
@Mod(
    modid = "mcservermanagerbridge",
    name = "MCServerManagerBridge",
    version = "2.3.0",
    acceptableRemoteVersions = "*"
)
public class Forge17BridgeMod {

    private final ReflectiveMinecraftServerBridge bridge;
    private volatile Object capturedServer;

    public Forge17BridgeMod() {
        this.bridge = new ReflectiveMinecraftServerBridge(
            "Forge",
            new File("config"),
            Forge17BridgeMod::listLoadedMods,
            System.out::println
        );
        Runtime.getRuntime().addShutdownHook(new Thread(bridge::stop, "MCServerManagerBridge-Shutdown"));
    }

    @Mod.EventHandler
    public void onPreInit(FMLPreInitializationEvent event) {
        try {
            File cfgDir = event.getModConfigurationDirectory();
            if (cfgDir != null) {
                bridge.setConfigDir(cfgDir);
            }
        } catch (Throwable ignored) {}
    }

    @Mod.EventHandler
    public void onServerStarting(FMLServerStartingEvent event) {
        try {
            Object srv = event.getClass().getMethod("getServer").invoke(event);
            if (srv != null) {
                this.capturedServer = srv;
            }
        } catch (Throwable ignored) {}
    }

    @Mod.EventHandler
    public void onServerStarted(FMLServerStartedEvent event) {
        Object srv = this.capturedServer;
        if (srv == null) {
            srv = getMinecraftServerFallback();
        }
        if (srv != null) {
            bridge.attachAndStart(srv);
        }
    }

    @Mod.EventHandler
    public void onServerStopping(FMLServerStoppingEvent event) {
        bridge.stop();
        this.capturedServer = null;
    }

    private static Object getMinecraftServerFallback() {
        try {
            Class<?> handlerCls = Class.forName("cpw.mods.fml.common.FMLCommonHandler");
            Object inst = handlerCls.getMethod("instance").invoke(null);
            return inst.getClass().getMethod("getMinecraftServerInstance").invoke(inst);
        } catch (Throwable ignored) {}
        return null;
    }

    private static List<ReflectiveMinecraftServerBridge.ModEntry> listLoadedMods() {
        List<ReflectiveMinecraftServerBridge.ModEntry> list = new ArrayList<>();
        try {
            Class<?> loaderCls = Class.forName("cpw.mods.fml.common.Loader");
            Object loader = loaderCls.getMethod("instance").invoke(null);
            Object modsObj = loader.getClass().getMethod("getActiveModList").invoke(loader);
            if (modsObj instanceof Collection) {
                for (Object container : (Collection<?>) modsObj) {
                    String id = String.valueOf(container.getClass().getMethod("getModId").invoke(container));
                    if ("minecraft".equalsIgnoreCase(id) || "mcp".equalsIgnoreCase(id)
                            || "FML".equalsIgnoreCase(id) || "Forge".equalsIgnoreCase(id)) {
                        continue;
                    }
                    String name = String.valueOf(container.getClass().getMethod("getName").invoke(container));
                    Object ver = container.getClass().getMethod("getVersion").invoke(container);
                    list.add(new ReflectiveMinecraftServerBridge.ModEntry(
                        name != null && !name.isEmpty() ? name : id,
                        ver != null ? ver.toString() : "",
                        true
                    ));
                }
            }
        } catch (Throwable ignored) {}
        return list;
    }
}
