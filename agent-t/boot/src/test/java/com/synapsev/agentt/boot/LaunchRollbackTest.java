package com.synapsev.agentt.boot;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.synapsev.agentt.bridge.Hooks;
import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.instrument.AgentTransformer;
import com.synapsev.agentt.tx.CollectingOut;
import com.synapsev.agentt.tx.TxTracker;
import org.junit.After;
import org.junit.Test;

public class LaunchRollbackTest {
    private static final Runnable NOOP = new Runnable() {
        public void run() {
        }
    };

    private static final Runnable BOOM = new Runnable() {
        public void run() {
            throw new IllegalStateException("cannot start");
        }
    };

    @After
    public void tearDown() {
        Hooks.setSink(null);
    }

    private static final class Counting implements Runnable {
        int calls;

        public void run() {
            calls++;
        }
    }

    @Test
    public void failingSenderStartRollsEverythingBack() {
        KillSwitchTest.FakeControl control = new KillSwitchTest.FakeControl();
        AgentTransformer transformer = new AgentTransformer();
        AgentRuntime rt = new AgentRuntime(control, transformer, new TxTracker(new CollectingOut(), new AgentConfig()));
        Counting stopped = new Counting();
        try {
            AgentRuntime.launch(rt, true, BOOM, NOOP, stopped);
            fail("start failure must be reported");
        } catch (IllegalStateException expected) {
            assertEquals("cannot start", expected.getMessage());
        }
        assertSame(transformer, control.removed);
        assertEquals("attach retransformed once on install and once on rollback", 2, control.retransforms);
        assertNull(Hooks.sink);
        assertFalse(rt.isInstalled());
        assertEquals(1, stopped.calls);
    }

    @Test
    public void failingControlThreadAlsoRollsBack() {
        KillSwitchTest.FakeControl control = new KillSwitchTest.FakeControl();
        AgentRuntime rt = new AgentRuntime(control, new AgentTransformer(),
                new TxTracker(new CollectingOut(), new AgentConfig()));
        try {
            AgentRuntime.launch(rt, false, NOOP, BOOM, NOOP);
            fail();
        } catch (IllegalStateException expected) {
            // expected
        }
        assertFalse(rt.isInstalled());
        assertNull(Hooks.sink);
    }

    @Test
    public void successfulLaunchStaysInstalled() {
        KillSwitchTest.FakeControl control = new KillSwitchTest.FakeControl();
        AgentRuntime rt = new AgentRuntime(control, new AgentTransformer(),
                new TxTracker(new CollectingOut(), new AgentConfig()));
        AgentRuntime.launch(rt, false, NOOP, NOOP, NOOP);
        assertTrue(rt.isInstalled());
    }
}
