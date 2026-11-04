package com.synapsev.agentt.transport;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import com.synapsev.agentt.json.JsonReader;
import com.synapsev.agentt.model.ActiveEntry;
import com.synapsev.agentt.model.JvmSample;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.junit.Test;

public class BatchSerializerTest {
    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object o) {
        return (Map<String, Object>) o;
    }

    private static String readFile(File f) throws IOException {
        FileInputStream in = new FileInputStream(f);
        try {
            byte[] b = new byte[(int) f.length()];
            int off = 0;
            while (off < b.length) {
                int r = in.read(b, off, b.length - off);
                if (r < 0) {
                    break;
                }
                off += r;
            }
            return new String(b, "UTF-8");
        } finally {
            in.close();
        }
    }

    private static Batch sampleBatch() {
        Batch b = new Batch();
        b.seq = 123;
        b.ts = 1761800000000L;
        b.cfgV = 4;
        b.agent = new Batch.AgentInfo();
        b.agent.version = "0.1.0";
        b.agent.jvm = "1.7.0_79";
        b.agent.pid = 42318;
        b.agent.host = "scdep-isic-wasdev";
        b.agent.startTs = 1761790000000L;
        b.activeBuckets = new int[] {12, 2, 1};
        ActiveEntry e = new ActiveEntry();
        e.traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
        e.spanId = "00f067aa0ba902b7";
        e.thread = "http-8080-exec-1";
        e.uriId = "a1b2c3d4e5f60718";
        e.startTs = 1761799995000L;
        e.phase = "sql";
        e.sqlId = "1122334455667788";
        e.stack = new ArrayList<String>();
        e.stack.add("a.B.c(B.java:1)");
        b.activeTop.add(e);
        b.tx.add(TestData.tx(1, false));
        b.tx.add(TestData.tx(2, true));
        b.dictSql.put("1122334455667788", "select * from orders where id = ?");
        b.dictUri.put("a1b2c3d4e5f60718", "/order/{n}");
        JvmSample j = new JvmSample();
        j.ts = 1761800000000L;
        j.heapUsed = 734003200L;
        j.heapMax = 2147483648L;
        j.nonheapUsed = 156000000L;
        j.gcCount = 412;
        j.gcMs = 9850;
        j.threads = 187;
        j.cpuRatio = 0.37;
        j.classes = 21345;
        j.connActive = 12;
        j.connIdle = 18;
        j.connMax = 659;
        j.connWait = 1;
        j.connPeak = 15;
        com.synapsev.agentt.model.PoolSample p1 = new com.synapsev.agentt.model.PoolSample();
        p1.name = "sic_DS";
        p1.kind = "jeus";
        p1.active = 7;
        p1.idle = 3;
        p1.max = 30;
        p1.wait = 0;
        p1.peak = 9;
        com.synapsev.agentt.model.PoolSample p2 = new com.synapsev.agentt.model.PoolSample();
        p2.name = "sic_sso_DS";
        p2.kind = "jeus";
        p2.active = 5;
        p2.idle = 0;
        p2.max = 5;
        p2.wait = 1;
        p2.peak = 6;
        j.pools = new com.synapsev.agentt.model.PoolSample[] {p1, p2};
        b.jvm = j;
        Batch.Dump d = new Batch.Dump();
        d.cmdId = 7;
        d.ts = 1761799999500L;
        d.text = "\"http-8080-exec-1\" #31\n\tat x.Y(Y.java:1)\n";
        d.truncated = false;
        b.dumps.add(d);
        return b;
    }

    @Test
    @SuppressWarnings("unchecked")
    public void matchesContract() throws IOException {
        File root = new File(System.getProperty("agentt.repo.root", "."));
        Map<String, Object> sample = map(JsonReader.parse(readFile(new File(root, "contracts/agent-t/batch-v1.sample.json"))));

        byte[] gz = BatchSerializer.serialize(sampleBatch());
        Map<String, Object> got = map(JsonReader.parse(TestData.gunzip(gz)));

        assertEquals(new TreeSet<String>(sample.keySet()), new TreeSet<String>(got.keySet()));
        Map<String, Object> sampleTx = map(TestData.list(sample.get("tx")).get(0));
        for (Object o : TestData.list(got.get("tx"))) {
            assertEquals(new TreeSet<String>(sampleTx.keySet()), new TreeSet<String>(map(o).keySet()));
        }
        Map<String, Object> sampleTx2 = map(TestData.list(sample.get("tx")).get(1));
        Map<String, Object> detail = map(map(TestData.list(got.get("tx")).get(1)).get("detail"));
        assertEquals(new TreeSet<String>(map(sampleTx2.get("detail")).keySet()), new TreeSet<String>(detail.keySet()));
        assertEquals(new TreeSet<String>(map(TestData.list(map(sampleTx2.get("detail")).get("nodes")).get(0)).keySet()),
                new TreeSet<String>(map(TestData.list(detail.get("nodes")).get(0)).keySet()));
        assertEquals(new TreeSet<String>(map(TestData.list(map(sampleTx2.get("detail")).get("stacks")).get(0)).keySet()),
                new TreeSet<String>(map(TestData.list(detail.get("stacks")).get(0)).keySet()));
        assertNull(map(TestData.list(got.get("tx")).get(0)).get("detail"));
        // nested objects
        for (String k : new String[] {"agent", "active", "jvm", "dropped", "dict"}) {
            assertEquals(k, new TreeSet<String>(map(sample.get(k)).keySet()), new TreeSet<String>(map(got.get(k)).keySet()));
        }
        assertEquals(new TreeSet<String>(map(TestData.list(sample.get("dumps")).get(0)).keySet()),
                new TreeSet<String>(map(TestData.list(got.get("dumps")).get(0)).keySet()));
        assertEquals(new TreeSet<String>(map(TestData.list(map(sample.get("active")).get("top")).get(0)).keySet()),
                new TreeSet<String>(map(TestData.list(map(got.get("active")).get("top")).get(0)).keySet()));
        Map<String, Object> sqlAgg = map(TestData.list(sampleTx.get("sql")).get(0));
        assertEquals(new TreeSet<String>(sqlAgg.keySet()),
                new TreeSet<String>(map(TestData.list(map(TestData.list(got.get("tx")).get(0)).get("sql")).get(0)).keySet()));
        assertEquals(Long.valueOf(1), got.get("v"));
    }

    @Test
    @SuppressWarnings("unchecked")
    public void paramsSerializedInsideDetailAndOmittedWhenAbsent() throws IOException {
        Batch b = sampleBatch();
        Map<String, Object> got = map(JsonReader.parse(TestData.gunzip(BatchSerializer.serialize(b))));
        Map<String, Object> d = map(map(TestData.list(got.get("tx")).get(1)).get("detail"));
        Map<String, Object> params = map(d.get("params"));
        assertEquals("a=1&pw=****", params.get("q"));
        assertEquals(Boolean.FALSE, params.get("t"));
        assertEquals("pw", TestData.list(TestData.list(params.get("p")).get(1)).get(0));
        assertEquals("****", TestData.list(TestData.list(params.get("p")).get(1)).get(1));
        b.tx.get(1).params = null;
        got = map(JsonReader.parse(TestData.gunzip(BatchSerializer.serialize(b))));
        assertNull(map(map(TestData.list(got.get("tx")).get(1)).get("detail")).get("params"));
    }

    @Test
    public void jvmPoolFieldsSerializedAndOmittedWhenNotCollected() throws IOException {
        Batch b = sampleBatch();
        b.jvm.pools[0].name = "we\"ird\\name";
        Map<String, Object> jvm = map(map(JsonReader.parse(TestData.gunzip(BatchSerializer.serialize(b)))).get("jvm"));
        assertEquals(Long.valueOf(12), jvm.get("conn_active"));
        assertEquals(Long.valueOf(18), jvm.get("conn_idle"));
        assertEquals(Long.valueOf(659), jvm.get("conn_max"));
        assertEquals(Long.valueOf(1), jvm.get("conn_wait"));
        assertEquals(Long.valueOf(15), jvm.get("conn_peak"));
        List<Object> pools = TestData.list(jvm.get("pools"));
        assertEquals(2, pools.size());
        assertEquals("we\"ird\\name", map(pools.get(0)).get("name"));
        assertEquals("jeus", map(pools.get(0)).get("kind"));
        assertEquals(Long.valueOf(30), map(pools.get(0)).get("max"));
        assertEquals(Long.valueOf(9), map(pools.get(0)).get("peak"));
        assertEquals(Long.valueOf(1), map(pools.get(1)).get("wait"));
        b.jvm.connActive = -1;
        b.jvm.connIdle = -1;
        b.jvm.connMax = -1;
        b.jvm.connWait = -1;
        b.jvm.connPeak = -1;
        b.jvm.pools = null;
        jvm = map(map(JsonReader.parse(TestData.gunzip(BatchSerializer.serialize(b)))).get("jvm"));
        for (String k : new String[] {"conn_active", "conn_idle", "conn_max", "conn_wait", "conn_peak", "pools"}) {
            assertFalse(k, jvm.containsKey(k));
        }
        assertEquals(Long.valueOf(187), jvm.get("threads"));
    }

    @Test
    public void jvmNullAndEscapingRoundTrip() throws IOException {
        Batch b = sampleBatch();
        b.jvm = null;
        b.activeTop.get(0).sqlId = null;
        Map<String, Object> got = map(JsonReader.parse(TestData.gunzip(BatchSerializer.serialize(b))));
        assertNull(got.get("jvm"));
        assertNull(map(TestData.list(map(got.get("active")).get("top")).get(0)).get("sql_id"));
        String text = (String) map(TestData.list(got.get("dumps")).get(0)).get("text");
        assertNotNull(text);
        assertEquals("\"http-8080-exec-1\" #31\n\tat x.Y(Y.java:1)\n", text);
    }
}
