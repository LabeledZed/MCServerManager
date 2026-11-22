package org.bukkit;

public class WorldCreator {
    public WorldCreator(String name) {}
    public static WorldCreator name(String name) { return null; }
    public WorldCreator environment(World.Environment env) { return this; }
    public WorldCreator type(WorldType type) { return this; }
    public WorldCreator seed(long seed) { return this; }
    public WorldCreator generateStructures(boolean generate) { return this; }
    public WorldCreator generator(String generator) { return this; }
    public World createWorld() { return null; }
}
