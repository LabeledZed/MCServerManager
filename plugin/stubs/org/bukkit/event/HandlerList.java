package org.bukkit.event;

import java.util.ArrayList;
import org.bukkit.plugin.RegisteredListener;

public class HandlerList {
    public static ArrayList<HandlerList> getHandlerLists() { return null; }
    public RegisteredListener[] getRegisteredListeners() { return null; }
    public synchronized void register(RegisteredListener listener) {}
    public synchronized void unregister(RegisteredListener listener) {}
}
