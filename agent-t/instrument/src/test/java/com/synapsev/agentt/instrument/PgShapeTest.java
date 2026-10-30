package com.synapsev.agentt.instrument;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.model.TxRecord;
import java.sql.Connection;
import java.sql.PreparedStatement;
import javax.sql.DataSource;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/** Mirrors pgjdbc: getConnection() lives in a base class that is not a DataSource; PgConnection implements a sub-interface. */
public class PgShapeTest {
    private TestEnv env;

    @Before
    public void setUp() {
        env = new TestEnv();
    }

    @After
    public void tearDown() {
        env.close();
    }

    private Object make(String cls) throws Exception {
        return env.loader.loadClass("testapp.Make").getMethod("of", Class.class).invoke(null, env.loader.loadClass(cls));
    }

    @Test
    public void baseClassGetConnectionAndSubInterfaceCloseAreCounted() throws Exception {
        DataSource ds = (DataSource) make("testapp.PgSimpleDataSource");
        Object tok = env.begin("/db");
        Connection c = ds.getConnection();
        c.close();
        env.end(tok);

        assertEquals(0, env.transformer.failures());
        assertTrue(env.loader.transformedNames.contains("testapp.PgBaseDataSource"));
        TxRecord r = env.records().get(0);
        assertEquals(1, r.connOpen);
        assertEquals(1, r.connClose);
        assertEquals(0, r.connLeak);
    }

    @Test
    public void unrelatedClassWithCovariantFactoryIsCounted() throws Exception {
        Object provider = env.loader.loadClass("testapp.ConnectionProvider").newInstance();
        Object tok = env.begin("/db");
        Connection c = (Connection) provider.getClass().getMethod("getConnection").invoke(provider);
        c.close();
        env.end(tok);
        TxRecord r = env.records().get(0);
        assertEquals(1, r.connOpen);
        assertEquals(1, r.connClose);
    }

    @Test
    public void statementGetConnectionIsNotAnOpen() throws Exception {
        DataSource ds = (DataSource) make("testapp.PgSimpleDataSource");
        Object tok = env.begin("/db");
        Connection c = ds.getConnection();
        PreparedStatement ps = (PreparedStatement) make("testapp.StubPreparedStatement");
        ps.getConnection(); // a different connection object, but not a new open
        c.close();
        env.end(tok);
        TxRecord r = env.records().get(0);
        assertEquals(1, r.connOpen);
        assertEquals(0, r.connLeak);
    }
}
