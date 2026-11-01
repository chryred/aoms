package com.synapsev.agentt.conf;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import org.junit.Test;

public class AgentConfigExcludeClassesTest {
    @Test
    public void parsesExcludeClassesSeparatelyFromUriExclude() {
        AgentConfig c = new AgentConfig();
        c.applyJson("{\"config\":{\"exclude\":[\"/static/*\"],\"exclude_classes\":[\"com.acme.\",\" org.x.* \",\"\",5]}}");
        assertEquals(Arrays.asList("/static/*"), c.exclude);
        assertEquals(Arrays.asList("com.acme.", "org.x.*"), c.excludeClasses);
    }
}
