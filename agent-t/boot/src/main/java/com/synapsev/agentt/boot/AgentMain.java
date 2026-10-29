package com.synapsev.agentt.boot;

import com.synapsev.agentt.conf.AgentProperties;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.instrument.Instrumentation;
import java.util.jar.JarFile;

/**
 * Agent entry points. Everything runs inside one try/catch: a failure to start leaves the application
 * untouched. This class must not reference bridge classes (they only exist once the bridge jar is appended).
 */
public final class AgentMain {
    static final String LOADED_MARKER = "agent_t.loaded";
    static final String BRIDGE_RESOURCE = "/bridge/agent-t-bridge.jar";

    private AgentMain() { }

    public static void premain(String args, Instrumentation inst) {
        start(args, inst, false);
    }

    public static void agentmain(String args, Instrumentation inst) {
        start(args, inst, true);
    }

    private static void start(String args, Instrumentation inst, boolean attached) {
        try {
            if (System.getProperty(LOADED_MARKER) != null) {
                return;
            }
            File agentDir = agentDir();
            if (new File(agentDir, "DISABLE").exists()) {
                return;
            }
            System.setProperty(LOADED_MARKER, "true");
            File propsFile = new File(agentDir, "agent-t.properties");
            String override = argValue(args, "props");
            if (override != null) {
                propsFile = new File(override);
            }
            AgentProperties props = AgentProperties.load(propsFile);
            appendBridge(inst);
            AgentRuntime.start(inst, props, attached);
        } catch (Throwable t) {
            System.err.println("[agent-t] not started: " + t);
        }
    }

    private static File agentDir() throws Exception {
        File jar = new File(AgentMain.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        File dir = jar.getParentFile();
        return dir == null ? new File(".") : dir;
    }

    /** "k=v,k2=v2" agent argument lookup. */
    static String argValue(String args, String key) {
        if (args == null) {
            return null;
        }
        String[] parts = args.split(",");
        for (int i = 0; i < parts.length; i++) {
            String p = parts[i].trim();
            if (p.startsWith(key + "=")) {
                return p.substring(key.length() + 1);
            }
        }
        return null;
    }

    private static void appendBridge(Instrumentation inst) throws Exception {
        InputStream in = AgentMain.class.getResourceAsStream(BRIDGE_RESOURCE);
        if (in == null) {
            throw new IllegalStateException("bridge jar missing from agent jar");
        }
        File tmp = File.createTempFile("agent-t-bridge", ".jar");
        tmp.deleteOnExit();
        try {
            OutputStream out = new FileOutputStream(tmp);
            try {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                }
            } finally {
                out.close();
            }
        } finally {
            in.close();
        }
        inst.appendToBootstrapClassLoaderSearch(new JarFile(tmp));
        // fail now (and not inside application code) if the bridge cannot be resolved from the boot loader
        Class.forName("com.synapsev.agentt.bridge.Hooks", true, null);
    }
}
