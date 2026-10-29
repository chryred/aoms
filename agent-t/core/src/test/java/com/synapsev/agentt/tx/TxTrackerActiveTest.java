package com.synapsev.agentt.tx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.active.ActiveRegistry;
import com.synapsev.agentt.active.StackSampler;
import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.model.TxRecord;
import org.junit.Test;

public class TxTrackerActiveTest {
    public static final class Req {
        public String getRequestURI() {
            return "/slow/1";
        }
    }

    public static final class Resp {
        public int getStatus() {
            return 200;
        }
    }

    private final AgentConfig config = new AgentConfig();
    private final CollectingOut out = new CollectingOut();
    private final ActiveRegistry registry = new ActiveRegistry();
    private final StackSampler sampler = new StackSampler(registry, config);
    private final TxTracker tracker = new TxTracker(out, config);

    {
        config.slowMs = 50;
        config.normalDetailRate = 0.0;
        tracker.setActive(registry, sampler);
    }

    @Test
    public void slowTransactionGetsStacksAndLeavesRegistry() throws Exception {
        Object tok = tracker.servletEnter(new Req(), new Resp());
        assertEquals(1, registry.snapshot(System.currentTimeMillis(), 50, 10).top.size());
        Thread.sleep(150);
        assertEquals(1, sampler.sampleOnce(System.currentTimeMillis()));
        assertEquals(1, sampler.sampleOnce(System.currentTimeMillis()));
        tracker.servletExit(tok, new Resp(), null);
        assertEquals(0, registry.snapshot(System.currentTimeMillis(), 50, 10).top.size());
        TxRecord r = out.records.get(0);
        assertNotNull(r.nodes);
        assertNotNull(r.stacks);
        assertTrue(r.stacks.get(0).count >= 2);
    }

    @Test
    public void fastTransactionDiscardsSamplerState() {
        Object tok = tracker.servletEnter(new Req(), new Resp());
        tracker.servletExit(tok, new Resp(), null);
        TxRecord r = out.records.get(0);
        assertNull(r.nodes);
        assertNull(r.stacks);
        assertEquals(0, registry.snapshot(System.currentTimeMillis(), 50, 10).top.size());
    }

    @Test
    public void resetClearsRegistry() {
        tracker.servletEnter(new Req(), new Resp());
        tracker.reset();
        assertEquals(0, registry.snapshot(System.currentTimeMillis(), 50, 10).top.size());
    }
}
