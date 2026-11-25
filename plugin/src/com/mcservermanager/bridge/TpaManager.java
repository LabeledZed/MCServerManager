package com.mcservermanager.bridge;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.PluginIdentifiableCommand;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;

/**
 * Handles /tpa, /tpahere, /tpahereall [list|friendly|everyone], /tpaccept, /tpdeny, /tpcancel,
 * and persistent /back with per-list teleport permission enforcement, clickable chat buttons,
 * request sound, teleport particles, and expiration notifications.
 */
public final class TpaManager implements CommandExecutor {

    public static final class TpaRequest {
        public final UUID senderId;
        public final String senderName;
        public final UUID targetId;
        public final String targetName;
        public final boolean here;
        public final long expiresAt;

        public TpaRequest(UUID senderId, String senderName, UUID targetId, String targetName, boolean here, long expiresAt) {
            this.senderId = senderId;
            this.senderName = senderName;
            this.targetId = targetId;
            this.targetName = targetName;
            this.here = here;
            this.expiresAt = expiresAt;
        }
    }

    private final MCServerManagerBridgePlugin plugin;
    private final WorldController worlds;
    private final PlayerProfileManager profiles;

    // target UUID -> incoming requests (ordered oldest -> newest)
    private final Map<UUID, List<TpaRequest>> incomingByTarget = new ConcurrentHashMap<>();
    private final List<DynamicBridgeCommand> registeredTpaCommands = new ArrayList<>();
    private DynamicBridgeCommand registeredBackCommand = null;
    private Object expirationTaskHandle = null;

    // Cached reflection handles for sound & particles across MC 1.13 - 26.3+
    private boolean effectsInitialized = false;
    private Object pickupSoundObj;
    private Method playSoundEnumMethod;
    private Method playSoundStringMethod;
    private Object explosionParticleObj;
    private Method spawnParticleMethod;

    public TpaManager(MCServerManagerBridgePlugin plugin, WorldController worlds, PlayerProfileManager profiles) {
        this.plugin = plugin;
        this.worlds = worlds;
        this.profiles = profiles;
    }

    public void startExpirationTask() {
        stopExpirationTask();
        expirationTaskHandle = FoliaCompat.runGlobalTimer(plugin, new Runnable() {
            @Override
            public void run() {
                checkExpiredRequests();
            }
        }, 20L, 20L);
    }

    public void stopExpirationTask() {
        if (expirationTaskHandle != null) {
            FoliaCompat.cancelTask(expirationTaskHandle);
            expirationTaskHandle = null;
        }
    }

    /**
     * Dynamically registers or unregisters built-in TPA and /back commands in Bukkit's CommandMap
     * based on realms.json so disabling them leaves zero command conflicts with third-party TPA plugins.
     */
    public synchronized void syncCommandRegistration(RealmsConfig cfg) {
        boolean wantTpa = cfg != null && cfg.tpaEnabled;
        boolean wantBack = cfg != null && cfg.backEnabled;
        boolean changed = false;

        if (wantTpa && registeredTpaCommands.isEmpty()) {
            registerDynamic(new DynamicBridgeCommand("tpa", "Request to teleport to another player.", "/tpa <player>", Collections.<String>emptyList(), plugin, this), registeredTpaCommands);
            registerDynamic(new DynamicBridgeCommand("tpahere", "Request another player to teleport to you.", "/tpahere <player>", Collections.<String>emptyList(), plugin, this), registeredTpaCommands);
            registerDynamic(new DynamicBridgeCommand("tpahereall", "Request players in your list, friendly lists, or everyone to teleport to you.", "/tpahereall [list|friendly|everyone]", Collections.<String>emptyList(), plugin, this), registeredTpaCommands);
            registerDynamic(new DynamicBridgeCommand("tpaccept", "Accept a pending teleport request.", "/tpaccept [player]", Arrays.asList("tpyes"), plugin, this), registeredTpaCommands);
            registerDynamic(new DynamicBridgeCommand("tpdeny", "Deny a pending teleport request.", "/tpdeny [player]", Arrays.asList("tpno"), plugin, this), registeredTpaCommands);
            registerDynamic(new DynamicBridgeCommand("tpcancel", "Cancel your outgoing teleport request(s).", "/tpcancel [player]", Collections.<String>emptyList(), plugin, this), registeredTpaCommands);
            changed = true;
        } else if (!wantTpa && !registeredTpaCommands.isEmpty()) {
            unregisterDynamicList(registeredTpaCommands);
            registeredTpaCommands.clear();
            incomingByTarget.clear();
            changed = true;
        }

        if (wantBack && registeredBackCommand == null) {
            List<DynamicBridgeCommand> tmp = new ArrayList<>();
            registerDynamic(new DynamicBridgeCommand("back", "Return to your previous teleport or most recent death location.", "/back", Collections.<String>emptyList(), plugin, this), tmp);
            if (!tmp.isEmpty()) {
                registeredBackCommand = tmp.get(0);
                changed = true;
            }
        } else if (!wantBack && registeredBackCommand != null) {
            unregisterDynamicList(Collections.singletonList(registeredBackCommand));
            registeredBackCommand = null;
            changed = true;
        }

        if (changed) {
            syncServerCommandsReflective();
        }
    }

    public synchronized void unregisterAllCommands() {
        boolean changed = false;
        if (!registeredTpaCommands.isEmpty()) {
            unregisterDynamicList(registeredTpaCommands);
            registeredTpaCommands.clear();
            changed = true;
        }
        if (registeredBackCommand != null) {
            unregisterDynamicList(Collections.singletonList(registeredBackCommand));
            registeredBackCommand = null;
            changed = true;
        }
        if (changed) {
            syncServerCommandsReflective();
        }
    }

    private void registerDynamic(DynamicBridgeCommand cmd, List<DynamicBridgeCommand> bucket) {
        Object cmdMap = getCommandMapReflective();
        if (cmdMap == null) return;
        try {
            Method registerMethod = cmdMap.getClass().getMethod("register", String.class, Command.class);
            registerMethod.invoke(cmdMap, "mcservermanagerbridge", cmd);
            bucket.add(cmd);
        } catch (Throwable ex) {
            plugin.getLogger().warning("[TPA] Failed to register /" + cmd.getName() + ": " + ex.getMessage());
        }
    }

    @SuppressWarnings("unchecked")
    private void unregisterDynamicList(List<DynamicBridgeCommand> commands) {
        Object cmdMap = getCommandMapReflective();
        if (cmdMap == null) return;
        try {
            Map<String, Command> known = getKnownCommandsReflective(cmdMap);
            if (known != null) {
                List<String> keysToRemove = new ArrayList<>();
                for (Map.Entry<String, Command> entry : known.entrySet()) {
                    Command val = entry.getValue();
                    for (DynamicBridgeCommand ours : commands) {
                        if (val == ours) {
                            keysToRemove.add(entry.getKey());
                            break;
                        }
                    }
                }
                for (String k : keysToRemove) {
                    try {
                        known.remove(k);
                    } catch (UnsupportedOperationException ignored) {
                        break;
                    }
                }
            }
            Class<?> cmdMapCls = Class.forName("org.bukkit.command.CommandMap");
            Method unreg = Command.class.getMethod("unregister", cmdMapCls);
            for (DynamicBridgeCommand ours : commands) {
                try { unreg.invoke(ours, cmdMap); } catch (Throwable ignored) {}
            }
        } catch (Throwable ex) {
            plugin.getLogger().warning("[TPA] Failed to unregister commands: " + ex.getMessage());
        }
    }

    private Object getCommandMapReflective() {
        try {
            Method m = Bukkit.getServer().getClass().getMethod("getCommandMap");
            Object map = m.invoke(Bukkit.getServer());
            if (map != null) return map;
        } catch (Throwable ignored) {}
        try {
            PluginManager pm = Bukkit.getPluginManager();
            Field f = pm.getClass().getDeclaredField("commandMap");
            f.setAccessible(true);
            return f.get(pm);
        } catch (Throwable ignored) {}
        return null;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Command> getKnownCommandsReflective(Object cmdMap) {
        try {
            Method m = cmdMap.getClass().getMethod("getKnownCommands");
            Object res = m.invoke(cmdMap);
            if (res instanceof Map) return (Map<String, Command>) res;
        } catch (Throwable ignored) {}
        Class<?> cls = cmdMap.getClass();
        while (cls != null) {
            try {
                Field f = cls.getDeclaredField("knownCommands");
                f.setAccessible(true);
                Object res = f.get(cmdMap);
                if (res instanceof Map) return (Map<String, Command>) res;
            } catch (Throwable ignored) {}
            cls = cls.getSuperclass();
        }
        return null;
    }

    private void syncServerCommandsReflective() {
        try {
            Method m = Bukkit.getServer().getClass().getMethod("syncCommands");
            m.invoke(Bukkit.getServer());
        } catch (Throwable ignored) {}
        for (Player p : BukkitCompat.getOnlinePlayers()) {
            try {
                p.getClass().getMethod("updateCommands").invoke(p);
            } catch (Throwable ignored) {}
        }
    }

    private static final class DynamicBridgeCommand extends Command implements PluginIdentifiableCommand {
        private final Plugin owner;
        private final TpaManager handler;

        DynamicBridgeCommand(String name, String description, String usage, List<String> aliases, Plugin owner, TpaManager handler) {
            super(name, description, usage, aliases);
            this.owner = owner;
            this.handler = handler;
        }

        @Override
        public Plugin getPlugin() {
            return owner;
        }

        @Override
        public boolean execute(CommandSender sender, String commandLabel, String[] args) {
            return handler.onCommand(sender, this, commandLabel, args);
        }

        @Override
        public List<String> tabComplete(CommandSender sender, String alias, String[] args) {
            return handler.onTabComplete(sender, this, alias, args);
        }
    }

    private void checkExpiredRequests() {
        if (incomingByTarget.isEmpty()) return;
        long now = System.currentTimeMillis();
        for (Map.Entry<UUID, List<TpaRequest>> entry : incomingByTarget.entrySet()) {
            List<TpaRequest> list = entry.getValue();
            List<TpaRequest> expired = null;
            synchronized (list) {
                Iterator<TpaRequest> it = list.iterator();
                while (it.hasNext()) {
                    TpaRequest r = it.next();
                    if (r.expiresAt <= now) {
                        it.remove();
                        if (expired == null) expired = new ArrayList<>();
                        expired.add(r);
                    }
                }
            }
            if (expired != null) {
                for (TpaRequest r : expired) {
                    Player sender = findOnlinePlayerByUuid(r.senderId);
                    if (sender != null && sender.isOnline()) {
                        sender.sendMessage("\u00A7eYour teleport request to \u00A7f" + r.targetName + " \u00A7ehas expired.");
                    }
                    Player target = findOnlinePlayerByUuid(r.targetId);
                    if (target != null && target.isOnline()) {
                        target.sendMessage("\u00A77Teleport request from \u00A7f" + r.senderName + " \u00A77has expired.");
                    }
                }
            }
        }
    }

    public void clearPlayerRequests(UUID uuid) {
        if (uuid == null) return;
        incomingByTarget.remove(uuid);
        for (List<TpaRequest> list : incomingByTarget.values()) {
            synchronized (list) {
                list.removeIf(r -> r.senderId.equals(uuid) || r.targetId.equals(uuid));
            }
        }
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player)) {
            sender.sendMessage("\u00A7cOnly players can use /" + command.getName() + ".");
            return true;
        }

        Player player = (Player) sender;
        String cmd = command.getName().toLowerCase(Locale.ROOT);
        RealmsConfig cfg = plugin.getRealmsConfig();

        if ("back".equals(cmd)) {
            handleBack(player, cfg);
            return true;
        }

        if (!cfg.tpaEnabled) {
            player.sendMessage("\u00A7cTeleport requests (/tpa) are currently disabled on this server.");
            return true;
        }

        switch (cmd) {
            case "tpa":
                handleSingleRequest(player, args, false, cfg);
                return true;
            case "tpahere":
                handleSingleRequest(player, args, true, cfg);
                return true;
            case "tpahereall":
                handleTpaHereAll(player, args, cfg);
                return true;
            case "tpaccept":
                handleAcceptOrDeny(player, args, true);
                return true;
            case "tpdeny":
                handleAcceptOrDeny(player, args, false);
                return true;
            case "tpcancel":
                handleCancel(player, args);
                return true;
            default:
                return false;
        }
    }

    private void handleSingleRequest(Player sender, String[] args, boolean here, RealmsConfig cfg) {
        if (args.length < 1) {
            sender.sendMessage("\u00A7cUsage: /" + (here ? "tpahere" : "tpa") + " <player>");
            return;
        }

        Player target = findOnlinePlayer(args[0]);
        if (target == null) {
            sender.sendMessage("\u00A7cPlayer not found online: " + args[0]);
            return;
        }
        if (target.getUniqueId().equals(sender.getUniqueId())) {
            sender.sendMessage("\u00A7cYou cannot send a teleport request to yourself.");
            return;
        }

        RealmsConfig.WorldGroup senderGroup = cfg.findGroupForPlayer(sender);
        RealmsConfig.WorldGroup targetGroup = cfg.findGroupForPlayer(target);
        if (!cfg.canGroupsExchangeTpa(senderGroup, targetGroup)) {
            String sName = senderGroup != null ? senderGroup.name : "your list";
            String tName = targetGroup != null ? targetGroup.name : "that list";
            sender.sendMessage("\u00A7cYour list (\u00A7f" + sName + "\u00A7c) does not have permission to exchange teleport requests with \u00A7f" + tName + "\u00A7c.");
            return;
        }

        int timeoutSec = Math.max(10, Math.min(300, cfg.tpaTimeoutSeconds));
        enqueueRequest(sender, target, here, timeoutSec);

        if (here) {
            sender.sendMessage("\u00A7aSent teleport-here request to \u00A7f" + target.getName() + "\u00A7a. \u00A78(Expires in " + timeoutSec + "s)");
            sendIncomingRequestPrompt(target, sender.getName(), "\u00A7b" + sender.getName() + " \u00A77wants you to teleport to them.", timeoutSec);
        } else {
            sender.sendMessage("\u00A7aSent teleport request to \u00A7f" + target.getName() + "\u00A7a. \u00A78(Expires in " + timeoutSec + "s)");
            sendIncomingRequestPrompt(target, sender.getName(), "\u00A7b" + sender.getName() + " \u00A77wants to teleport to you.", timeoutSec);
        }
    }

    private void handleTpaHereAll(Player sender, String[] args, RealmsConfig cfg) {
        String scope = args.length > 0 ? args[0].trim().toLowerCase(Locale.ROOT) : "list";
        if (!"list".equals(scope) && !"friendly".equals(scope) && !"everyone".equals(scope)) {
            sender.sendMessage("\u00A7cUsage: /tpahereall [list|friendly|everyone] \u00A77(default: list)");
            return;
        }

        RealmsConfig.WorldGroup senderGroup = cfg.findGroupForPlayer(sender);
        int timeoutSec = Math.max(10, Math.min(300, cfg.tpaTimeoutSeconds));
        int sentCount = 0;

        for (Player target : BukkitCompat.getOnlinePlayers()) {
            if (target == null || target.getUniqueId().equals(sender.getUniqueId())) continue;
            RealmsConfig.WorldGroup targetGroup = cfg.findGroupForPlayer(target);

            boolean eligible;
            if ("everyone".equals(scope)) {
                eligible = true;
            } else if ("friendly".equals(scope)) {
                eligible = cfg.canGroupsExchangeTpa(senderGroup, targetGroup);
            } else {
                // "list" (default): players in the sender's own list
                eligible = senderGroup != null && targetGroup != null
                    && senderGroup.id.equalsIgnoreCase(targetGroup.id);
            }

            if (!eligible) continue;

            enqueueRequest(sender, target, true, timeoutSec);
            sendIncomingRequestPrompt(
                target,
                sender.getName(),
                "\u00A7b" + sender.getName() + " \u00A77invited you to teleport to them (\u00A7f/tpahereall " + scope + "\u00A77).",
                timeoutSec
            );
            sentCount++;
        }

        if (sentCount == 0) {
            sender.sendMessage("\u00A7eNo eligible online players found for /tpahereall " + scope + ".");
        } else {
            sender.sendMessage("\u00A7aSent teleport-here requests to \u00A7f" + sentCount + " \u00A7aplayer" + (sentCount == 1 ? "" : "s") + " \u00A78(scope: " + scope + ", expires in " + timeoutSec + "s)");
        }
    }

    private void handleAcceptOrDeny(Player receiver, String[] args, boolean accept) {
        List<TpaRequest> list = incomingByTarget.get(receiver.getUniqueId());
        if (list == null) {
            receiver.sendMessage("\u00A7cYou have no pending teleport requests.");
            return;
        }

        long now = System.currentTimeMillis();
        TpaRequest matched = null;
        String filterName = args.length > 0 ? args[0].trim() : null;

        synchronized (list) {
            list.removeIf(r -> r.expiresAt <= now);
            if (filterName != null && !filterName.isEmpty()) {
                for (int i = list.size() - 1; i >= 0; i--) {
                    if (list.get(i).senderName.equalsIgnoreCase(filterName)) {
                        matched = list.remove(i);
                        break;
                    }
                }
            } else if (!list.isEmpty()) {
                matched = list.remove(list.size() - 1);
            }
        }

        if (matched == null) {
            receiver.sendMessage(
                filterName != null
                    ? "\u00A7cNo active teleport request from " + filterName + "."
                    : "\u00A7cYou have no pending teleport requests."
            );
            return;
        }

        Player requester = findOnlinePlayerByUuid(matched.senderId);
        if (!accept) {
            receiver.sendMessage("\u00A7eDenied teleport request from \u00A7f" + matched.senderName + "\u00A7e.");
            if (requester != null) {
                requester.sendMessage("\u00A7c" + receiver.getName() + " denied your teleport request.");
            }
            return;
        }

        if (requester == null || !requester.isOnline()) {
            receiver.sendMessage("\u00A7c" + matched.senderName + " is no longer online.");
            return;
        }

        if (matched.here) {
            Location from = receiver.getLocation();
            Location dest = requester.getLocation();
            spawnTeleportParticles(from);
            FoliaCompat.teleportSafe(receiver, dest);
            spawnTeleportParticles(dest);
            receiver.sendMessage("\u00A7aTeleporting you to \u00A7f" + requester.getName() + "\u00A7a.");
            requester.sendMessage("\u00A7a" + receiver.getName() + " accepted your request and is teleporting to you.");
        } else {
            Location from = requester.getLocation();
            Location dest = receiver.getLocation();
            spawnTeleportParticles(from);
            FoliaCompat.teleportSafe(requester, dest);
            spawnTeleportParticles(dest);
            requester.sendMessage("\u00A7a" + receiver.getName() + " accepted! Teleporting you now.");
            receiver.sendMessage("\u00A7aAccepted teleport request from \u00A7f" + requester.getName() + "\u00A7a.");
        }
    }

    private void handleCancel(Player sender, String[] args) {
        String targetFilter = args.length > 0 ? args[0].trim() : null;
        int cancelled = 0;
        long now = System.currentTimeMillis();

        for (List<TpaRequest> list : incomingByTarget.values()) {
            synchronized (list) {
                Iterator<TpaRequest> it = list.iterator();
                while (it.hasNext()) {
                    TpaRequest r = it.next();
                    if (r.expiresAt <= now) {
                        it.remove();
                        continue;
                    }
                    if (!r.senderId.equals(sender.getUniqueId())) continue;
                    if (targetFilter != null && !targetFilter.isEmpty() && !r.targetName.equalsIgnoreCase(targetFilter)) {
                        continue;
                    }
                    it.remove();
                    cancelled++;
                    Player target = findOnlinePlayerByUuid(r.targetId);
                    if (target != null) {
                        target.sendMessage("\u00A7e" + sender.getName() + " cancelled their teleport request.");
                    }
                }
            }
        }

        if (cancelled == 0) {
            sender.sendMessage("\u00A7eYou have no active outgoing teleport requests to cancel.");
        } else {
            sender.sendMessage("\u00A7aCancelled \u00A7f" + cancelled + " \u00A7aoutgoing teleport request" + (cancelled == 1 ? "" : "s") + ".");
        }
    }

    private void handleBack(Player player, RealmsConfig cfg) {
        if (!cfg.backEnabled) {
            player.sendMessage("\u00A7c/back is currently disabled on this server.");
            return;
        }
        PlayerProfileManager.BackLocation back = profiles.loadBackLocation(player.getUniqueId());
        if (back == null) {
            player.sendMessage("\u00A7cNo previous teleport or death location saved yet.");
            return;
        }
        World targetWorld = worlds.getWorld(back.world);
        if (targetWorld == null) {
            player.sendMessage("\u00A7cCannot return: world '" + back.world + "' is not currently loaded.");
            return;
        }

        if (cfg.enabled) {
            RealmsConfig.WorldGroup playerGroup = cfg.findGroupForPlayer(player);
            List<RealmsConfig.WorldGroup> targetGroups = cfg.findGroupsContainingWorld(targetWorld.getName());
            if (playerGroup != null && !targetGroups.isEmpty()) {
                boolean allowed = false;
                for (RealmsConfig.WorldGroup tg : targetGroups) {
                    if (playerGroup.id.equalsIgnoreCase(tg.id) || cfg.canGroupsExchangeTpa(playerGroup, tg)) {
                        allowed = true;
                        break;
                    }
                }
                if (!allowed) {
                    player.sendMessage(
                        "\u00A7cCannot return to '" + targetWorld.getName()
                            + "': your current list does not have access to that realm."
                    );
                    return;
                }
            }
        }

        Location from = player.getLocation();
        Location dest = new Location(targetWorld, back.x, back.y, back.z, back.yaw, back.pitch);
        spawnTeleportParticles(from);
        FoliaCompat.teleportSafe(player, dest);
        spawnTeleportParticles(dest);
        String kind = "death".equalsIgnoreCase(back.reason) ? "death" : "teleport";
        player.sendMessage(
            "\u00A7aReturned to your previous " + kind + " location (\u00A7f" + targetWorld.getName()
                + " " + Math.round(back.x) + ", " + Math.round(back.y) + ", " + Math.round(back.z) + "\u00A7a)."
        );
    }

    private void enqueueRequest(Player sender, Player target, boolean here, int timeoutSec) {
        long now = System.currentTimeMillis();
        long expiresAt = now + (timeoutSec * 1000L);
        List<TpaRequest> list = incomingByTarget.computeIfAbsent(
            target.getUniqueId(),
            k -> new ArrayList<TpaRequest>()
        );
        synchronized (list) {
            list.removeIf(r -> r.expiresAt <= now || r.senderId.equals(sender.getUniqueId()));
            list.add(new TpaRequest(sender.getUniqueId(), sender.getName(), target.getUniqueId(), target.getName(), here, expiresAt));
        }
    }

    private static Player findOnlinePlayer(String name) {
        Player exact = Bukkit.getPlayerExact(name);
        if (exact != null) return exact;
        for (Player p : BukkitCompat.getOnlinePlayers()) {
            if (p.getName().equalsIgnoreCase(name)) return p;
        }
        return null;
    }

    private static Player findOnlinePlayerByUuid(UUID uuid) {
        for (Player p : BukkitCompat.getOnlinePlayers()) {
            if (p.getUniqueId().equals(uuid)) return p;
        }
        return null;
    }

    /**
     * Plays ENTITY_EXPERIENCE_ORB_PICKUP (volume 3.0, pitch 0.533) and sends clickable
     * [Accept] (/tpyes) and [Decline] (/tpno) chat buttons to the recipient.
     */
    private void sendIncomingRequestPrompt(Player target, String senderName, String headerLine, int timeoutSec) {
        playRequestSound(target);
        target.sendMessage(headerLine);

        String acceptCmd = "/tpyes " + senderName;
        String declineCmd = "/tpno " + senderName;

        if (sendClickableButtonsViaAdventure(target, acceptCmd, declineCmd, timeoutSec)) {
            return;
        }
        if (sendClickableButtonsViaBungee(target, acceptCmd, declineCmd, timeoutSec)) {
            return;
        }
        target.sendMessage("\u00A7a[Accept: " + acceptCmd + "]  \u00A7c[Decline: " + declineCmd + "] \u00A78(" + timeoutSec + "s)");
    }

    private boolean sendClickableButtonsViaAdventure(Player target, String acceptCmd, String declineCmd, int timeoutSec) {
        try {
            Class<?> gsonSerCls = Class.forName("net.kyori.adventure.text.serializer.gson.GsonComponentSerializer");
            Object gson = gsonSerCls.getMethod("gson").invoke(null);
            Class<?> compCls = Class.forName("net.kyori.adventure.text.Component");
            Method deserialize = gsonSerCls.getMethod("deserialize", String.class);
            Method sendMsg = target.getClass().getMethod("sendMessage", compCls);

            String json = buildButtonsJson(acceptCmd, declineCmd, timeoutSec);
            Object component = deserialize.invoke(gson, json);
            if (component != null) {
                sendMsg.invoke(target, component);
                return true;
            }
        } catch (Throwable ignored) {}
        return false;
    }

    private boolean sendClickableButtonsViaBungee(Player target, String acceptCmd, String declineCmd, int timeoutSec) {
        try {
            Class<?> textCompCls = Class.forName("net.md_5.bungee.api.chat.TextComponent");
            Class<?> baseCompCls = Class.forName("net.md_5.bungee.api.chat.BaseComponent");
            Class<?> clickEvtCls = Class.forName("net.md_5.bungee.api.chat.ClickEvent");
            Class<?> clickActionCls = Class.forName("net.md_5.bungee.api.chat.ClickEvent$Action");

            @SuppressWarnings("unchecked")
            Object runCommand = Enum.valueOf(clickActionCls.asSubclass(Enum.class), "RUN_COMMAND");
            Constructor<?> textCtor = textCompCls.getConstructor(String.class);
            Constructor<?> clickCtor = clickEvtCls.getConstructor(clickActionCls, String.class);
            Method setClick = textCompCls.getMethod("setClickEvent", clickEvtCls);
            Method addExtra = textCompCls.getMethod("addExtra", baseCompCls);

            Object root = textCtor.newInstance("  ");
            Object acceptBtn = textCtor.newInstance("\u00A7a\u00A7l[Accept]");
            setClick.invoke(acceptBtn, clickCtor.newInstance(runCommand, acceptCmd));
            Object spacer = textCtor.newInstance("   ");
            Object declineBtn = textCtor.newInstance("\u00A7c\u00A7l[Decline]");
            setClick.invoke(declineBtn, clickCtor.newInstance(runCommand, declineCmd));
            Object suffix = textCtor.newInstance(" \u00A78(" + timeoutSec + "s)");

            addExtra.invoke(root, acceptBtn);
            addExtra.invoke(root, spacer);
            addExtra.invoke(root, declineBtn);
            addExtra.invoke(root, suffix);

            Object spigot = target.getClass().getMethod("spigot").invoke(target);
            spigot.getClass().getMethod("sendMessage", baseCompCls).invoke(spigot, root);
            return true;
        } catch (Throwable ignored) {}
        return false;
    }

    private static String buildButtonsJson(String acceptCmd, String declineCmd, int timeoutSec) {
        return "{\"text\":\"  \",\"extra\":["
            + "{\"text\":\"[Accept]\",\"color\":\"green\",\"bold\":true,"
            + "\"clickEvent\":{\"action\":\"run_command\",\"value\":" + JsonUtil.quote(acceptCmd) + "},"
            + "\"hoverEvent\":{\"action\":\"show_text\",\"contents\":{\"text\":" + JsonUtil.quote("Click to run " + acceptCmd) + ",\"color\":\"green\"}}},"
            + "{\"text\":\"   \",\"bold\":false},"
            + "{\"text\":\"[Decline]\",\"color\":\"red\",\"bold\":true,"
            + "\"clickEvent\":{\"action\":\"run_command\",\"value\":" + JsonUtil.quote(declineCmd) + "},"
            + "\"hoverEvent\":{\"action\":\"show_text\",\"contents\":{\"text\":" + JsonUtil.quote("Click to run " + declineCmd) + ",\"color\":\"red\"}}},"
            + "{\"text\":\" (" + timeoutSec + "s)\",\"color\":\"dark_gray\",\"bold\":false}"
            + "]}";
    }

    private void ensureEffectsReflection() {
        if (effectsInitialized) return;
        effectsInitialized = true;

        // Sound: ENTITY_EXPERIENCE_ORB_PICKUP (1.9-26.3+) or ORB_PICKUP (1.4-1.8.8)
        try {
            Class<?> soundCls = Class.forName("org.bukkit.Sound");
            Field f = null;
            try {
                f = soundCls.getField("ENTITY_EXPERIENCE_ORB_PICKUP");
            } catch (NoSuchFieldException ignored) {
                try {
                    f = soundCls.getField("ORB_PICKUP");
                } catch (NoSuchFieldException ignored2) {}
            }
            if (f != null) {
                pickupSoundObj = f.get(null);
                playSoundEnumMethod = Player.class.getMethod("playSound", Location.class, soundCls, float.class, float.class);
            }
        } catch (Throwable ignored) {}
        try {
            playSoundStringMethod = Player.class.getMethod("playSound", Location.class, String.class, float.class, float.class);
        } catch (Throwable ignored) {}

        // Particle: EXPLOSION_NORMAL (renamed to POOF in MC 1.20.5-26.3+)
        try {
            Class<?> particleCls = Class.forName("org.bukkit.Particle");
            try {
                @SuppressWarnings("unchecked")
                Object p = Enum.valueOf(particleCls.asSubclass(Enum.class), "EXPLOSION_NORMAL");
                explosionParticleObj = p;
            } catch (IllegalArgumentException ignored) {
                @SuppressWarnings("unchecked")
                Object p = Enum.valueOf(particleCls.asSubclass(Enum.class), "POOF");
                explosionParticleObj = p;
            }
            spawnParticleMethod = World.class.getMethod(
                "spawnParticle",
                particleCls,
                double.class,
                double.class,
                double.class,
                int.class,
                double.class,
                double.class,
                double.class,
                double.class
            );
        } catch (Throwable ignored) {}
    }

    private void playRequestSound(Player player) {
        if (player == null || !player.isOnline()) return;
        ensureEffectsReflection();
        Location loc = player.getLocation();
        if (loc == null) return;
        try {
            if (pickupSoundObj != null && playSoundEnumMethod != null) {
                playSoundEnumMethod.invoke(player, loc, pickupSoundObj, Float.valueOf(3.0f), Float.valueOf(0.533f));
                return;
            }
            if (playSoundStringMethod != null) {
                playSoundStringMethod.invoke(player, loc, "entity.experience_orb.pickup", Float.valueOf(3.0f), Float.valueOf(0.533f));
            }
        } catch (Throwable ignored) {}
    }

    public void spawnTeleportParticles(Location loc) {
        if (loc == null || loc.getWorld() == null) return;
        ensureEffectsReflection();
        if (explosionParticleObj == null || spawnParticleMethod == null) return;
        try {
            spawnParticleMethod.invoke(
                loc.getWorld(),
                explosionParticleObj,
                Double.valueOf(loc.getX()),
                Double.valueOf(loc.getY() + 1.0),
                Double.valueOf(loc.getZ()),
                Integer.valueOf(20),
                Double.valueOf(0.4),
                Double.valueOf(0.6),
                Double.valueOf(0.4),
                Double.valueOf(0.08)
            );
        } catch (Throwable ignored) {}
    }

    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (!(sender instanceof Player) || args.length != 1) {
            return Collections.emptyList();
        }
        Player player = (Player) sender;
        String cmd = command.getName().toLowerCase(Locale.ROOT);
        String prefix = args[0].toLowerCase(Locale.ROOT);
        List<String> out = new ArrayList<>();

        if ("tpahereall".equals(cmd)) {
            for (String opt : Arrays.asList("list", "friendly", "everyone")) {
                if (opt.startsWith(prefix)) out.add(opt);
            }
            return out;
        }

        if ("tpa".equals(cmd) || "tpahere".equals(cmd)) {
            RealmsConfig cfg = plugin.getRealmsConfig();
            RealmsConfig.WorldGroup senderGroup = cfg.findGroupForPlayer(player);
            for (Player p : BukkitCompat.getOnlinePlayers()) {
                if (p.getUniqueId().equals(player.getUniqueId())) continue;
                RealmsConfig.WorldGroup targetGroup = cfg.findGroupForPlayer(p);
                if (cfg.canGroupsExchangeTpa(senderGroup, targetGroup)
                        && p.getName().toLowerCase(Locale.ROOT).startsWith(prefix)) {
                    out.add(p.getName());
                }
            }
            return out;
        }

        if ("tpaccept".equals(cmd) || "tpdeny".equals(cmd)) {
            List<TpaRequest> list = incomingByTarget.get(player.getUniqueId());
            if (list != null) {
                long now = System.currentTimeMillis();
                synchronized (list) {
                    for (TpaRequest r : list) {
                        if (r.expiresAt > now && r.senderName.toLowerCase(Locale.ROOT).startsWith(prefix)) {
                            out.add(r.senderName);
                        }
                    }
                }
            }
            return out;
        }

        if ("tpcancel".equals(cmd)) {
            long now = System.currentTimeMillis();
            for (List<TpaRequest> list : incomingByTarget.values()) {
                synchronized (list) {
                    for (TpaRequest r : list) {
                        if (r.expiresAt > now && r.senderId.equals(player.getUniqueId())
                                && r.targetName.toLowerCase(Locale.ROOT).startsWith(prefix)) {
                            out.add(r.targetName);
                        }
                    }
                }
            }
            return out;
        }

        return Collections.emptyList();
    }
}
