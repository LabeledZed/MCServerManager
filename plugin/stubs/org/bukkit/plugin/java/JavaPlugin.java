package org.bukkit.plugin.java;

import java.io.File;
import java.util.logging.Logger;
import org.bukkit.Server;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.Plugin;

public abstract class JavaPlugin implements Plugin {
    public void onEnable() {}
    public void onDisable() {}
    public File getDataFolder() { return null; }
    public Logger getLogger() { return null; }
    public Server getServer() { return null; }
    public String getName() { return null; }
    public boolean isEnabled() { return true; }
    public org.bukkit.plugin.PluginDescriptionFile getDescription() { return null; }
    public PluginCommand getCommand(String name) { return null; }
}
