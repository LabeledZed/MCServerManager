package org.bukkit.event.player;

public class PlayerPortalEvent extends PlayerTeleportEvent {
    public boolean getCanCreatePortal() { return true; }
    public void setCanCreatePortal(boolean canCreatePortal) {}
    public int getSearchRadius() { return 128; }
    public void setSearchRadius(int searchRadius) {}
}
