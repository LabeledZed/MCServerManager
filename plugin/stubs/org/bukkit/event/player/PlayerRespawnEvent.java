package org.bukkit.event.player;

import org.bukkit.Location;

public class PlayerRespawnEvent extends PlayerEvent {
    public Location getRespawnLocation() { return null; }
    public void setRespawnLocation(Location respawnLocation) {}
    public boolean isBedSpawn() { return false; }
}
