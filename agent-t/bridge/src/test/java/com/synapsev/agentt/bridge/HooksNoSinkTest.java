package com.synapsev.agentt.bridge;

import static org.junit.Assert.assertNull;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class HooksNoSinkTest {
    @Before
    public void clear() {
        Hooks.setSink(null);
    }

    @After
    public void clearAfter() {
        Hooks.setSink(null);
    }

    @Test
    public void everyHookReturnsQuietlyWithoutSink() {
        assertNull(Hooks.servletEnter(new Object(), new Object()));
        Hooks.servletExit(null, null, null);
        Hooks.sqlPrepare(new Object(), "select 1");
        assertNull(Hooks.sqlEnter(new Object(), null));
        Hooks.sqlExit(null, new RuntimeException());
        Hooks.fetchEnter(new Object());
        Hooks.fetch(new Object(), true);
        Hooks.connOpenEnter(new Object());
        Hooks.connOpen(null);
        Hooks.connClose(new Object());
        Hooks.connCommit(new Object());
        Hooks.connRollback(new Object());
        assertNull(Hooks.extEnter(new Object()));
        Hooks.extExit(null, null);
    }

    @Test
    public void throwingSinkNeverEscapes() {
        Hooks.setSink((HookSink) java.lang.reflect.Proxy.newProxyInstance(
                HookSink.class.getClassLoader(), new Class<?>[] {HookSink.class},
                new java.lang.reflect.InvocationHandler() {
                    public Object invoke(Object p, java.lang.reflect.Method m, Object[] a) {
                        throw new IllegalStateException("boom");
                    }
                }));
        assertNull(Hooks.servletEnter(null, null));
        Hooks.servletExit(null, null, null);
        Hooks.sqlPrepare(null, null);
        assertNull(Hooks.sqlEnter(null, null));
        Hooks.sqlExit(null, null);
        Hooks.fetchEnter(null);
        Hooks.fetch(null, false);
        Hooks.connOpenEnter(null);
        Hooks.connOpen(null);
        Hooks.connClose(null);
        Hooks.connCommit(null);
        Hooks.connRollback(null);
        assertNull(Hooks.extEnter(null));
        Hooks.extExit(null, null);
    }
}
