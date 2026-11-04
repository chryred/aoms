package com.synapsev.agentt.conf;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Reader;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

/** Static agent settings from agent-t.properties (UTF-8). */
public final class AgentProperties {
    public final String gatewayUrl;
    public final String agentToken;
    public final String instanceRole;
    public final String systemName;
    public final String logDir;
    public final boolean captureParams;
    /** DB 커넥션 풀 지표 수집 킬 스위치(기본 true, pool.metrics=false 로 끈다). */
    public final boolean poolMetrics;
    public final List<String> captureUriInclude;
    public final List<String> captureUriExclude;

    private AgentProperties(Properties p) {
        gatewayUrl = get(p, "gateway.url");
        agentToken = get(p, "agent.token");
        instanceRole = get(p, "instance.role");
        systemName = get(p, "system.name");
        logDir = get(p, "log.dir");
        captureParams = "true".equalsIgnoreCase(get(p, "capture.params"));
        poolMetrics = !"false".equalsIgnoreCase(get(p, "pool.metrics"));
        captureUriInclude = list(get(p, "capture.params.uri.include"));
        captureUriExclude = list(get(p, "capture.params.uri.exclude"));
    }

    private static List<String> list(String csv) {
        List<String> out = new ArrayList<String>();
        String[] parts = csv.split(",");
        for (int i = 0; i < parts.length; i++) {
            String s = parts[i].trim();
            if (s.length() > 0) {
                out.add(s);
            }
        }
        return out;
    }

    private static String get(Properties p, String k) {
        String v = p.getProperty(k);
        return v == null ? "" : v.trim();
    }

    public static AgentProperties load(File f) throws IOException {
        Properties p = new Properties();
        Reader r = new InputStreamReader(new FileInputStream(f), "UTF-8");
        try {
            p.load(r);
        } finally {
            r.close();
        }
        return new AgentProperties(p);
    }
}
