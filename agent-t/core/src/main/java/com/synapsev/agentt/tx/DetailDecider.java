package com.synapsev.agentt.tx;

import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.model.TxRecord;

/** Decides at transaction end whether the call tree is kept (spec 7.1) with a per-JVM per-second cap. */
public final class DetailDecider {
    public static final int MAX_PER_SECOND = 50;
    private static final Object LOCK = new Object();
    private static long window = -1;
    private static int count;

    private DetailDecider() { }

    public static boolean keep(TxRecord tx, AgentConfig cfg, long nowMs) {
        boolean candidate = tx.elapsedMs >= cfg.slowMs || tx.error || tx.connLeak > 0 || tx.connUncommit > 0;
        if (!candidate) {
            double rate = cfg.normalDetailRate;
            if (!(rate > 0) || Math.random() >= rate) {
                return false;
            }
        }
        synchronized (LOCK) {
            long sec = nowMs / 1000;
            if (sec != window) {
                window = sec;
                count = 0;
            }
            if (count >= MAX_PER_SECOND) {
                return false;
            }
            count++;
            return true;
        }
    }

    /** Test hook: forget the current one-second window. */
    static void reset() {
        synchronized (LOCK) {
            window = -1;
            count = 0;
        }
    }
}
