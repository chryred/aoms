package com.synapsev.agentt.jvm;

import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.model.JvmSample;
import org.junit.Test;

public class JvmCollectorTest {
    @Test
    public void sampleFields() {
        JvmSample s = new JvmCollector().sample();
        assertTrue(s.heapMax > 0);
        assertTrue(s.heapUsed > 0);
        assertTrue(s.nonheapUsed >= 0);
        assertTrue(s.threads > 0);
        assertTrue(s.classes > 0);
        assertTrue(s.gcCount >= 0 && s.gcMs >= 0);
        assertTrue(s.ts > 0);
        assertTrue(s.cpuRatio == -1 || (s.cpuRatio >= 0 && s.cpuRatio <= 1));
    }
}
