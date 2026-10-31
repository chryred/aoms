package com.synapsev.agentt.tx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import com.synapsev.agentt.conf.AgentConfig;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import org.junit.Test;

/** The per-class accessor cache must not keep an undeployed webapp's classloader alive. */
public class TxTrackerAccessLeakTest {
    public static final class LeakReq {
        public String getRequestURI() {
            return "/leak/1";
        }

        public String getMethod() {
            return "GET";
        }
    }

    public static final class Resp {
        public int getStatus() {
            return 200;
        }
    }

    /** Defines LeakReq itself (no parent delegation for that one class), like a webapp loader. */
    private static final class WebappLoader extends ClassLoader {
        private static final String NAME = LeakReq.class.getName();

        WebappLoader() {
            super(TxTrackerAccessLeakTest.class.getClassLoader());
        }

        @Override
        protected synchronized Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
            if (!NAME.equals(name)) {
                return super.loadClass(name, resolve);
            }
            Class<?> c = findLoadedClass(name);
            if (c == null) {
                try {
                    InputStream in = getParent().getResourceAsStream(name.replace('.', '/') + ".class");
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        bos.write(buf, 0, n);
                    }
                    in.close();
                    byte[] b = bos.toByteArray();
                    c = defineClass(name, b, 0, b.length);
                } catch (java.io.IOException e) {
                    throw new ClassNotFoundException(name, e);
                }
            }
            return c;
        }
    }

    private final AgentConfig config = new AgentConfig();
    private final CollectingOut out = new CollectingOut();
    private final TxTracker tracker = new TxTracker(out, config);

    /** Runs two requests of a class from a fresh loader; returns only a weak handle to that loader. */
    private WeakReference<ClassLoader> exercise() throws Exception {
        ClassLoader loader = new WebappLoader();
        Class<?> c = loader.loadClass(LeakReq.class.getName());
        Object req = c.newInstance();
        for (int i = 0; i < 2; i++) {
            Object tok = tracker.servletEnter(req, new Resp());
            tracker.servletExit(tok, new Resp(), null);
        }
        return new WeakReference<ClassLoader>(loader);
    }

    @Test
    public void accessCacheDoesNotPinWebappClassLoader() throws Exception {
        WeakReference<ClassLoader> ref = exercise();
        assertEquals("reflection must still work through the cache", "GET", out.records.get(1).method);
        for (int i = 0; i < 40 && ref.get() != null; i++) {
            System.gc();
            System.runFinalization();
            Thread.sleep(25);
        }
        assertNull("webapp classloader is still strongly reachable from TxTracker", ref.get());
    }

    @Test
    public void methodIsResolvedAgainAfterWeakReferenceCleared() throws Exception {
        WeakReference<ClassLoader> keep = exercise();
        for (int i = 0; i < 5; i++) {
            System.gc();
        }
        // same tracker, a request of a plain (app-loader) class still resolves its accessors
        Object tok = tracker.servletEnter(new LeakReq(), new Resp());
        tracker.servletExit(tok, new Resp(), null);
        assertEquals("GET", out.records.get(out.records.size() - 1).method);
        keep.clear();
    }
}
