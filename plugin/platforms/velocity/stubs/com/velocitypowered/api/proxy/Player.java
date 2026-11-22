package com.velocitypowered.api.proxy;

import com.velocitypowered.api.proxy.server.RegisteredServer;
import java.util.Optional;
import java.util.UUID;

public interface Player {
    String getUsername();
    UUID getUniqueId();
    long getPing();
    Optional<ServerConnection> getCurrentServer();
    ConnectionRequestBuilder createConnectionRequest(RegisteredServer server);
}
