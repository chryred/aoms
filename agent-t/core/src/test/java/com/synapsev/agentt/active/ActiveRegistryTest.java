package com.synapsev.agentt.active;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import com.synapsev.agentt.model.ActiveEntry;
import com.synapsev.agentt.tx.TxContext;
import org.junit.Test;

public class ActiveRegistryTest {
    private static TxContext ctx(String trace, long startTs) {
        TxContext c = new TxContext(Thread.currentThread(), 0, startTs, System.nanoTime(), -1);
        c.traceId = trace;
        return c;
    }

    @Test
    public void buckets() {
        ActiveRegistry r = new ActiveRegistry();
        long now = 100000;
        r.register(ctx("a", now - 1000));
        r.register(ctx("b", now - 4000));
        r.register(ctx("c", now - 10000));
        ActiveRegistry.ActiveSnapshot s = r.snapshot(now, 3000, 50);
        assertArrayEquals(new int[] {1, 1, 1}, s.buckets);
        assertEquals(3, s.top.size());
        assertEquals("c", s.top.get(0).traceId);
        assertEquals("b", s.top.get(1).traceId);
        assertEquals("a", s.top.get(2).traceId);
    }

    @Test
    public void boundariesAndTopLimit() {
        ActiveRegistry r = new ActiveRegistry();
        long now = 100000;
        r.register(ctx("t", now - 3000));
        r.register(ctx("3t", now - 9000));
        r.register(ctx("just-under", now - 2999));
        ActiveRegistry.ActiveSnapshot s = r.snapshot(now, 3000, 2);
        assertArrayEquals(new int[] {1, 1, 1}, s.buckets);
        assertEquals(2, s.top.size());
    }

    @Test
    public void unregisterAndClear() {
        ActiveRegistry r = new ActiveRegistry();
        TxContext a = ctx("a", 1);
        TxContext b = ctx("b", 2);
        r.register(a);
        r.register(b);
        r.unregister(a);
        assertEquals(1, r.snapshot(1000, 3000, 10).top.size());
        r.clear();
        assertEquals(0, r.snapshot(1000, 3000, 10).top.size());
    }

    @Test
    public void entryReflectsPhaseAndSql() {
        ActiveRegistry r = new ActiveRegistry();
        TxContext c = ctx("a", 1);
        c.uriId = "u1";
        c.phase = "sql";
        c.curSqlId = "s1";
        r.register(c);
        ActiveEntry e = r.snapshot(10, 3000, 10).top.get(0);
        assertEquals("sql", e.phase);
        assertEquals("s1", e.sqlId);
        assertEquals("u1", e.uriId);
        assertEquals(Thread.currentThread().getName(), e.thread);
        c.phase = "ext";
        assertNull(r.snapshot(10, 3000, 10).top.get(0).sqlId);
    }
}
