package com.synapsev.agentt.norm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class JdbcUrlNormalizerTest {
    private static void check(String expected, String url) {
        assertEquals(url, expected, JdbcUrlNormalizer.normalize(url));
    }

    @Test
    public void oracleThin() {
        check("10.1.1.5:1521/ORCL", "jdbc:oracle:thin:@10.1.1.5:1521:ORCL");
        check("dbhost:1522/SVC", "jdbc:oracle:thin:@//dbhost:1522/SVC");
        check("dbhost:1521/SVC", "jdbc:oracle:thin:@dbhost:1521/SVC");
        check("dbhost:1521/SVC", "jdbc:oracle:thin:@//dbhost/SVC");
        check("dbhost:1521/ORCL", "jdbc:oracle:thin:scott/tiger@dbhost:1521:ORCL");
        check("dbhost:1521/ORCL", "jdbc:oracle:thin:scott/p@ss@dbhost:1521:ORCL");
        check("ora1:1530/PRD",
                "jdbc:oracle:thin:@(DESCRIPTION=(ADDRESS_LIST=(ADDRESS=(PROTOCOL=TCP)(HOST=ora1)(PORT=1530))"
                + "(ADDRESS=(PROTOCOL=TCP)(HOST=ora2)(PORT=1530)))(CONNECT_DATA=(SERVICE_NAME=PRD)))");
        check("ora1:1521/XE",
                "jdbc:oracle:thin:@( DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(host = ora1)(Port = 1521)) "
                + "(CONNECT_DATA = (SID = XE)))");
        check("oracle/MYTNS", "jdbc:oracle:oci:@MYTNS");
        check("oracle", "jdbc:oracle:thin:@");
        check("oracle", "jdbc:oracle:thin:@ldap://ldap.example.com:389/db,cn=OracleContext");
    }

    @Test
    public void tibero() {
        check("10.2.2.2:8629/tibero", "jdbc:tibero:thin:@10.2.2.2:8629:tibero");
    }

    @Test
    public void postgresql() {
        check("pg1:5432/app", "jdbc:postgresql://pg1:5432/app");
        check("pg1:5432/app", "jdbc:postgresql://pg1/app?user=u&password=secret&ssl=true");
        check("pg1:5433/app", "jdbc:postgresql://pg1:5433,pg2:5433/app?targetServerType=primary");
        check("[::1]:5432/app", "jdbc:postgresql://[::1]:5432/app");
        check("pg1:5432/app", "jdbc:postgresql://u:pw@pg1:5432/app");
    }

    @Test
    public void mysqlAndMariadb() {
        check("m1:3306/shop", "jdbc:mysql://m1:3306/shop?useSSL=false&password=x");
        check("m1:3306/shop", "jdbc:mysql://m1/shop");
        check("m1:3307/shop", "jdbc:mysql:loadbalance://m1:3307,m2:3307/shop");
        check("maria:3306/db1", "jdbc:mariadb://maria:3306/db1?user=root");
        check("m1:3306/shop", "jdbc:mysql://address=(host=m1)(port=3306)/shop");
        check("m1:3306", "jdbc:mysql://m1:3306");
    }

    @Test
    public void sqlServer() {
        check("10.103.1.61:1433/stap",
                "jdbc:sqlserver://10.103.1.61:1433;databaseName=stap;user=sa;password=secret;encrypt=false");
        check("sqlh:1433/Db", "jdbc:sqlserver://sqlh;DatabaseName=Db");
        check("sqlh:1500/Db", "jdbc:sqlserver://sqlh\\INST1:1500;database=Db");
        check("sqlh\\INST1:1433/Db", "jdbc:sqlserver://sqlh\\INST1;databaseName=Db");
        check("sqlh:1433", "jdbc:sqlserver://sqlh:1433");
        check("sqlh:1433/Db", "jdbc:jtds:sqlserver://sqlh:1433/Db;tds=8.0;user=x;password=y");
        check("sqlh:1433/Db", "jdbc:microsoft:sqlserver://sqlh:1433;DatabaseName=Db");
    }

    @Test
    public void db2() {
        check("db2h:50000/SAMPLE", "jdbc:db2://db2h:50000/SAMPLE:currentSchema=X;user=u;password=p;");
        check("db2h:50000/SAMPLE", "jdbc:db2://db2h/SAMPLE");
    }

    @Test
    public void unknownAndEdgeCases() {
        check("h2", "jdbc:h2:mem:test;DB_CLOSE_DELAY=-1");
        check("sqlite", "jdbc:sqlite:/tmp/x.db");
        check("hsqldb", "jdbc:hsqldb:mem:t");
        check("cub:33000/demo", "jdbc:cub://cub:33000/demo");
        check("", "");
        check("", null);
        check("", "   ");
        check("", "jdbc:");
        check("", "://");
        check("x", "jdbc:x");
    }

    @Test
    public void credentialsNeverLeak() {
        String[] urls = {
            "jdbc:oracle:thin:scott/tiger@h:1521:S",
            "jdbc:postgresql://h/db?user=bob&password=hunter2",
            "jdbc:sqlserver://h;databaseName=d;user=bob;password=hunter2",
            "jdbc:mysql://bob:hunter2@h/db",
            "jdbc:mysql://h/db?password=hunter2",
            "jdbc:db2://h:50000/D:user=bob;password=hunter2;",
        };
        for (int i = 0; i < urls.length; i++) {
            String n = JdbcUrlNormalizer.normalize(urls[i]);
            assertFalse(urls[i] + " -> " + n, n.contains("hunter2") || n.contains("tiger") || n.contains("bob"));
        }
    }

    @Test
    public void cappedAndControlCharsRemoved() {
        StringBuilder sb = new StringBuilder("jdbc:postgresql://h:5432/");
        for (int i = 0; i < 500; i++) {
            sb.append('d');
        }
        assertEquals(JdbcUrlNormalizer.MAX_LEN, JdbcUrlNormalizer.normalize(sb.toString()).length());
        String n = JdbcUrlNormalizer.normalize("jdbc:postgresql://h:5432/a\nb");
        assertTrue(n, n.indexOf('\n') < 0);
    }
}
