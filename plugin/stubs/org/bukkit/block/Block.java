package org.bukkit.block;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;

public interface Block {
    World getWorld();
    Material getType();
    int getX();
    int getY();
    int getZ();
    Location getLocation();
}
