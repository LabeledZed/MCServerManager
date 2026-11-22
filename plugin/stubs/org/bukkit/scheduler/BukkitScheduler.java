package org.bukkit.scheduler;

import java.util.concurrent.Callable;
import java.util.concurrent.Future;
import org.bukkit.plugin.Plugin;

public interface BukkitScheduler {
    <T> Future<T> callSyncMethod(Plugin plugin, Callable<T> task);
    int scheduleSyncDelayedTask(Plugin plugin, Runnable task, long delay);
    int scheduleSyncRepeatingTask(Plugin plugin, Runnable task, long delay, long period);
    void cancelTask(int taskId);
}
