package com.synapsev.agentt.transport;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.json.JsonReader;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.Test;

public class SenderBackoffTest {
    static final class ScriptedPoster extends HttpPoster {
        final List<String> bodies = new CopyOnWriteArrayList<String>();
        final List<Long> times = new CopyOnWriteArrayList<Long>();
        private final String[] sqlIdsWanted;

        ScriptedPoster(String... needSql) {
            super("http://127.0.0.1:1", "t");
            this.sqlIdsWanted = needSql;
        }

        @Override
        public Response post(byte[] gzipJson) throws IOException {
            bodies.add(TestData.gunzip(gzipJson));
            times.add(System.nanoTime());
            int n = bodies.size();
            if (n == 1) {
                return new Response(429, "{\"backoff_ms\":2000}");
            }
            if (n == 3 && sqlIdsWanted.length > 0) {
                return new Response(200, "{\"need_dict\":{\"sql\":[\"" + sqlIdsWanted[0] + "\"],\"uri\":[]}}");
            }
            return new Response(200, "{\"backoff_ms\":0}");
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> parse(String s) {
        return (Map<String, Object>) JsonReader.parse(s);
    }

    private static boolean waitFor(List<String> l, int n, long ms) throws InterruptedException {
        long end = System.currentTimeMillis() + ms;
        while (l.size() < n && System.currentTimeMillis() < end) {
            Thread.sleep(10);
        }
        return l.size() >= n;
    }

    @Test
    public void detailOmittedAfter429() throws Exception {
        ScriptedPoster poster = new ScriptedPoster();
        Sender s = new Sender(poster, new AgentConfig(), new Batch.AgentInfo(), 50);
        s.offerTx(TestData.tx(1, true));
        s.start();
        try {
            assertTrue(waitFor(poster.bodies, 1, 5000));
            Map<String, Object> first = parse(poster.bodies.get(0));
            assertNotNull(((Map<?, ?>) TestData.list(first.get("tx")).get(0)).get("detail"));

            s.offerTx(TestData.tx(2, true));
            assertTrue(waitFor(poster.bodies, 2, 8000));
            Map<String, Object> second = parse(poster.bodies.get(1));
            List<Object> txs = TestData.list(second.get("tx"));
            assertEquals(2, txs.size());
            for (Object o : txs) {
                assertNull(((Map<?, ?>) o).get("detail"));
            }
            long gapMs = (poster.times.get(1) - poster.times.get(0)) / 1000000L;
            assertTrue("gap=" + gapMs, gapMs >= 1800);
        } finally {
            s.stop();
        }
    }

    @Test
    public void dictSentOnceThenOnNeedDict() throws Exception {
        ScriptedPoster poster = new ScriptedPoster("1122334455667788");
        Sender s = new Sender(poster, new AgentConfig(), new Batch.AgentInfo(), 50);
        s.defineSql("1122334455667788", "select * from orders where id = ?");
        s.offerTx(TestData.tx(1, false));
        s.start();
        try {
            assertTrue(waitFor(poster.bodies, 2, 8000));
            // batch 1 hit 429 (not acknowledged) so batch 2 still carries the dictionary entry
            assertTrue(poster.bodies.get(1).contains("select * from orders where id = ?"));
            s.offerTx(TestData.tx(3, false));
            assertTrue(waitFor(poster.bodies, 3, 3000));
            assertTrue("acked dict must not repeat", !poster.bodies.get(2).contains("select * from orders where id = ?"));
            s.offerTx(TestData.tx(4, false));
            assertTrue(waitFor(poster.bodies, 4, 3000));
            assertTrue("need_dict forces resend", poster.bodies.get(3).contains("select * from orders where id = ?"));
        } finally {
            s.stop();
        }
    }
}
