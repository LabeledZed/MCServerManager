package org.bukkit.event.weather;

import org.bukkit.World;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;

public abstract class WeatherEvent extends Event {
    public World getWorld() { return null; }
    @Override
    public HandlerList getHandlers() { return null; }
}
