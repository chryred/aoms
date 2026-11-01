package com.synapsev.agentt.active;

import com.synapsev.agentt.model.ActiveEntry;
import com.synapsev.agentt.tx.TxContext;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-flight root transactions. register/unregister are O(1) on a concurrent map keyed by context identity
 * ({@link TxContext} does not override equals/hashCode), so WAS threads never contend on a lock.
 */
public final class ActiveRegistry {
    /** Queue buckets {normal, warning, critical} plus the longest-running entries (elapsed descending). */
    public static final class ActiveSnapshot {
        public final int[] buckets;
        public final List<ActiveEntry> top;

        public ActiveSnapshot(int[] buckets, List<ActiveEntry> top) {
            this.buckets = buckets;
            this.top = top;
        }
    }

    static final long MAX_AGE_MS = 6L * 60 * 60 * 1000;

    private final ConcurrentHashMap<TxContext, Boolean> active = new ConcurrentHashMap<TxContext, Boolean>();
    private volatile StackSampler sampler;

    void attach(StackSampler s) {
        this.sampler = s;
    }

    public void register(TxContext c) {
        if (c != null) {
            active.put(c, Boolean.TRUE);
        }
    }

    public void unregister(TxContext c) {
        if (c != null) {
            active.remove(c);
        }
    }

    public void clear() {
        active.clear();
    }

    boolean contains(TxContext c) {
        return active.containsKey(c);
    }

    /**
     * Snapshot of the current contexts (weakly consistent). Contexts whose thread has died or that are older
     * than {@link #MAX_AGE_MS} leaked (servletExit never ran) and are evicted here.
     */
    List<TxContext> contexts(long nowMs) {
        List<TxContext> out = new ArrayList<TxContext>();
        for (TxContext c : active.keySet()) {
            if (!c.thread.isAlive() || nowMs - c.startTs > MAX_AGE_MS) {
                active.remove(c);
            } else {
                out.add(c);
            }
        }
        return out;
    }

    /**
     * Buckets by elapsed time with T = slowMs: normal {@code < T}, warning {@code T ~ 3T}, critical
     * {@code >= 3T}; {@code top} holds at most {@code topN} entries, longest first.
     */
    public ActiveSnapshot snapshot(long nowMs, long slowMs, int topN) {
        int[] buckets = new int[3];
        List<TxContext> all = contexts(nowMs);
        Collections.sort(all, new Comparator<TxContext>() {
            public int compare(TxContext a, TxContext b) {
                return a.startTs < b.startTs ? -1 : (a.startTs == b.startTs ? 0 : 1);
            }
        });
        List<ActiveEntry> top = new ArrayList<ActiveEntry>();
        StackSampler s = sampler;
        for (int i = 0; i < all.size(); i++) {
            TxContext c = all.get(i);
            long elapsed = nowMs - c.startTs;
            if (elapsed >= 3 * slowMs) {
                buckets[2]++;
            } else if (elapsed >= slowMs) {
                buckets[1]++;
            } else {
                buckets[0]++;
            }
            if (top.size() < topN) { // oldest first == elapsed descending
                top.add(entry(c, s));
            }
        }
        return new ActiveSnapshot(buckets, top);
    }

    private static ActiveEntry entry(TxContext c, StackSampler s) {
        ActiveEntry e = new ActiveEntry();
        e.traceId = c.traceId;
        e.spanId = c.spanId;
        e.thread = c.thread == null ? "" : c.thread.getName();
        e.uriId = c.uriId;
        e.startTs = c.startTs;
        String phase = c.phase;
        e.phase = phase;
        e.sqlId = "sql".equals(phase) ? c.curSqlId : null;
        if (s != null) {
            e.stack = s.latest(c);
        }
        return e;
    }
}
