package com.synapsev.agentt.model;

import java.util.ArrayList;
import java.util.List;

/** A completed transaction. Detail exists iff {@code nodes != null}. */
public final class TxRecord {
    public static final class StackSample {
        public String[] frames = new String[0];
        public int count;
    }

    public String traceId = "";
    public String spanId = "";
    public String parentSpan = "";
    public long startTs;
    public long elapsedMs;
    public String method = "";
    public String uriId = "";
    public int status;
    public boolean error;
    public String exc = "";
    public long cpuMs;
    public long sqlMs;
    public int sqlCnt;
    public long fetchCnt;
    public long fetchMs;
    public long extMs;
    public int extCnt;
    public int connOpen;
    public int connClose;
    public int connLeak;
    public int connUncommit;
    public String userIp = "";
    public String userId = "";
    public String bizKey = "";
    public List<SqlAgg> sql = new ArrayList<SqlAgg>();
    public List<DetailNode> nodes;
    public List<StackSample> stacks;
    /** Masked request parameters; only ever set together with {@code nodes} (detail). */
    public TxParams params;

    public boolean hasDetail() {
        return nodes != null;
    }

    public void stripDetail() {
        nodes = null;
        stacks = null;
        params = null;
    }

    /** Rough serialized size; cheap enough for the WAS thread. */
    public long estimateBytes() {
        return 600 + len(traceId) + len(exc) + len(userIp) + len(userId) + len(bizKey) + len(method)
                + sqlBytes() + detailBytes();
    }

    public long sqlBytes() {
        return sql == null ? 0 : sql.size() * 110L;
    }

    public long detailBytes() {
        if (nodes == null) {
            return 0;
        }
        long b = 40 + (params == null ? 0 : params.estimateBytes());
        for (int i = 0; i < nodes.size(); i++) {
            b += 90 + len(nodes.get(i).name);
        }
        if (stacks != null) {
            for (int i = 0; i < stacks.size(); i++) {
                String[] f = stacks.get(i).frames;
                b += 20;
                for (int j = 0; j < f.length; j++) {
                    b += 4 + len(f[j]);
                }
            }
        }
        return b;
    }

    private static int len(String s) {
        return s == null ? 0 : s.length();
    }
}
