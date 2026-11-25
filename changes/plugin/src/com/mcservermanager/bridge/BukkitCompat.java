package com.mcservermanager.bridge;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerPortalEvent;
import org.bukkit.event.world.PortalCreateEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.plugin.EventExecutor;
import org.bukkit.plugin.Plugin;

/**
 * Reflection-backed Bukkit/Spigot/Paper/Folia compatibility shim covering
 * CraftBukkit / Spigot / Paper / Purpur / Leaf / Folia / Cauldron / Thermos
 * from Minecraft 1.2.5 through 26.3+ in a single Java 8 JAR.
 */
public final class BukkitCompat {

    public interface ChatRecipientsHandler {
        void filterChat(Player sender, Collection<Player> recipients);
    }

    public static final class PortalBlockPos {
        public final Material type;
        public final int x;
        public final int y;
        public final int z;

        public PortalBlockPos(Material type, int x, int y, int z) {
            this.type = type;
            this.x = x;
            this.y = y;
            this.z = z;
        }
    }

    private static volatile Method onlinePlayersMethod;
    private static volatile boolean onlinePlayersResolved = false;

    private static volatile Method hidePlayerModern;
    private static volatile Method hidePlayerLegacy;
    private static volatile Method showPlayerModern;
    private static volatile Method showPlayerLegacy;
    private static volatile boolean visibilityResolved = false;

    private static volatile Method getHealthMethod;
    private static volatile Method getMaxHealthMethod;
    private static volatile Method setHealthDoubleMethod;
    private static volatile Method setHealthIntMethod;
    private static volatile boolean healthResolved = false;

    private BukkitCompat() {}

    /**
     * Handles both Bukkit 1.7.10+ (Collection&lt;? extends Player&gt;) and
     * CraftBukkit/Spigot 1.1-1.7.9 (Player[]) return types without NoSuchMethodError.
     */
    @SuppressWarnings("unchecked")
    public static List<Player> getOnlinePlayers() {
        try {
            if (!onlinePlayersResolved) {
                onlinePlayersMethod = Bukkit.class.getMethod("getOnlinePlayers");
                onlinePlayersResolved = true;
            }
            if (onlinePlayersMethod != null) {
                Object res = onlinePlayersMethod.invoke(null);
                if (res instanceof Collection) {
                    return new ArrayList<Player>((Collection<? extends Player>) res);
                }
                if (res instanceof Player[]) {
                    Player[] arr = (Player[]) res;
                    List<Player> list = new ArrayList<Player>(arr.length);
                    Collections.addAll(list, arr);
                    return list;
                }
            }
        } catch (Throwable ignored) {}
        return Collections.emptyList();
    }

    public static boolean hasOnlinePlayers() {
        return !getOnlinePlayers().isEmpty();
    }

    public static String getBukkitVersionSafe() {
        try {
            String v = Bukkit.getBukkitVersion();
            if (v != null && !v.isEmpty()) return v;
        } catch (Throwable ignored) {}
        try {
            String v = Bukkit.getVersion();
            if (v != null && !v.isEmpty()) return v;
        } catch (Throwable ignored) {}
        return "Bukkit";
    }

    public static boolean isNetherPortalMaterial(Material mat) {
        if (mat == null) return false;
        String n = mat.name();
        return "NETHER_PORTAL".equals(n) || "PORTAL".equals(n);
    }

    private static void ensureHealthMethods(Player sample) {
        if (healthResolved || sample == null) return;
        Class<?> cls = sample.getClass();
        try {
            getHealthMethod = cls.getMethod("getHealth");
        } catch (Throwable ignored) {}
        try {
            getMaxHealthMethod = cls.getMethod("getMaxHealth");
        } catch (Throwable ignored) {}
        try {
            setHealthDoubleMethod = cls.getMethod("setHealth", double.class);
        } catch (Throwable ignored) {}
        try {
            setHealthIntMethod = cls.getMethod("setHealth", int.class);
        } catch (Throwable ignored) {}
        healthResolved = true;
    }

    /**
     * Works across Bukkit 1.1-1.5.2 (int getHealth) and 1.6.1-26.3+ (double getHealth).
     */
    public static double getHealth(Player p) {
        if (p == null) return 20.0;
        ensureHealthMethods(p);
        try {
            if (getHealthMethod != null) {
                Object out = getHealthMethod.invoke(p);
                if (out instanceof Number) return ((Number) out).doubleValue();
            }
        } catch (Throwable ignored) {}
        try {
            Method m = p.getClass().getMethod("getHealth");
            Object out = m.invoke(p);
            if (out instanceof Number) return ((Number) out).doubleValue();
        } catch (Throwable ignored) {}
        return 20.0;
    }

    /**
     * Works across Bukkit 1.1-1.5.2 (int getMaxHealth), 1.6.1-1.20 (double getMaxHealth),
     * and 1.9-26.3+ (Attribute.MAX_HEALTH / Attribute.GENERIC_MAX_HEALTH).
     */
    public static double getMaxHealth(Player p) {
        if (p == null) return 20.0;
        // Prefer modern Attribute API on 1.9-26.3+
        try {
            Class<?> attrCls = Class.forName("org.bukkit.attribute.Attribute");
            Object maxHealthAttr = null;
            try {
                maxHealthAttr = attrCls.getField("MAX_HEALTH").get(null);
            } catch (Throwable ignored) {}
            if (maxHealthAttr == null) {
                try {
                    maxHealthAttr = attrCls.getField("GENERIC_MAX_HEALTH").get(null);
                } catch (Throwable ignored) {}
            }
            if (maxHealthAttr != null) {
                Method getAttr = p.getClass().getMethod("getAttribute", attrCls);
                Object inst = getAttr.invoke(p, maxHealthAttr);
                if (inst != null) {
                    Object val = inst.getClass().getMethod("getValue").invoke(inst);
                    if (val instanceof Number) {
                        double d = ((Number) val).doubleValue();
                        if (d > 0.0) return d;
                    }
                }
            }
        } catch (Throwable ignored) {}

        ensureHealthMethods(p);
        try {
            if (getMaxHealthMethod != null) {
                Object out = getMaxHealthMethod.invoke(p);
                if (out instanceof Number) return Math.max(1.0, ((Number) out).doubleValue());
            }
        } catch (Throwable ignored) {}
        return 20.0;
    }

    /**
     * Works across Bukkit 1.1-1.5.2 (setHealth(int)) and 1.6.1-26.3+ (setHealth(double)).
     */
    public static void setHealth(Player p, double health) {
        if (p == null) return;
        ensureHealthMethods(p);
        try {
            if (setHealthDoubleMethod != null) {
                setHealthDoubleMethod.invoke(p, Double.valueOf(health));
                return;
            }
            if (setHealthIntMethod != null) {
                setHealthIntMethod.invoke(p, Integer.valueOf((int) Math.round(health)));
                return;
            }
        } catch (Throwable ignored) {}
        try {
            Method m = p.getClass().getMethod("setHealth", double.class);
            m.invoke(p, Double.valueOf(health));
        } catch (Throwable ignored) {
            try {
                Method m = p.getClass().getMethod("setHealth", int.class);
                m.invoke(p, Integer.valueOf((int) Math.round(health)));
            } catch (Throwable ignored2) {}
        }
    }

    /**
     * Works across Bukkit 1.2.5 (no ender chest -> returns null) and 1.3.1-26.3+.
     */
    public static Inventory getEnderChest(Player p) {
        if (p == null) return null;
        try {
            Method m = p.getClass().getMethod("getEnderChest");
            Object res = m.invoke(p);
            if (res instanceof Inventory) return (Inventory) res;
        } catch (Throwable ignored) {}
        return null;
    }

    /**
     * Works across Bukkit 1.2.5 (setLevel fallback) and 1.3.1-26.3+ (giveExpLevels).
     */
    public static void giveExpLevels(Player p, int levels) {
        if (p == null) return;
        try {
            Method m = p.getClass().getMethod("giveExpLevels", int.class);
            m.invoke(p, Integer.valueOf(levels));
            return;
        } catch (Throwable ignored) {}
        try {
            p.setLevel(Math.max(0, p.getLevel() + levels));
        } catch (Throwable ignored) {}
    }

    private static void ensureVisibilityMethods(Player sample) {
        if (visibilityResolved || sample == null) return;
        Class<?> cls = sample.getClass();
        try {
            hidePlayerModern = cls.getMethod("hidePlayer", Plugin.class, Player.class);
        } catch (Throwable ignored) {}
        try {
            hidePlayerLegacy = cls.getMethod("hidePlayer", Player.class);
        } catch (Throwable ignored) {}
        try {
            showPlayerModern = cls.getMethod("showPlayer", Plugin.class, Player.class);
        } catch (Throwable ignored) {}
        try {
            showPlayerLegacy = cls.getMethod("showPlayer", Player.class);
        } catch (Throwable ignored) {}
        visibilityResolved = true;
    }

    /**
     * Uses 2-arg showPlayer(Plugin, Player) on 1.12+, falls back to showPlayer(Player) on 1.1-1.11.2.
     */
    public static void showPlayer(Player viewer, Plugin plugin, Player target) {
        if (viewer == null || target == null) return;
        ensureVisibilityMethods(viewer);
        try {
            if (showPlayerModern != null) {
                showPlayerModern.invoke(viewer, plugin, target);
                return;
            }
            if (showPlayerLegacy != null) {
                showPlayerLegacy.invoke(viewer, target);
            }
        } catch (Throwable ignored) {}
    }

    /**
     * Uses 2-arg hidePlayer(Plugin, Player) on 1.12+, falls back to hidePlayer(Player) on 1.1-1.11.2.
     */
    public static void hidePlayer(Player viewer, Plugin plugin, Player target) {
        if (viewer == null || target == null) return;
        ensureVisibilityMethods(viewer);
        try {
            if (hidePlayerModern != null) {
                hidePlayerModern.invoke(viewer, plugin, target);
                return;
            }
            if (hidePlayerLegacy != null) {
                hidePlayerLegacy.invoke(viewer, target);
            }
        } catch (Throwable ignored) {}
    }

    /**
     * Purely reflective WorldBorder access so 1.7.10 and older servers never hit NoClassDefFoundError.
     */
    public static double getWorldBorderSize(World w) {
        if (w == null) return 0.0;
        try {
            Method getWb = w.getClass().getMethod("getWorldBorder");
            Object wb = getWb.invoke(w);
            if (wb != null) {
                Method getSize = wb.getClass().getMethod("getSize");
                Object out = getSize.invoke(wb);
                if (out instanceof Number) return ((Number) out).doubleValue();
            }
        } catch (Throwable ignored) {}
        return 0.0;
    }

    public static boolean setWorldBorderSize(World w, double size) {
        if (w == null) return false;
        try {
            Method getWb = w.getClass().getMethod("getWorldBorder");
            Object wb = getWb.invoke(w);
            if (wb != null) {
                Method setSize = wb.getClass().getMethod("setSize", double.class);
                setSize.invoke(wb, Double.valueOf(size));
                return true;
            }
        } catch (Throwable ignored) {}
        return false;
    }

    public static String getPortalCreateReasonName(PortalCreateEvent event) {
        if (event == null) return "";
        try {
            Method m = event.getClass().getMethod("getReason");
            Object r = m.invoke(event);
            if (r instanceof Enum) return ((Enum<?>) r).name();
            if (r != null) return r.toString();
        } catch (Throwable ignored) {}
        return "";
    }

    /**
     * Handles both Bukkit 1.14+ (List&lt;BlockState&gt;) and Bukkit 1.2.5-1.13.2 (ArrayList&lt;Block&gt;).
     */
    public static List<PortalBlockPos> getPortalCreateBlocks(PortalCreateEvent event) {
        List<PortalBlockPos> out = new ArrayList<PortalBlockPos>();
        if (event == null) return out;
        try {
            Method m = event.getClass().getMethod("getBlocks");
            Object raw = m.invoke(event);
            if (raw instanceof Iterable) {
                for (Object item : (Iterable<?>) raw) {
                    if (item instanceof BlockState) {
                        BlockState bs = (BlockState) item;
                        out.add(new PortalBlockPos(bs.getType(), bs.getX(), bs.getY(), bs.getZ()));
                    } else if (item instanceof Block) {
                        Block b = (Block) item;
                        out.add(new PortalBlockPos(b.getType(), b.getX(), b.getY(), b.getZ()));
                    }
                }
            }
        } catch (Throwable ignored) {}
        return out;
    }

    /**
     * Sets portal search radius on both 1.14+ (event.setSearchRadius) and 1.2.5-1.13.2 (PortalTravelAgent).
     */
    public static void setPortalSearchRadius(PlayerPortalEvent event, int radius) {
        if (event == null) return;
        try {
            Method m = event.getClass().getMethod("setSearchRadius", int.class);
            m.invoke(event, Integer.valueOf(radius));
            return;
        } catch (Throwable ignored) {}
        try {
            Object agent = event.getClass().getMethod("getPortalTravelAgent").invoke(event);
            if (agent != null) {
                agent.getClass().getMethod("setSearchRadius", int.class).invoke(agent, Integer.valueOf(radius));
            }
        } catch (Throwable ignored) {}
    }

    /**
     * Enables portal creation on both 1.14+ (event.setCanCreatePortal) and 1.2.5-1.13.2 (PortalTravelAgent).
     */
    public static void setPortalCanCreate(PlayerPortalEvent event, boolean canCreate) {
        if (event == null) return;
        try {
            Method m = event.getClass().getMethod("setCanCreatePortal", boolean.class);
            m.invoke(event, Boolean.valueOf(canCreate));
            return;
        } catch (Throwable ignored) {}
        try {
            event.getClass().getMethod("useTravelAgent", boolean.class).invoke(event, Boolean.TRUE);
            Object agent = event.getClass().getMethod("getPortalTravelAgent").invoke(event);
            if (agent != null) {
                agent.getClass().getMethod("setCanCreatePortal", boolean.class).invoke(agent, Boolean.valueOf(canCreate));
            }
        } catch (Throwable ignored) {}
    }

    /**
     * Dynamically hooks AsyncPlayerChatEvent (1.3.1-26.3+) with fallback to PlayerChatEvent (1.2.5)
     * so RealmsListener never hits NoClassDefFoundError on 1.2.5 servers.
     */
    @SuppressWarnings("unchecked")
    public static void registerChatListener(Plugin plugin, Listener listener, final ChatRecipientsHandler handler) {
        String[] candidates = new String[]{
            "org.bukkit.event.player.AsyncPlayerChatEvent",
            "org.bukkit.event.player.PlayerChatEvent"
        };
        for (String clsName : candidates) {
            try {
                final Class<? extends Event> evtClass = (Class<? extends Event>) Class.forName(clsName);
                final Method getPlayer = evtClass.getMethod("getPlayer");
                final Method getRecipients = evtClass.getMethod("getRecipients");
                Bukkit.getPluginManager().registerEvent(
                    evtClass,
                    listener,
                    EventPriority.HIGH,
                    new EventExecutor() {
                        @Override
                        public void execute(Listener l, Event event) {
                            if (!evtClass.isInstance(event)) return;
                            try {
                                Object pObj = getPlayer.invoke(event);
                                Object recObj = getRecipients.invoke(event);
                                if (pObj instanceof Player && recObj instanceof Collection) {
                                    handler.filterChat((Player) pObj, (Collection<Player>) recObj);
                                }
                            } catch (Throwable ignored) {}
                        }
                    },
                    plugin,
                    true
                );
                return;
            } catch (Throwable ignored) {}
        }
    }

    /**
     * Reads native TPS from Paper/Purpur/Leaf/Folia (Bukkit.getTPS / Server.getTPS)
     * or Spigot 1.8-1.21 (CraftServer -> MinecraftServer.recentTps).
     */
    public static double[] readNativeTps() {
        try {
            Method m = Bukkit.class.getMethod("getTPS");
            Object out = m.invoke(null);
            if (out instanceof double[]) return (double[]) out;
        } catch (Throwable ignored) {}
        try {
            Object srv = Bukkit.getServer();
            Method m = srv.getClass().getMethod("getTPS");
            Object out = m.invoke(srv);
            if (out instanceof double[]) return (double[]) out;
        } catch (Throwable ignored) {}
        // Spigot fallback: CraftServer.getServer() or CraftServer.console -> MinecraftServer.recentTps
        try {
            Object craftSrv = Bukkit.getServer();
            Object mcSrv = null;
            try {
                mcSrv = craftSrv.getClass().getMethod("getServer").invoke(craftSrv);
            } catch (Throwable ignored) {}
            if (mcSrv == null) {
                Class<?> c = craftSrv.getClass();
                while (c != null && mcSrv == null) {
                    try {
                        Field f = c.getDeclaredField("console");
                        f.setAccessible(true);
                        mcSrv = f.get(craftSrv);
                    } catch (Throwable ignored) {}
                    c = c.getSuperclass();
                }
            }
            if (mcSrv != null) {
                Class<?> c = mcSrv.getClass();
                while (c != null) {
                    try {
                        Field f = c.getDeclaredField("recentTps");
                        f.setAccessible(true);
                        Object out = f.get(mcSrv);
                        if (out instanceof double[]) return (double[]) out;
                    } catch (Throwable ignored) {}
                    c = c.getSuperclass();
                }
            }
        } catch (Throwable ignored) {}
        return null;
    }
}
