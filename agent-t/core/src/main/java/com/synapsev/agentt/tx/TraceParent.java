package com.synapsev.agentt.tx;

import java.util.concurrent.atomic.AtomicLong;

/** W3C Trace Context "traceparent" parsing/formatting plus cheap random ID generation. */
public final class TraceParent {
    private static final char[] HEX = "0123456789abcdef".toCharArray();
    private static final AtomicLong SEED = new AtomicLong(System.nanoTime());
    private static final ThreadLocal<long[]> RNG = new ThreadLocal<long[]>();

    public final String traceId;
    public final String spanId;

    private TraceParent(String traceId, String spanId) {
        this.traceId = traceId;
        this.spanId = spanId;
    }

    /** Returns null for anything that is not a valid header. */
    public static TraceParent parse(String h) {
        if (h == null) {
            return null;
        }
        h = h.trim();
        int n = h.length();
        if (n < 55 || h.charAt(2) != '-' || h.charAt(35) != '-' || h.charAt(52) != '-') {
            return null;
        }
        if (!isHex(h, 0, 2) || h.startsWith("ff")) {
            return null;
        }
        if (h.startsWith("00") && n != 55) {
            return null;
        }
        if (n > 55 && h.charAt(55) != '-') {
            return null;
        }
        if (!isHex(h, 3, 32) || !isHex(h, 36, 16) || !isHex(h, 53, 2)) {
            return null;
        }
        String trace = h.substring(3, 35);
        String span = h.substring(36, 52);
        if (allZero(trace) || allZero(span)) {
            return null;
        }
        return new TraceParent(trace, span);
    }

    public static String format(String traceId, String spanId) {
        return "00-" + traceId + "-" + spanId + "-01";
    }

    public static String newTraceId() {
        return hex16(next()) + hex16(next());
    }

    public static String newSpanId() {
        return hex16(next());
    }

    private static boolean isHex(String s, int from, int len) {
        for (int i = from; i < from + len; i++) {
            char c = s.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
                return false;
            }
        }
        return true;
    }

    private static boolean allZero(String s) {
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) != '0') {
                return false;
            }
        }
        return true;
    }

    private static String hex16(long v) {
        char[] out = new char[16];
        for (int i = 15; i >= 0; i--) {
            out[i] = HEX[(int) (v & 0xf)];
            v >>>= 4;
        }
        return new String(out);
    }

    private static long mix(long z) {
        z = (z ^ (z >>> 30)) * 0xbf58476d1ce4e5b9L;
        z = (z ^ (z >>> 27)) * 0x94d049bb133111ebL;
        return z ^ (z >>> 31);
    }

    /** Per-thread xorshift64 seeded with splitmix64; never returns 0. */
    private static long next() {
        long[] s = RNG.get();
        if (s == null) {
            long seed = mix(System.nanoTime() ^ ((long) System.identityHashCode(Thread.currentThread()) << 32)
                    ^ SEED.addAndGet(0x9E3779B97F4A7C15L));
            s = new long[] {seed == 0 ? 1 : seed};
            RNG.set(s);
        }
        long x = s[0];
        x ^= x << 13;
        x ^= x >>> 7;
        x ^= x << 17;
        s[0] = x;
        return x == 0 ? 1 : x;
    }
}
