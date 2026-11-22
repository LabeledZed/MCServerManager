package org.bukkit;

import java.io.File;

public interface Server {
    String getName();
    String getVersion();
    String getBukkitVersion();
    File getWorldContainer();
}
