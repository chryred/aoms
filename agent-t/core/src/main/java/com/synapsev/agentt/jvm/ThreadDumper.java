package com.synapsev.agentt.jvm;

import java.lang.management.LockInfo;
import java.lang.management.ManagementFactory;
import java.lang.management.MonitorInfo;
import java.lang.management.ThreadInfo;
import java.lang.management.ThreadMXBean;

/** On-demand thread dump in a jstack-like format. At most one dump per {@link #MIN_GAP_MS} per instance. */
public final class ThreadDumper {
    public static final int DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
    static final long MIN_GAP_MS = 60000L;

    /** Monotonic clock in nanoseconds (injectable for tests). */
    interface Ticker {
        long nanos();
    }

    private final Ticker ticker;
    private long lastDumpNanos;
    private boolean dumped;

    public ThreadDumper() {
        this(new Ticker() {
            public long nanos() {
                return System.nanoTime();
            }
        });
    }

    ThreadDumper(Ticker ticker) {
        this.ticker = ticker;
    }

    /** Returns {text, "true"|"false" (truncated)}, or null when the 60 s limit applies. */
    public synchronized String[] dump(int maxBytes) {
        long now = ticker.nanos();
        if (dumped && now - lastDumpNanos < MIN_GAP_MS * 1000000L) {
            return null;
        }
        dumped = true;
        lastDumpNanos = now;
        String text = render(ManagementFactory.getThreadMXBean());
        boolean truncated = false;
        if (utf8Len(text) > maxBytes) {
            text = cut(text, maxBytes);
            truncated = true;
        }
        return new String[] {text, String.valueOf(truncated)};
    }

    static String render(ThreadMXBean mx) {
        ThreadInfo[] infos = mx.dumpAllThreads(true, true);
        StringBuilder b = new StringBuilder(16 * 1024);
        b.append("Full thread dump (").append(infos.length).append(" threads) ts=")
                .append(System.currentTimeMillis()).append("\n\n");
        for (int i = 0; i < infos.length; i++) {
            ThreadInfo t = infos[i];
            if (t == null) {
                continue;
            }
            b.append('"').append(t.getThreadName()).append("\" Id=").append(t.getThreadId()).append(' ')
                    .append(t.getThreadState());
            if (t.getLockName() != null) {
                b.append(" on ").append(t.getLockName());
            }
            if (t.getLockOwnerName() != null) {
                b.append(" owned by \"").append(t.getLockOwnerName()).append("\" Id=").append(t.getLockOwnerId());
            }
            if (t.isSuspended()) {
                b.append(" (suspended)");
            }
            if (t.isInNative()) {
                b.append(" (in native)");
            }
            b.append('\n');
            StackTraceElement[] st = t.getStackTrace();
            MonitorInfo[] mons = t.getLockedMonitors();
            for (int j = 0; j < st.length; j++) {
                b.append("\tat ").append(st[j]).append('\n');
                for (int k = 0; k < mons.length; k++) {
                    if (mons[k].getLockedStackDepth() == j) {
                        b.append("\t- locked ").append(mons[k]).append('\n');
                    }
                }
            }
            LockInfo[] syncs = t.getLockedSynchronizers();
            if (syncs.length > 0) {
                b.append("\n\tLocked synchronizers: ").append(syncs.length).append('\n');
                for (int k = 0; k < syncs.length; k++) {
                    b.append("\t- ").append(syncs[k]).append('\n');
                }
            }
            b.append('\n');
        }
        return b.toString();
    }

    private static int utf8Len(String s) {
        try {
            return s.getBytes("UTF-8").length;
        } catch (java.io.UnsupportedEncodingException e) {
            return s.length();
        }
    }

    /** Longest prefix whose UTF-8 form fits in maxBytes, never splitting a surrogate pair. */
    private static String cut(String s, int maxBytes) {
        int end = Math.min(s.length(), Math.max(0, maxBytes));
        while (end > 0 && utf8Len(s.substring(0, end)) > maxBytes) {
            end = Math.max(0, end - Math.max(1, (utf8Len(s.substring(0, end)) - maxBytes) / 3));
        }
        if (end > 0 && Character.isHighSurrogate(s.charAt(end - 1))) {
            end--;
        }
        return s.substring(0, end);
    }
}
