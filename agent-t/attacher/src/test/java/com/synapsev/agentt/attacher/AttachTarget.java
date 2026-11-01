package com.synapsev.agentt.attacher;

/** Tiny target JVM for AttacherIT: prints the agent_t.loaded marker every 2 seconds. */
public final class AttachTarget {
    private AttachTarget() { }

    public static void main(String[] args) throws Exception {
        while (true) {
            System.out.println("agent_t.loaded=" + System.getProperty("agent_t.loaded"));
            System.out.flush();
            Thread.sleep(2000);
        }
    }
}
