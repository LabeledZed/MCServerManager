package com.mcservermanager.bridge;

import java.util.List;
import java.util.Locale;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * In-game OP admin command (/mv or /mcsm) for quick world teleportation, spawn setting,
 * group assignment, and config reloading alongside the MCServerManager web UI.
 */
public final class RealmsCommand implements CommandExecutor {

    private final MCServerManagerBridgePlugin plugin;
    private final WorldController worlds;

    public RealmsCommand(MCServerManagerBridgePlugin plugin, WorldController worlds) {
        this.plugin = plugin;
        this.worlds = worlds;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!sender.isOp()) {
            sender.sendMessage("\u00A7cOperator permission required.");
            return true;
        }

        if (args.length == 0) {
            sendHelp(sender, label);
            return true;
        }

        String sub = args[0].toLowerCase(Locale.ROOT);
        switch (sub) {
            case "list": {
                List<World> loaded = Bukkit.getWorlds();
                sender.sendMessage("\u00A7b[Realms] Loaded Worlds (" + loaded.size() + "):");
                for (World w : loaded) {
                    sender.sendMessage(" \u00A77- \u00A7f" + w.getName() + " \u00A78(" + w.getEnvironment() + ", " + w.getPlayers().size() + " players)");
                }
                RealmsConfig cfg = plugin.getRealmsConfig();
                if (!cfg.groups.isEmpty()) {
                    sender.sendMessage("\u00A7b[Realms] Groups (" + cfg.groups.size() + "):");
                    for (RealmsConfig.WorldGroup g : cfg.groups) {
                        String cc = RealmsConfig.hexToChatColor(g.color);
                        sender.sendMessage(" \u00A77- " + cc + g.name + " \u00A78[" + g.id + "] \u00A77overworld=\u00A7f" + g.overworld + " \u00A77players=\u00A7f" + g.players.size());
                    }
                }
                return true;
            }
            case "tp": {
                if (args.length == 2) {
                    if (!(sender instanceof Player)) {
                        sender.sendMessage("\u00A7cUsage from console: /" + label + " tp <player> <world>");
                        return true;
                    }
                    World target = worlds.getWorld(args[1]);
                    if (target == null) {
                        sender.sendMessage("\u00A7cWorld not loaded: " + args[1]);
                        return true;
                    }
                    FoliaCompat.teleportSafe((Player) sender, target.getSpawnLocation());
                    sender.sendMessage("\u00A7aTeleported to " + WorldController.getCanonicalWorldName(target));
                    return true;
                }
                if (args.length >= 3) {
                    Player p = Bukkit.getPlayerExact(args[1]);
                    if (p == null) {
                        sender.sendMessage("\u00A7cPlayer not online: " + args[1]);
                        return true;
                    }
                    World target = worlds.getWorld(args[2]);
                    if (target == null) {
                        sender.sendMessage("\u00A7cWorld not loaded: " + args[2]);
                        return true;
                    }
                    FoliaCompat.teleportSafe(p, target.getSpawnLocation());
                    sender.sendMessage("\u00A7aMoved " + p.getName() + " to " + WorldController.getCanonicalWorldName(target));
                    return true;
                }
                sender.sendMessage("\u00A7cUsage: /" + label + " tp [player] <world>");
                return true;
            }
            case "setspawn": {
                if (!(sender instanceof Player)) {
                    sender.sendMessage("\u00A7cOnly players can run setspawn.");
                    return true;
                }
                Player p = (Player) sender;
                Location loc = p.getLocation();
                p.getWorld().setSpawnLocation(loc.getBlockX(), loc.getBlockY(), loc.getBlockZ());
                sender.sendMessage("\u00A7aSet spawn for " + p.getWorld().getName() + " to " + loc.getBlockX() + ", " + loc.getBlockY() + ", " + loc.getBlockZ());
                return true;
            }
            case "reload": {
                plugin.reloadRealmsFromDisk();
                sender.sendMessage("\u00A7aReloaded MCServerManager Realms & Per-World Plugins.");
                return true;
            }
            default:
                sendHelp(sender, label);
                return true;
        }
    }

    private static void sendHelp(CommandSender sender, String label) {
        sender.sendMessage("\u00A7b[MCServerManager Realms]");
        sender.sendMessage(" \u00A7f/" + label + " list \u00A77— List worlds and realm groups");
        sender.sendMessage(" \u00A7f/" + label + " tp [player] <world> \u00A77— Teleport to a world");
        sender.sendMessage(" \u00A7f/" + label + " setspawn \u00A77— Set current world spawn");
        sender.sendMessage(" \u00A7f/" + label + " reload \u00A77— Reload realms.json & plugin rules");
    }
}
