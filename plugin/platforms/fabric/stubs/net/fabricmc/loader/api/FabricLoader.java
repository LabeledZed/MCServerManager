package net.fabricmc.loader.api;

import java.nio.file.Path;
import java.util.Collection;

public interface FabricLoader {
    static FabricLoader getInstance() { return null; }
    Path getConfigDir();
    Collection<ModContainer> getAllMods();
    Object getGameInstance();
}
