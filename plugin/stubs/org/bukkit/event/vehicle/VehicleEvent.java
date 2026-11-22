package org.bukkit.event.vehicle;

import org.bukkit.entity.Vehicle;
import org.bukkit.event.Event;
import org.bukkit.event.HandlerList;

public abstract class VehicleEvent extends Event {
    public Vehicle getVehicle() { return null; }
    @Override
    public HandlerList getHandlers() { return null; }
}
