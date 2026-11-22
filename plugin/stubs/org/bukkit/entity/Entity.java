package org.bukkit.entity;

import org.bukkit.Location;
import org.bukkit.World;

public interface Entity {
    World getWorld();
    Location getLocation();
    String getName();
    boolean teleport(Location location);
}
