package com.synapsev.agentt.active;

import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.log.AgentLog;
import com.synapsev.agentt.model.TxRecord;
import com.synapsev.agentt.tx.TxContext;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Daemon that samples the stacks of slow in-flight transactions (elapsed >= slowMs), oldest first, at most
 * {@link #MAX_TARGETS} per cycle. Keeps the newest stack per transaction for the active list and a
 * frame-frequency table (capped at {@link #MAX_DISTINCT} stacks) that is handed to the transaction's detail
 * when it finishes.
 */
public final class StackSampler {
    static final int MAX_TARGETS = 20;
    static final int MAX_FRAMES = 64;
    static final int MAX_DISTINCT = 200;
    private static final long MIN_INTERVAL_MS = 100;
    private static final String AGENT_PACKAGE = "com.synapsev.agentt.";

    private static final class State {
        final Map<String, TxRecord.StackSample> freq = new LinkedHashMap<String, TxRecord.StackSample>();
        volatile List<String> latest = Collections.emptyList();
    }

    private final ActiveRegistry registry;
    private final AgentConfig config;
    private final Map<TxContext, State> states = new ConcurrentHashMap<TxContext, State>();
    private volatile boolean running;
    private Thread thread;

    public StackSampler(ActiveRegistry registry, AgentConfig config) {
        this.registry = registry;
        this.config = config;
        registry.attach(this);
    }

    /** Newest sampled stack of a transaction (innermost frame first); empty when never sampled. */
    List<String> latest(TxContext c) {
        State s = states.get(c);
        return s == null ? new ArrayList<String>() : new ArrayList<String>(s.latest);
    }

    /** Removes and returns the frequency table (count descending), or null when nothing was sampled. */
    public List<TxRecord.StackSample> take(TxContext c) {
        State s = states.remove(c);
        if (s == null) {
            return null;
        }
        List<TxRecord.StackSample> out;
        synchronized (s) {
            out = new ArrayList<TxRecord.StackSample>(s.freq.values());
        }
        if (out.isEmpty()) {
            return null;
        }
        Collections.sort(out, new Comparator<TxRecord.StackSample>() {
            public int compare(TxRecord.StackSample a, TxRecord.StackSample b) {
                return b.count - a.count;
            }
        });
        return out;
    }

    /** One sampling pass; returns how many transactions were sampled. */
    public int sampleOnce(long nowMs) {
        long slow = config.slowMs;
        List<TxContext> targets = new ArrayList<TxContext>();
        List<TxContext> all = registry.contexts();
        for (int i = 0; i < all.size(); i++) {
            TxContext c = all.get(i);
            if (nowMs - c.startTs >= slow) {
                targets.add(c);
            }
        }
        Collections.sort(targets, new Comparator<TxContext>() {
            public int compare(TxContext a, TxContext b) {
                return a.startTs < b.startTs ? -1 : (a.startTs == b.startTs ? 0 : 1);
            }
        });
        int sampled = 0;
        for (int i = 0; i < targets.size() && sampled < MAX_TARGETS; i++) {
            TxContext c = targets.get(i);
            String[] frames = capture(c.thread);
            if (frames.length == 0) {
                continue;
            }
            sampled++;
            record(c, frames);
        }
        purge();
        return sampled;
    }

    private void record(TxContext c, String[] frames) {
        State s = states.get(c);
        if (s == null) {
            s = new State();
            states.put(c, s);
        }
        s.latest = java.util.Arrays.asList(frames);
        StringBuilder key = new StringBuilder();
        for (int i = 0; i < frames.length; i++) {
            key.append(frames[i]).append('\n');
        }
        String k = key.toString();
        synchronized (s) {
            TxRecord.StackSample f = s.freq.get(k);
            if (f == null) {
                if (s.freq.size() >= MAX_DISTINCT) {
                    return;
                }
                f = new TxRecord.StackSample();
                f.frames = frames;
                s.freq.put(k, f);
            }
            f.count++;
        }
    }

    /** Drops state of transactions that already ended (a sample may race with {@link #take}). */
    private void purge() {
        for (TxContext c : states.keySet()) {
            if (!registry.contains(c)) {
                states.remove(c);
            }
        }
    }

    private static String[] capture(Thread t) {
        StackTraceElement[] st;
        try {
            st = t == null ? null : t.getStackTrace();
        } catch (Throwable e) {
            return new String[0];
        }
        if (st == null) {
            return new String[0];
        }
        List<String> out = new ArrayList<String>();
        for (int i = 0; i < st.length && out.size() < MAX_FRAMES; i++) {
            String cls = st[i].getClassName();
            if (cls.startsWith(AGENT_PACKAGE)) {
                continue; // agent and bridge frames are noise for the user
            }
            out.add(format(st[i]));
        }
        return out.toArray(new String[out.size()]);
    }

    static String format(StackTraceElement e) {
        String file = e.getFileName();
        StringBuilder b = new StringBuilder();
        b.append(e.getClassName()).append('.').append(e.getMethodName()).append('(');
        if (file == null) {
            b.append("Unknown Source");
        } else {
            b.append(file);
            if (e.getLineNumber() >= 0) {
                b.append(':').append(e.getLineNumber());
            }
        }
        return b.append(')').toString();
    }

    public synchronized void start() {
        if (running) {
            return;
        }
        running = true;
        thread = new Thread(new Runnable() {
            public void run() {
                loop();
            }
        }, "agent-t-sampler");
        thread.setDaemon(true);
        thread.start();
    }

    public synchronized void stop() {
        running = false;
        if (thread != null) {
            thread.interrupt();
            thread = null;
        }
    }

    private void loop() {
        while (running) {
            try {
                Thread.sleep(Math.max(MIN_INTERVAL_MS, config.stackIntervalMs));
                sampleOnce(System.currentTimeMillis());
            } catch (InterruptedException e) {
                return;
            } catch (Throwable t) {
                AgentLog.error("stack sampler", t);
            }
        }
    }
}
