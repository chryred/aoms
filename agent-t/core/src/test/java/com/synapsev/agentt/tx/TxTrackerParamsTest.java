package com.synapsev.agentt.tx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.model.TxRecord;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Before;
import org.junit.Test;

public class TxTrackerParamsTest {
    /** Public contract both javax and jakarta requests satisfy by method name only. */
    public interface ServletLike {
        String getRequestURI();

        String getQueryString();

        Map<String, String[]> getParameterMap();
    }

    private static final class Counters {
        final AtomicInteger mapCalls = new AtomicInteger();
        final AtomicInteger entryMapCalls = new AtomicInteger();
        volatile boolean insideTx;
    }

    /** Non-public implementation: reflection must go through the public interface. */
    private static class FakeReq implements ServletLike {
        final String uri;
        final Counters c;
        boolean throwing;

        FakeReq(String uri, Counters c) {
            this.uri = uri;
            this.c = c;
        }

        public String getRequestURI() {
            return uri;
        }

        public String getQueryString() {
            return "a=1&password=zzz";
        }

        public Map<String, String[]> getParameterMap() {
            c.mapCalls.incrementAndGet();
            if (throwing) {
                throw new IllegalStateException("boom");
            }
            Map<String, String[]> m = new LinkedHashMap<String, String[]>();
            m.put("a", new String[] {"1"});
            m.put("token", new String[] {"secret"});
            return m;
        }
    }

    /** Stands in for javax/jakarta: only the method names matter. */
    public static final class JakartaReq {
        public String getRequestURI() {
            return "/jk";
        }

        public String getQueryString() {
            return null;
        }

        public Map<String, String[]> getParameterMap() {
            Map<String, String[]> m = new LinkedHashMap<String, String[]>();
            m.put("id", new String[] {"7"});
            return m;
        }
    }

    public static final class Resp {
        public int getStatus() {
            return 200;
        }
    }

    private final AgentConfig config = new AgentConfig();
    private final CollectingOut out = new CollectingOut();
    private final TxTracker tracker = new TxTracker(out, config);

    @Before
    public void setUp() {
        config.slowMs = 0; // every tx qualifies for detail
        config.normalDetailRate = 0.0;
        DetailDecider.reset();
    }

    @Test
    public void disabledByDefaultNeverReadsParameters() {
        Counters c = new Counters();
        Object root = tracker.servletEnter(new FakeReq("/x", c), new Resp());
        tracker.servletExit(root, new Resp(), null);
        assertEquals(0, c.mapCalls.get());
        assertNull(out.records.get(0).params);
        assertNotNull(out.records.get(0).nodes);
    }

    @Test
    public void capturedOnlyAtExitAndMasked() {
        config.captureParams = true;
        Counters c = new Counters();
        FakeReq req = new FakeReq("/x", c);
        Object root = tracker.servletEnter(req, new Resp());
        assertEquals("not read at entry", 0, c.mapCalls.get());
        tracker.servletExit(root, new Resp(), null);
        assertEquals(1, c.mapCalls.get());
        TxRecord r = out.records.get(0);
        assertNotNull(r.params);
        assertEquals("a=1&password=****", r.params.query);
        assertEquals("1", r.params.params.get(0)[1]);
        assertEquals("****", r.params.params.get(1)[1]);
    }

    @Test
    public void jakartaStyleRequestWorksAndNullQueryIsEmpty() {
        config.captureParams = true;
        Object root = tracker.servletEnter(new JakartaReq(), new Resp());
        tracker.servletExit(root, new Resp(), null);
        TxRecord r = out.records.get(0);
        assertEquals("", r.params.query);
        assertEquals("id", r.params.params.get(0)[0]);
    }

    @Test
    public void notAttachedWithoutDetail() {
        config.captureParams = true;
        config.slowMs = 100000;
        Counters c = new Counters();
        Object root = tracker.servletEnter(new FakeReq("/x", c), new Resp());
        tracker.servletExit(root, new Resp(), null);
        TxRecord r = out.records.get(0);
        assertNull(r.nodes);
        assertNull(r.params);
        assertEquals(0, c.mapCalls.get());
    }

    @Test
    public void errorTransactionKeepsDetailAndParams() {
        config.captureParams = true;
        config.slowMs = 100000;
        Object root = tracker.servletEnter(new FakeReq("/x", new Counters()), new Resp());
        tracker.servletExit(root, new Resp(), new RuntimeException("x"));
        assertNotNull(out.records.get(0).params);
    }

    @Test
    public void uriIncludeExcludeHonored() {
        config.captureParams = true;
        config.captureUriInclude = java.util.Arrays.asList("/api/*");
        config.captureUriExclude = java.util.Arrays.asList("/api/login");
        Counters c = new Counters();
        for (String u : new String[] {"/api/a", "/api/login", "/other"}) {
            DetailDecider.reset();
            Object root = tracker.servletEnter(new FakeReq(u, c), new Resp());
            tracker.servletExit(root, new Resp(), null);
        }
        assertNotNull(out.records.get(0).params);
        assertNull(out.records.get(1).params);
        assertNull(out.records.get(2).params);
        assertEquals(1, c.mapCalls.get());
    }

    @Test
    public void throwingRequestNeverBreaksTransaction() {
        config.captureParams = true;
        FakeReq req = new FakeReq("/x", new Counters());
        req.throwing = true;
        Object root = tracker.servletEnter(req, new Resp());
        tracker.servletExit(root, new Resp(), null);
        TxRecord r = out.records.get(0);
        assertNotNull(r.nodes);
        assertTrue(r.params == null || r.params.params.isEmpty());
    }
}
