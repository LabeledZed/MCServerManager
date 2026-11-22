package com.velocitypowered.api.proxy.server;

import com.velocitypowered.api.proxy.Player;
import java.util.Collection;

public interface RegisteredServer {
    ServerInfo getServerInfo();
    Collection<Player> getPlayersConnected();
}
