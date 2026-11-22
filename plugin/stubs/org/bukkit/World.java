package org.bukkit;

import java.io.File;
import java.util.List;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;

public interface World {
    enum Environment { NORMAL, NETHER, THE_END, CUSTOM }
    String getName();
    Environment getEnvironment();
    long getTime();
    void setTime(long time);
    boolean hasStorm();
    void setStorm(boolean hasStorm);
    boolean isThundering();
    void setThundering(boolean thundering);
    Difficulty getDifficulty();
    void setDifficulty(Difficulty difficulty);
    boolean getPVP();
    void setPVP(boolean pvp);
    long getSeed();
    Location getSpawnLocation();
    boolean setSpawnLocation(int x, int y, int z);
    boolean setSpawnLocation(Location location);
    WorldBorder getWorldBorder();
    List<Player> getPlayers();
    String[] getGameRules();
    String getGameRuleValue(String rule);
    boolean setGameRuleValue(String rule, String value);
    Block getBlockAt(int x, int y, int z);
    Block getBlockAt(Location location);
    int getHighestBlockYAt(int x, int z);
    File getWorldFolder();
    void save();
}
