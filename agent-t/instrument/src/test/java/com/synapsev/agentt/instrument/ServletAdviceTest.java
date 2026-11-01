package com.synapsev.agentt.instrument;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.synapsev.agentt.id.Fnv64;
import com.synapsev.agentt.model.TxRecord;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class ServletAdviceTest {
    private TestEnv env;

    @Before
    public void setUp() {
        env = new TestEnv();
    }

    @After
    public void tearDown() {
        env.close();
    }

    private Runnable scenario(String uri, String traceparent, boolean withFilter) throws Exception {
        Class<?> c = env.loader.loadClass("testapp.ServletScenario");
        Object o = c.newInstance();
        c.getField("uri").set(o, uri);
        c.getField("traceparent").set(o, traceparent);
        c.getField("withFilter").setBoolean(o, withFilter);
        return (Runnable) o;
    }

    @Test
    public void recordsRootOnly() throws Exception {
        scenario("/order/123", null, true).run();
        assertTrue(env.loader.transformedNames.contains("testapp.OrderFilter"));
        assertTrue(env.loader.transformedNames.contains("javax.servlet.http.HttpServlet"));
        assertEquals(0, env.transformer.failures());
        assertEquals("one record for Filter -> Servlet nesting", 1, env.records().size());
        TxRecord r = env.records().get(0);
        assertEquals(Fnv64.hex("/order/{n}"), r.uriId);
        assertTrue(env.out.uriDefs.contains(Fnv64.hex("/order/{n}") + "=/order/{n}"));
        assertEquals("GET", r.method);
        assertEquals(200, r.status);
        assertFalse(r.error);
        assertEquals("10.1.2.3", r.userIp);
        assertTrue(r.traceId.matches("[0-9a-f]{32}"));
        assertTrue(r.spanId.matches("[0-9a-f]{16}"));
        assertEquals("", r.parentSpan);
    }

    @Test
    public void servletWithoutFilterIsRoot() throws Exception {
        scenario("/plain", null, false).run();
        assertEquals(1, env.records().size());
    }

    @Test
    public void incomingTraceparentLinksParent() throws Exception {
        String trace = "4bf92f3577b34da6a3ce929d0e0e4736";
        String span = "00f067aa0ba902b7";
        scenario("/order/1", "00-" + trace + "-" + span + "-01", true).run();
        TxRecord r = env.records().get(0);
        assertEquals(trace, r.traceId);
        assertEquals(span, r.parentSpan);
        assertFalse(span.equals(r.spanId));
    }

    @Test
    public void invalidTraceparentStartsNewTrace() throws Exception {
        scenario("/order/1", "nonsense", true).run();
        TxRecord r = env.records().get(0);
        assertTrue(r.traceId.matches("[0-9a-f]{32}"));
        assertEquals("", r.parentSpan);
    }

    @Test
    public void exceptionPropagatesUnchangedAndIsRecorded() throws Exception {
        try {
            scenario("/boom", null, true).run();
            fail("exception must reach the caller");
        } catch (IllegalStateException e) {
            assertEquals("boom", e.getMessage());
        }
        assertEquals(1, env.records().size());
        TxRecord r = env.records().get(0);
        assertTrue(r.error);
        assertEquals("java.lang.IllegalStateException", r.exc);
        assertEquals(500, r.status);
    }

    @Test
    public void errorKeepsDetailTreeWithRootNode() throws Exception {
        try {
            scenario("/boom", null, true).run();
        } catch (IllegalStateException expected) {
            // expected
        }
        TxRecord r = env.records().get(0);
        assertTrue(r.hasDetail());
        assertNotNull(r.nodes.get(0));
        assertEquals("http", r.nodes.get(0).kind);
        assertEquals(-1, r.nodes.get(0).parent);
    }

    @Test
    public void excludedUriIsNotTraced() throws Exception {
        env.config.exclude = java.util.Arrays.asList("/static/*");
        scenario("/static/app.js", null, true).run();
        assertEquals(0, env.records().size());
    }

    @Test
    public void secondRequestOnSameThreadIsIndependentRoot() throws Exception {
        scenario("/order/1", null, true).run();
        scenario("/order/2", null, true).run();
        assertEquals(2, env.records().size());
    }
}
