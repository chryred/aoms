package com.synapsev.agentt.tx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TraceParentTest {
    private static final String TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
    private static final String SPAN = "00f067aa0ba902b7";

    @Test
    public void validHeaderKeepsTraceAndParentSpan() {
        TraceParent p = TraceParent.parse("00-" + TRACE + "-" + SPAN + "-01");
        assertNotNull(p);
        assertEquals(TRACE, p.traceId);
        assertEquals(SPAN, p.spanId);
    }

    @Test
    public void invalidHeadersAreRejected() {
        assertNull(TraceParent.parse(null));
        assertNull(TraceParent.parse(""));
        assertNull(TraceParent.parse("garbage"));
        assertNull(TraceParent.parse("00-" + TRACE + "-" + SPAN)); // no flags
        assertNull(TraceParent.parse("00-" + TRACE.toUpperCase() + "-" + SPAN + "-01"));
        assertNull(TraceParent.parse("00-00000000000000000000000000000000-" + SPAN + "-01"));
        assertNull(TraceParent.parse("00-" + TRACE + "-0000000000000000-01"));
        assertNull(TraceParent.parse("ff-" + TRACE + "-" + SPAN + "-01"));
        assertNull(TraceParent.parse("00-" + TRACE + "-" + SPAN + "-01-extra"));
        assertNull(TraceParent.parse("00-" + TRACE + "x-" + SPAN + "-01"));
    }

    @Test
    public void generatedIdsHaveW3cShapeAndDiffer() {
        String t1 = TraceParent.newTraceId();
        String t2 = TraceParent.newTraceId();
        assertEquals(32, t1.length());
        assertTrue(t1.matches("[0-9a-f]{32}"));
        assertFalse(t1.equals(t2));
        assertTrue(TraceParent.newSpanId().matches("[0-9a-f]{16}"));
    }

    @Test
    public void formatRoundTrips() {
        String h = TraceParent.format(TRACE, SPAN);
        assertEquals("00-" + TRACE + "-" + SPAN + "-01", h);
        assertEquals(TRACE, TraceParent.parse(h).traceId);
    }
}
