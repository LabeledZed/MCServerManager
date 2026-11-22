package org.bukkit.event.server;

import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;
import org.bukkit.plugin.Plugin;

public abstract class PluginEvent extends Event {
    public Plugin getPlugin() { return null; }
    @Override
    public HandlerList getHandlers() { return null; }
}
