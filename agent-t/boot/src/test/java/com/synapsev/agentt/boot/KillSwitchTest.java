package com.synapsev.agentt.boot;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.bridge.Hooks;
import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.instrument.AgentTransformer;
import com.synapsev.agentt.tx.CollectingOut;
import com.synapsev.agentt.tx.TxTracker;
import java.lang.instrument.ClassFileTransformer;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class KillSwitchTest {
    public static final class Req {
        public String getRequestURI() {
            return "/order/1";
        }
    }

    static final class FakeControl implements AgentRuntime.Control {
        ClassFileTransformer added;
        ClassFileTransformer removed;
        int retransforms;

        public void add(ClassFileTransformer t) {
            added = t;
        }

        public void remove(ClassFileTransformer t) {
            removed = t;
        }

        public void retransform(AgentTransformer t) {
            retransforms++;
        }
    }

    private final AgentConfig config = new AgentConfig();
    private final CollectingOut out = new CollectingOut();
    private final FakeControl control = new FakeControl();
    private final AgentTransformer transformer = new AgentTransformer();
    private AgentRuntime rt;

    @Before
    public void setUp() {
        config.normalDetailRate = 0.0;
        rt = new AgentRuntime(control, transformer, new TxTracker(out, config));
    }

    @After
    public void tearDown() {
        Hooks.setSink(null);
    }

    private void oneRequest() {
        Object tok = Hooks.servletEnter(new Req(), new Object());
        Hooks.servletExit(tok, new Object(), null);
    }

    @Test
    public void disabledStopsRecordingAndRestoresClasses() {
        rt.install(false);
        assertSame(transformer, control.added);
        assertEquals(0, control.retransforms);
        oneRequest();
        assertEquals(1, out.records.size());

        config.enabled = false;
        rt.apply(config.enabled);

        assertSame(transformer, control.removed);
        assertEquals("original bytecode restored by retransform", 1, control.retransforms);
        assertNull(Hooks.sink);
        assertFalse(rt.isInstalled());
        oneRequest();
        assertEquals("no record after kill switch", 1, out.records.size());
        assertNull(transformer.transform(null, "javax/servlet/http/HttpServlet", null, null, new byte[] {1}));
        assertEquals("inactive transformer does not even attempt work", 0, transformer.failures());
    }

    @Test
    public void reEnableInstallsAgainAndRetransforms() {
        rt.install(false);
        rt.apply(false);
        rt.apply(true);
        assertNotNull(Hooks.sink);
        assertEquals(2, control.retransforms);
        oneRequest();
        assertEquals(1, out.records.size());
        assertTrue(rt.isInstalled());
    }

    @Test
    public void staleContextFromBeforeKillSwitchDoesNotSwallowNextRequest() {
        rt.install(false);
        Object tok = Hooks.servletEnter(new Req(), new Object()); // exit never delivered
        assertNotNull(tok);
        rt.apply(false);
        rt.apply(true);
        oneRequest();
        assertEquals(1, out.records.size());
    }

    @Test
    public void changedClassExclusionsRetransform() {
        rt.install(false);
        java.util.List<String> ex = java.util.Arrays.asList("com.acme.*");
        rt.applyExcludes(ex);
        assertEquals(ex, transformer.getExcludeClasses());
        assertEquals(1, control.retransforms);
        rt.applyExcludes(ex);
        assertEquals("unchanged list does not retransform again", 1, control.retransforms);
    }
}
