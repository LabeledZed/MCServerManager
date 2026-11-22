package org.bukkit.command;

import java.util.List;

public abstract class Command {
    protected Command(String name) {}
    protected Command(String name, String description, String usageMessage, List<String> aliases) {}
    public String getName() { return null; }
    public List<String> getAliases() { return null; }
    public abstract boolean execute(CommandSender sender, String commandLabel, String[] args);
    public List<String> tabComplete(CommandSender sender, String alias, String[] args) { return null; }
}
