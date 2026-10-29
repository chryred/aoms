package com.synapsev.agentt.instrument;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.model.TxRecord;
import java.net.HttpURLConnection;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class ExtAdviceTest {
    private TestEnv env;

    @Before
    public void setUp() {
        env = new TestEnv();
    }

    @After
    public void tearDown() {
        env.close();
    }

    @Test
    public void externalCallCountedOnceAndTraceparentInjected() throws Exception {
        env.config.normalDetailRate = 1.0;
        HttpURLConnection u = (HttpURLConnection) env.loader.loadClass("testapp.StubHttpURLConnection").newInstance();
        Object tok = env.begin("/ext");
        assertEquals(200, u.getResponseCode()); // internally getInputStream -> connect
        u.getInputStream();
        env.end(tok);

        assertEquals(0, env.transformer.failures());
        TxRecord r = env.records().get(0);
        assertEquals(1, r.extCnt);
        String h = u.getRequestProperty("traceparent");
        assertTrue(h, h.matches("00-" + r.traceId + "-[0-9a-f]{16}-01"));
        assertTrue(r.hasDetail());
        assertEquals("ext", r.nodes.get(1).kind);
        assertEquals("http://example.com:8080/api/items", r.nodes.get(1).name);
    }

    @Test
    public void callOutsideTransactionIsUntouched() throws Exception {
        HttpURLConnection u = (HttpURLConnection) env.loader.loadClass("testapp.StubHttpURLConnection").newInstance();
        assertEquals(200, u.getResponseCode());
        assertEquals(null, u.getRequestProperty("traceparent"));
        assertEquals(0, env.records().size());
    }
}
