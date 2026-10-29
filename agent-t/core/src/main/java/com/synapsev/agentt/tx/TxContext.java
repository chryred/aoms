package com.synapsev.agentt.tx;

import com.synapsev.agentt.model.DetailNode;
import com.synapsev.agentt.model.SqlAgg;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * State of one root transaction. Mutated only by the thread that owns it, except the volatile live-view
 * fields (phase, curSqlId, uriId) which the active-transaction sampler reads from another thread.
 */
public final class TxContext {
    static final int MAX_NODES = 2000;

    /** Per-SQL accumulator in nanoseconds; converted to {@link SqlAgg} when the transaction ends. */
    static final class AggState {
        final SqlAgg agg = new SqlAgg();
        long nanos;
        long maxNanos;
        long fetchNanos;
    }

    static final class ConnState {
        boolean closed;
        boolean committed;
    }

    public final Thread thread;
    public final long startTs;
    public final long startNano;
    final int generation;
    final long startCpuNanos;

    public String traceId = "";
    public String spanId = "";
    public String parentSpan = "";
    public String method = "";
    public String userIp = "";
    public volatile String uriId = "";
    /** "run", "sql" or "ext". */
    public volatile String phase = "run";
    public volatile String curSqlId;

    int sqlCnt;
    long sqlNanos;
    long fetchCnt;
    long fetchNanos;
    long fetchStartNano;
    int extCnt;
    long extNanos;
    int connOpen;
    int connClose;
    int connUncommit;
    int sqlDepth;
    int extDepth;
    int fetchDepth;
    int openDepth;
    AggState lastAgg;
    int droppedNodes;
    final Map<String, AggState> aggs = new LinkedHashMap<String, AggState>();
    final List<DetailNode> nodes = new ArrayList<DetailNode>();
    Map<Object, ConnState> conns;
    Map<Object, Boolean> extConns;

    public TxContext(Thread thread, int generation, long startTs, long startNano, long startCpuNanos) {
        this.thread = thread;
        this.generation = generation;
        this.startTs = startTs;
        this.startNano = startNano;
        this.startCpuNanos = startCpuNanos;
    }

    /** Adds a node (child of the root) unless the per-transaction cap is reached; returns it or null. */
    DetailNode addNode(String kind, String name, String sqlId, long nowNano, int parent) {
        if (nodes.size() >= MAX_NODES) {
            droppedNodes++;
            return null;
        }
        DetailNode n = new DetailNode();
        n.idx = nodes.size();
        n.parent = parent;
        n.kind = kind;
        n.name = name;
        n.sqlId = sqlId == null ? "" : sqlId;
        n.startOffsetMs = (nowNano - startNano) / 1000000L;
        nodes.add(n);
        return n;
    }

    Map<Object, ConnState> conns() {
        if (conns == null) {
            conns = new IdentityHashMap<Object, ConnState>();
        }
        return conns;
    }

    Map<Object, Boolean> extConns() {
        if (extConns == null) {
            extConns = new IdentityHashMap<Object, Boolean>();
        }
        return extConns;
    }
}
