package com.synapsev.agentt.conf;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import org.junit.Test;

public class AgentConfigTest {
    private static final String RESPONSE = "{\"config\": {\"version\": 5, \"enabled\": true, \"slow_ms\": 3000, "
            + "\"normal_detail_rate\": 0.01, \"stack_interval_ms\": 1000, \"exclude\": [\"/health\"], "
            + "\"uri_rules\": [[\"/t/[a-z]+\", \"/t/{x}\"]], \"log_level\": \"debug\"}, \"commands\": [], "
            + "\"need_dict\": {\"sql\": [], \"uri\": []}, \"backoff_ms\": 0}";

    @Test
    public void defaults() {
        AgentConfig c = new AgentConfig();
        assertEquals(0, c.version);
        assertEquals(3000, c.slowMs);
        assertEquals(0.01, c.normalDetailRate, 0.0);
        assertEquals(1000, c.stackIntervalMs);
        assertTrue(c.enabled);
    }

    @Test
    public void applyJson() {
        AgentConfig c = new AgentConfig();
        c.applyJson(RESPONSE);
        assertEquals(3000, c.slowMs);
        assertEquals(5, c.version);
        assertEquals("debug", c.logLevel);
        assertEquals(1, c.exclude.size());
        assertEquals("/t/{x}", c.uriRules.get(0)[1]);
    }

    @Test
    public void applyBareConfigObjectAndKeepsOmittedFields() {
        AgentConfig c = new AgentConfig();
        c.applyJson("{\"version\": 7, \"slow_ms\": 500}");
        assertEquals(7, c.version);
        assertEquals(500, c.slowMs);
        assertEquals(1000, c.stackIntervalMs);
    }

    @Test
    public void propertiesLoad() throws IOException {
        File f = File.createTempFile("agent-t", ".properties");
        f.deleteOnExit();
        FileOutputStream out = new FileOutputStream(f);
        out.write(("gateway.url=http://10.0.0.1:8330\nagent.token= tok \ninstance.role=sic_server1\n"
                + "system.name=신세계\nlog.dir=/tmp/x\n").getBytes("UTF-8"));
        out.close();
        AgentProperties p = AgentProperties.load(f);
        assertEquals("http://10.0.0.1:8330", p.gatewayUrl);
        assertEquals("tok", p.agentToken);
        assertEquals("sic_server1", p.instanceRole);
        assertEquals("신세계", p.systemName);
        assertEquals("/tmp/x", p.logDir);
    }
}
