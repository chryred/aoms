package com.synapsev.agentt.transport;

import com.synapsev.agentt.model.ActiveEntry;
import com.synapsev.agentt.model.JvmSample;
import com.synapsev.agentt.model.TxRecord;
import java.lang.management.ManagementFactory;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** One wire batch (protocol v1). Plain data holder. */
public final class Batch {
    public static final class AgentInfo {
        public String version = "0.1.0";
        public String jvm = "";
        public long pid;
        public String host = "";
        public long startTs;

        public static AgentInfo detect(String agentVersion) {
            AgentInfo a = new AgentInfo();
            a.version = agentVersion;
            a.jvm = System.getProperty("java.version", "");
            try {
                String name = ManagementFactory.getRuntimeMXBean().getName(); // pid@host
                int at = name.indexOf('@');
                a.pid = Long.parseLong(at > 0 ? name.substring(0, at) : name);
                a.startTs = ManagementFactory.getRuntimeMXBean().getStartTime();
            } catch (Throwable ignore) {
                // keep defaults
            }
            try {
                a.host = InetAddress.getLocalHost().getHostName();
            } catch (Throwable ignore) {
                a.host = "unknown";
            }
            return a;
        }
    }

    public static final class Dump {
        public long cmdId;
        public long ts;
        public String text = "";
        public boolean truncated;
    }

    public int v = 1;
    public long seq;
    public long ts;
    public int cfgV;
    public AgentInfo agent = new AgentInfo();
    public int[] activeBuckets = new int[] {0, 0, 0};
    public List<ActiveEntry> activeTop = new ArrayList<ActiveEntry>();
    public List<TxRecord> tx = new ArrayList<TxRecord>();
    public Map<String, String> dictSql = new LinkedHashMap<String, String>();
    public Map<String, String> dictUri = new LinkedHashMap<String, String>();
    /** null except on the 5-second cadence. */
    public JvmSample jvm;
    public List<Dump> dumps = new ArrayList<Dump>();
    public long droppedDetail;
    public long droppedSql;
    public long droppedTx;
}
