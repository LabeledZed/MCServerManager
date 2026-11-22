package org.bukkit.event.entity;

import org.bukkit.entity.Entity;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;

public abstract class EntityEvent extends Event {
    public Entity getEntity() { return null; }
    @Override
    public HandlerList getHandlers() { return null; }
}
