package com.synapsev.agentt.jvm.pool;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.model.JvmSample;
import com.synapsev.agentt.model.PoolSample;
import java.io.File;
import java.lang.ref.WeakReference;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.List;
import javax.management.MBeanServer;
import javax.management.MBeanServerFactory;
import javax.management.ObjectName;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class PoolCollectorTest {
    private MBeanServer server;
    private final List<MBeanServer> servers = new ArrayList<MBeanServer>();
    private final PoolCollector.ServerSource src = new PoolCollector.ServerSource() {
        public List<MBeanServer> servers() {
            return servers;
        }
    };

    @Before
    public void setUp() {
        server = MBeanServerFactory.newMBeanServer(); // 플랫폼 서버를 쓰지 않는다
        servers.add(server);
    }

    @After
    public void tearDown() {
        servers.clear();
    }

    private PoolCollector collector() {
        return new PoolCollector(src, 64, 200, 30000);
    }

    private static Object jeusStats(ClassLoader cl, long size, long free, long max, long wait) throws Exception {
        Class<?> c = Class.forName(FakeJeusStats.class.getName(), true, cl);
        return c.getConstructor(long.class, long.class, long.class, long.class).newInstance(size, free, max, wait);
    }

    private static ClassLoader isolatedLoader() throws Exception {
        URL loc = FakeJeusStats.class.getProtectionDomain().getCodeSource().getLocation();
        return new URLClassLoader(new URL[] {loc}, null); // 부모 없음: FakeJeusStats 를 자기 것으로 정의
    }

    private FakePoolMBean jeus(String name, Object stats) throws Exception {
        FakePoolMBean m = new FakePoolMBean().put("stats", stats).put("PooledConnectionInfo", new Object());
        server.registerMBean(m, new ObjectName("JEUS:j2eeType=JDBCDataSource,name=" + name
                + ",JDBCResource=r1,J2EEServer=sic_server1"));
        m.calls.clear(); // 등록 중 getMBeanInfo 등은 제외
        return m;
    }

    private static PoolSample find(PoolSample[] pools, String name) {
        for (PoolSample p : pools) {
            if (p.name.equals(name)) {
                return p;
            }
        }
        return null;
    }

    @Test
    public void jeusStatsFromSeparateClassLoaderAndOnlyStatsIsRead() throws Exception {
        ClassLoader other = isolatedLoader();
        Object st = jeusStats(other, 12, 5, 30, 2);
        assertFalse(st.getClass() == FakeJeusStats.class);
        FakePoolMBean m = jeus("sic_DS", st);
        PoolCollector pc = collector();
        pc.tick(1000);
        JvmSample s = new JvmSample();
        pc.fill(s, 2000);
        assertEquals(1, s.pools.length);
        assertEquals("sic_DS", s.pools[0].name);
        assertEquals("jeus", s.pools[0].kind);
        assertEquals(7, s.pools[0].active);
        assertEquals(5, s.pools[0].idle);
        assertEquals(30, s.pools[0].max);
        assertEquals(2, s.pools[0].wait);
        assertEquals(7, s.connActive);
        assertEquals(5, s.connIdle);
        assertEquals(30, s.connMax);
        assertEquals(2, s.connWait);
        assertEquals(java.util.Arrays.asList("getAttribute:stats"), m.calls);
        pc.collect(7000);
        assertEquals(java.util.Arrays.asList("getAttribute:stats", "getAttribute:stats"), m.calls);
    }

    @Test
    public void jeusMaxFallsBackToUpperBoundAndActiveNeverNegative() throws Exception {
        jeus("a", jeusStats(isolatedLoader(), 3, 5, 0, 0));
        PoolCollector pc = collector();
        pc.tick(1000);
        JvmSample s = new JvmSample();
        pc.fill(s, 1500);
        assertEquals(0, s.pools[0].active);
        assertEquals(30, s.pools[0].max);
    }

    @Test
    public void peakKeepsShortLivedActiveWithinFiveSecondWindow() throws Exception {
        ClassLoader cl = isolatedLoader();
        FakePoolMBean m = jeus("p", jeusStats(cl, 5, 5, 30, 0));
        PoolCollector pc = collector();
        pc.tick(1000); // active 0
        m.put("stats", jeusStats(cl, 5, 1, 30, 0));
        pc.collect(2000); // active 4 (잠깐)
        m.put("stats", jeusStats(cl, 5, 5, 30, 0));
        pc.collect(3000); // active 0
        JvmSample s = new JvmSample();
        pc.fill(s, 3100);
        assertEquals(0, s.pools[0].active);
        assertEquals(4, s.pools[0].peak);
        assertEquals(4, s.connPeak);
        pc.collect(7500); // 2000ms 시점이 5초 창 밖
        s = new JvmSample();
        pc.fill(s, 7600);
        assertEquals(0, s.pools[0].peak);
        assertEquals(0, s.connPeak);
    }

    @Test
    public void peakNeverBelowCurrentActive() throws Exception {
        jeus("p", jeusStats(isolatedLoader(), 5, 2, 30, 0));
        PoolCollector pc = collector();
        pc.tick(1000);
        JvmSample s = new JvmSample();
        pc.fill(s, 1100);
        assertEquals(3, s.pools[0].active);
        assertEquals(3, s.pools[0].peak);
    }

    @Test
    public void noPoolsOmitsFields() {
        PoolCollector pc = collector();
        pc.tick(1000);
        JvmSample s = new JvmSample();
        pc.fill(s, 1500);
        assertEquals(-1, s.connActive);
        assertNull(s.pools);
    }

    @Test
    public void hikariSynonymsAndConfigMax() throws Exception {
        FakePoolMBean pool = new FakePoolMBean().put("ActiveConnections", 4).put("IdleConnections", 1)
                .put("TotalConnections", 5).put("ThreadsAwaitingConnection", 3);
        FakePoolMBean cfg = new FakePoolMBean().put("MaximumPoolSize", 10);
        server.registerMBean(pool, new ObjectName("com.zaxxer.hikari:type=Pool (HikariPool-1)"));
        server.registerMBean(cfg, new ObjectName("com.zaxxer.hikari:type=PoolConfig (HikariPool-1)"));
        PoolCollector pc = collector();
        pc.tick(1000);
        JvmSample s = new JvmSample();
        pc.fill(s, 1500);
        assertEquals(1, s.pools.length);
        PoolSample p = s.pools[0];
        assertEquals("HikariPool-1", p.name);
        assertEquals("hikari", p.kind);
        assertEquals(4, p.active);
        assertEquals(1, p.idle);
        assertEquals(10, p.max);
        assertEquals(3, p.wait);
        assertFalse(pool.calls.contains("getAttributes"));
    }

    @Test
    public void tomcatJdbcAndDataSourceSynonyms() throws Exception {
        server.registerMBean(new FakePoolMBean().put("Active", 2).put("Idle", 3).put("MaxActive", 5)
                .put("WaitCount", 1), new ObjectName("tomcat.jdbc:type=ConnectionPool,class=x,name=\"jdbc/x\""));
        server.registerMBean(new FakePoolMBean().put("numActive", 1L).put("numIdle", 0L).put("maxTotal", 8),
                new ObjectName("Catalina:type=DataSource,context=/app,name=\"jdbc/y\""));
        // 같은 패턴이지만 풀이 아닌 MBean 은 버려진다
        server.registerMBean(new FakePoolMBean().put("Foo", 1), new ObjectName("Catalina:type=DataSource,name=\"junk\""));
        PoolCollector pc = collector();
        pc.tick(1000);
        JvmSample s = new JvmSample();
        pc.fill(s, 1500);
        assertEquals(2, s.pools.length);
        PoolSample x = find(s.pools, "jdbc/x");
        assertEquals("tomcat", x.kind);
        assertEquals(2, x.active);
        assertEquals(5, x.max);
        assertEquals(1, x.wait);
        PoolSample y = find(s.pools, "jdbc/y");
        assertEquals(1, y.active);
        assertEquals(8, y.max);
        assertEquals(0, y.wait);
    }

    @Test
    public void dbcp2() throws Exception {
        server.registerMBean(new FakePoolMBean().put("NumActive", 3).put("NumIdle", 2).put("MaxTotal", -1),
                new ObjectName("org.apache.commons.dbcp2:name=ds,type=BasicDataSource"));
        PoolCollector pc = collector();
        pc.tick(1000);
        JvmSample s = new JvmSample();
        pc.fill(s, 1500);
        assertEquals("dbcp2", s.pools[0].kind);
        assertEquals(0, s.pools[0].max); // 무제한은 0(미상)
        assertEquals(0, s.connMax);
    }

    @Test
    public void badValuesAndThrowingMBeansDoNotPropagate() throws Exception {
        server.registerMBean(new FakePoolMBean().put("ActiveConnections", "oops").put("IdleConnections", null),
                new ObjectName("com.zaxxer.hikari:type=Pool (bad)"));
        server.registerMBean(new FakePoolMBean().put("stats", new IllegalStateException("boom")),
                new ObjectName("JEUS:j2eeType=JDBCDataSource,name=boom,JDBCResource=r,J2EEServer=s"));
        jeus("ok", jeusStats(isolatedLoader(), 2, 1, 5, 0));
        PoolCollector pc = collector();
        pc.tick(1000);
        JvmSample s = new JvmSample();
        pc.fill(s, 1500);
        assertEquals(1, s.pools.length);
        assertEquals("ok", s.pools[0].name);
    }

    @Test
    public void rediscoveryAddsAndRemovesPools() throws Exception {
        jeus("a", jeusStats(isolatedLoader(), 1, 0, 5, 0));
        PoolCollector pc = collector();
        pc.tick(1000);
        jeus("b", jeusStats(isolatedLoader(), 2, 0, 5, 0));
        pc.tick(6000); // 아직 재탐색 시각(60s) 전
        JvmSample s = new JvmSample();
        pc.fill(s, 6500);
        assertEquals(1, s.pools.length);
        pc.tick(62000);
        s = new JvmSample();
        pc.fill(s, 62500);
        assertEquals(2, s.pools.length);
        server.unregisterMBean(new ObjectName("JEUS:j2eeType=JDBCDataSource,name=a,JDBCResource=r1,J2EEServer=sic_server1"));
        pc.tick(130000);
        s = new JvmSample();
        pc.fill(s, 130500);
        assertEquals(1, s.pools.length);
        assertEquals("b", s.pools[0].name);
    }

    @Test
    public void poolsSortedByUtilizationAndCapped() throws Exception {
        jeus("low", jeusStats(isolatedLoader(), 2, 1, 10, 0));
        jeus("full", jeusStats(isolatedLoader(), 5, 0, 5, 4));
        jeus("mid", jeusStats(isolatedLoader(), 6, 0, 10, 0));
        PoolCollector pc = new PoolCollector(src, 2, 200, 30000);
        pc.tick(1000);
        JvmSample s = new JvmSample();
        pc.fill(s, 1500);
        assertEquals(2, s.pools.length);
        assertEquals("full", s.pools[0].name);
        assertEquals("mid", s.pools[1].name);
        assertEquals(11, s.connActive);
    }

    @Test
    public void budgetRoundRobinSpreadsAcrossCycles() throws Exception {
        for (int i = 0; i < 10; i++) {
            FakePoolMBean m = jeus("p" + i, jeusStats(isolatedLoader(), 1, 0, 5, 0));
            m.sleepMs = 30;
        }
        PoolCollector pc = new PoolCollector(src, 64, 100, 30000);
        pc.discover(1000);
        pc.collect(1000);
        JvmSample s = new JvmSample();
        pc.fill(s, 1100);
        assertNotNull(s.pools);
        assertTrue("예산 안에 일부만 읽어야 한다: " + s.pools.length, s.pools.length < 10);
        for (int i = 0; i < 6; i++) {
            pc.collect(1000 + 100L * (i + 1));
        }
        s = new JvmSample();
        pc.fill(s, 1700);
        assertEquals(10, s.pools.length);
    }

    @Test
    public void persistentBudgetOverrunSlowsThenDisables() throws Exception {
        FakePoolMBean m = jeus("slow", jeusStats(isolatedLoader(), 1, 0, 5, 0));
        FakePoolMBean m2 = jeus("slow2", jeusStats(isolatedLoader(), 1, 0, 5, 0));
        m.sleepMs = 15;
        m2.sleepMs = 15;
        PoolCollector pc = new PoolCollector(src, 64, 5, 30000); // 예산 5ms < 읽기 2회
        long now = 1000;
        pc.tick(now);
        for (int i = 0; i < 3; i++) {
            now += 5000;
            pc.tick(now);
        }
        assertFalse(pc.isDisabled());
        pc.tick(now + 301000);
        assertTrue(pc.isDisabled());
        JvmSample s = new JvmSample();
        pc.fill(s, now + 301500);
        assertNull(s.pools); // 비활성이면 값을 내지 않는다
    }

    @Test
    public void staleSnapshotIsOmitted() throws Exception {
        jeus("a", jeusStats(isolatedLoader(), 1, 0, 5, 0));
        PoolCollector pc = collector();
        pc.tick(1000);
        JvmSample s = new JvmSample();
        pc.fill(s, 1000 + 30001);
        assertEquals(-1, s.connActive);
        assertNull(s.pools);
    }

    @Test
    public void threadIsNamedDaemonAndProducesSnapshot() throws Exception {
        jeus("a", jeusStats(isolatedLoader(), 1, 0, 5, 0));
        PoolCollector pc = collector();
        pc.initialDelayMs = 10;
        pc.collectPeriodMs = 20;
        pc.start();
        try {
            Thread found = null;
            JvmSample s = new JvmSample();
            for (int i = 0; i < 100 && s.pools == null; i++) {
                Thread.sleep(20);
                pc.fill(s);
            }
            assertNotNull(s.pools);
            for (Thread t : Thread.getAllStackTraces().keySet()) {
                if ("agent-t-pool".equals(t.getName())) {
                    found = t;
                }
            }
            assertNotNull(found);
            assertTrue(found.isDaemon());
        } finally {
            pc.stop();
        }
    }

    @Test
    public void methodCacheDoesNotPinClassLoader() throws Exception {
        PoolCollector pc = collector();
        ObjectName on = new ObjectName("JEUS:j2eeType=JDBCDataSource,name=leak,JDBCResource=r,J2EEServer=s");
        WeakReference<ClassLoader> ref = readOnce(pc, on);
        server.unregisterMBean(on);
        for (int i = 0; i < 50 && ref.get() != null; i++) {
            System.gc();
            Thread.sleep(20);
        }
        assertNull("커넥션 풀 통계 클래스의 로더가 캐시에 고정됨", ref.get());
    }

    private WeakReference<ClassLoader> readOnce(PoolCollector pc, ObjectName on) throws Exception {
        URLClassLoader cl = (URLClassLoader) isolatedLoader();
        server.registerMBean(new FakePoolMBean().put("stats", jeusStats(cl, 3, 1, 9, 0)), on);
        pc.tick(1000);
        pc.collect(2000);
        return new WeakReference<ClassLoader>(cl);
    }

    @Test
    public void sourceNeverUsesForbiddenCalls() throws Exception {
        File root = new File(System.getProperty("agentt.repo.root", "."));
        File f = new File(root, "agent-t/core/src/main/java/com/synapsev/agentt/jvm/pool/PoolCollector.java");
        java.io.FileInputStream in = new java.io.FileInputStream(f);
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            bos.write(buf, 0, n);
        }
        in.close();
        String text = new String(bos.toByteArray(), "UTF-8");
        for (String bad : new String[] {"getPlatformMBeanServer", "s.setAttribute(", "s.getAttributes(", "s.invoke(", "s.setAttributes("}) {
            assertFalse(bad, text.contains(bad));
        }
    }
}
