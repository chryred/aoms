package com.synapsev.agentt.tx;

import com.synapsev.agentt.bridge.HookSink;
import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.id.Fnv64;
import com.synapsev.agentt.log.AgentLog;
import com.synapsev.agentt.model.DetailNode;
import com.synapsev.agentt.model.SqlAgg;
import com.synapsev.agentt.model.TxRecord;
import com.synapsev.agentt.norm.SqlNormalizer;
import com.synapsev.agentt.norm.UriNormalizer;
import com.synapsev.agentt.transport.Sender;
import java.lang.management.ManagementFactory;
import java.lang.management.ThreadMXBean;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Receives the instrumentation hooks and turns them into {@link TxRecord}s. Only the outermost servlet/filter
 * entry on a thread is a root; SQL / fetch / connection / outbound-call events attach to that root's context.
 * Nothing here may throw into the host application (the bridge also guards, this is defence in depth).
 */
public final class TxTracker implements HookSink {
    /** Where finished transactions and dictionary entries go; the production implementation is the Sender. */
    public interface Out {
        void offerTx(TxRecord tx);

        void defineSql(String id, String text);

        void defineUri(String id, String text);
    }

    public static Out forSender(final Sender sender) {
        return new Out() {
            public void offerTx(TxRecord tx) {
                sender.offerTx(tx);
            }

            public void defineSql(String id, String text) {
                sender.defineSql(id, text);
            }

            public void defineUri(String id, String text) {
                sender.defineUri(id, text);
            }
        };
    }

    static final String UNKNOWN_SQL = "/* unknown sql */";
    private static final int NAME_MAX = 200;
    private static final int CACHE_MAX = 20000;
    private static final Class<?>[] NO_ARGS = new Class<?>[0];
    private static final Class<?>[] STRING_ARG = new Class<?>[] {String.class};

    private static final class SqlToken {
        final TxContext ctx;
        final String sqlId;
        final long startNano;
        final DetailNode node;

        SqlToken(TxContext ctx, String sqlId, long startNano, DetailNode node) {
            this.ctx = ctx;
            this.sqlId = sqlId;
            this.startNano = startNano;
            this.node = node;
        }
    }

    private static final class ExtToken {
        final TxContext ctx;
        final long startNano;
        final DetailNode node;

        ExtToken(TxContext ctx, long startNano, DetailNode node) {
            this.ctx = ctx;
            this.startNano = startNano;
            this.node = node;
        }
    }

    /** Cached reflective accessors for one request or response class (null Method = not available). */
    private static final class Access {
        Method uri;
        Method method;
        Method remoteAddr;
        Method header;
        Method status;
    }

    private final Out out;
    private final AgentConfig config;
    private final ThreadLocal<TxContext> current = new ThreadLocal<TxContext>();
    private volatile int generation;
    private final WeakIdentityMap stmtSql = new WeakIdentityMap();
    private final Map<String, String[]> sqlCache = new ConcurrentHashMap<String, String[]>();
    private final Map<String, String[]> uriCache = new ConcurrentHashMap<String, String[]>();
    private volatile int uriCacheVersion = Integer.MIN_VALUE;
    private final Map<Class<?>, Access> access = new ConcurrentHashMap<Class<?>, Access>();
    private final ThreadMXBean threads;

    public TxTracker(Out out, AgentConfig config) {
        this.out = out;
        this.config = config;
        ThreadMXBean t = null;
        try {
            t = ManagementFactory.getThreadMXBean();
            if (!t.isCurrentThreadCpuTimeSupported()) {
                t = null;
            }
        } catch (Throwable ignore) {
            t = null;
        }
        this.threads = t;
    }

    /** Forgets in-flight contexts (kill switch): stale thread-locals are ignored from now on. */
    public void reset() {
        generation++;
    }

    // ---- servlet / filter root ----

    public Object servletEnter(Object req, Object resp) {
        if (!config.enabled) {
            return null;
        }
        TxContext cur = current.get();
        if (cur != null && cur.generation == generation) {
            return null; // nested filter/servlet: only the outermost is the root
        }
        Access a = accessFor(req);
        String uri = str(call(a == null ? null : a.uri, req, null));
        if (excluded(uri)) {
            return null;
        }
        long nano = System.nanoTime();
        TxContext c = new TxContext(Thread.currentThread(), generation, System.currentTimeMillis(), nano, cpuNow());
        c.method = str(call(a == null ? null : a.method, req, null));
        c.userIp = str(call(a == null ? null : a.remoteAddr, req, null));
        TraceParent p = TraceParent.parse(str(call(a == null ? null : a.header, req, new Object[] {"traceparent"})));
        if (p != null) {
            c.traceId = p.traceId;
            c.parentSpan = p.spanId;
        } else {
            c.traceId = TraceParent.newTraceId();
        }
        c.spanId = TraceParent.newSpanId();
        String[] u = normalizedUri(uri);
        c.uriId = u[1];
        c.addNode("http", c.method + " " + u[0], null, nano, -1);
        current.set(c);
        return c;
    }

    public void servletExit(Object token, Object resp, Throwable t) {
        if (!(token instanceof TxContext)) {
            return;
        }
        TxContext c = (TxContext) token;
        try {
            if (current.get() == c) {
                current.remove();
            }
            if (c.generation != generation || !config.enabled) {
                return;
            }
            finish(c, resp, t);
        } catch (Throwable e) {
            AgentLog.debug("tx finish failed: " + e);
        }
    }

    private void finish(TxContext c, Object resp, Throwable t) {
        long now = System.nanoTime();
        TxRecord r = new TxRecord();
        r.traceId = c.traceId;
        r.spanId = c.spanId;
        r.parentSpan = c.parentSpan;
        r.startTs = c.startTs;
        r.elapsedMs = (now - c.startNano) / 1000000L;
        r.method = c.method;
        r.uriId = c.uriId;
        int status = 0;
        Access ra = accessFor(resp);
        Object st = call(ra == null ? null : ra.status, resp, null);
        if (st instanceof Number) {
            status = ((Number) st).intValue();
        }
        if (t != null && status < 400) {
            status = 500;
        }
        r.status = status;
        r.error = t != null || status >= 500;
        r.exc = t == null ? "" : t.getClass().getName();
        long cpu = cpuNow();
        r.cpuMs = (c.startCpuNanos >= 0 && cpu >= 0) ? (cpu - c.startCpuNanos) / 1000000L : 0;
        r.sqlMs = c.sqlNanos / 1000000L;
        r.sqlCnt = c.sqlCnt;
        r.fetchCnt = c.fetchCnt;
        r.fetchMs = c.fetchNanos / 1000000L;
        r.extMs = c.extNanos / 1000000L;
        r.extCnt = c.extCnt;
        r.connOpen = c.connOpen;
        r.connClose = c.connClose;
        r.connLeak = c.connOpen - c.connClose;
        r.connUncommit = c.connUncommit;
        r.userIp = c.userIp;
        List<SqlAgg> sql = new ArrayList<SqlAgg>(c.aggs.size());
        for (TxContext.AggState s : c.aggs.values()) {
            s.agg.ms = s.nanos / 1000000L;
            s.agg.maxMs = s.maxNanos / 1000000L;
            s.agg.fetchMs = s.fetchNanos / 1000000L;
            sql.add(s.agg);
        }
        r.sql = sql;
        if (DetailDecider.keep(r, config, System.currentTimeMillis())) {
            if (!c.nodes.isEmpty()) {
                c.nodes.get(0).durationMs = r.elapsedMs;
            }
            r.nodes = c.nodes;
            if (c.droppedNodes > 0) {
                AgentLog.debug("node cap reached, dropped " + c.droppedNodes);
            }
        }
        out.offerTx(r);
    }

    // ---- JDBC ----

    public void sqlPrepare(Object stmt, String sql) {
        if (stmt != null && sql != null) {
            stmtSql.put(stmt, sql);
        }
    }

    public Object sqlEnter(Object stmt, String sql) {
        TxContext c = context();
        if (c == null || c.sqlDepth > 0) {
            return null;
        }
        String raw = sql != null ? sql : (stmt == null ? null : stmtSql.get(stmt));
        String[] n = normalizedSql(raw);
        long now = System.nanoTime();
        c.sqlDepth++;
        c.phase = "sql";
        c.curSqlId = n[1];
        String name = n[0].length() > NAME_MAX ? n[0].substring(0, NAME_MAX) : n[0];
        return new SqlToken(c, n[1], now, c.addNode("sql", name, n[1], now, 0));
    }

    public void sqlExit(Object token, Throwable t) {
        if (!(token instanceof SqlToken)) {
            return;
        }
        SqlToken k = (SqlToken) token;
        TxContext c = k.ctx;
        long dur = System.nanoTime() - k.startNano;
        TxContext.AggState s = c.aggs.get(k.sqlId);
        if (s == null) {
            s = new TxContext.AggState();
            s.agg.sqlId = k.sqlId;
            c.aggs.put(k.sqlId, s);
        }
        s.agg.cnt++;
        s.nanos += dur;
        if (dur > s.maxNanos) {
            s.maxNanos = dur;
        }
        if (t != null) {
            s.agg.err++;
        }
        c.lastAgg = s;
        c.sqlCnt++;
        c.sqlNanos += dur;
        if (k.node != null) {
            k.node.durationMs = dur / 1000000L;
        }
        c.sqlDepth = 0;
        c.phase = "run";
        c.curSqlId = null;
    }

    public void fetchEnter(Object rs) {
        TxContext c = context();
        if (c == null) {
            return;
        }
        if (c.fetchDepth++ == 0) {
            c.fetchStartNano = System.nanoTime();
        }
    }

    public void fetch(Object rs, boolean hasRow) {
        TxContext c = context();
        if (c == null || c.fetchDepth <= 0) {
            return;
        }
        if (--c.fetchDepth > 0) {
            return; // inner call of a wrapping ResultSet; the outermost one reports
        }
        long dur = System.nanoTime() - c.fetchStartNano;
        c.fetchNanos += dur;
        TxContext.AggState s = c.lastAgg;
        if (s != null) {
            s.fetchNanos += dur;
        }
        if (hasRow) {
            c.fetchCnt++;
            if (s != null) {
                s.agg.fetchCnt++;
            }
        }
    }

    // ---- connections ----

    public void connOpen(Object conn) {
        TxContext c = context();
        if (c == null || conn == null || c.conns().containsKey(conn)) {
            return;
        }
        c.conns().put(conn, new TxContext.ConnState());
        c.connOpen++;
    }

    public void connClose(Object conn) {
        TxContext c = context();
        if (c == null || conn == null || c.conns == null) {
            return;
        }
        TxContext.ConnState s = c.conns.get(conn);
        if (s == null || s.closed) {
            return;
        }
        s.closed = true;
        c.connClose++;
        if (!s.committed && conn instanceof java.sql.Connection) {
            try {
                if (!((java.sql.Connection) conn).getAutoCommit()) {
                    c.connUncommit++;
                }
            } catch (Throwable ignore) {
                // connection state unreadable: do not guess
            }
        }
    }

    public void connCommit(Object conn) {
        markCommitted(conn);
    }

    public void connRollback(Object conn) {
        markCommitted(conn);
    }

    private void markCommitted(Object conn) {
        TxContext c = context();
        if (c == null || conn == null || c.conns == null) {
            return;
        }
        TxContext.ConnState s = c.conns.get(conn);
        if (s != null) {
            s.committed = true;
        }
    }

    // ---- outbound HTTP ----

    public Object extEnter(Object urlConn) {
        TxContext c = context();
        if (c == null || c.extDepth > 0 || urlConn == null) {
            return null;
        }
        long now = System.nanoTime();
        boolean first = !c.extConns().containsKey(urlConn);
        if (first) {
            c.extConns().put(urlConn, Boolean.TRUE);
            c.extCnt++;
            if (urlConn instanceof HttpURLConnection) {
                try {
                    ((HttpURLConnection) urlConn).setRequestProperty("traceparent",
                            TraceParent.format(c.traceId, TraceParent.newSpanId()));
                } catch (Throwable ignore) {
                    // already connected or foreign implementation: header is best effort
                }
            }
        }
        c.extDepth++;
        c.phase = "ext";
        return new ExtToken(c, now, c.addNode("ext", urlName(urlConn), null, now, 0));
    }

    public void extExit(Object token, Throwable t) {
        if (!(token instanceof ExtToken)) {
            return;
        }
        ExtToken k = (ExtToken) token;
        long dur = System.nanoTime() - k.startNano;
        k.ctx.extNanos += dur;
        if (k.node != null) {
            k.node.durationMs = dur / 1000000L;
        }
        k.ctx.extDepth = 0;
        k.ctx.phase = "run";
    }

    // ---- helpers ----

    private TxContext context() {
        TxContext c = current.get();
        return (c != null && c.generation == generation) ? c : null;
    }

    private long cpuNow() {
        try {
            return threads == null ? -1 : threads.getCurrentThreadCpuTime();
        } catch (Throwable t) {
            return -1;
        }
    }

    private static String urlName(Object urlConn) {
        try {
            if (urlConn instanceof java.net.URLConnection) {
                URL u = ((java.net.URLConnection) urlConn).getURL();
                String name = u.getProtocol() + "://" + u.getHost() + (u.getPort() < 0 ? "" : ":" + u.getPort())
                        + u.getPath();
                return name.length() > NAME_MAX ? name.substring(0, NAME_MAX) : name;
            }
        } catch (Throwable ignore) {
            // fall through
        }
        return "ext";
    }

    private boolean excluded(String uri) {
        List<String> ex = config.exclude;
        for (int i = 0; i < ex.size(); i++) {
            String p = ex.get(i);
            if (p.length() == 0) {
                continue;
            }
            if (p.charAt(p.length() - 1) == '*') {
                if (uri.startsWith(p.substring(0, p.length() - 1))) {
                    return true;
                }
            } else if (uri.startsWith(p)) {
                return true;
            }
        }
        return false;
    }

    /** {normalized, id}; defines the dictionary entry the first time a raw value is seen. */
    private String[] normalizedUri(String raw) {
        int v = config.version;
        if (v != uriCacheVersion) {
            uriCache.clear();
            uriCacheVersion = v;
        }
        String[] n = uriCache.get(raw);
        if (n == null) {
            String norm = UriNormalizer.normalize(raw, config.uriRules);
            n = new String[] {norm, Fnv64.hex(norm)};
            if (uriCache.size() >= CACHE_MAX) {
                uriCache.clear();
            }
            uriCache.put(raw, n);
            out.defineUri(n[1], norm);
        }
        return n;
    }

    private String[] normalizedSql(String raw) {
        String key = raw == null ? UNKNOWN_SQL : raw;
        String[] n = sqlCache.get(key);
        if (n == null) {
            String norm = raw == null ? UNKNOWN_SQL : SqlNormalizer.normalize(raw);
            n = new String[] {norm, Fnv64.hex(norm)};
            if (sqlCache.size() >= CACHE_MAX) {
                sqlCache.clear();
            }
            sqlCache.put(key, n);
            out.defineSql(n[1], norm);
        }
        return n;
    }

    private Access accessFor(Object req) {
        if (req == null) {
            return null;
        }
        Class<?> k = req.getClass();
        Access a = access.get(k);
        if (a == null) {
            a = new Access();
            a.uri = find(k, "getRequestURI", NO_ARGS);
            a.method = find(k, "getMethod", NO_ARGS);
            a.remoteAddr = find(k, "getRemoteAddr", NO_ARGS);
            a.header = find(k, "getHeader", STRING_ARG);
            a.status = find(k, "getStatus", NO_ARGS);
            access.put(k, a);
        }
        return a;
    }

    private static Object call(Method m, Object target, Object[] args) {
        if (m == null || target == null) {
            return null;
        }
        try {
            return m.invoke(target, args);
        } catch (Throwable t) {
            return null;
        }
    }

    private static String str(Object o) {
        return o instanceof String ? (String) o : "";
    }

    /** Finds the method on a public type of the hierarchy so reflection works for non-public implementations. */
    static Method find(Class<?> c, String name, Class<?>[] params) {
        Set<Class<?>> seen = new HashSet<Class<?>>();
        return find(c, name, params, seen);
    }

    private static Method find(Class<?> c, String name, Class<?>[] params, Set<Class<?>> seen) {
        if (c == null || !seen.add(c)) {
            return null;
        }
        if (Modifier.isPublic(c.getModifiers())) {
            try {
                Method m = c.getMethod(name, params);
                if (Modifier.isPublic(m.getDeclaringClass().getModifiers())) {
                    return m;
                }
            } catch (Throwable ignore) {
                // keep searching
            }
        }
        Method m = find(c.getSuperclass(), name, params, seen);
        if (m != null) {
            return m;
        }
        Class<?>[] ifs = c.getInterfaces();
        for (int i = 0; i < ifs.length; i++) {
            m = find(ifs[i], name, params, seen);
            if (m != null) {
                return m;
            }
        }
        return null;
    }
}
