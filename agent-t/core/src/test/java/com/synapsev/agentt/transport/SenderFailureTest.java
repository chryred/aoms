package com.synapsev.agentt.transport;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.conf.AgentConfig;
import java.io.IOException;
import org.junit.Test;

/** Spec 6.8: one retry after a failed send, then discard (newest data must stay admissible). */
public class SenderFailureTest {
    static final class ThrowingPoster extends HttpPoster {
        volatile int calls;

        ThrowingPoster() {
            super("http://127.0.0.1:1", "t");
        }

        @Override
        public Response post(byte[] gzipJson) throws IOException {
            calls++;
            throw new IOException("gateway down");
        }
    }

    private static boolean until(Sender s, int dropped, long ms) throws InterruptedException {
        long end = System.currentTimeMillis() + ms;
        while (s.droppedTx() < dropped && System.currentTimeMillis() < end) {
            Thread.sleep(10);
        }
        return s.droppedTx() >= dropped;
    }

    @Test
    public void failedBatchIsRetriedOnceThenDroppedAndBufferFreed() throws Exception {
        ThrowingPoster poster = new ThrowingPoster();
        Sender s = new Sender(poster, new AgentConfig(), new Batch.AgentInfo(), 20);
        s.setFailurePauses(30, 30);
        for (int i = 0; i < 100; i++) {
            s.offerTx(TestData.tx(i, true));
        }
        s.start();
        try {
            assertTrue("dropped=" + s.droppedTx(), until(s, 100, 5000));
            assertEquals(0, s.bufferedBytes());
            assertEquals(100, s.droppedTx());
            assertTrue(s.droppedDetail() > 0);
            assertTrue(s.droppedSql() > 0);

            // a fresh tx is admitted rather than rejected by stale data
            long before = s.droppedTx();
            s.offerTx(TestData.tx(1000, true));
            assertTrue(s.bufferedBytes() > 0);
            assertEquals(before, s.droppedTx());
            assertTrue(until(s, 101, 5000));
            assertEquals(0, s.bufferedBytes());
            assertTrue(poster.calls >= 4);
        } finally {
            s.stop();
        }
    }
}
