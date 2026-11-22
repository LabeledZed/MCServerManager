package org.bukkit.event.world;

import java.util.List;
import org.bukkit.block.BlockState;
import org.bukkit.event.Cancellable;

public class PortalCreateEvent extends WorldEvent implements Cancellable {
    public enum CreateReason { FIRE, NETHER_PAIR, END_PLATFORM }
    public List<BlockState> getBlocks() { return null; }
    public CreateReason getReason() { return null; }
    public boolean isCancelled() { return false; }
    public void setCancelled(boolean cancel) {}
}
