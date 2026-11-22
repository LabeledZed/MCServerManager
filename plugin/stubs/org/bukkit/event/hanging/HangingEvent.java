package org.bukkit.event.hanging;

import org.bukkit.entity.Hanging;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;

public abstract class HangingEvent extends Event {
    public Hanging getEntity() { return null; }
    @Override
    public HandlerList getHandlers() { return null; }
}
