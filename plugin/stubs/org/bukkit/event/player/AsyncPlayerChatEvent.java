package org.bukkit.event.player;

import java.util.Set;
import org.bukkit.entity.Player;
import org.bukkit.event.Cancellable;

public class AsyncPlayerChatEvent extends PlayerEvent implements Cancellable {
    public Set<Player> getRecipients() { return null; }
    public boolean isCancelled() { return false; }
    public void setCancelled(boolean cancel) {}
}
