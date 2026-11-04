package com.synapsev.agentt.tx;

import static org.junit.Assert.assertEquals;

import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.model.SqlAgg;
import com.synapsev.agentt.model.TxRecord;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

public class TxTrackerDbNameTest {
    public static final class Req {
        public String getRequestURI() {
            return "/db/1";
        }
    }

    public static final class Resp {
        public int getStatus() {
            return 200;
        }
    }

    private final AgentConfig config = new AgentConfig();
    private final CollectingOut out = new CollectingOut();
    private final TxTracker tracker = new TxTracker(out, config);

    /** Connection proxy whose getMetaData().getURL() is counted; url == null makes getMetaData throw. */
    private static Connection conn(final String url, final AtomicInteger metaCalls) {
        return (Connection) Proxy.newProxyInstance(TxTrackerDbNameTest.class.getClassLoader(),
                new Class<?>[] {Connection.class}, new InvocationHandler() {
                    public Object invoke(Object p, Method m, Object[] a) throws Throwable {
                        if (m.getName().equals("getMetaData")) {
                            metaCalls.incrementAndGet();
                            if (url == null) {
                                throw new SQLException("boom");
                            }
                            return Proxy.newProxyInstance(TxTrackerDbNameTest.class.getClassLoader(),
                                    new Class<?>[] {DatabaseMetaData.class}, new InvocationHandler() {
                                        public Object invoke(Object p2, Method m2, Object[] a2) {
                                            return m2.getName().equals("getURL") ? url : null;
                                        }
                                    });
                        }
                        if (m.getName().equals("hashCode")) {
                            return 7; // identical hash for every proxy: identity map must still tell them apart
                        }
                        if (m.getName().equals("equals")) {
                            return true; // a hostile equals(): identity semantics required
                        }
                        return null;
                    }
                });
    }

    private static Statement stmt(final Connection c) {
        return (Statement) Proxy.newProxyInstance(TxTrackerDbNameTest.class.getClassLoader(),
                new Class<?>[] {Statement.class}, new InvocationHandler() {
                    public Object invoke(Object p, Method m, Object[] a) {
                        return m.getName().equals("getConnection") ? c : null;
                    }
                });
    }

    private void run(Statement s, String sql) {
        Object t = tracker.sqlEnter(s, sql);
        tracker.sqlExit(t, null);
    }

    @Test
    public void metadataReadOncePerConnectionAndSqlKeyedByDb() {
        AtomicInteger calls1 = new AtomicInteger();
        AtomicInteger calls2 = new AtomicInteger();
        Statement s1 = stmt(conn("jdbc:sqlserver://10.103.1.61:1433;databaseName=stap;password=x", calls1));
        Statement s2 = stmt(conn("jdbc:oracle:thin:@ora1:1521:ORCL", calls2));
        Object root = tracker.servletEnter(new Req(), new Resp());
        for (int i = 0; i < 5; i++) {
            run(s1, "select 1 from t");
        }
        run(s2, "select 1 from t"); // same SQL, other DB
        run(s2, "select 1 from t");
        tracker.servletExit(root, new Resp(), null);
        assertEquals(1, calls1.get());
        assertEquals(1, calls2.get());
        TxRecord r = out.records.get(0);
        assertEquals(2, r.sql.size());
        SqlAgg a = r.sql.get(0);
        SqlAgg b = r.sql.get(1);
        assertEquals("10.103.1.61:1433/stap", a.db);
        assertEquals(5, a.cnt);
        assertEquals("ora1:1521/ORCL", b.db);
        assertEquals(2, b.cnt);
        assertEquals(a.sqlId, b.sqlId);
        assertEquals(7, r.sqlCnt);
    }

    @Test
    public void failingMetadataIsNegativeCachedAndNeverThrows() {
        AtomicInteger calls = new AtomicInteger();
        Statement s = stmt(conn(null, calls));
        Object root = tracker.servletEnter(new Req(), new Resp());
        run(s, "select 2");
        run(s, "select 2");
        run(s, "select 2");
        tracker.servletExit(root, new Resp(), null);
        assertEquals(1, calls.get());
        assertEquals("", out.records.get(0).sql.get(0).db);
        assertEquals(3, out.records.get(0).sql.get(0).cnt);
    }

    @Test
    public void nonStatementOrNullStatementGivesEmptyDb() {
        Object root = tracker.servletEnter(new Req(), new Resp());
        Object t = tracker.sqlEnter("not a statement", "select a from t3");
        tracker.sqlExit(t, null);
        t = tracker.sqlEnter(null, "select b from t4");
        tracker.sqlExit(t, null);
        tracker.servletExit(root, new Resp(), null);
        assertEquals("", out.records.get(0).sql.get(0).db);
        assertEquals("", out.records.get(0).sql.get(1).db);
    }
}
