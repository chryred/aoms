package com.synapsev.agentt.instrument;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import org.junit.Test;

public class RetransformSafetyTest {
    @Test
    public void corruptedClassKeepsOriginalAndCountsFailure() throws Exception {
        byte[] good = StubLoader.classBytes("javax.servlet.http.HttpServlet");
        byte[] broken = Arrays.copyOf(good, good.length - 120); // cut inside the method data
        AgentTransformer t = new AgentTransformer();
        assertNull(t.transform(getClass().getClassLoader(), "javax/servlet/http/HttpServlet", null, null, broken));
        assertEquals(1, t.failures());
        assertEquals(0, t.transformedClasses());
    }

    @Test
    public void garbageBytesAreSurvivable() {
        AgentTransformer t = new AgentTransformer();
        assertNull(t.transform(null, "com/acme/Whatever", null, null, new byte[] {1, 2, 3, 4}));
        assertEquals(1, t.failures());
    }

    @Test
    public void validClassStillTransformsAfterFailure() throws Exception {
        AgentTransformer t = new AgentTransformer();
        t.transform(null, "com/acme/Whatever", null, null, new byte[] {1, 2, 3, 4});
        byte[] good = StubLoader.classBytes("javax.servlet.http.HttpServlet");
        assertNotNull(t.transform(getClass().getClassLoader(), "javax/servlet/http/HttpServlet", null, null, good));
        assertEquals(1, t.failures());
    }

    @Test
    public void unrelatedClassIsLeftAlone() throws Exception {
        AgentTransformer t = new AgentTransformer();
        byte[] bytes = StubLoader.classBytes("com.synapsev.agentt.instrument.RetransformSafetyTest");
        assertNull(t.transform(getClass().getClassLoader(), "com/synapsev/agentt/instrument/RetransformSafetyTest",
                null, null, bytes));
        assertNull(t.transform(getClass().getClassLoader(), "org/acme/Plain", null, null, bytes));
        assertEquals(0, t.failures());
    }

    @Test
    public void inactiveTransformerDoesNothing() throws Exception {
        AgentTransformer t = new AgentTransformer();
        t.setActive(false);
        byte[] good = StubLoader.classBytes("javax.servlet.http.HttpServlet");
        assertNull(t.transform(getClass().getClassLoader(), "javax/servlet/http/HttpServlet", null, null, good));
        assertEquals(0, t.failures());
    }
}
