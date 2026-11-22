package org.bukkit.event;

public abstract class Event {
    public String getEventName() { return null; }
    public abstract HandlerList getHandlers();
}
