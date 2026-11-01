package com.synapsev.agentt.instrument;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.synapsev.agentt.id.Fnv64;
import com.synapsev.agentt.model.TxRecord;
import com.synapsev.agentt.norm.SqlNormalizer;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class JdbcAdviceTest {
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
    public void aggregatesPerSql() throws Exception {
        String sql = "select * from orders where id = 42";
        Object tok = env.begin("/jdbc");
        Connection c = ds.getConnection();
        PreparedStatement ps = c.prepareStatement(sql);
        ResultSet rs = null;
        for (int i = 0; i < 3; i++) {
            rs = ps.executeQuery();
        }
        for (int i = 0; i < 10; i++) {
            assertTrue(rs.next());
        }
        c.commit();
        c.close();
        env.end(tok);

        assertEquals(0, env.transformer.failures());
        assertEquals(1, env.records().size());
        TxRecord r = env.records().get(0);
        String norm = SqlNormalizer.normalize(sql);
        assertEquals(1, r.sql.size());
        assertEquals(Fnv64.hex(norm), r.sql.get(0).sqlId);
        assertEquals(3, r.sql.get(0).cnt);
        assertEquals(10, r.sql.get(0).fetchCnt);
        assertEquals(3, r.sqlCnt);
        assertEquals(10, r.fetchCnt);
        assertTrue(env.out.sqlDefs.contains(Fnv64.hex(norm) + "=" + norm));
    }

    @Test
    public void differentSqlGetSeparateRows() throws Exception {
        Object tok = env.begin("/jdbc");
        Connection c = ds.getConnection();
        c.prepareStatement("select 1 from a").execute();
        c.prepareStatement("select 2 from b").execute();
        c.prepareStatement("select 1 from a").execute();
        c.close();
        env.end(tok);
        TxRecord r = env.records().get(0);
        assertEquals(2, r.sql.size());
        assertEquals(2, r.sql.get(0).cnt);
        assertEquals(1, r.sql.get(1).cnt);
    }

    @Test
    public void sqlFailureIsCountedAndRethrown() throws Exception {
        Object tok = env.begin("/jdbc");
        PreparedStatement ps = ds.getConnection().prepareStatement("update t set a = 1 -- fail");
        try {
            ps.executeUpdate();
            fail("SQLException must reach the caller");
        } catch (SQLException e) {
            assertEquals("forced failure", e.getMessage());
        }
        env.end(tok);
        assertEquals(1, env.records().get(0).sql.get(0).err);
    }

    @Test
    public void sqlOutsideTransactionIsIgnored() throws Exception {
        PreparedStatement ps = ds.getConnection().prepareStatement("select 1");
        assertTrue(ps.execute());
        assertEquals(0, env.records().size());
    }

    @Test
    public void detailTreeHasSqlNodesUnderRoot() throws Exception {
        env.config.normalDetailRate = 1.0;
        Object tok = env.begin("/jdbc");
        ds.getConnection().prepareStatement("select 1 from dual").execute();
        env.end(tok);
        TxRecord r = env.records().get(0);
        assertTrue(r.hasDetail());
        assertEquals(2, r.nodes.size());
        assertEquals("sql", r.nodes.get(1).kind);
        assertEquals(0, r.nodes.get(1).parent);
        assertEquals(r.sql.get(0).sqlId, r.nodes.get(1).sqlId);
    }
}
