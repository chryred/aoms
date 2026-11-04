package com.synapsev.agentt.jvm.pool;

/** JEUS JDBCConnectionPoolStatsImpl 흉내(같은 getter 이름). 별도 클래스로더에서 로드해 쓴다. */
public class FakeJeusStats {
    /** JSR-77 RangeStatistic 흉내. */
    public static class Range {
        private final long current;
        private final long upper;

        public Range(long current, long upper) {
            this.current = current;
            this.upper = upper;
        }

        public long getCurrent() {
            return current;
        }

        public long getUpperBound() {
            return upper;
        }
    }

    private final long size;
    private final long free;
    private final long max;
    private final long wait;

    public FakeJeusStats(long size, long free, long max, long wait) {
        this.size = size;
        this.free = free;
        this.max = max;
        this.wait = wait;
    }

    public Range getPoolSize() {
        return new Range(size, 30);
    }

    public Range getFreePoolSize() {
        return new Range(free, 30);
    }

    public Range getMaxPoolSize() {
        return new Range(max, max);
    }

    public Range getWaitingThreadCount() {
        return new Range(wait, 0);
    }
}
