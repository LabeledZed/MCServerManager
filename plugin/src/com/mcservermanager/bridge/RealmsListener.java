package com.mcservermanager.bridge;

import java.lang.reflect.Method;
import java.util.Collection;
import java.util.Iterator;
import java.util.List;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.server.PluginEnableEvent;
import org.bukkit.event.world.PortalCreateEvent;

/**
 * Core Bukkit event listener for MCServerManager Realms:
 * - Default world & Player Group join routing
 * - Per-group / per-world inventory, chat, visibility/Tab-list, and gamemode isolation
 * - Linked Nether/End portals, owned colored portals, and per-group respawn handling
 * - Per-world plugin command blocking and late-loaded plugin listener wrapping
 */
public final class RealmsListener implements Listener {

    private final MCServerManagerBridgePlugin plugin;
    private final WorldController worlds;
    private final PlayerProfileManager profiles;
    private final PortalManager portals;
    private final PluginScopeManager pluginScope;
    private final TpaManager tpaManager;

    public RealmsListener(
            MCServerManagerBridgePlugin plugin,
            WorldController worlds,
            PlayerProfileManager profiles,
            PortalManager portals,
            PluginScopeManager pluginScope,
            TpaManager tpaManager
    ) {
        this.plugin = plugin;
        this.worlds = worlds;
        this.profiles = profiles;
        this.portals = portals;
        this.pluginScope = pluginScope;
        this.tpaManager = tpaManager;
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onPlayerJoin(PlayerJoinEvent event) {
        final Player player = event.getPlayer();
        final RealmsConfig cfg = plugin.getRealmsConfig();
        if (player == null) return;

        profiles.initPlayerOnJoin(player, cfg);
        if (!cfg.enabled) {
            refreshVisibilityForAll();
            return;
        }

        final String currentWorldName = player.getWorld() != null ? player.getWorld().getName() : "";
        final RealmsConfig.WorldGroup explicit = cfg.findExplicitGroupForPlayerName(
            player.getName(), player.getUniqueId().toString()
        );
        final RealmsConfig.WorldGroup effective = explicit != null ? explicit : cfg.getDefaultGroup();
        final String lastAssigned = profiles.readLastAssignedGroup(player.getUniqueId());

        Location routeTarget = null;

        if (explicit != null) {
            boolean newlyAssigned = !effective.id.equalsIgnoreCase(lastAssigned);
            if (newlyAssigned) {
                profiles.writeLastAssignedGroup(player.getUniqueId(), effective.id);
                if (!effective.containsWorld(currentWorldName)) {
                    String groupScope = "group_" + RealmsConfig.sanitizeKey(effective.id);
                    Location saved = profiles.loadSavedLocation(player.getUniqueId(), groupScope, worlds);
                    if (saved != null && saved.getWorld() != null && effective.containsWorld(saved.getWorld().getName())) {
                        routeTarget = saved;
                    } else {
                        World ow = worlds.getWorld(effective.overworld);
                        if (ow != null) routeTarget = ow.getSpawnLocation();
                    }
                }
            } else if (!player.hasPlayedBefore() && !effective.containsWorld(currentWorldName)) {
                World ow = worlds.getWorld(effective.overworld);
                if (ow != null) routeTarget = ow.getSpawnLocation();
            }
        } else {
            // Player inherits the default world's group list
            if (!effective.id.equalsIgnoreCase(lastAssigned)) {
                profiles.writeLastAssignedGroup(player.getUniqueId(), effective.id);
            }
            World defaultW = worlds.getWorld(cfg.defaultJoinWorld);
            if (defaultW == null) {
                defaultW = worlds.getWorld(effective.overworld);
            }
            if (defaultW != null && !defaultW.getName().equalsIgnoreCase(currentWorldName)) {
                List<RealmsConfig.WorldGroup> currentGroups = cfg.findGroupsContainingWorld(currentWorldName);
                boolean inDifferentGroup = !currentGroups.isEmpty() && !effective.containsWorld(currentWorldName);
                if (!player.hasPlayedBefore() || cfg.forceDefaultJoinForUnassigned || inDifferentGroup) {
                    routeTarget = defaultW.getSpawnLocation();
                }
            }
        }

        final Location finalTarget = routeTarget;
        FoliaCompat.runForEntity(plugin, player, new Runnable() {
            @Override
            public void run() {
                if (!player.isOnline()) return;
                if (finalTarget != null && finalTarget.getWorld() != null) {
                    FoliaCompat.teleportSafe(player, finalTarget);
                }
                applyDefaultGameMode(player, plugin.getRealmsConfig());
                refreshVisibilityForAll();
                pluginScope.refreshPlayerCommands(player);
            }
        }, 1L);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerChangedWorld(PlayerChangedWorldEvent event) {
        final Player player = event.getPlayer();
        final RealmsConfig cfg = plugin.getRealmsConfig();
        if (player == null || !cfg.enabled) return;

        profiles.handleWorldChange(player, event.getFrom(), player.getWorld(), cfg);
        FoliaCompat.runForEntity(plugin, player, new Runnable() {
            @Override
            public void run() {
                if (!player.isOnline()) return;
                applyDefaultGameMode(player, plugin.getRealmsConfig());
                refreshVisibilityForAll();
                pluginScope.refreshPlayerCommands(player);
            }
        }, 1L);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        if (player != null) {
            profiles.saveCurrentProfile(player, plugin.getRealmsConfig());
            profiles.setActiveScope(player.getUniqueId(), null);
            if (tpaManager != null) {
                tpaManager.clearPlayerRequests(player.getUniqueId());
            }
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPlayerDeath(PlayerDeathEvent event) {
        Player player = event.getEntity();
        if (player == null) return;
        Location loc = player.getLocation();
        if (loc != null && loc.getWorld() != null) {
            profiles.saveBackLocation(player.getUniqueId(), loc, "death");
            RealmsConfig cfg = plugin.getRealmsConfig();
            if (cfg != null && cfg.backEnabled) {
                player.sendMessage("\u00A77Death location saved. Use \u00A7b/back \u00A77to return.");
            }
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlayerTeleport(PlayerTeleportEvent event) {
        Player player = event.getPlayer();
        Location from = event.getFrom();
        Location to = event.getTo();
        if (player == null || from == null || from.getWorld() == null) return;

        PlayerTeleportEvent.TeleportCause cause = event.getCause();
        String causeName = cause != null ? cause.name() : "";
        if ("DISMOUNT".equals(causeName)
                || "EXIT_BED".equals(causeName)
                || "ENDER_PEARL".equals(causeName)
                || "CHORUS_FRUIT".equals(causeName)) {
            return;
        }

        boolean differentWorld = to == null || to.getWorld() == null
                || !from.getWorld().getName().equalsIgnoreCase(to.getWorld().getName());
        if (!differentWorld && from.distanceSquared(to) < 9.0) {
            return;
        }

        profiles.saveBackLocation(player.getUniqueId(), from, "teleport");
    }

    @EventHandler(priority = EventPriority.LOW)
    public void onPlayerRespawn(PlayerRespawnEvent event) {
        RealmsConfig cfg = plugin.getRealmsConfig();
        if (!cfg.enabled) return;
        Player player = event.getPlayer();
        if (player == null || player.getWorld() == null) return;

        String deathWorldName = player.getWorld().getName();
        RealmsConfig.SeparationOptions sep = cfg.getEffectiveSeparation(deathWorldName);
        if (!sep.portalsAndRespawn) return;

        List<RealmsConfig.WorldGroup> groups = cfg.findGroupsContainingWorld(deathWorldName);
        if (!groups.isEmpty()) {
            RealmsConfig.WorldGroup group = null;
            RealmsConfig.WorldGroup playerGroup = cfg.findGroupForPlayer(player);
            if (playerGroup != null) {
                for (RealmsConfig.WorldGroup g : groups) {
                    if (g.id.equalsIgnoreCase(playerGroup.id)) {
                        group = g;
                        break;
                    }
                }
            }
            if (group == null) group = groups.get(0);

            Location currentRespawn = event.getRespawnLocation();
            boolean validBedOrAnchor = (event.isBedSpawn() || isAnchorSpawnReflective(event))
                && currentRespawn != null
                && currentRespawn.getWorld() != null
                && group.containsWorld(currentRespawn.getWorld().getName());
            if (validBedOrAnchor) return;

            World ow = worlds.getWorld(group.overworld);
            if (ow != null) {
                event.setRespawnLocation(ow.getSpawnLocation());
            }
            return;
        }

        // Standalone world with portalsAndRespawn separation enabled: respawn within the same standalone world
        Location currentRespawn = event.getRespawnLocation();
        boolean validBedOrAnchor = (event.isBedSpawn() || isAnchorSpawnReflective(event))
            && currentRespawn != null
            && currentRespawn.getWorld() != null
            && currentRespawn.getWorld().getName().equalsIgnoreCase(deathWorldName);
        if (!validBedOrAnchor) {
            event.setRespawnLocation(player.getWorld().getSpawnLocation());
        }
    }

    /**
     * Invoked via BukkitCompat.registerChatListener (supports AsyncPlayerChatEvent on 1.3.1+ and PlayerChatEvent on 1.2.5).
     */
    public void handleChatRecipients(Player sender, Collection<Player> recipients) {
        RealmsConfig cfg = plugin.getRealmsConfig();
        if (!cfg.enabled) return;
        if (sender == null || sender.getWorld() == null || recipients == null) return;

        String senderWorld = sender.getWorld().getName();
        Iterator<Player> it = recipients.iterator();
        while (it.hasNext()) {
            Player recipient = it.next();
            if (recipient == null || recipient == sender) continue;
            String recipientWorld = recipient.getWorld() != null ? recipient.getWorld().getName() : "";
            if (!cfg.canPlayersInteractInScope(senderWorld, recipientWorld, false)) {
                it.remove();
            }
        }
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onPlayerPortal(PlayerPortalEvent event) {
        portals.handlePlayerPortal(event, plugin.getRealmsConfig());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPortalCreate(PortalCreateEvent event) {
        portals.handlePortalCreate(event, plugin.getRealmsConfig());
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onPlayerCommand(PlayerCommandPreprocessEvent event) {
        pluginScope.handleCommandPreprocess(event);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onPluginEnable(PluginEnableEvent event) {
        if (event.getPlugin() != null && !"MCServerManagerBridge".equalsIgnoreCase(event.getPlugin().getName())) {
            FoliaCompat.runGlobalDelayed(plugin, new Runnable() {
                @Override
                public void run() {
                    pluginScope.syncAllListeners();
                }
            }, 1L);
        }
    }

    public void applyDefaultGameMode(Player player, RealmsConfig cfg) {
        if (player == null || player.getWorld() == null || !cfg.enabled) return;
        String gm = cfg.getDefaultGameModeForWorld(player.getWorld().getName());
        if (gm == null || gm.isEmpty()) return;
        try {
            GameMode target = GameMode.valueOf(gm);
            if (player.getGameMode() != target) {
                player.setGameMode(target);
            }
        } catch (IllegalArgumentException ignored) {}
    }

    public void refreshVisibilityForAll() {
        RealmsConfig cfg = plugin.getRealmsConfig();
        List<Player> online = BukkitCompat.getOnlinePlayers();
        for (Player viewer : online) {
            String wA = viewer.getWorld() != null ? viewer.getWorld().getName() : "";
            for (Player target : online) {
                if (viewer == target) continue;
                String wB = target.getWorld() != null ? target.getWorld().getName() : "";
                boolean visible = !cfg.enabled || cfg.canPlayersInteractInScope(wA, wB, true);
                if (visible) {
                    BukkitCompat.showPlayer(viewer, plugin, target);
                } else {
                    BukkitCompat.hidePlayer(viewer, plugin, target);
                }
            }
        }
    }

    public void showAllPlayersToEveryone() {
        List<Player> online = BukkitCompat.getOnlinePlayers();
        for (Player viewer : online) {
            for (Player target : online) {
                if (viewer == target) continue;
                BukkitCompat.showPlayer(viewer, plugin, target);
            }
        }
    }

    private static boolean isAnchorSpawnReflective(PlayerRespawnEvent event) {
        try {
            Method m = event.getClass().getMethod("isAnchorSpawn");
            Object res = m.invoke(event);
            return Boolean.TRUE.equals(res);
        } catch (Throwable ignored) {
            return false;
        }
    }
}
