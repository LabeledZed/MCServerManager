package com.mcservermanager.bridge;

import java.lang.reflect.Method;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.plugin.Plugin;

/**
 * Reflection-based Folia / Paper / Spigot scheduler and teleport compatibility layer.
 * Uses Folia's GlobalRegionScheduler, EntityScheduler, RegionScheduler, and Entity#teleportAsync
 * when running on Folia, and falls back to BukkitScheduler / Entity#teleport on Paper/Spigot.
 */
public final class FoliaCompat {

    private static volatile Boolean foliaCached;

    private FoliaCompat() {}

    public static boolean isFolia() {
        Boolean cached = foliaCached;
        if (cached != null) return cached.booleanValue();
        boolean detected = false;
        try {
            Class.forName("io.papermc.paper.threadedregions.RegionizedServer");
            detected = true;
        } catch (Throwable ignored) {}
        foliaCached = Boolean.valueOf(detected);
        return detected;
    }

    public static void runGlobal(Plugin plugin, Runnable task) {
        if (isFolia()) {
            try {
                Object sched = Bukkit.getServer().getClass().getMethod("getGlobalRegionScheduler").invoke(Bukkit.getServer());
                Method exec = sched.getClass().getMethod("execute", Plugin.class, Runnable.class);
                exec.invoke(sched, plugin, task);
                return;
            } catch (Throwable ignored) {}
        }
        Bukkit.getScheduler().scheduleSyncDelayedTask(plugin, task, 0L);
    }

    public static Object runGlobalDelayed(Plugin plugin, final Runnable task, long delayTicks) {
        long safeDelay = Math.max(1L, delayTicks);
        if (isFolia()) {
            try {
                Object sched = Bukkit.getServer().getClass().getMethod("getGlobalRegionScheduler").invoke(Bukkit.getServer());
                Method runDelayed = sched.getClass().getMethod("runDelayed", Plugin.class, Consumer.class, long.class);
                Consumer<Object> consumer = new Consumer<Object>() {
                    @Override
                    public void accept(Object scheduledTask) {
                        task.run();
                    }
                };
                return runDelayed.invoke(sched, plugin, consumer, Long.valueOf(safeDelay));
            } catch (Throwable ignored) {}
        }
        return Integer.valueOf(Bukkit.getScheduler().scheduleSyncDelayedTask(plugin, task, delayTicks));
    }

    public static Object runGlobalTimer(Plugin plugin, final Runnable task, long delayTicks, long periodTicks) {
        long safeDelay = Math.max(1L, delayTicks);
        long safePeriod = Math.max(1L, periodTicks);
        if (isFolia()) {
            try {
                Object sched = Bukkit.getServer().getClass().getMethod("getGlobalRegionScheduler").invoke(Bukkit.getServer());
                Method runAtFixedRate = sched.getClass().getMethod("runAtFixedRate", Plugin.class, Consumer.class, long.class, long.class);
                Consumer<Object> consumer = new Consumer<Object>() {
                    @Override
                    public void accept(Object scheduledTask) {
                        task.run();
                    }
                };
                return runAtFixedRate.invoke(sched, plugin, consumer, Long.valueOf(safeDelay), Long.valueOf(safePeriod));
            } catch (Throwable ignored) {}
        }
        return Integer.valueOf(Bukkit.getScheduler().scheduleSyncRepeatingTask(plugin, task, delayTicks, periodTicks));
    }

    public static void cancelTask(Object handle) {
        if (handle == null) return;
        if (handle instanceof Integer) {
            int id = ((Integer) handle).intValue();
            if (id != -1 && !isFolia()) {
                try {
                    Bukkit.getScheduler().cancelTask(id);
                } catch (Throwable ignored) {}
            }
            return;
        }
        try {
            Method cancel = handle.getClass().getMethod("cancel");
            cancel.invoke(handle);
        } catch (Throwable ignored) {}
    }

    public static <T> T callGlobalSync(Plugin plugin, final Callable<T> task, int timeoutSeconds) throws Exception {
        if (isFolia()) {
            final CompletableFuture<T> future = new CompletableFuture<T>();
            runGlobal(plugin, new Runnable() {
                @Override
                public void run() {
                    try {
                        future.complete(task.call());
                    } catch (Throwable t) {
                        future.completeExceptionally(t);
                    }
                }
            });
            return future.get(timeoutSeconds, TimeUnit.SECONDS);
        }
        Future<T> future = Bukkit.getScheduler().callSyncMethod(plugin, task);
        return future.get(timeoutSeconds, TimeUnit.SECONDS);
    }

    public static void runForEntity(Plugin plugin, Entity entity, final Runnable task, long delayTicks) {
        if (entity == null) {
            runGlobalDelayed(plugin, task, delayTicks);
            return;
        }
        if (isFolia()) {
            try {
                Object entitySched = entity.getClass().getMethod("getScheduler").invoke(entity);
                Consumer<Object> consumer = new Consumer<Object>() {
                    @Override
                    public void accept(Object scheduledTask) {
                        task.run();
                    }
                };
                if (delayTicks <= 0L) {
                    Method run = entitySched.getClass().getMethod("run", Plugin.class, Consumer.class, Runnable.class);
                    run.invoke(entitySched, plugin, consumer, null);
                } else {
                    Method runDelayed = entitySched.getClass().getMethod("runDelayed", Plugin.class, Consumer.class, Runnable.class, long.class);
                    runDelayed.invoke(entitySched, plugin, consumer, null, Long.valueOf(delayTicks));
                }
                return;
            } catch (Throwable ignored) {}
        }
        Bukkit.getScheduler().scheduleSyncDelayedTask(plugin, task, delayTicks);
    }

    public static <T> T callForEntitySync(Plugin plugin, Entity entity, final Callable<T> task, int timeoutSeconds) throws Exception {
        if (isFolia() && entity != null) {
            final CompletableFuture<T> future = new CompletableFuture<T>();
            runForEntity(plugin, entity, new Runnable() {
                @Override
                public void run() {
                    try {
                        future.complete(task.call());
                    } catch (Throwable t) {
                        future.completeExceptionally(t);
                    }
                }
            }, 0L);
            return future.get(timeoutSeconds, TimeUnit.SECONDS);
        }
        return callGlobalSync(plugin, task, timeoutSeconds);
    }

    public static void runAtLocation(Plugin plugin, Location loc, Runnable task) {
        if (isFolia() && loc != null && loc.getWorld() != null) {
            try {
                Object regSched = Bukkit.getServer().getClass().getMethod("getRegionScheduler").invoke(Bukkit.getServer());
                Method exec = regSched.getClass().getMethod("execute", Plugin.class, Location.class, Runnable.class);
                exec.invoke(regSched, plugin, loc, task);
                return;
            } catch (Throwable ignored) {}
        }
        if (isFolia()) {
            runGlobal(plugin, task);
        } else {
            task.run();
        }
    }

    public static void teleportSafe(Entity entity, Location dest) {
        if (entity == null || dest == null || dest.getWorld() == null) return;
        if (isFolia()) {
            try {
                Method tpAsync = entity.getClass().getMethod("teleportAsync", Location.class);
                tpAsync.invoke(entity, dest);
                return;
            } catch (Throwable ignored) {}
        }
        try {
            entity.teleport(dest);
        } catch (UnsupportedOperationException ex) {
            try {
                Method tpAsync = entity.getClass().getMethod("teleportAsync", Location.class);
                tpAsync.invoke(entity, dest);
            } catch (Throwable ignored) {}
        }
    }
}
