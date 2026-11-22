package org.bukkit.event;

public class EventException extends Exception {
    public EventException(Throwable throwable) { super(throwable); }
    public EventException(String message) { super(message); }
}
