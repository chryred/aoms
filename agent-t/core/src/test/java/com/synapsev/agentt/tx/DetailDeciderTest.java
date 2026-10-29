package com.synapsev.agentt.tx;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.model.TxRecord;
import org.junit.Before;
import org.junit.Test;

public class DetailDeciderTest {
    private AgentConfig cfg;

    @Before
    public void setUp() {
        DetailDecider.reset();
        cfg = new AgentConfig();
        cfg.slowMs = 3000;
        cfg.normalDetailRate = 0.0;
    }

    private static TxRecord tx(long elapsed) {
        TxRecord t = new TxRecord();
        t.elapsedMs = elapsed;
        return t;
    }

    @Test
    public void slowBoundary() {
        assertFalse(DetailDecider.keep(tx(2999), cfg, 1000));
        assertTrue(DetailDecider.keep(tx(3000), cfg, 1000));
    }

    @Test
    public void errorLeakAndUncommitAreKept() {
        TxRecord e = tx(1);
        e.error = true;
        assertTrue(DetailDecider.keep(e, cfg, 1000));
        TxRecord l = tx(1);
        l.connLeak = 1;
        assertTrue(DetailDecider.keep(l, cfg, 1000));
        TxRecord u = tx(1);
        u.connUncommit = 1;
        assertTrue(DetailDecider.keep(u, cfg, 1000));
    }

    @Test
    public void normalSampleRate() {
        cfg.normalDetailRate = 1.0;
        assertTrue(DetailDecider.keep(tx(1), cfg, 1000));
        cfg.normalDetailRate = 0.0;
        assertFalse(DetailDecider.keep(tx(1), cfg, 1000));
    }

    @Test
    public void perSecondCapOfFifty() {
        for (int i = 0; i < 50; i++) {
            assertTrue("kept #" + (i + 1), DetailDecider.keep(tx(5000), cfg, 7000 + i));
        }
        assertFalse("51st slow tx within the same second", DetailDecider.keep(tx(5000), cfg, 7500));
        assertTrue("next second starts a new window", DetailDecider.keep(tx(5000), cfg, 8000));
    }
}
