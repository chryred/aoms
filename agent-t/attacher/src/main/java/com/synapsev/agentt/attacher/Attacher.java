package com.synapsev.agentt.attacher;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;

/**
 * Dynamic attach launcher: {@code java -jar agent-t-attacher.jar <pid> <agentJar> [agentArgs]}.
 *
 * <p>Must run with the TARGET JVM's java. JDK 6-8 load {@code tools.jar} reflectively, JDK 9+ use the
 * {@code jdk.attach} module. There is no compile-time dependency on {@code com.sun.tools.attach}.
 *
 * <p>Exit codes: 0 success, 2 precondition failure (one line {@code PRECHECK:<reason>}), 1 other failure.
 * {@code --check <pid>} only evaluates the preconditions and prints {@code OK} or {@code PRECHECK:<reason>}.
 */
public final class Attacher {
    static final String NO_TOOLS_JAR = "no_tools_jar";
    static final String ATTACH_DISABLED = "attach_disabled";
    static final String DYNAMIC_LOADING_DISABLED = "dynamic_loading_disabled";
    static final String NOT_SAME_USER = "not_same_user";
    static final String TMPDIR_NOT_WRITABLE = "tmpdir_not_writable";
    static final String JDK_TOO_OLD = "jdk_too_old";
    static final String NO_SUCH_PID = "no_such_pid";

    private static final String VM_CLASS = "com.sun.tools.attach.VirtualMachine";

    private Attacher() { }

    public static void main(String[] args) {
        int code;
        try {
            code = run(args);
        } catch (Throwable t) {
            System.err.println("attach failed: " + t);
            code = 1;
        }
        System.exit(code);
    }

    static int run(String[] args) throws Exception {
        if (args.length >= 2 && "--check".equals(args[0])) {
            String reason = precheck(args[1]);
            System.out.println(reason == null ? "OK" : "PRECHECK:" + reason);
            return reason == null ? 0 : 2;
        }
        if (args.length < 2) {
            System.err.println("usage: java -jar agent-t-attacher.jar [--check] <pid> [<agentJarPath> [agentArgs]]");
            return 1;
        }
        String pid = args[0];
        String agentJar = args[1];
        String agentArgs = args.length > 2 ? args[2] : null;
        String reason = precheck(pid);
        if (reason != null) {
            System.out.println("PRECHECK:" + reason);
            return 2;
        }
        if (!new File(agentJar).isFile()) {
            System.err.println("agent jar not found: " + agentJar);
            return 1;
        }
        attach(pid, new File(agentJar).getAbsolutePath(), agentArgs);
        System.out.println("OK");
        return 0;
    }

    /** @return null when attach is expected to work, otherwise a stable reason token. */
    static String precheck(String pid) {
        boolean linux = new File("/proc/self").exists();
        if (!pid.matches("[0-9]+")) {
            return NO_SUCH_PID;
        }
        if (linux && !new File("/proc/" + pid).exists()) {
            return NO_SUCH_PID;
        }
        int major = javaMajor(System.getProperty("java.specification.version", ""));
        if (major < 6) {
            return JDK_TOO_OLD;
        }
        if (major <= 8 && toolsJar() == null) {
            return NO_TOOLS_JAR;
        }
        if (linux) {
            String mine = uidOf("/proc/self/status");
            String theirs = uidOf("/proc/" + pid + "/status");
            if (mine != null && theirs != null && !mine.equals(theirs)) {
                return NOT_SAME_USER;
            }
            String[] opts = cmdline("/proc/" + pid + "/cmdline");
            boolean disabled = false;
            boolean dynamicOff = false;
            for (int i = 0; i < opts.length; i++) {
                if ("-XX:+DisableAttachMechanism".equals(opts[i])) {
                    disabled = true;
                } else if ("-XX:-DisableAttachMechanism".equals(opts[i])) {
                    disabled = false;
                } else if ("-XX:-EnableDynamicAgentLoading".equals(opts[i])) {
                    dynamicOff = true;
                } else if ("-XX:+EnableDynamicAgentLoading".equals(opts[i])) {
                    dynamicOff = false;
                }
            }
            if (disabled) {
                return ATTACH_DISABLED;
            }
            if (dynamicOff) {
                return DYNAMIC_LOADING_DISABLED;
            }
        }
        if (!tmpdirWritable()) {
            return TMPDIR_NOT_WRITABLE;
        }
        return null;
    }

    /** "1.6" -> 6, "1.8.0" -> 8, "9" -> 9, "21" -> 21; unparsable -> 0. */
    static int javaMajor(String spec) {
        try {
            String[] p = spec.split("\\.");
            int first = Integer.parseInt(p[0]);
            if (first == 1 && p.length > 1) {
                return Integer.parseInt(p[1]);
            }
            return first;
        } catch (RuntimeException e) {
            return 0;
        }
    }

    static File toolsJar() {
        String home = System.getProperty("java.home", "");
        File[] candidates = { new File(home, "../lib/tools.jar"), new File(home, "lib/tools.jar") };
        for (int i = 0; i < candidates.length; i++) {
            if (candidates[i].isFile()) {
                return candidates[i];
            }
        }
        return null;
    }

    private static boolean tmpdirWritable() {
        File dir = new File(System.getProperty("java.io.tmpdir", "/tmp"));
        File f = null;
        try {
            f = File.createTempFile("agent-t-attach", ".tmp", dir);
            return true;
        } catch (IOException e) {
            return false;
        } catch (SecurityException e) {
            return false;
        } finally {
            if (f != null) {
                f.delete();
            }
        }
    }

    /** First field of the "Uid:" line (real uid), or null when unreadable. */
    private static String uidOf(String statusFile) {
        BufferedReader r = null;
        try {
            r = new BufferedReader(new InputStreamReader(new FileInputStream(statusFile), "UTF-8"));
            String line;
            while ((line = r.readLine()) != null) {
                if (line.startsWith("Uid:")) {
                    String[] f = line.substring(4).trim().split("\\s+");
                    return f.length > 0 ? f[0] : null;
                }
            }
        } catch (IOException e) {
            // unreadable -> skip the check
        } finally {
            if (r != null) {
                try {
                    r.close();
                } catch (IOException ignore) {
                    // ignore
                }
            }
        }
        return null;
    }

    /** NUL-separated argv of the process; empty when unreadable (check is then skipped). */
    private static String[] cmdline(String file) {
        java.io.InputStream in = null;
        try {
            in = new FileInputStream(file);
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
            }
            return new String(out.toByteArray(), "UTF-8").split("\u0000");
        } catch (IOException e) {
            return new String[0];
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (IOException ignore) {
                    // ignore
                }
            }
        }
    }

    private static void attach(String pid, String agentJar, String agentArgs) throws Exception {
        Class<?> vmClass;
        int major = javaMajor(System.getProperty("java.specification.version", ""));
        if (major <= 8) {
            URLClassLoader loader = new URLClassLoader(new URL[] { toolsJar().toURI().toURL() },
                    Attacher.class.getClassLoader());
            vmClass = Class.forName(VM_CLASS, true, loader);
        } else {
            vmClass = Class.forName(VM_CLASS);
        }
        Object vm = invoke(vmClass.getMethod("attach", String.class), null, pid);
        try {
            invoke(vmClass.getMethod("loadAgent", String.class, String.class), vm, agentJar, agentArgs);
        } finally {
            try {
                invoke(vmClass.getMethod("detach"), vm);
            } catch (Exception ignore) {
                // detach failure must not mask the load result
            }
        }
    }

    private static Object invoke(Method m, Object target, Object... a) throws Exception {
        try {
            return m.invoke(target, a);
        } catch (InvocationTargetException e) {
            Throwable c = e.getCause();
            if (c instanceof Exception) {
                throw (Exception) c;
            }
            throw e;
        }
    }
}
