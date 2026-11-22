package org.bukkit.block;

import org.bukkit.Material;
import org.bukkit.World;

public interface BlockState {
    World getWorld();
    Material getType();
    int getX();
    int getY();
    int getZ();
    Block getBlock();
}
