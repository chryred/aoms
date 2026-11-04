package com.synapsev.agentt.model;

/** Per-transaction aggregate of one SQL statement. */
public final class SqlAgg {
    public String sqlId = "";
    public int cnt;
    public long ms;
    public long maxMs;
    public long fetchCnt;
    public long fetchMs;
    public int err;
    /** Short DB connection name (host:port/db), "" when unknown. */
    public String db = "";
}
