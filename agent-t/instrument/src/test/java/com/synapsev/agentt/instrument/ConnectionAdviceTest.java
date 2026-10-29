package com.synapsev.agentt.instrument;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.model.TxRecord;
import com.synapsev.agentt.tx.DetailDecider;
import java.sql.Connection;
import javax.sql.DataSource;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class ConnectionAdviceTest {
    private TestEnv env;
    private DataSource ds;

    @Before
    public void setUp() throws Exception {
        env = new TestEnv();
        ds = (DataSource) env.loader.loadClass("testapp.Make").getMethod("of", Class.class)
                .invoke(null, env.loader.loadClass("testapp.StubDataSource"));
    }

    @After
    public void tearDown() {
        env.close();
    }

    @Test
    public void leakAndUncommit() throws Exception {
        Object tok = env.begin("/conn");
        Connection a = ds.getConnection();
        ds.getConnection(); // never returned
        a.setAutoCommit(false);
        a.close(); // no commit/rollback
        env.end(tok);

        TxRecord r = env.records().get(0);
        assertEquals(2, r.connOpen);
        assertEquals(1, r.connClose);
        assertEquals(1, r.connLeak);
        assertEquals(1, r.connUncommit);
        assertTrue("leak/uncommit forces detail", r.hasDetail());
        assertTrue(DetailDecider.keep(r, env.config, 424242000L));
    }

    @Test
    public void commitBeforeCloseIsNotUncommitted() throws Exception {
        Object tok = env.begin("/conn");
        Connection a = ds.getConnection();
        a.setAutoCommit(false);
        a.commit();
        a.close();
        env.end(tok);
        TxRecord r = env.records().get(0);
        assertEquals(0, r.connLeak);
        assertEquals(0, r.connUncommit);
        assertFalse(r.hasDetail());
    }

    @Test
    public void autoCommitConnectionClosedNormally() throws Exception {
        Object tok = env.begin("/conn");
        ds.getConnection().close();
        env.end(tok);
        TxRecord r = env.records().get(0);
        assertEquals(1, r.connOpen);
        assertEquals(1, r.connClose);
        assertEquals(0, r.connUncommit);
    }

    @Test
    public void wrappingDataSourceCountsOnlyTheOutermostOpen() throws Exception {
        DataSource wrapper = (DataSource) env.loader.loadClass("testapp.Make").getMethod("of", Class.class)
                .invoke(null, env.loader.loadClass("testapp.WrapperDataSource"));
        Object tok = env.begin("/conn");
        Connection c = wrapper.getConnection();
        c.close();
        env.end(tok);
        TxRecord r = env.records().get(0);
        assertEquals(1, r.connOpen);
        assertEquals(1, r.connClose);
        assertEquals(0, r.connLeak);
    }
}
