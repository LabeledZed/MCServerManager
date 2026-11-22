package org.bukkit.configuration.file;

import java.io.File;
import java.io.IOException;
import java.util.List;

public class YamlConfiguration {
    public static YamlConfiguration loadConfiguration(File file) { return null; }
    public void save(File file) throws IOException {}
    public void set(String path, Object value) {}
    public boolean contains(String path) { return false; }
    public String getString(String path) { return null; }
    public String getString(String path, String def) { return def; }
    public int getInt(String path, int def) { return def; }
    public double getDouble(String path, double def) { return def; }
    public List<?> getList(String path) { return null; }
}
