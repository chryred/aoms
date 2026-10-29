package com.synapsev.agentt.transport;

import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.json.JsonReader;
import com.synapsev.agentt.log.AgentLog;
import com.synapsev.agentt.model.ActiveEntry;
import com.synapsev.agentt.model.DetailNode;
import com.synapsev.agentt.model.JvmSample;
import com.synapsev.agentt.model.SqlAgg;
import com.synapsev.agentt.model.TxRecord;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Bounded, non-blocking batch sender. offer* never waits for the network: one daemon thread builds a
 * batch every interval and posts it. Estimated buffered bytes are capped at {@link #MAX_BUFFER_BYTES};
 * when over, details are shed first, then SQL aggregates, then whole transactions.
 */
public final class Sender {
    /** Receives gateway commands from responses. */
    public interface CommandListener {
        void onCommand(long id, String type);
    }

    public static final long MAX_BUFFER_BYTES = 8L * 1024 * 1024;
    private static final long DRAIN_BYTES = 2L * 1024 * 1024;
    private static final long DICT_CHAR_BUDGET = 4L * 1024 * 1024;
    private static final int SENT_ID_LIMIT = 200000;
    private static final long NETWORK_PAUSE_MS = 5000;
    private static final long UNAUTH_PAUSE_MS = 60000;

    private static final class ActiveSnapshot {
        final List<ActiveEntry> top;
        final int[] buckets;

        ActiveSnapshot(List<ActiveEntry> top, int[] buckets) {
            this.top = top;
            this.buckets = buckets;
        }
    }

    private final HttpPoster poster;
    private final AgentConfig config;
    private final Batch.AgentInfo agent;
    private final long intervalMs;

    private final ConcurrentLinkedQueue<TxRecord> txQueue = new ConcurrentLinkedQueue<TxRecord>();
    private final ConcurrentLinkedQueue<Batch.Dump> dumpQueue = new ConcurrentLinkedQueue<Batch.Dump>();
    private final AtomicReference<ActiveSnapshot> activeRef = new AtomicReference<ActiveSnapshot>();
    private final AtomicReference<JvmSample> jvmRef = new AtomicReference<JvmSample>();
    private final AtomicLong bytes = new AtomicLong();
    private final AtomicLong dropDetail = new AtomicLong();
    private final AtomicLong dropSql = new AtomicLong();
    private final AtomicLong dropTx = new AtomicLong();

    private final Map<String, String> sqlTexts = new ConcurrentHashMap<String, String>();
    private final Map<String, String> uriTexts = new ConcurrentHashMap<String, String>();
    private final AtomicLong dictChars = new AtomicLong();

    // owned by the sender thread
    private final List<TxRecord> retryTx = new ArrayList<TxRecord>();
    private final List<Batch.Dump> retryDumps = new ArrayList<Batch.Dump>();
    private final Set<String> sentSql = new HashSet<String>();
    private final Set<String> sentUri = new HashSet<String>();
    private final Set<String> needSql = new HashSet<String>();
    private final Set<String> needUri = new HashSet<String>();
    private long seq;
    private long reportedDetail;
    private long reportedSql;
    private long reportedTx;
    private long pauseUntilNanos;

    private volatile long backoffUntilNanos;
    private volatile CommandListener listener;
    private volatile boolean running;
    private Thread thread;

    public Sender(HttpPoster poster, AgentConfig config, Batch.AgentInfo agent, long intervalMs) {
        this.poster = poster;
        this.config = config;
        this.agent = agent;
        this.intervalMs = intervalMs;
    }

    public void setCommandListener(CommandListener l) {
        this.listener = l;
    }

    // ---- WAS-thread API: never blocks, never throws ----

    public void offerTx(TxRecord tx) {
        if (tx == null) {
            return;
        }
        try {
            if (tx.hasDetail() && System.nanoTime() - backoffUntilNanos < 0) {
                tx.stripDetail();
                dropDetail.incrementAndGet();
            }
            long est = tx.estimateBytes();
            while (true) {
                long cur = bytes.get();
                if (cur + est <= MAX_BUFFER_BYTES) {
                    if (bytes.compareAndSet(cur, cur + est)) {
                        txQueue.add(tx);
                        return;
                    }
                    continue;
                }
                if (tx.hasDetail()) {
                    tx.stripDetail();
                    dropDetail.incrementAndGet();
                } else if (tx.sql != null && !tx.sql.isEmpty()) {
                    dropSql.addAndGet(tx.sql.size());
                    tx.sql = Collections.<SqlAgg>emptyList();
                } else {
                    dropTx.incrementAndGet();
                    return;
                }
                est = tx.estimateBytes();
            }
        } catch (Throwable ignore) {
            // never affect the host thread
        }
    }

    /** Latest snapshot wins; older unsent snapshots are replaced. */
    public void offerActive(List<ActiveEntry> top, int[] buckets) {
        activeRef.set(new ActiveSnapshot(top == null ? new ArrayList<ActiveEntry>() : top, buckets));
    }

    public void offerJvm(JvmSample s) {
        jvmRef.set(s);
    }

    public void offerDump(long cmdId, String text, boolean truncated) {
        try {
            Batch.Dump d = new Batch.Dump();
            d.cmdId = cmdId;
            d.ts = System.currentTimeMillis();
            d.text = text == null ? "" : text;
            d.truncated = truncated;
            long est = d.text.length() + 128L;
            while (true) {
                long cur = bytes.get();
                if (cur + est > MAX_BUFFER_BYTES) {
                    return;
                }
                if (bytes.compareAndSet(cur, cur + est)) {
                    dumpQueue.add(d);
                    return;
                }
            }
        } catch (Throwable ignore) {
            // ignore
        }
    }

    /** Registers the normalized SQL text for an ID so the dictionary can be sent / re-sent. */
    public void defineSql(String id, String text) {
        define(sqlTexts, id, text);
    }

    public void defineUri(String id, String text) {
        define(uriTexts, id, text);
    }

    private void define(Map<String, String> m, String id, String text) {
        if (id == null || text == null || m.containsKey(id)) {
            return;
        }
        if (dictChars.addAndGet(text.length()) > DICT_CHAR_BUDGET) {
            dictChars.addAndGet(-text.length());
            return;
        }
        m.put(id, text);
    }

    // ---- counters (cumulative) ----

    public long droppedDetail() {
        return dropDetail.get();
    }

    public long droppedSql() {
        return dropSql.get();
    }

    public long droppedTx() {
        return dropTx.get();
    }

    public long bufferedBytes() {
        return bytes.get();
    }

    // ---- lifecycle ----

    public synchronized void start() {
        if (running) {
            return;
        }
        running = true;
        thread = new Thread(new Runnable() {
            public void run() {
                loop();
            }
        }, "agent-t-sender");
        thread.setDaemon(true);
        thread.start();
    }

    public synchronized void stop() {
        running = false;
        if (thread != null) {
            thread.interrupt();
            try {
                thread.join(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            thread = null;
        }
    }

    // ---- sender thread ----

    private void loop() {
        while (running) {
            try {
                Thread.sleep(intervalMs);
            } catch (InterruptedException e) {
                return;
            }
            if (System.nanoTime() - pauseUntilNanos < 0) {
                continue;
            }
            try {
                cycle();
            } catch (Throwable t) {
                if (!running) {
                    return;
                }
                AgentLog.error("sender cycle failed", t);
            }
        }
    }

    private void cycle() throws Exception {
        List<TxRecord> txs = new ArrayList<TxRecord>(retryTx);
        retryTx.clear();
        List<Batch.Dump> dumps = new ArrayList<Batch.Dump>(retryDumps);
        retryDumps.clear();
        long drained = 0;
        for (int i = 0; i < txs.size(); i++) {
            drained += txs.get(i).estimateBytes();
        }
        TxRecord t;
        while (drained < DRAIN_BYTES && (t = txQueue.poll()) != null) {
            txs.add(t);
            drained += t.estimateBytes();
        }
        Batch.Dump d;
        while ((d = dumpQueue.poll()) != null) {
            dumps.add(d);
        }
        if (System.nanoTime() - backoffUntilNanos < 0) {
            for (int i = 0; i < txs.size(); i++) {
                stripAccounted(txs.get(i));
            }
        }

        Batch b = new Batch();
        b.seq = ++seq;
        b.ts = System.currentTimeMillis();
        b.cfgV = config.version;
        b.agent = agent;
        b.tx = txs;
        b.dumps = dumps;
        b.jvm = jvmRef.getAndSet(null);
        ActiveSnapshot a = activeRef.getAndSet(null);
        if (a != null) {
            b.activeTop = a.top;
            if (a.buckets != null) {
                b.activeBuckets = a.buckets;
            }
        }
        collectDict(b);
        long dd = dropDetail.get();
        long ds = dropSql.get();
        long dt = dropTx.get();
        b.droppedDetail = dd - reportedDetail;
        b.droppedSql = ds - reportedSql;
        b.droppedTx = dt - reportedTx;

        HttpPoster.Response r;
        try {
            r = poster.post(BatchSerializer.serialize(b));
        } catch (java.io.IOException e) {
            if (!running) {
                return;
            }
            AgentLog.warn("post failed: " + e);
            requeue(txs, dumps);
            pauseFor(NETWORK_PAUSE_MS);
            return;
        }

        switch (r.status) {
            case 200:
                release(txs, dumps);
                reportedDetail = dd;
                reportedSql = ds;
                reportedTx = dt;
                sentSql.addAll(b.dictSql.keySet());
                sentUri.addAll(b.dictUri.keySet());
                needSql.clear();
                needUri.clear();
                if (sentSql.size() > SENT_ID_LIMIT) {
                    sentSql.clear();
                }
                if (sentUri.size() > SENT_ID_LIMIT) {
                    sentUri.clear();
                }
                handleOk(r.body);
                break;
            case 400:
                AgentLog.warn("gateway rejected batch (400), discarding");
                release(txs, dumps);
                reportedDetail = dd;
                reportedSql = ds;
                reportedTx = dt;
                break;
            case 401:
                AgentLog.warn("gateway auth failed (401), retry in 60s");
                requeue(txs, dumps);
                pauseFor(UNAUTH_PAUSE_MS);
                break;
            case 429:
                long backoff = parseBackoff(r.body, 1000);
                backoffUntilNanos = System.nanoTime() + backoff * 1000000L;
                for (int i = 0; i < txs.size(); i++) {
                    stripAccounted(txs.get(i));
                }
                requeue(txs, dumps);
                pauseFor(backoff);
                break;
            default:
                AgentLog.warn("unexpected gateway status " + r.status);
                requeue(txs, dumps);
                pauseFor(NETWORK_PAUSE_MS);
        }
    }

    private void pauseFor(long ms) {
        pauseUntilNanos = System.nanoTime() + ms * 1000000L;
    }

    /** Strips detail from a record already counted in {@link #bytes}, keeping the accounting exact. */
    private void stripAccounted(TxRecord t) {
        if (!t.hasDetail()) {
            return;
        }
        long before = t.estimateBytes();
        t.stripDetail();
        bytes.addAndGet(t.estimateBytes() - before);
        dropDetail.incrementAndGet();
    }

    private void requeue(List<TxRecord> txs, List<Batch.Dump> dumps) {
        retryTx.addAll(txs);
        retryDumps.addAll(dumps);
    }

    private void release(List<TxRecord> txs, List<Batch.Dump> dumps) {
        long n = 0;
        for (int i = 0; i < txs.size(); i++) {
            n += txs.get(i).estimateBytes();
        }
        for (int i = 0; i < dumps.size(); i++) {
            n += dumps.get(i).text.length() + 128L;
        }
        bytes.addAndGet(-n);
    }

    private void collectDict(Batch b) {
        for (int i = 0; i < b.tx.size(); i++) {
            TxRecord t = b.tx.get(i);
            addUri(b, t.uriId);
            if (t.sql != null) {
                for (int j = 0; j < t.sql.size(); j++) {
                    addSql(b, t.sql.get(j).sqlId);
                }
            }
            if (t.nodes != null) {
                for (int j = 0; j < t.nodes.size(); j++) {
                    DetailNode n = t.nodes.get(j);
                    addSql(b, n.sqlId);
                }
            }
        }
        for (int i = 0; i < b.activeTop.size(); i++) {
            ActiveEntry e = b.activeTop.get(i);
            addUri(b, e.uriId);
            addSql(b, e.sqlId);
        }
        for (String id : needSql) {
            forceSql(b, id);
        }
        for (String id : needUri) {
            forceUri(b, id);
        }
    }

    private void addSql(Batch b, String id) {
        if (id != null && id.length() > 0 && !sentSql.contains(id)) {
            forceSql(b, id);
        }
    }

    private void addUri(Batch b, String id) {
        if (id != null && id.length() > 0 && !sentUri.contains(id)) {
            forceUri(b, id);
        }
    }

    private void forceSql(Batch b, String id) {
        String text = sqlTexts.get(id);
        if (text != null) {
            b.dictSql.put(id, text);
        }
    }

    private void forceUri(Batch b, String id) {
        String text = uriTexts.get(id);
        if (text != null) {
            b.dictUri.put(id, text);
        }
    }

    private static long parseBackoff(String body, long fallback) {
        try {
            Object o = JsonReader.parse(body);
            if (o instanceof Map && ((Map<?, ?>) o).get("backoff_ms") instanceof Number) {
                long v = ((Number) ((Map<?, ?>) o).get("backoff_ms")).longValue();
                return v > 0 ? Math.min(v, 300000L) : fallback;
            }
        } catch (RuntimeException ignore) {
            // fall through
        }
        return fallback;
    }

    private void handleOk(String body) {
        Object root;
        try {
            root = JsonReader.parse(body);
        } catch (RuntimeException e) {
            AgentLog.warn("unparseable gateway response: " + e.getMessage());
            return;
        }
        if (!(root instanceof Map)) {
            return;
        }
        Map<?, ?> m = (Map<?, ?>) root;
        try {
            if (m.get("config") instanceof Map) {
                config.applyJson(body);
                AgentLog.setLevel(config.logLevel);
            }
        } catch (RuntimeException e) {
            AgentLog.warn("config apply failed: " + e.getMessage());
        }
        if (m.get("need_dict") instanceof Map) {
            Map<?, ?> nd = (Map<?, ?>) m.get("need_dict");
            collectIds(nd.get("sql"), needSql, sentSql);
            collectIds(nd.get("uri"), needUri, sentUri);
        }
        CommandListener l = listener;
        if (l != null && m.get("commands") instanceof List) {
            for (Object o : (List<?>) m.get("commands")) {
                if (o instanceof Map) {
                    Map<?, ?> c = (Map<?, ?>) o;
                    if (c.get("id") instanceof Number && c.get("type") instanceof String) {
                        try {
                            l.onCommand(((Number) c.get("id")).longValue(), (String) c.get("type"));
                        } catch (Throwable t) {
                            AgentLog.error("command listener failed", t);
                        }
                    }
                }
            }
        }
        if (m.get("backoff_ms") instanceof Number) {
            long ms = ((Number) m.get("backoff_ms")).longValue();
            if (ms > 0) {
                pauseFor(Math.min(ms, 300000L));
            }
        }
    }

    private static void collectIds(Object list, Set<String> need, Set<String> sent) {
        if (list instanceof List) {
            for (Object o : (List<?>) list) {
                if (o instanceof String) {
                    need.add((String) o);
                    sent.remove(o);
                }
            }
        }
    }
}
