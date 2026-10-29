package com.synapsev.agentt.conf;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Reader;
import java.util.Properties;

/** Static agent settings from agent-t.properties (UTF-8). */
public final class AgentProperties {
    public final String gatewayUrl;
    public final String agentToken;
    public final String instanceRole;
    public final String systemName;
    public final String logDir;

    private AgentProperties(Properties p) {
        gatewayUrl = get(p, "gateway.url");
        agentToken = get(p, "agent.token");
        instanceRole = get(p, "instance.role");
        systemName = get(p, "system.name");
        logDir = get(p, "log.dir");
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
