package org.bukkit.plugin;

import org.bukkit.event.Event;
import org.bukkit.event.EventException;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

public class RegisteredListener {
    public RegisteredListener(Listener listener, EventExecutor executor, EventPriority priority, Plugin plugin, boolean ignoreCancelled) {}
    public Listener getListener() { return null; }
    public Plugin getPlugin() { return null; }
    public EventPriority getPriority() { return null; }
    public void callEvent(Event event) throws EventException {}
    public boolean isIgnoringCancelled() { return false; }
}
