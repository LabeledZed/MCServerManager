package org.bukkit.inventory;

public interface PlayerInventory extends Inventory {
    ItemStack[] getArmorContents();
    void setArmorContents(ItemStack[] items);
}
