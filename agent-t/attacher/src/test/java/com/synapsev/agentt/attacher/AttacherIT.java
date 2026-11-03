package com.synapsev.agentt.attacher;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

/**
 * Runs inside a Docker container (see build.sh it-attach). Uses the container's own java for the target and
 * the attacher, as the install job does.
 *
 * <pre>
 * java -cp it-classes AttacherIT attach  &lt;attacher.jar&gt; &lt;agent.jar&gt;   JDK image: check, attach, kill-switch options
 * java -cp it-classes AttacherIT nojdk   &lt;attacher.jar&gt;                  JRE image: --check must say no_tools_jar
 * </pre>
 */
public final class AttacherIT {
    private static int failures;

    private AttacherIT() { }

    public static void main(String[] args) throws Exception {
        String mode = args[0];
        String attacher = args[1];
        if ("attach".equals(mode)) {
            testAttach(attacher, args[2]);
            testOptionChecks(attacher);
        } else if ("nojdk".equals(mode)) {
            testNoToolsJar(attacher);
        } else {
            throw new IllegalArgumentException(mode);
        }
        System.out.println(failures == 0 ? "IT PASS (" + mode + ")" : "IT FAIL (" + mode + "): " + failures);
        System.exit(failures == 0 ? 0 : 1);
    }

    private static void testAttach(String attacher, String agentJar) throws Exception {
        Target t = Target.start();
        try {
            String[] before = run(attacher, "--check", t.pid);
            expect("check", before, 0, "OK");
            ok("check before attach has no LOADED line", before[2].isEmpty());
            expect("no_such_pid", run(attacher, "--check", "999999"), 2, "PRECHECK:no_such_pid");
            // unreachable gateway: the agent must still load and the target must keep running
            File props = File.createTempFile("agent-t-it", ".properties");
            props.deleteOnExit();
            FileWriter w = new FileWriter(props);
            w.write("gateway.url=http://127.0.0.1:1\nagent.token=it-token\ninstance.role=it\nsystem.name=it\nlog.dir=/tmp\n");
            w.close();
            expect("attach", run(attacher, t.pid, agentJar, "props=" + props.getPath()), 0, "OK");
            String expectedMarker = new File(agentJar).getAbsolutePath();
            boolean loaded = t.waitForLine("agent_t.loaded=" + expectedMarker, 20000);
            ok("target reports agent_t.loaded=<agent jar path>", loaded);
            String[] after = run(attacher, "--check", t.pid);
            expect("check after attach", after, 0, "OK");
            ok("check after attach prints LOADED:" + expectedMarker, after[2].equals("LOADED:" + expectedMarker));
            Thread.sleep(4500);
            ok("target still running after attach", t.alive());
        } finally {
            t.stop();
        }
    }

    private static void testOptionChecks(String attacher) throws Exception {
        String[][] cases = {
            { "-XX:+DisableAttachMechanism", "PRECHECK:attach_disabled" },
            { "-XX:-EnableDynamicAgentLoading", "PRECHECK:dynamic_loading_disabled" },
        };
        for (int i = 0; i < cases.length; i++) {
            Target t = Target.start("-XX:+IgnoreUnrecognizedVMOptions", cases[i][0]);
            try {
                expect(cases[i][0], run(attacher, "--check", t.pid), 2, cases[i][1]);
            } finally {
                t.stop();
            }
        }
    }

    private static void testNoToolsJar(String attacher) throws Exception {
        Target t = Target.start();
        try {
            expect("no_tools_jar", run(attacher, "--check", t.pid), 2, "PRECHECK:no_tools_jar");
        } finally {
            t.stop();
        }
    }

    private static void ok(String what, boolean cond) {
        System.out.println((cond ? "ok   " : "FAIL ") + what);
        if (!cond) {
            failures++;
        }
    }

    private static void expect(String what, String[] result, int code, String stdout) {
        boolean good = result[0].equals(String.valueOf(code)) && result[1].equals(stdout);
        ok(what + " -> exit " + result[0] + " '" + result[1] + "'" + (good ? "" : " (expected " + code + " '" + stdout + "')"), good);
    }

    /** @return {exitCode, firstOutputLine, remaining output lines joined by newline} */
    private static String[] run(String attacher, String... args) throws Exception {
        List<String> cmd = new ArrayList<String>();
        cmd.add(javaBin());
        cmd.add("-jar");
        cmd.add(attacher);
        for (int i = 0; i < args.length; i++) {
            cmd.add(args[i]);
        }
        Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
        BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), "UTF-8"));
        String first = r.readLine();
        StringBuilder rest = new StringBuilder();
        String line;
        while ((line = r.readLine()) != null) {
            System.out.println("  attacher: " + line);
            rest.append(rest.length() == 0 ? "" : "\n").append(line);
        }
        return new String[] { String.valueOf(p.waitFor()), first == null ? "" : first, rest.toString() };
    }

    private static String javaBin() {
        return new File(System.getProperty("java.home"), "bin/java").getPath();
    }

    /** Target JVM launched via sh/exec so its PID is known (first stdout line). */
    private static final class Target {
        final Process process;
        final BufferedReader out;
        final String pid;

        private Target(Process process, BufferedReader out, String pid) {
            this.process = process;
            this.out = out;
            this.pid = pid;
        }

        static Target start(String... jvmOpts) throws IOException {
            List<String> cmd = new ArrayList<String>();
            cmd.add("sh");
            cmd.add("-c");
            cmd.add("echo $$; exec \"$@\"");
            cmd.add("sh");
            cmd.add(javaBin());
            for (int i = 0; i < jvmOpts.length; i++) {
                cmd.add(jvmOpts[i]);
            }
            cmd.add("-cp");
            cmd.add(System.getProperty("java.class.path"));
            cmd.add("com.synapsev.agentt.attacher.AttachTarget");
            Process p = new ProcessBuilder(cmd).redirectErrorStream(true).start();
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), "UTF-8"));
            String pid = r.readLine().trim();
            try {
                Thread.sleep(1500); // let the JVM come up
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return new Target(p, r, pid);
        }

        boolean waitForLine(String expected, long timeoutMs) throws Exception {
            long end = System.currentTimeMillis() + timeoutMs;
            while (System.currentTimeMillis() < end) {
                if (!out.ready()) {
                    Thread.sleep(200);
                    continue;
                }
                String line = out.readLine();
                if (line == null) {
                    return false;
                }
                if (!line.startsWith("agent_t.loaded=")) {
                    System.out.println("  target: " + line);
                }
                if (line.equals(expected)) {
                    return true;
                }
            }
            return false;
        }

        boolean alive() {
            try {
                process.exitValue();
                return false;
            } catch (IllegalThreadStateException e) {
                return true;
            }
        }

        void stop() {
            process.destroy();
        }
    }
}
