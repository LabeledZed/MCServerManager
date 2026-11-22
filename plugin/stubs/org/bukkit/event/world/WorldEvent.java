package org.bukkit.event.world;

import org.bukkit.World;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;

public abstract class WorldEvent extends Event {
    public World getWorld() { return null; }
    @Override
    public HandlerList getHandlers() { return null; }
}
