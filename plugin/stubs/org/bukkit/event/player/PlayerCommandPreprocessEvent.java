package org.bukkit.event.player;

import org.bukkit.event.Cancellable;

public class PlayerCommandPreprocessEvent extends PlayerEvent implements Cancellable {
    public String getMessage() { return null; }
    public void setMessage(String message) {}
    public boolean isCancelled() { return false; }
    public void setCancelled(boolean cancel) {}
}
