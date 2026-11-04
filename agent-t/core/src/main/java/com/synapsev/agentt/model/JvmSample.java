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
    /** 커넥션 풀 합계(-1 = 미수집, 직렬화에서 키 생략). */
    public int connActive = -1;
    public int connIdle = -1;
    public int connMax = -1;
    public int connWait = -1;
    /** 풀별 5초 창 peak 의 합(-1 = 미수집). */
    public int connPeak = -1;
    /** 풀별 값(null = 미수집). */
    public PoolSample[] pools;
}
