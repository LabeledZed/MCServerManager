package cpw.mods.fml.common;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface Mod {
    String modid();
    String name() default "";
    String version() default "";

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    @interface PreInit {}

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    @interface ServerStarting {}

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    @interface ServerStarted {}

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    @interface ServerStopping {}
}
