package com.synapsev.agentt.transport;

import com.synapsev.agentt.model.DetailNode;
import com.synapsev.agentt.model.SqlAgg;
import com.synapsev.agentt.model.TxRecord;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.GZIPInputStream;

/** Shared helpers for transport tests. */
final class TestData {
    private TestData() { }

    static TxRecord tx(int n, boolean withDetail) {
        TxRecord t = new TxRecord();
        t.traceId = String.format("%032x", n);
        t.spanId = String.format("%016x", n);
        t.parentSpan = "";
        t.startTs = 1761799990000L + n;
        t.elapsedMs = 85;
        t.method = "GET";
        t.uriId = "a1b2c3d4e5f60718";
        t.status = 200;
        t.exc = "";
        t.userIp = "10.20.30.41";
        t.userId = "u1001";
        t.bizKey = "";
        t.sql = new ArrayList<SqlAgg>();
        SqlAgg a = new SqlAgg();
        a.sqlId = "1122334455667788";
        a.cnt = 1;
        a.ms = 25;
        a.maxMs = 25;
        t.sql.add(a);
        if (withDetail) {
            t.nodes = new ArrayList<DetailNode>();
            for (int i = 0; i < 20; i++) {
                DetailNode d = new DetailNode();
                d.idx = i;
                d.parent = i == 0 ? -1 : 0;
                d.kind = i == 0 ? "http" : "sql";
                d.name = "select * from order_line where order_id = ?";
                d.startOffsetMs = i;
                d.durationMs = 5;
                d.sqlId = i == 0 ? "" : "1122334455667788";
                t.nodes.add(d);
            }
            t.stacks = new ArrayList<TxRecord.StackSample>();
            TxRecord.StackSample s = new TxRecord.StackSample();
            s.frames = new String[] {"oracle.jdbc.driver.T4CPreparedStatement.executeForRows(T4CPreparedStatement.java:1203)",
                "com.shinsegae.order.OrderDao.lines(OrderDao.java:120)"};
            s.count = 3;
            t.stacks.add(s);
        }
        return t;
    }

    static String gunzip(byte[] gz) throws IOException {
        GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(gz));
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int r;
        while ((r = in.read(buf)) > 0) {
            out.write(buf, 0, r);
        }
        return new String(out.toByteArray(), "UTF-8");
    }

    static List<Object> list(Object o) {
        @SuppressWarnings("unchecked")
        List<Object> l = (List<Object>) o;
        return l;
    }
}
