package org.bukkit;

import java.io.File;
import java.util.Collection;
import java.util.List;
import org.bukkit.entity.Player;
import org.bukkit.plugin.PluginManager;
import org.bukkit.scheduler.BukkitScheduler;

public final class Bukkit {
    public static Server getServer() { return null; }
    public static BukkitScheduler getScheduler() { return null; }
    public static PluginManager getPluginManager() { return null; }
    public static List<World> getWorlds() { return null; }
    public static World getWorld(String name) { return null; }
    public static World createWorld(WorldCreator creator) { return null; }
    public static boolean unloadWorld(World world, boolean save) { return false; }
    public static boolean unloadWorld(String name, boolean save) { return false; }
    public static File getWorldContainer() { return null; }
    public static Collection<? extends Player> getOnlinePlayers() { return null; }
    public static Player getPlayerExact(String name) { return null; }
    public static int broadcastMessage(String message) { return 0; }
    public static String getName() { return null; }
    public static String getVersion() { return null; }
    public static String getBukkitVersion() { return null; }
}
