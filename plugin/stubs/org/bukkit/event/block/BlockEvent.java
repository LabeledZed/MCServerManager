package org.bukkit.event.block;

import org.bukkit.block.Block;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;

public abstract class BlockEvent extends Event {
    public Block getBlock() { return null; }
    @Override
    public HandlerList getHandlers() { return null; }
}
