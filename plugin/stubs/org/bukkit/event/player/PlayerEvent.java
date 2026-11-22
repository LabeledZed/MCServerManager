package org.bukkit.event.player;

import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;

public abstract class PlayerEvent extends Event {
    public Player getPlayer() { return null; }
    @Override
    public HandlerList getHandlers() { return null; }
}
