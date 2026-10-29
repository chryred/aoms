package com.synapsev.agentt.transport;

import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.model.TxRecord;
import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import org.junit.Test;

public class SenderOverflowTest {
    /** Poster that never answers until the test ends. */
    static final class BlockingPoster extends HttpPoster {
        final CountDownLatch release = new CountDownLatch(1);

        BlockingPoster() {
            super("http://127.0.0.1:1", "t");
        }

        @Override
        public Response post(byte[] gzipJson) throws IOException {
            try {
                release.await();
            } catch (InterruptedException e) {
                throw new IOException("interrupted");
            }
            return new Response(503, "");
        }
    }

    static final class FastPoster extends HttpPoster {
        FastPoster() {
            super("http://127.0.0.1:1", "t");
        }

        @Override
        public Response post(byte[] gzipJson) {
            return new Response(200, "{}");
        }
    }

    private static Sender newSender(HttpPoster p) {
        return new Sender(p, new AgentConfig(), new Batch.AgentInfo(), 20);
    }

    @Test
    public void blockedGatewayNeverBlocksOrGrowsPastCap() throws Exception {
        // warm up the JIT on a separate sender so emulated/slow hosts are measured fairly
        Sender warm = newSender(new FastPoster());
        warm.start();
        for (int i = 0; i < 20000; i++) {
            warm.offerTx(TestData.tx(i, i % 2 == 0));
        }
        warm.stop();

        BlockingPoster poster = new BlockingPoster();
        Sender s = newSender(poster);
        s.start();
        try {
            final int total = 100000;
            long spentNanos = 0;
            int firstDetailDrop = -1;
            int firstTxDrop = -1;
            long maxBuffered = 0;
            for (int i = 0; i < total; i++) {
                TxRecord t = TestData.tx(i, true);
                long t0 = System.nanoTime();
                s.offerTx(t);
                spentNanos += System.nanoTime() - t0;
                if (firstDetailDrop < 0 && s.droppedDetail() > 0) {
                    firstDetailDrop = i;
                }
                if (firstTxDrop < 0 && s.droppedTx() > 0) {
                    firstTxDrop = i;
                }
                if ((i & 255) == 0) {
                    maxBuffered = Math.max(maxBuffered, s.bufferedBytes());
                }
            }
            maxBuffered = Math.max(maxBuffered, s.bufferedBytes());
            double avgMicros = spentNanos / 1000.0 / total;
            assertTrue("avg offerTx micros=" + avgMicros, avgMicros < 50.0);
            assertTrue("buffered=" + maxBuffered, maxBuffered <= Sender.MAX_BUFFER_BYTES);
            assertTrue("detail drops should occur", s.droppedDetail() > 0);
            assertTrue("detail dropped before tx: " + firstDetailDrop + " vs " + firstTxDrop,
                    firstTxDrop < 0 || firstDetailDrop <= firstTxDrop);
            assertTrue(s.droppedTx() > 0);
        } finally {
            poster.release.countDown();
            s.stop();
        }
    }
}
