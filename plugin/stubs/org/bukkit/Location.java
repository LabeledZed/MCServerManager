package org.bukkit;

public class Location {
    public Location(World world, double x, double y, double z) {}
    public Location(World world, double x, double y, double z, float yaw, float pitch) {}
    public World getWorld() { return null; }
    public void setWorld(World world) {}
    public double getX() { return 0; }
    public double getY() { return 0; }
    public double getZ() { return 0; }
    public int getBlockX() { return 0; }
    public int getBlockY() { return 0; }
    public int getBlockZ() { return 0; }
    public float getYaw() { return 0; }
    public float getPitch() { return 0; }
    public double distanceSquared(Location o) { return 0; }
    @Override
    public Location clone() { return null; }
}
