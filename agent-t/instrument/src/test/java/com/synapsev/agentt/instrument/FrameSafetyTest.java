package com.synapsev.agentt.instrument;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class FrameSafetyTest {
    private TestEnv env;

    @Before
    public void setUp() {
        env = new TestEnv();
    }

    @After
    public void tearDown() {
        env.close();
    }

    private void run(boolean merge) throws Exception {
        Class<?> c = env.loader.loadClass("testapp.ServletScenario");
        Object o = c.newInstance();
        c.getField("merge").setBoolean(o, merge);
        ((Runnable) o).run();
    }

    private String seen() throws Exception {
        return (String) env.loader.loadClass("testapp.MergeFilter").getField("seen").get(null);
    }

    @Test
    public void branchMergesGetValidFrames() throws Exception {
        run(true);
        assertTrue(env.loader.transformedNames.contains("testapp.MergeFilter"));
        assertEquals("branch6", seen());
        assertEquals(0, env.transformer.failures());
        assertEquals(1, env.records().size());
    }

    @Test
    public void unresolvableHierarchyLeavesClassUntouchedAndWorking() throws Exception {
        env.loader.hiddenResources.add("testapp/BranchA.class");
        run(true);
        assertFalse(env.loader.transformedNames.contains("testapp.MergeFilter"));
        assertTrue(env.transformer.failures() >= 1);
        assertEquals("branch6", seen());
        assertEquals(1, env.records().size()); // the servlet root is still traced
    }

    @Test
    public void excludedClassIsNotTransformed() throws Exception {
        env.transformer.setExcludeClasses(Arrays.asList("testapp.OrderFilter"));
        run(false);
        assertFalse(env.loader.transformedNames.contains("testapp.OrderFilter"));
        assertTrue(env.loader.transformedNames.contains("javax.servlet.http.HttpServlet"));
        assertEquals(1, env.records().size());
    }

    @Test
    public void globExcludeCoversWholePackage() throws Exception {
        env.transformer.setExcludeClasses(Arrays.asList("javax.servlet.http.*", "testapp.Order*"));
        run(false);
        assertTrue(env.loader.transformedNames.isEmpty());
        assertEquals(0, env.records().size());
    }

    @Test
    public void exclusionMatching() {
        assertTrue(Matchers.excluded("com/acme/Foo", Arrays.asList("com.acme")));
        assertTrue(Matchers.excluded("com/acme/Foo", Arrays.asList("com/acme/*o")));
        assertFalse(Matchers.excluded("com/other/Foo", Arrays.asList("com.acme", "*Bar")));
        assertNotNull(Matchers.match("javax/servlet/http/HttpServlet", new java.util.HashSet<String>(),
                "service", "(Ljavax/servlet/http/HttpServletRequest;Ljavax/servlet/http/HttpServletResponse;)V", false));
    }
}
