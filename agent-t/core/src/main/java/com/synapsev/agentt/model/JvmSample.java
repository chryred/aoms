package com.synapsev.agentt.model;

/** JVM metrics sample (bytes, ms; cpuRatio 0.0~1.0, -1 when unavailable). */
public final class JvmSample {
    public long ts;
    public long heapUsed;
    public long heapMax;
    public long nonheapUsed;
    public long gcCount;
    public long gcMs;
    public int threads;
    public double cpuRatio = -1;
    public int classes;
}
