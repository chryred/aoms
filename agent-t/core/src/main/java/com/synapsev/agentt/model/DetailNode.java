package com.synapsev.agentt.model;

/** One node of a retained transaction's call tree. kind = http | sql | ext. */
public final class DetailNode {
    public int idx;
    public int parent = -1;
    public String kind = "http";
    public String name = "";
    public long startOffsetMs;
    public long durationMs;
    public String sqlId = "";
}
