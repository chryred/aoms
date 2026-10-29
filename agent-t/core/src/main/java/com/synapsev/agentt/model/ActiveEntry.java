package com.synapsev.agentt.model;

import java.util.ArrayList;
import java.util.List;

/** An in-flight transaction. phase = run | sql | ext; sqlId is non-null only when phase is sql. */
public final class ActiveEntry {
    public String traceId = "";
    public String spanId = "";
    public String thread = "";
    public String uriId = "";
    public long startTs;
    public String phase = "run";
    public String sqlId;
    public List<String> stack = new ArrayList<String>();
}
