package org.bukkit.event.player;

import org.bukkit.Location;
import org.bukkit.event.Cancellable;

public class PlayerTeleportEvent extends PlayerEvent implements Cancellable {
    public enum TeleportCause {
        ENDER_PEARL, COMMAND, PLUGIN, NETHER_PORTAL, END_PORTAL, SPECTATE,
        END_GATEWAY, CHORUS_FRUIT, DISMOUNT, EXIT_BED, UNKNOWN
    }
    public Location getFrom() { return null; }
    public void setFrom(Location from) {}
    public Location getTo() { return null; }
    public void setTo(Location to) {}
    public TeleportCause getCause() { return null; }
    public boolean isCancelled() { return false; }
    public void setCancelled(boolean cancel) {}
}
