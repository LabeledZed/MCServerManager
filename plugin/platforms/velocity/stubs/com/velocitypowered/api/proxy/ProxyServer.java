package com.velocitypowered.api.proxy;

import com.velocitypowered.api.plugin.PluginManager;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import java.util.Collection;
import java.util.Optional;

public interface ProxyServer {
    Collection<Player> getAllPlayers();
    Optional<Player> getPlayer(String username);
    Collection<RegisteredServer> getAllServers();
    Optional<RegisteredServer> getServer(String name);
    PluginManager getPluginManager();
    Object getVersion();
}
