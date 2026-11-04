package com.synapsev.agentt.transport;

import com.synapsev.agentt.json.JsonWriter;
import com.synapsev.agentt.model.ActiveEntry;
import com.synapsev.agentt.model.DetailNode;
import com.synapsev.agentt.model.JvmSample;
import com.synapsev.agentt.model.PoolSample;
import com.synapsev.agentt.model.SqlAgg;
import com.synapsev.agentt.model.TxRecord;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPOutputStream;

/** Batch to protocol-v1 JSON, gzip-compressed. */
public final class BatchSerializer {
    private BatchSerializer() { }

    public static byte[] serialize(Batch b) throws IOException {
        byte[] json = toJson(b).getBytes("UTF-8");
        ByteArrayOutputStream bos = new ByteArrayOutputStream(json.length / 4 + 64);
        GZIPOutputStream gz = new GZIPOutputStream(bos);
        gz.write(json);
        gz.close();
        return bos.toByteArray();
    }

    public static String toJson(Batch b) {
        JsonWriter w = new JsonWriter(4096 + b.tx.size() * 700);
        w.beginObject();
        w.key("v").value(b.v);
        w.key("seq").value(b.seq);
        w.key("ts").value(b.ts);
        w.key("cfg_v").value(b.cfgV);
        w.key("agent").beginObject();
        w.key("version").value(b.agent.version);
        w.key("jvm").value(b.agent.jvm);
        w.key("pid").value(b.agent.pid);
        w.key("host").value(b.agent.host);
        w.key("start_ts").value(b.agent.startTs);
        w.endObject();

        w.key("active").beginObject();
        w.key("buckets").beginArray();
        for (int i = 0; i < 3; i++) {
            w.value(b.activeBuckets != null && i < b.activeBuckets.length ? b.activeBuckets[i] : 0);
        }
        w.endArray();
        w.key("top").beginArray();
        for (int i = 0; i < b.activeTop.size(); i++) {
            active(w, b.activeTop.get(i));
        }
        w.endArray();
        w.endObject();

        w.key("tx").beginArray();
        for (int i = 0; i < b.tx.size(); i++) {
            tx(w, b.tx.get(i));
        }
        w.endArray();

        w.key("dict").beginObject();
        dict(w, "sql", b.dictSql);
        dict(w, "uri", b.dictUri);
        w.endObject();

        w.key("jvm");
        if (b.jvm == null) {
            w.nullValue();
        } else {
            jvm(w, b.jvm);
        }

        w.key("dumps").beginArray();
        for (int i = 0; i < b.dumps.size(); i++) {
            Batch.Dump d = b.dumps.get(i);
            w.beginObject();
            w.key("cmd_id").value(d.cmdId);
            w.key("ts").value(d.ts);
            w.key("text").value(d.text);
            w.key("truncated").value(d.truncated);
            w.endObject();
        }
        w.endArray();

        w.key("dropped").beginObject();
        w.key("detail").value(b.droppedDetail);
        w.key("sql").value(b.droppedSql);
        w.key("tx").value(b.droppedTx);
        w.endObject();
        w.endObject();
        return w.toString();
    }

    private static void dict(JsonWriter w, String name, Map<String, String> m) {
        w.key(name).beginObject();
        for (Map.Entry<String, String> e : m.entrySet()) {
            w.key(e.getKey()).value(e.getValue());
        }
        w.endObject();
    }

    private static void active(JsonWriter w, ActiveEntry e) {
        w.beginObject();
        w.key("trace_id").value(e.traceId);
        w.key("span_id").value(e.spanId);
        w.key("thread").value(e.thread);
        w.key("uri_id").value(e.uriId);
        w.key("start_ts").value(e.startTs);
        w.key("phase").value(e.phase);
        w.key("sql_id").value(e.sqlId);
        w.key("stack").beginArray();
        for (int i = 0; i < e.stack.size(); i++) {
            w.value(e.stack.get(i));
        }
        w.endArray();
        w.endObject();
    }

    private static void tx(JsonWriter w, TxRecord t) {
        w.beginObject();
        w.key("trace_id").value(t.traceId);
        w.key("span_id").value(t.spanId);
        w.key("parent_span").value(t.parentSpan == null ? "" : t.parentSpan);
        w.key("start_ts").value(t.startTs);
        w.key("elapsed_ms").value(t.elapsedMs);
        w.key("method").value(t.method);
        w.key("uri_id").value(t.uriId);
        w.key("status").value(t.status);
        w.key("error").value(t.error);
        w.key("exc").value(t.exc == null ? "" : t.exc);
        w.key("cpu_ms").value(t.cpuMs);
        w.key("sql_ms").value(t.sqlMs);
        w.key("sql_cnt").value(t.sqlCnt);
        w.key("fetch_cnt").value(t.fetchCnt);
        w.key("fetch_ms").value(t.fetchMs);
        w.key("ext_ms").value(t.extMs);
        w.key("ext_cnt").value(t.extCnt);
        w.key("conn_open").value(t.connOpen);
        w.key("conn_close").value(t.connClose);
        w.key("conn_leak").value(t.connLeak);
        w.key("conn_uncommit").value(t.connUncommit);
        w.key("user_ip").value(t.userIp == null ? "" : t.userIp);
        w.key("user_id").value(t.userId == null ? "" : t.userId);
        w.key("biz_key").value(t.bizKey == null ? "" : t.bizKey);
        w.key("sql").beginArray();
        if (t.sql != null) {
            for (int i = 0; i < t.sql.size(); i++) {
                SqlAgg a = t.sql.get(i);
                w.beginObject();
                w.key("sql_id").value(a.sqlId);
                w.key("cnt").value(a.cnt);
                w.key("ms").value(a.ms);
                w.key("max_ms").value(a.maxMs);
                w.key("fetch_cnt").value(a.fetchCnt);
                w.key("fetch_ms").value(a.fetchMs);
                w.key("err").value(a.err);
                w.key("db").value(a.db == null ? "" : a.db);
                w.endObject();
            }
        }
        w.endArray();
        w.key("detail");
        if (t.nodes == null) {
            w.nullValue();
        } else {
            detail(w, t);
        }
        w.endObject();
    }

    private static void detail(JsonWriter w, TxRecord t) {
        w.beginObject();
        w.key("nodes").beginArray();
        for (int i = 0; i < t.nodes.size(); i++) {
            DetailNode n = t.nodes.get(i);
            w.beginObject();
            w.key("i").value(n.idx);
            w.key("p").value(n.parent);
            w.key("k").value(n.kind);
            w.key("n").value(n.name);
            w.key("s").value(n.startOffsetMs);
            w.key("d").value(n.durationMs);
            w.key("sql_id").value(n.sqlId == null ? "" : n.sqlId);
            w.endObject();
        }
        w.endArray();
        w.key("stacks").beginArray();
        List<TxRecord.StackSample> st = t.stacks;
        if (st != null) {
            for (int i = 0; i < st.size(); i++) {
                w.beginObject();
                w.key("f").beginArray();
                String[] f = st.get(i).frames;
                for (int j = 0; j < f.length; j++) {
                    w.value(f[j]);
                }
                w.endArray();
                w.key("c").value(st.get(i).count);
                w.endObject();
            }
        }
        w.endArray();
        if (t.params != null) {
            w.key("params").beginObject();
            w.key("q").value(t.params.query);
            w.key("p").beginArray();
            for (int i = 0; i < t.params.params.size(); i++) {
                String[] kv = t.params.params.get(i);
                w.beginArray().value(kv[0]).value(kv[1]).endArray();
            }
            w.endArray();
            w.key("t").value(t.params.truncated);
            w.endObject();
        }
        w.endObject();
    }

    private static void jvm(JsonWriter w, JvmSample j) {
        w.beginObject();
        w.key("ts").value(j.ts);
        w.key("heap_used").value(j.heapUsed);
        w.key("heap_max").value(j.heapMax);
        w.key("nonheap_used").value(j.nonheapUsed);
        w.key("gc_count").value(j.gcCount);
        w.key("gc_ms").value(j.gcMs);
        w.key("threads").value(j.threads);
        w.key("cpu_ratio").value(j.cpuRatio);
        w.key("classes").value(j.classes);
        if (j.connActive >= 0) {
            w.key("conn_active").value(j.connActive);
            w.key("conn_idle").value(j.connIdle);
            w.key("conn_max").value(j.connMax);
            w.key("conn_wait").value(j.connWait);
            if (j.connPeak >= 0) {
                w.key("conn_peak").value(j.connPeak);
            }
        }
        if (j.pools != null && j.pools.length > 0) {
            w.key("pools").beginArray();
            for (int i = 0; i < j.pools.length; i++) {
                PoolSample p = j.pools[i];
                w.beginObject();
                w.key("name").value(p.name);
                w.key("kind").value(p.kind);
                w.key("active").value(p.active);
                w.key("idle").value(p.idle);
                w.key("max").value(p.max);
                w.key("wait").value(p.wait);
                if (p.peak >= 0) {
                    w.key("peak").value(p.peak);
                }
                w.endObject();
            }
            w.endArray();
        }
        w.endObject();
    }
}
