package com.synapsev.agentt.jvm;

import com.synapsev.agentt.model.JvmSample;
import java.lang.management.ClassLoadingMXBean;
import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;
import java.lang.management.OperatingSystemMXBean;
import java.lang.management.ThreadMXBean;
import java.lang.reflect.Method;
import java.util.List;

/** Reads JVM metrics from the platform MXBeans (JDK 1.6+). gc_count / gc_ms are cumulative. */
public final class JvmCollector {
    private final MemoryMXBean memory = ManagementFactory.getMemoryMXBean();
    private final ThreadMXBean threads = ManagementFactory.getThreadMXBean();
    private final ClassLoadingMXBean classes = ManagementFactory.getClassLoadingMXBean();
    private final List<GarbageCollectorMXBean> gcs = ManagementFactory.getGarbageCollectorMXBeans();
    private final OperatingSystemMXBean os = ManagementFactory.getOperatingSystemMXBean();
    /** com.sun.management.OperatingSystemMXBean#getProcessCpuLoad (JDK 7+), looked up reflectively. */
    private final Method processCpuLoad = findCpuLoad(os);

    public JvmSample sample() {
        JvmSample s = new JvmSample();
        s.ts = System.currentTimeMillis();
        MemoryUsage heap = memory.getHeapMemoryUsage();
        s.heapUsed = heap.getUsed();
        s.heapMax = heap.getMax() > 0 ? heap.getMax() : heap.getCommitted();
        s.nonheapUsed = memory.getNonHeapMemoryUsage().getUsed();
        long count = 0;
        long ms = 0;
        for (int i = 0; i < gcs.size(); i++) {
            GarbageCollectorMXBean g = gcs.get(i);
            if (g.getCollectionCount() > 0) {
                count += g.getCollectionCount();
            }
            if (g.getCollectionTime() > 0) {
                ms += g.getCollectionTime();
            }
        }
        s.gcCount = count;
        s.gcMs = ms;
        s.threads = threads.getThreadCount();
        s.classes = classes.getLoadedClassCount();
        s.cpuRatio = cpuRatio();
        return s;
    }

    private double cpuRatio() {
        if (processCpuLoad == null) {
            return -1;
        }
        try {
            Object v = processCpuLoad.invoke(os);
            if (v instanceof Number) {
                double d = ((Number) v).doubleValue();
                return d >= 0 ? d : -1;
            }
        } catch (Throwable ignore) {
            // fall through
        }
        return -1;
    }

    private static Method findCpuLoad(OperatingSystemMXBean os) {
        try {
            Class<?> k = Class.forName("com.sun.management.OperatingSystemMXBean");
            if (k.isInstance(os)) {
                return k.getMethod("getProcessCpuLoad");
            }
        } catch (Throwable ignore) {
            // not a HotSpot-style JVM, or JDK 6: cpu_ratio stays -1
        }
        return null;
    }
}
