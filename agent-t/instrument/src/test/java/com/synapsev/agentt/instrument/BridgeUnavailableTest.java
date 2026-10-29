package com.synapsev.agentt.instrument;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.net.HttpURLConnection;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/** App loader that cannot resolve the bridge package: instrumented code must behave exactly like the original. */
public class BridgeUnavailableTest {
    private TestEnv env;

    @Before
    public void setUp() {
        env = new TestEnv();
        env.loader.blockBridge = true;
    }

    @After
    public void tearDown() {
        env.close();
    }

    private Runnable scenario(String uri) throws Exception {
        Class<?> c = env.loader.loadClass("testapp.ServletScenario");
        Object o = c.newInstance();
        c.getField("uri").set(o, uri);
        return (Runnable) o;
    }

    @Test
    public void servletRunsNormally() throws Exception {
        scenario("/order/1").run();
        assertTrue(env.loader.transformedNames.contains("javax.servlet.http.HttpServlet"));
        assertEquals(0, env.records().size());
    }

    @Test
    public void servletExceptionIsTheOriginalOne() throws Exception {
        try {
            scenario("/boom").run();
            fail();
        } catch (IllegalStateException e) {
            assertEquals("boom", e.getMessage());
        }
    }

    @Test
    public void jdbcBehavesNormally() throws Exception {
        DataSource ds = (DataSource) env.loader.loadClass("testapp.Make").getMethod("of", Class.class)
                .invoke(null, env.loader.loadClass("testapp.StubDataSource"));
        Connection c = ds.getConnection();
        PreparedStatement ps = c.prepareStatement("select 1 from dual");
        assertTrue(ps.execute());
        ResultSet rs = ps.executeQuery();
        assertTrue(rs.next());
        c.commit();
        c.close();
        try {
            c.prepareStatement("update t set a = 1 -- fail").executeUpdate();
            fail();
        } catch (SQLException e) {
            assertEquals("forced failure", e.getMessage());
        }
    }

    @Test
    public void externalCallBehavesNormally() throws Exception {
        HttpURLConnection u = (HttpURLConnection) env.loader.loadClass("testapp.StubHttpURLConnection").newInstance();
        assertEquals(200, u.getResponseCode());
    }
}
