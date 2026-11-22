package org.bukkit.inventory;

public interface Inventory {
    ItemStack[] getContents();
    void setContents(ItemStack[] items);
    void clear();
}
