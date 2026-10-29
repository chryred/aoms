package com.synapsev.agentt.active;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.model.ActiveEntry;
import com.synapsev.agentt.model.TxRecord;
import com.synapsev.agentt.tx.TxContext;
import java.util.List;
import org.junit.After;
import org.junit.Test;

public class StackSamplerTest {
    private final Thread sleeper = new Thread("sleeper") {
        @Override
        public void run() {
            try {
                Thread.sleep(30000);
            } catch (InterruptedException e) {
                // test over
            }
        }
    };

    @After
    public void tearDown() {
        sleeper.interrupt();
    }

    private static TxContext ctx(Thread t, long startTs) {
        return new TxContext(t, 0, startTs, System.nanoTime(), -1);
    }

    @Test
    public void collectsOnlySlow() throws Exception {
        AgentConfig cfg = new AgentConfig();
        cfg.slowMs = 3000;
        ActiveRegistry reg = new ActiveRegistry();
        StackSampler sampler = new StackSampler(reg, cfg);
        long now = System.currentTimeMillis();
        sleeper.setDaemon(true);
        sleeper.start();
        Thread quick = new Thread("quick");
        quick.start();
        quick.join();
        TxContext slow = ctx(sleeper, now - 5000);
        TxContext fast = ctx(quick, now);
        reg.register(slow);
        reg.register(fast);
        Thread.sleep(100); // let the sleeper reach Thread.sleep
        assertEquals(1, sampler.sampleOnce(now));
        assertEquals(1, sampler.sampleOnce(now));
        ActiveEntry e = reg.snapshot(now, 3000, 10).top.get(0);
        assertFalse("latest stack on the active entry", e.stack.isEmpty());
        assertTrue(e.stack.get(0).contains("sleep"));
        reg.unregister(slow);
        List<TxRecord.StackSample> stacks = sampler.take(slow);
        assertEquals(1, stacks.size());
        assertTrue(stacks.get(0).count >= 2);
        assertNull(sampler.take(fast));
        assertNull("table is handed over once", sampler.take(slow));
    }

    @Test
    public void capsSampleCountAtTwenty() throws Exception {
        AgentConfig cfg = new AgentConfig();
        cfg.slowMs = 1000;
        ActiveRegistry reg = new ActiveRegistry();
        StackSampler sampler = new StackSampler(reg, cfg);
        sleeper.setDaemon(true);
        sleeper.start();
        Thread.sleep(100);
        long now = System.currentTimeMillis();
        for (int i = 0; i < 30; i++) {
            reg.register(ctx(sleeper, now - 5000 - i));
        }
        assertEquals(StackSampler.MAX_TARGETS, sampler.sampleOnce(now));
    }

    @Test
    public void framesDropAgentPackageAndCap() {
        StackTraceElement[] st = {
            new StackTraceElement("com.synapsev.agentt.bridge.Hooks", "enter", "Hooks.java", 1),
            new StackTraceElement("app.Svc", "run", "Svc.java", 5),
            new StackTraceElement("com.synapsev.agentt.tx.TxTracker", "sqlEnter", "TxTracker.java", 9),
            new StackTraceElement("app.Dao", "q", "Dao.java", 7)};
        assertArrayEquals(new String[] {"app.Svc.run(Svc.java:5)", "app.Dao.q(Dao.java:7)"}, StackSampler.frames(st));
        StackTraceElement[] deep = new StackTraceElement[100];
        for (int i = 0; i < deep.length; i++) {
            deep[i] = new StackTraceElement("app.C" + i, "m", "C.java", i);
        }
        String[] f = StackSampler.frames(deep);
        assertEquals(StackSampler.MAX_FRAMES, f.length);
        assertEquals("app.C0.m(C.java:0)", f[0]);
    }

    @Test
    public void evictsLeakedContexts() throws Exception {
        AgentConfig cfg = new AgentConfig();
        cfg.slowMs = 1000;
        ActiveRegistry reg = new ActiveRegistry();
        StackSampler sampler = new StackSampler(reg, cfg);
        long now = System.currentTimeMillis();
        Thread dead = new Thread("dead");
        dead.start();
        dead.join();
        sleeper.setDaemon(true);
        sleeper.start();
        Thread.sleep(100);
        reg.register(ctx(dead, now - 5000));
        reg.register(ctx(sleeper, now - 7L * 3600 * 1000));
        TxContext live = ctx(sleeper, now - 5000);
        reg.register(live);
        assertEquals(1, sampler.sampleOnce(now));
        ActiveRegistry.ActiveSnapshot s = reg.snapshot(now, 1000, 10);
        assertEquals(1, s.top.size());
        assertArrayEquals(new int[] {0, 0, 1}, s.buckets);
    }

    @Test
    public void frameFormat() {
        assertEquals("a.B.m(B.java:12)", StackSampler.format(new StackTraceElement("a.B", "m", "B.java", 12)));
        assertEquals("a.B.m(B.java)", StackSampler.format(new StackTraceElement("a.B", "m", "B.java", -1)));
        assertEquals("a.B.m(Unknown Source)", StackSampler.format(new StackTraceElement("a.B", "m", null, -1)));
    }
}
