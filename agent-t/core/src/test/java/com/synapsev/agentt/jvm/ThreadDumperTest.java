package com.synapsev.agentt.jvm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ThreadDumperTest {
    @Test
    public void containsCurrentThreadAndRateLimits() {
        ThreadDumper d = new ThreadDumper();
        String[] r = d.dump(ThreadDumper.DEFAULT_MAX_BYTES);
        assertTrue(r[0].contains(Thread.currentThread().getName()));
        assertTrue(r[0].contains("java.lang.Thread.State") || r[0].contains("RUNNABLE"));
        assertEquals("false", r[1]);
        assertNull("second dump within 60s is ignored", d.dump(ThreadDumper.DEFAULT_MAX_BYTES));
    }

    @Test
    public void truncates() throws Exception {
        String[] r = new ThreadDumper().dump(100);
        assertEquals("true", r[1]);
        assertTrue(r[0].getBytes("UTF-8").length <= 100);
        assertFalse(r[0].length() == 0);
    }
}
