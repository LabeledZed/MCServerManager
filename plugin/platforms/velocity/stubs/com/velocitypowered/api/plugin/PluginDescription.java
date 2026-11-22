package com.velocitypowered.api.plugin;

import java.util.Optional;

public interface PluginDescription {
    String getId();
    Optional<String> getName();
    Optional<String> getVersion();
}
