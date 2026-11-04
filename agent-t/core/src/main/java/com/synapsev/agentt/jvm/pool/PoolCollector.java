package com.synapsev.agentt.jvm.pool;

import com.synapsev.agentt.log.AgentLog;
import com.synapsev.agentt.model.JvmSample;
import com.synapsev.agentt.model.PoolSample;
import java.lang.ref.WeakReference;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import javax.management.InstanceNotFoundException;
import javax.management.MBeanAttributeInfo;
import javax.management.MBeanServer;
import javax.management.MBeanServerFactory;
import javax.management.ObjectName;

/**
 * DB 커넥션 풀 지표 수집기(JMX 읽기 전용). 전용 데몬 스레드 {@code agent-t-pool} 에서만 JMX 를 호출하고,
 * JVM 샘플러({@code agent-t-jvm})는 마지막으로 완료된 스냅샷만 {@link #fill} 로 읽는다.
 *
 * <p>규칙(위반 금지):
 * <ul>
 * <li>MBeanServer 는 {@code MBeanServerFactory.findMBeanServer(null)} 로 이미 만들어진 것만 찾는다. JEUS 는 플랫폼이
 * 아닌 자체 MBeanServer 를 쓰며, 플랫폼 MBeanServer 를 생성시키는 API 는 호출하지 않는다(기동 부작용).</li>
 * <li>MBean 에는 {@code getAttribute} 와 탐색용 {@code queryNames}/{@code getMBeanInfo} 만 쓴다. {@code invoke},
 * {@code setAttribute}, {@code getAttributes}(일괄 읽기)는 금지. JEUS 풀 MBean 은 {@code stats} 속성 하나만 읽는다
 * (같은 MBean 에 shrink/disableCP 등 상태 변경 오퍼레이션과 무거운 PooledConnectionInfo 가 있다).</li>
 * <li>Java 6 API 만 사용. JEUS/Hikari/Tomcat 클래스에는 컴파일 의존이 없고 JEUS 통계 객체는 리플렉션으로만 읽는다.</li>
 * </ul>
 */
public final class PoolCollector {
    /** 이미 생성된 MBeanServer 목록 공급자(테스트에서 대체). */
    public interface ServerSource {
        List<MBeanServer> servers();
    }

    /** 기본 공급자: 새 MBeanServer 를 만들지 않고 이미 등록된 것만 돌려준다. */
    static final class FactorySource implements ServerSource {
        public List<MBeanServer> servers() {
            return MBeanServerFactory.findMBeanServer(null);
        }
    }

    /** 한 번에 수집하는 풀 수 상한(프로토콜 상한과 동일). */
    public static final int MAX_POOLS = 64;
    static final int MAX_TARGETS = 256;
    /** 수집 주기에서 한 사이클이 쓸 수 있는 시간(ms). */
    static final long BUDGET_MS = 200;
    /** 스냅샷이 이 시간(ms) 넘게 갱신되지 않으면 값을 보내지 않는다. */
    static final long STALE_MS = 30000;

    /** peak 창(ms)과 폴링 이력 링 크기(1초 폴링이면 5~6개면 충분). */
    static final long PEAK_WINDOW_MS = 5000;
    private static final int PEAK_RING = 8;

    private static final long REDISCOVER_MS = 60000;
    private static final long REDISCOVER_IDLE_MS = 300000;
    private static final long SLOW_PERIOD_MS = 30000;
    private static final long DISABLE_AFTER_MS = 300000;
    private static final long SLOW_CALL_NS = 1000000000L;
    private static final long SLOW_QUERY_NS = 100000000L;
    private static final int SLOW_CALL_SKIP_CYCLES = 6;
    private static final int MAX_FAILS = 5;
    private static final int LOG_POOLS = 40;

    private static final int JEUS = 0;
    private static final int ATTR = 1;

    private static final class Provider {
        final String kind;
        final int mode;
        final ObjectName pattern;
        /** HikariCP: type 값이 이 접두로 시작하는 것만(PoolConfig 제외). null 이면 필터 없음. */
        final String typePrefix;

        Provider(String kind, int mode, String pattern, String typePrefix) {
            this.kind = kind;
            this.mode = mode;
            this.pattern = objectName(pattern);
            this.typePrefix = typePrefix;
        }
    }

    private static ObjectName objectName(String s) {
        try {
            return new ObjectName(s);
        } catch (Exception e) {
            throw new IllegalStateException(s, e);
        }
    }

    private static final Provider[] PROVIDERS = {
        new Provider("jeus", JEUS, "JEUS:j2eeType=JDBCDataSource,*", null),
        new Provider("hikari", ATTR, "com.zaxxer.hikari:*", "Pool ("),
        new Provider("tomcat", ATTR, "tomcat.jdbc:type=ConnectionPool,*", null),
        new Provider("tomcat", ATTR, "*:type=DataSource,*", null),
        new Provider("dbcp2", ATTR, "org.apache.commons.dbcp2:*", null),
    };

    // 속성 동의어(대소문자 무시). 앞쪽이 우선.
    private static final String[] ACTIVE = {"ActiveConnections", "NumActive", "Active", "ActiveCount"};
    private static final String[] IDLE = {"IdleConnections", "NumIdle", "Idle", "IdleCount"};
    private static final String[] MAX = {"MaxTotal", "MaxActive", "MaximumPoolSize", "MaxPoolSize"};
    private static final String[] WAIT = {"ThreadsAwaitingConnection", "WaitCount", "WaitingThreads"};
    private static final String[] TOTAL = {"TotalConnections"};

    private static final class Target {
        final WeakReference<MBeanServer> server;
        final ObjectName on;
        final Provider provider;
        final String key;
        final String name;
        boolean resolved;
        String aActive;
        String aIdle;
        String aMax;
        String aWait;
        String aTotal;
        /** HikariCP 의 PoolConfig.MaximumPoolSize(탐색 시 갱신), 없으면 -1. */
        long configMax = -1;
        int fails;
        int skip;
        PoolSample last;
        long lastAt;
        /** 최근 폴링의 (시각, active) 링 — 5초 창 최대값(peak) 계산용. */
        final long[] histAt = new long[PEAK_RING];
        final int[] histVal = new int[PEAK_RING];
        int histN;
        int histPos;

        void record(long nowMs, int active) {
            histAt[histPos] = nowMs;
            histVal[histPos] = active;
            histPos = (histPos + 1) % PEAK_RING;
            if (histN < PEAK_RING) {
                histN++;
            }
        }

        /** nowMs 기준 PEAK_WINDOW_MS 안의 active 최대값. */
        int peak(long nowMs, int current) {
            int p = current;
            for (int i = 0; i < histN; i++) {
                if (nowMs - histAt[i] <= PEAK_WINDOW_MS && histVal[i] > p) {
                    p = histVal[i];
                }
            }
            return p;
        }

        Target(MBeanServer server, ObjectName on, Provider provider, String key, String name) {
            this.server = new WeakReference<MBeanServer>(server);
            this.on = on;
            this.provider = provider;
            this.key = key;
            this.name = name;
        }
    }

    private static final class Snapshot {
        final long atMs;
        final PoolSample[] pools;
        final int active;
        final int idle;
        final int max;
        final int wait;
        final int peak;

        Snapshot(long atMs, PoolSample[] pools) {
            this.atMs = atMs;
            this.pools = pools;
            long a = 0;
            long i = 0;
            long m = 0;
            long w = 0;
            long pk = 0;
            for (int k = 0; k < pools.length; k++) {
                a += pools[k].active;
                i += pools[k].idle;
                m += Math.max(0, pools[k].max);
                w += pools[k].wait;
                pk += pools[k].peak;
            }
            active = clamp(a);
            idle = clamp(i);
            max = clamp(m);
            wait = clamp(w);
            peak = clamp(pk);
        }
    }

    private final ServerSource source;
    private final int maxPools;
    private final long budgetNs;
    private final long staleMs;
    private final List<Target> targets = new ArrayList<Target>();
    private final Map<String, Target> known = new HashMap<String, Target>();
    private final Set<String> rejected = new HashSet<String>();
    /** 클래스 → 메서드 이름 → 약한 Method. 값이 키 클래스를 강하게 잡지 않아 webapp 언로드를 막지 않는다. */
    private final Map<Class<?>, Map<String, WeakReference<Method>>> methods =
            new WeakHashMap<Class<?>, Map<String, WeakReference<Method>>>();

    /**
     * 첫 탐색 전 대기(ms)와 정상 폴링 주기(ms). 테스트에서만 바꾼다. 1초 폴링: 쿼리가 커넥션을 수 ms 만 잡아
     * 5초 단일 시점 샘플은 거의 항상 0 이므로, 창 안 최대값(peak)을 함께 보고하기 위함이다(같은 200ms 예산 안).
     */
    long initialDelayMs = 30000;
    long collectPeriodMs = 1000;

    private volatile Snapshot snapshot;
    private volatile boolean disabled;
    private Thread thread;

    private long nextDiscoverAt;
    private int emptyDiscoveries;
    private int slowQueries;
    private int cursor;
    private int overCycles;
    private long overSinceMs;
    private boolean slowMode;
    private boolean logged;
    private boolean loggedEmpty;
    private int lastServerCount;

    public PoolCollector() {
        this(new FactorySource(), MAX_POOLS, BUDGET_MS, STALE_MS);
    }

    PoolCollector(ServerSource source, int maxPools, long budgetMs, long staleMs) {
        this.source = source;
        this.maxPools = maxPools;
        this.budgetNs = budgetMs * 1000000L;
        this.staleMs = staleMs;
    }

    /** 전용 데몬 스레드 {@code agent-t-pool} 시작. */
    public synchronized void start() {
        if (thread != null) {
            return;
        }
        Thread t = new Thread("agent-t-pool") {
            @Override
            public void run() {
                try {
                    Thread.sleep(initialDelayMs);
                    while (!isInterrupted() && !disabled) {
                        tick(System.currentTimeMillis());
                        Thread.sleep(slowMode ? SLOW_PERIOD_MS : collectPeriodMs);
                    }
                } catch (InterruptedException e) {
                    // 종료
                } catch (Throwable e) {
                    AgentLog.error("agent-t-pool", e);
                }
            }
        };
        t.setDaemon(true);
        thread = t;
        t.start();
    }

    public synchronized void stop() {
        if (thread != null) {
            thread.interrupt();
            thread = null;
        }
    }

    public boolean isDisabled() {
        return disabled;
    }

    /** 샘플에 풀 지표를 채운다. 풀이 없거나 스냅샷이 오래됐으면(stale) 아무것도 하지 않는다(키 생략). */
    public void fill(JvmSample s) {
        fill(s, System.currentTimeMillis());
    }

    void fill(JvmSample s, long nowMs) {
        Snapshot sn = snapshot;
        if (disabled || sn == null || sn.pools.length == 0 || nowMs - sn.atMs > staleMs) {
            return;
        }
        s.connActive = sn.active;
        s.connIdle = sn.idle;
        s.connMax = sn.max;
        s.connWait = sn.wait;
        s.connPeak = sn.peak;
        s.pools = sn.pools;
    }

    /** 한 틱: 필요하면 재탐색 후 수집. 모든 예외를 삼킨다. */
    void tick(long nowMs) {
        if (disabled) {
            return;
        }
        try {
            if (nowMs >= nextDiscoverAt) {
                discover(nowMs);
            }
            if (!targets.isEmpty()) {
                collect(nowMs);
            } else {
                snapshot = null;
            }
        } catch (SecurityException e) {
            disable("SecurityException (JMX 접근 거부)");
        } catch (Throwable e) {
            AgentLog.debug("pool tick: " + e);
        }
    }

    private void disable(String why) {
        disabled = true;
        snapshot = null;
        AgentLog.warn("pool metrics disabled: " + why);
    }

    // ---- 탐색 ----

    void discover(long nowMs) {
        List<MBeanServer> servers;
        try {
            servers = source.servers();
        } catch (SecurityException e) {
            disable("SecurityException (findMBeanServer)");
            return;
        }
        Set<String> seen = new HashSet<String>();
        Map<MBeanServer, Boolean> once = new IdentityHashMap<MBeanServer, Boolean>();
        boolean complete = true;
        int serverCount = 0;
        long queryNs = 0;
        for (int i = 0; servers != null && i < servers.size(); i++) {
            MBeanServer s = servers.get(i);
            if (s == null || once.containsKey(s)) {
                continue;
            }
            once.put(s, Boolean.TRUE);
            serverCount++;
            for (int p = 0; p < PROVIDERS.length; p++) {
                Provider pv = PROVIDERS[p];
                try {
                    long t0 = System.nanoTime();
                    Set<ObjectName> names = s.queryNames(pv.pattern, null);
                    queryNs += System.nanoTime() - t0;
                    if (names == null) {
                        continue;
                    }
                    for (ObjectName on : names) {
                        register(s, pv, on, seen);
                    }
                } catch (SecurityException e) {
                    disable("SecurityException (queryNames)");
                    return;
                } catch (Throwable e) {
                    complete = false;
                    AgentLog.debug("pool discover " + pv.kind + ": " + e);
                }
            }
        }
        lastServerCount = serverCount;
        if (complete) {
            for (int i = targets.size() - 1; i >= 0; i--) {
                Target t = targets.get(i);
                if (!seen.contains(t.key)) {
                    targets.remove(i);
                    known.remove(t.key);
                }
            }
            rejected.retainAll(seen);
        }
        if (queryNs > SLOW_QUERY_NS) {
            slowQueries++;
        }
        if (targets.isEmpty()) {
            emptyDiscoveries++;
            if (!loggedEmpty) {
                loggedEmpty = true;
                AgentLog.info("pool metrics: no pool MBean found yet (mbeanServers=" + serverCount + "), will retry");
            }
        } else {
            emptyDiscoveries = 0;
        }
        long interval = REDISCOVER_MS;
        if (slowQueries >= 2 || emptyDiscoveries >= 3) {
            interval = REDISCOVER_IDLE_MS;
        }
        nextDiscoverAt = nowMs + interval;
    }

    private void register(MBeanServer s, Provider pv, ObjectName on, Set<String> seen) {
        String name;
        if (pv.typePrefix != null) {
            String type = on.getKeyProperty("type");
            if (type == null || !type.startsWith(pv.typePrefix) || !type.endsWith(")")) {
                return;
            }
            name = type.substring(pv.typePrefix.length(), type.length() - 1);
        } else {
            name = unquote(on.getKeyProperty("name"));
            if (name == null || name.length() == 0) {
                name = on.getCanonicalName();
            }
        }
        String key = pv.kind + "|" + on.getCanonicalName();
        // 같은 풀이 두 MBeanServer 에 있거나 두 패턴에 모두 걸려도 한 번만 센다.
        if (!seen.add(key) || rejected.contains(key)) {
            return;
        }
        Target t = known.get(key);
        if (t == null) {
            if (targets.size() >= MAX_TARGETS) {
                return;
            }
            t = new Target(s, on, pv, key, name);
            targets.add(t);
            known.put(key, t);
        }
        if ("hikari".equals(pv.kind)) {
            t.configMax = readHikariMax(s, on, name);
        }
    }

    private long readHikariMax(MBeanServer s, ObjectName pool, String name) {
        try {
            ObjectName cfg = new ObjectName(pool.getDomain() + ":type=PoolConfig (" + name + ")");
            Object v = s.getAttribute(cfg, "MaximumPoolSize");
            return v instanceof Number ? ((Number) v).longValue() : -1;
        } catch (Throwable e) {
            return -1;
        }
    }

    private static String unquote(String v) {
        if (v != null && v.length() >= 2 && v.charAt(0) == '"' && v.charAt(v.length() - 1) == '"') {
            return v.substring(1, v.length() - 1);
        }
        return v;
    }

    // ---- 수집 ----

    void collect(long nowMs) {
        long start = System.nanoTime();
        int n = targets.size();
        boolean over = false;
        List<Target> remove = new ArrayList<Target>();
        int next = 0;
        for (int i = 0; i < n; i++) {
            if (i > 0 && System.nanoTime() - start > budgetNs) {
                over = true;
                next = (cursor + i) % n;
                break;
            }
            Target t = targets.get((cursor + i) % n);
            if (t.skip > 0) {
                t.skip--;
                continue;
            }
            if (!readOne(t, nowMs)) {
                remove.add(t);
            }
        }
        if (!over && System.nanoTime() - start > budgetNs) {
            over = true;
        }
        cursor = next;
        for (int i = 0; i < remove.size(); i++) {
            Target t = remove.get(i);
            targets.remove(t);
            known.remove(t.key);
        }
        if (cursor >= targets.size()) {
            cursor = 0;
        }
        guard(over, nowMs);
        if (disabled) {
            return;
        }
        snapshot = build(nowMs);
        if (!logged && snapshot != null && snapshot.pools.length > 0) {
            logged = true;
            logDiscovered(snapshot);
        }
    }

    /** 예산 초과가 이어지면 주기를 늘리고, 5분 넘게 이어지면 수집을 끈다. */
    private void guard(boolean over, long nowMs) {
        if (!over) {
            overCycles = 0;
            overSinceMs = 0;
            slowMode = false;
            return;
        }
        overCycles++;
        if (overSinceMs == 0) {
            overSinceMs = nowMs;
        }
        if (overCycles >= 3 && !slowMode) {
            slowMode = true;
            AgentLog.warn("pool metrics budget exceeded (" + budgetNs / 1000000L + "ms) " + overCycles
                    + " cycles in a row, period -> " + SLOW_PERIOD_MS + "ms");
        }
        if (nowMs - overSinceMs >= DISABLE_AFTER_MS) {
            disable("budget exceeded for " + DISABLE_AFTER_MS / 1000 + "s");
        }
    }

    /** @return false 면 이 대상을 제거. */
    private boolean readOne(Target t, long nowMs) {
        MBeanServer s = t.server.get();
        if (s == null) {
            return false;
        }
        long t0 = System.nanoTime();
        try {
            PoolSample ps = t.provider.mode == JEUS ? readJeus(s, t) : readAttrs(s, t);
            if (ps == null) {
                if (!t.provider.kind.equals("jeus") && !t.resolved) {
                    rejected.add(t.key);
                    return false;
                }
                return ++t.fails < MAX_FAILS;
            }
            t.last = ps;
            t.lastAt = nowMs;
            t.record(nowMs, ps.active);
            t.fails = 0;
        } catch (InstanceNotFoundException e) {
            return false;
        } catch (SecurityException e) {
            throw e;
        } catch (Throwable e) {
            // LinkageError, 클래스로더 문제, MBean 구현 예외 등 전부: 해당 풀만 실패 처리
            AgentLog.debug("pool read " + t.name + ": " + e);
            if (++t.fails >= MAX_FAILS) {
                return false;
            }
        } finally {
            if (System.nanoTime() - t0 > SLOW_CALL_NS) {
                t.skip = SLOW_CALL_SKIP_CYCLES;
            }
        }
        return true;
    }

    private PoolSample sample(Target t, long active, long idle, long max, long wait) {
        PoolSample p = new PoolSample();
        p.name = t.name;
        p.kind = t.provider.kind;
        p.active = clamp(Math.max(0, active));
        p.idle = clamp(Math.max(0, idle));
        p.max = clamp(Math.max(0, max));
        p.wait = clamp(Math.max(0, wait));
        p.peak = p.active;
        return p;
    }

    /** JEUS: getAttribute(name, "stats") 한 번. 값 객체는 리플렉션으로만 읽는다(JEUS 클래스 의존 없음). */
    private PoolSample readJeus(MBeanServer s, Target t) throws Exception {
        Object st = s.getAttribute(t.on, "stats");
        if (st == null) {
            return null;
        }
        long size = current(st, "getPoolSize");
        long free = current(st, "getFreePoolSize");
        if (size < 0 || free < 0) {
            return null;
        }
        long max = current(st, "getMaxPoolSize");
        if (max <= 0) {
            Object ub = call(call(st, "getPoolSize"), "getUpperBound");
            max = ub instanceof Number ? ((Number) ub).longValue() : 0;
        }
        long wait = current(st, "getWaitingThreadCount");
        t.resolved = true;
        return sample(t, size - free, free, max, wait);
    }

    private long current(Object o, String getter) {
        Object stat = call(o, getter);
        Object v = call(stat, "getCurrent");
        return v instanceof Number ? ((Number) v).longValue() : -1;
    }

    private Object call(Object o, String name) {
        if (o == null) {
            return null;
        }
        Method m = method(o.getClass(), name);
        if (m == null) {
            return null;
        }
        try {
            return m.invoke(o);
        } catch (Throwable e) {
            return null;
        }
    }

    private Method method(Class<?> c, String name) {
        Map<String, WeakReference<Method>> byName = methods.get(c);
        if (byName == null) {
            byName = new HashMap<String, WeakReference<Method>>();
            methods.put(c, byName);
        }
        WeakReference<Method> ref = byName.get(name);
        Method m = ref == null ? null : ref.get();
        if (m == null) {
            try {
                m = c.getMethod(name);
                if (!Modifier.isPublic(c.getModifiers())) {
                    m.setAccessible(true);
                }
            } catch (Throwable e) {
                m = null;
            }
            byName.put(name, new WeakReference<Method>(m));
        }
        return m;
    }

    /** Hikari/Tomcat/DBCP: 최초 1회 getMBeanInfo 로 동의어를 실제 속성명에 매핑한 뒤 속성마다 getAttribute. */
    private PoolSample readAttrs(MBeanServer s, Target t) throws Exception {
        if (!t.resolved) {
            MBeanAttributeInfo[] infos = s.getMBeanInfo(t.on).getAttributes();
            Map<String, String> lower = new HashMap<String, String>();
            for (int i = 0; infos != null && i < infos.length; i++) {
                if (infos[i].isReadable()) {
                    lower.put(infos[i].getName().toLowerCase(Locale.ENGLISH), infos[i].getName());
                }
            }
            t.aActive = pick(lower, ACTIVE);
            t.aIdle = pick(lower, IDLE);
            t.aMax = pick(lower, MAX);
            t.aWait = pick(lower, WAIT);
            t.aTotal = pick(lower, TOTAL);
            if (t.aActive == null) {
                return null; // 풀 MBean 이 아님(같은 패턴의 다른 MBean)
            }
            t.resolved = true;
        }
        long active = num(s, t.on, t.aActive);
        if (active < 0) {
            return null;
        }
        long idle = num(s, t.on, t.aIdle);
        long total = num(s, t.on, t.aTotal);
        if (idle < 0) {
            idle = total >= 0 ? Math.max(0, total - active) : 0;
        }
        long max = num(s, t.on, t.aMax);
        if (max <= 0 && t.configMax > 0) {
            max = t.configMax;
        }
        if (max <= 0 && total > 0 && "hikari".equals(t.provider.kind)) {
            max = total;
        }
        long wait = num(s, t.on, t.aWait);
        return sample(t, active, idle, max, wait);
    }

    private static String pick(Map<String, String> lower, String[] synonyms) {
        for (int i = 0; i < synonyms.length; i++) {
            String a = lower.get(synonyms[i].toLowerCase(Locale.ENGLISH));
            if (a != null) {
                return a;
            }
        }
        return null;
    }

    /** 숫자 속성 1개 읽기. 없음/숫자 아님/속성 오류는 -1. 객체가 없어졌으면(InstanceNotFound) 그대로 던진다. */
    private static long num(MBeanServer s, ObjectName on, String attr) throws InstanceNotFoundException {
        if (attr == null) {
            return -1;
        }
        try {
            Object v = s.getAttribute(on, attr);
            return v instanceof Number ? ((Number) v).longValue() : -1;
        } catch (InstanceNotFoundException e) {
            throw e;
        } catch (SecurityException e) {
            throw e;
        } catch (Exception e) {
            return -1;
        }
    }

    // ---- 스냅샷 ----

    private Snapshot build(long nowMs) {
        List<PoolSample> list = new ArrayList<PoolSample>();
        for (int i = 0; i < targets.size(); i++) {
            Target t = targets.get(i);
            if (t.last != null && nowMs - t.lastAt <= staleMs) {
                PoolSample c = new PoolSample();
                PoolSample l = t.last;
                c.name = l.name;
                c.kind = l.kind;
                c.active = l.active;
                c.idle = l.idle;
                c.max = l.max;
                c.wait = l.wait;
                c.peak = t.peak(nowMs, l.active);
                list.add(c);
            }
        }
        Collections.sort(list, new Comparator<PoolSample>() {
            public int compare(PoolSample a, PoolSample b) {
                double ua = util(a);
                double ub = util(b);
                if (ua != ub) {
                    return ua > ub ? -1 : 1;
                }
                if (a.wait != b.wait) {
                    return a.wait > b.wait ? -1 : 1;
                }
                return a.name.compareTo(b.name);
            }
        });
        if (list.size() > maxPools) {
            list = new ArrayList<PoolSample>(list.subList(0, maxPools));
        }
        return new Snapshot(nowMs, list.toArray(new PoolSample[list.size()]));
    }

    private static double util(PoolSample p) {
        return p.max > 0 ? (double) p.active / p.max : 0;
    }

    private static int clamp(long v) {
        return v > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) v;
    }

    private void logDiscovered(Snapshot sn) {
        StringBuilder sb = new StringBuilder("pool metrics: mbeanServers=").append(lastServerCount)
                .append(" pools=").append(sn.pools.length).append(" [");
        PoolSample[] byName = sn.pools.clone();
        Arrays.sort(byName, new Comparator<PoolSample>() {
            public int compare(PoolSample a, PoolSample b) {
                return a.name.compareTo(b.name);
            }
        });
        for (int i = 0; i < byName.length && i < LOG_POOLS; i++) {
            if (i > 0) {
                sb.append(", ");
            }
            sb.append(byName[i].name).append('(').append(byName[i].kind).append(",max=").append(byName[i].max)
                    .append(')');
        }
        if (byName.length > LOG_POOLS) {
            sb.append(", +").append(byName.length - LOG_POOLS).append(" more");
        }
        sb.append("] sum active=").append(sn.active).append(" idle=").append(sn.idle).append(" max=").append(sn.max)
                .append(" wait=").append(sn.wait).append(" peak=").append(sn.peak);
        if (!targets.isEmpty()) {
            sb.append(" e.g. ").append(targets.get(0).on.getCanonicalName());
        }
        AgentLog.info(sb.toString());
    }
}
