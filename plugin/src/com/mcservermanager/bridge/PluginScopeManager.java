package com.mcservermanager.bridge;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.command.Command;
import org.bukkit.command.PluginIdentifiableCommand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventException;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockEvent;
import org.bukkit.event.entity.EntityEvent;
import org.bukkit.event.hanging.HangingEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerEvent;
import org.bukkit.event.vehicle.VehicleEvent;
import org.bukkit.event.weather.WeatherEvent;
import org.bukkit.event.world.WorldEvent;
import org.bukkit.plugin.EventExecutor;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.RegisteredListener;

/**
 * Per-World Plugin Scoping Engine.
 * Intercepts three layers live without server restarts:
 * 1. Bukkit HandlerList RegisteredListeners (wraps/unwraps plugin event listeners by world/group)
 * 2. Command execution (blocks plugin commands run in disallowed worlds via CommandMap resolution)
 * 3. Command tab-completions (filters PlayerCommandSendEvent and calls player.updateCommands())
 */
public final class PluginScopeManager {

    private static final EventExecutor NOOP_EXECUTOR = new EventExecutor() {
        @Override
        public void execute(Listener listener, Event event) {}
    };

    private static final int EXTRACT_NONE = 0;
    private static final int EXTRACT_GET_WORLD = 1;
    private static final int EXTRACT_GET_PLAYER = 2;
    private static final int EXTRACT_GET_ENTITY = 3;
    private static final int EXTRACT_GET_BLOCK = 4;
    private static final int EXTRACT_GET_LOCATION = 5;
    private static final int EXTRACT_GET_VIEW = 6;

    private final Plugin bridgePlugin;
    private final Logger logger;
    private volatile RealmsConfig config;

    private final Map<Class<?>, Integer> eventExtractorCache = new ConcurrentHashMap<>();
    private final Map<Class<?>, Method> eventMethodCache = new ConcurrentHashMap<>();

    public PluginScopeManager(Plugin bridgePlugin, RealmsConfig initialConfig, Logger logger) {
        this.bridgePlugin = bridgePlugin;
        this.config = initialConfig;
        this.logger = logger;
    }

    public void setConfig(RealmsConfig nextConfig) {
        this.config = nextConfig;
    }

    /**
     * Dynamically hooks PlayerCommandSendEvent (MC 1.13+) via reflection so tab-complete
     * automatically hides commands belonging to plugins disabled in the player's current world.
     */
    @SuppressWarnings("unchecked")
    public void registerCommandSendHook(Listener listener) {
        try {
            Class<? extends Event> evtClass =
                (Class<? extends Event>) Class.forName("org.bukkit.event.player.PlayerCommandSendEvent");
            final Method getPlayerMethod = evtClass.getMethod("getPlayer");
            final Method getCommandsMethod = evtClass.getMethod("getCommands");

            Bukkit.getPluginManager().registerEvent(
                evtClass,
                listener,
                EventPriority.HIGHEST,
                new EventExecutor() {
                    @Override
                    public void execute(Listener l, Event event) {
                        if (!evtClass.isInstance(event)) return;
                        try {
                            Object pObj = getPlayerMethod.invoke(event);
                            Object cmdsObj = getCommandsMethod.invoke(event);
                            if (pObj instanceof Player && cmdsObj instanceof Collection) {
                                filterTabCompleteCommands((Player) pObj, (Collection<String>) cmdsObj);
                            }
                        } catch (Throwable ignored) {}
                    }
                },
                bridgePlugin,
                false
            );
        } catch (Throwable ignored) {
            // Pre-1.13 or unavailable
        }
    }

    /**
     * Wraps listeners for any plugin with a non-'all' rule and unwraps listeners for plugins reset to 'all'.
     * Safe to invoke repeatedly on the main thread whenever realms.json is saved.
     */
    public void syncAllListeners() {
        RealmsConfig cfg = this.config;
        ArrayList<HandlerList> lists = HandlerList.getHandlerLists();
        if (lists == null) return;

        int wrappedCount = 0;
        int unwrappedCount = 0;

        for (HandlerList hl : lists) {
            if (hl == null) continue;
            RegisteredListener[] registered = hl.getRegisteredListeners();
            if (registered == null) continue;

            for (RegisteredListener rl : registered) {
                if (rl == null || rl.getPlugin() == null) continue;
                String pluginName = rl.getPlugin().getName();
                if ("MCServerManagerBridge".equalsIgnoreCase(pluginName)) continue;

                boolean needsScope = cfg != null && cfg.enabled && hasActiveRule(cfg, pluginName);
                if (rl instanceof WorldScopedRegisteredListener) {
                    if (!needsScope) {
                        WorldScopedRegisteredListener wrapper = (WorldScopedRegisteredListener) rl;
                        hl.unregister(wrapper);
                        hl.register(wrapper.getDelegate());
                        unwrappedCount++;
                    }
                } else if (needsScope) {
                    hl.unregister(rl);
                    hl.register(new WorldScopedRegisteredListener(rl, this));
                    wrappedCount++;
                }
            }
        }

        if (wrappedCount > 0 || unwrappedCount > 0) {
            logger.info("[PerWorldPlugins] Synced listeners (wrapped=" + wrappedCount + ", unwrapped=" + unwrappedCount + ")");
        }
        refreshAllOnlinePlayersCommands();
    }

    /**
     * Restores all wrapped RegisteredListeners back to their original delegates on bridge shutdown.
     */
    public void unwrapAllListeners() {
        ArrayList<HandlerList> lists = HandlerList.getHandlerLists();
        if (lists == null) return;
        for (HandlerList hl : lists) {
            if (hl == null) continue;
            RegisteredListener[] registered = hl.getRegisteredListeners();
            if (registered == null) continue;
            for (RegisteredListener rl : registered) {
                if (rl instanceof WorldScopedRegisteredListener) {
                    WorldScopedRegisteredListener wrapper = (WorldScopedRegisteredListener) rl;
                    hl.unregister(wrapper);
                    hl.register(wrapper.getDelegate());
                }
            }
        }
    }

    private static boolean hasActiveRule(RealmsConfig cfg, String pluginName) {
        RealmsConfig.PluginWorldRule rule = cfg.findPluginRule(pluginName);
        return rule != null && !"all".equalsIgnoreCase(rule.mode);
    }

    public boolean isPluginAllowedForEvent(Plugin targetPlugin, Event event) {
        RealmsConfig cfg = this.config;
        if (cfg == null || !cfg.enabled || targetPlugin == null || event == null) return true;
        String pluginName = targetPlugin.getName();
        if (!hasActiveRule(cfg, pluginName)) return true;

        World world = extractEventWorld(event);
        if (world == null) {
            // Global / non-world event (e.g. ServerListPingEvent, PluginEnableEvent) — allow through
            return true;
        }
        return cfg.isPluginAllowedInWorld(pluginName, world.getName());
    }

    public void handleCommandPreprocess(PlayerCommandPreprocessEvent event) {
        RealmsConfig cfg = this.config;
        if (event.isCancelled() || cfg == null || !cfg.enabled) return;
        String msg = event.getMessage();
        if (msg == null || !msg.startsWith("/")) return;

        String trimmed = msg.substring(1).trim();
        if (trimmed.isEmpty()) return;
        int space = trimmed.indexOf(' ');
        String rawLabel = (space > 0 ? trimmed.substring(0, space) : trimmed).toLowerCase(Locale.ROOT);

        Player player = event.getPlayer();
        if (player == null || player.getWorld() == null) return;
        String worldName = player.getWorld().getName();

        String ownerPlugin = resolveOwningPluginName(rawLabel);
        if (ownerPlugin == null) return;

        if (!cfg.isPluginAllowedInWorld(ownerPlugin, worldName)) {
            event.setCancelled(true);
            player.sendMessage("\u00A7cCommand /" + rawLabel + " (" + ownerPlugin + ") is disabled in this world.");
        }
    }

    public void filterTabCompleteCommands(Player player, Collection<String> commands) {
        RealmsConfig cfg = this.config;
        if (cfg == null || !cfg.enabled || player == null || player.getWorld() == null || commands == null) return;
        if (cfg.pluginRules.isEmpty()) return;

        String worldName = player.getWorld().getName();
        Iterator<String> it = commands.iterator();
        while (it.hasNext()) {
            String cmdLabel = it.next();
            String owner = resolveOwningPluginName(cmdLabel);
            if (owner != null && !cfg.isPluginAllowedInWorld(owner, worldName)) {
                it.remove();
            }
        }
    }

    public void refreshPlayerCommands(Player player) {
        if (player == null || !player.isOnline()) return;
        try {
            Method m = player.getClass().getMethod("updateCommands");
            m.invoke(player);
        } catch (Throwable ignored) {}
    }

    public void refreshAllOnlinePlayersCommands() {
        for (Player p : Bukkit.getOnlinePlayers()) {
            refreshPlayerCommands(p);
        }
    }

    private String resolveOwningPluginName(String rawLabel) {
        if (rawLabel == null || rawLabel.isEmpty()) return null;

        // 1. Check namespaced command prefix (e.g. "worldedit:wand")
        int colon = rawLabel.indexOf(':');
        if (colon > 0) {
            String prefix = rawLabel.substring(0, colon);
            for (Plugin p : Bukkit.getPluginManager().getPlugins()) {
                if (p.getName().equalsIgnoreCase(prefix)) {
                    return p.getName();
                }
            }
        }

        // 2. Resolve via Bukkit CommandMap (works across Spigot, Paper, Purpur, Leaf 26.3)
        Object cmdMap = getCommandMapReflective();
        if (cmdMap != null) {
            try {
                Method getCmd = cmdMap.getClass().getMethod("getCommand", String.class);
                Object cmdObj = getCmd.invoke(cmdMap, rawLabel);
                if (cmdObj == null && colon > 0) {
                    cmdObj = getCmd.invoke(cmdMap, rawLabel.substring(colon + 1));
                }
                if (cmdObj instanceof PluginIdentifiableCommand) {
                    Plugin p = ((PluginIdentifiableCommand) cmdObj).getPlugin();
                    if (p != null) return p.getName();
                }
                if (cmdObj instanceof Command) {
                    try {
                        Method getPlugin = cmdObj.getClass().getMethod("getPlugin");
                        Object p = getPlugin.invoke(cmdObj);
                        if (p instanceof Plugin) return ((Plugin) p).getName();
                    } catch (Throwable ignored) {}
                }
            } catch (Throwable ignored) {}
        }
        return null;
    }

    private Object getCommandMapReflective() {
        // Paper / Purpur / Leaf: Server#getCommandMap()
        try {
            Method m = Bukkit.getServer().getClass().getMethod("getCommandMap");
            Object map = m.invoke(Bukkit.getServer());
            if (map != null) return map;
        } catch (Throwable ignored) {}
        // Spigot fallback: SimplePluginManager.commandMap field
        try {
            PluginManager pm = Bukkit.getPluginManager();
            Field f = pm.getClass().getDeclaredField("commandMap");
            f.setAccessible(true);
            return f.get(pm);
        } catch (Throwable ignored) {}
        return null;
    }

    private World extractEventWorld(Event event) {
        // Fast path for standard Bukkit event hierarchies
        if (event instanceof PlayerEvent) {
            Player p = ((PlayerEvent) event).getPlayer();
            return p != null ? p.getWorld() : null;
        }
        if (event instanceof BlockEvent) {
            Block b = ((BlockEvent) event).getBlock();
            return b != null ? b.getWorld() : null;
        }
        if (event instanceof EntityEvent) {
            Entity e = ((EntityEvent) event).getEntity();
            return e != null ? e.getWorld() : null;
        }
        if (event instanceof WorldEvent) {
            return ((WorldEvent) event).getWorld();
        }
        if (event instanceof VehicleEvent) {
            Entity v = ((VehicleEvent) event).getVehicle();
            return v != null ? v.getWorld() : null;
        }
        if (event instanceof HangingEvent) {
            Entity h = ((HangingEvent) event).getEntity();
            return h != null ? h.getWorld() : null;
        }
        if (event instanceof WeatherEvent) {
            return ((WeatherEvent) event).getWorld();
        }

        // Cached reflection path for InventoryEvent (safe across class->interface change in 1.21+) & custom/Paper events
        Class<?> cls = event.getClass();
        Integer strategy = eventExtractorCache.get(cls);
        if (strategy == null) {
            strategy = discoverExtractor(cls);
            eventExtractorCache.put(cls, strategy);
        }

        Method m = eventMethodCache.get(cls);
        if (strategy == EXTRACT_NONE || m == null) return null;

        try {
            Object val = m.invoke(event);
            if (val == null) return null;
            switch (strategy.intValue()) {
                case EXTRACT_GET_WORLD:
                    return (val instanceof World) ? (World) val : null;
                case EXTRACT_GET_PLAYER:
                    return (val instanceof Entity) ? ((Entity) val).getWorld() : null;
                case EXTRACT_GET_ENTITY:
                    return (val instanceof Entity) ? ((Entity) val).getWorld() : null;
                case EXTRACT_GET_BLOCK:
                    return (val instanceof Block) ? ((Block) val).getWorld() : null;
                case EXTRACT_GET_LOCATION:
                    return (val instanceof Location) ? ((Location) val).getWorld() : null;
                case EXTRACT_GET_VIEW: {
                    // InventoryEvent#getView()#getPlayer()#getWorld() — reflective so it works on both 1.13-1.20.6 & 1.21-26.3+
                    Method viewPlayer = val.getClass().getMethod("getPlayer");
                    Object human = viewPlayer.invoke(val);
                    return (human instanceof Entity) ? ((Entity) human).getWorld() : null;
                }
                default:
                    return null;
            }
        } catch (Throwable ignored) {
            return null;
        }
    }

    private int discoverExtractor(Class<?> cls) {
        if (tryCacheMethod(cls, "getWorld")) return EXTRACT_GET_WORLD;
        if (tryCacheMethod(cls, "getPlayer")) return EXTRACT_GET_PLAYER;
        if (tryCacheMethod(cls, "getEntity")) return EXTRACT_GET_ENTITY;
        if (tryCacheMethod(cls, "getBlock")) return EXTRACT_GET_BLOCK;
        if (tryCacheMethod(cls, "getLocation")) return EXTRACT_GET_LOCATION;
        if (tryCacheMethod(cls, "getView")) return EXTRACT_GET_VIEW;
        return EXTRACT_NONE;
    }

    private boolean tryCacheMethod(Class<?> cls, String name) {
        try {
            Method m = cls.getMethod(name);
            m.setAccessible(true);
            eventMethodCache.put(cls, m);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    /**
     * Wraps another plugin's RegisteredListener so events are only forwarded when the event's world
     * is permitted for that plugin under realms.json.
     */
    public static final class WorldScopedRegisteredListener extends RegisteredListener {
        private final RegisteredListener delegate;
        private final PluginScopeManager scopeManager;

        public WorldScopedRegisteredListener(RegisteredListener delegate, PluginScopeManager scopeManager) {
            super(
                delegate.getListener(),
                NOOP_EXECUTOR,
                delegate.getPriority(),
                delegate.getPlugin(),
                delegate.isIgnoringCancelled()
            );
            this.delegate = delegate;
            this.scopeManager = scopeManager;
        }

        public RegisteredListener getDelegate() {
            return delegate;
        }

        @Override
        public void callEvent(Event event) throws EventException {
            if (!scopeManager.isPluginAllowedForEvent(delegate.getPlugin(), event)) {
                return;
            }
            delegate.callEvent(event);
        }
    }
}
