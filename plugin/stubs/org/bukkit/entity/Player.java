package org.bukkit.entity;

import java.util.UUID;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.plugin.Plugin;

public interface Player extends HumanEntity, CommandSender {
    String getName();
    UUID getUniqueId();
    World getWorld();
    Location getLocation();
    double getHealth();
    void setHealth(double health);
    double getMaxHealth();
    int getFoodLevel();
    void setFoodLevel(int value);
    float getSaturation();
    void setSaturation(float value);
    float getExhaustion();
    void setExhaustion(float value);
    int getFireTicks();
    void setFireTicks(int ticks);
    int getLevel();
    void setLevel(int level);
    float getExp();
    void setExp(float exp);
    int getTotalExperience();
    void setTotalExperience(int exp);
    GameMode getGameMode();
    void setGameMode(GameMode mode);
    boolean isOp();
    boolean hasPlayedBefore();
    boolean isOnline();
    PlayerInventory getInventory();
    Inventory getEnderChest();
    void giveExpLevels(int amount);
    void sendMessage(String message);
    void kickPlayer(String message);
    boolean teleport(Location location);
    void hidePlayer(Plugin plugin, Player player);
    void showPlayer(Plugin plugin, Player player);
}
