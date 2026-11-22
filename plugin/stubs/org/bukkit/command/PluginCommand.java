package org.bukkit.command;

import org.bukkit.plugin.Plugin;

public final class PluginCommand extends Command implements PluginIdentifiableCommand {
    protected PluginCommand(String name, Plugin owner) { super(name); }
    @Override
    public boolean execute(CommandSender sender, String commandLabel, String[] args) { return false; }
    public Plugin getPlugin() { return null; }
    public void setExecutor(CommandExecutor executor) {}
    public void setTabCompleter(TabCompleter completer) {}
}
