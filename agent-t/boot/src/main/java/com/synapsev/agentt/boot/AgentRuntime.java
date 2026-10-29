package com.synapsev.agentt.boot;

import com.synapsev.agentt.active.ActiveRegistry;
import com.synapsev.agentt.active.StackSampler;
import com.synapsev.agentt.bridge.Hooks;
import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.conf.AgentProperties;
import com.synapsev.agentt.instrument.AgentTransformer;
import com.synapsev.agentt.jvm.JvmCollector;
import com.synapsev.agentt.jvm.ThreadDumper;
import com.synapsev.agentt.log.AgentLog;
import com.synapsev.agentt.transport.Batch;
import com.synapsev.agentt.transport.HttpPoster;
import com.synapsev.agentt.transport.Sender;
import com.synapsev.agentt.tx.TxTracker;
import java.lang.instrument.ClassFileTransformer;
import java.lang.instrument.Instrumentation;

/**
 * Owns the install/uninstall lifecycle of the instrumentation. Kept separate from {@link AgentMain} so that
 * bridge classes are only touched after the bridge jar is on the bootstrap class path. The kill switch
 * ({@code enabled=false}) removes the transformer, restores original class bytes and detaches the hooks.
 */
public final class AgentRuntime {
    /** The Instrumentation operations the runtime needs (a fake in tests). */
    public interface Control {
        void add(ClassFileTransformer t);

        void remove(ClassFileTransformer t);

        /** Retransforms every loaded class the transformer is interested in, one class per call. */
        void retransform(AgentTransformer t);
    }

    static final class InstControl implements Control {
        private final Instrumentation inst;

        InstControl(Instrumentation inst) {
            this.inst = inst;
        }

        public void add(ClassFileTransformer t) {
            inst.addTransformer(t, true);
        }

        public void remove(ClassFileTransformer t) {
            inst.removeTransformer(t);
        }

        public void retransform(AgentTransformer t) {
            if (!inst.isRetransformClassesSupported()) {
                return;
            }
            int ok = 0;
            int failed = 0;
            Class<?>[] all = inst.getAllLoadedClasses();
            for (int i = 0; i < all.length; i++) {
                Class<?> c = all[i];
                try {
                    if (inst.isModifiableClass(c) && t.isCandidate(c)) {
                        inst.retransformClasses(c);
                        ok++;
                    }
                } catch (Throwable e) {
                    failed++; // that class simply keeps its current bytes
                }
            }
            AgentLog.info("retransform done: ok=" + ok + " failed=" + failed);
        }
    }

    private final Control control;
    private final AgentTransformer transformer;
    private final TxTracker tracker;
    private boolean installed;

    public AgentRuntime(Control control, AgentTransformer transformer, TxTracker tracker) {
        this.control = control;
        this.transformer = transformer;
        this.tracker = tracker;
    }

    public synchronized boolean isInstalled() {
        return installed;
    }

    /** Installs hooks and transformer; {@code retransformLoaded} is true for dynamic attach and re-enabling. */
    public synchronized void install(boolean retransformLoaded) {
        if (installed) {
            return;
        }
        installed = true;
        Hooks.setSink(tracker);
        transformer.setActive(true);
        control.add(transformer);
        if (retransformLoaded) {
            control.retransform(transformer);
        }
    }

    /** Kill switch: hooks off, transformer removed, original bytecode restored. */
    public synchronized void uninstall() {
        if (!installed) {
            return;
        }
        installed = false;
        Hooks.setSink(null);
        tracker.reset();
        transformer.setActive(false);
        control.remove(transformer);
        control.retransform(transformer);
    }

    /** Applies a changed class-exclusion list and retransforms so excluded classes are restored. */
    public synchronized void applyExcludes(java.util.List<String> patterns) {
        if (patterns.equals(transformer.getExcludeClasses())) {
            return;
        }
        transformer.setExcludeClasses(patterns);
        if (installed) {
            control.retransform(transformer);
        }
    }

    public synchronized void apply(boolean enabled) {
        if (enabled) {
            install(true);
        } else {
            uninstall();
        }
    }

    /**
     * Installs the transformer, then starts the sender and the control thread. If anything after the install
     * fails, everything is rolled back (transformer removed, classes restored, hooks detached) so a later
     * attach cannot double-instrument.
     */
    static void launch(AgentRuntime rt, boolean attached, Runnable startSender, Runnable startPoller,
            Runnable stopSender) {
        rt.install(attached); // transformer first, then the background threads
        try {
            startSender.run();
            startPoller.run();
        } catch (RuntimeException e) {
            rollback(rt, stopSender);
            throw e;
        } catch (Error e) {
            rollback(rt, stopSender);
            throw e;
        }
    }

    private static void rollback(AgentRuntime rt, Runnable stopSender) {
        try {
            stopSender.run();
        } catch (Throwable ignore) {
            // best effort
        }
        rt.uninstall();
    }

    /** A not-yet-started daemon thread that runs {@code task} every {@code periodMs}; failures are logged. */
    private static Thread daemon(String name, final long periodMs, final Runnable task) {
        Thread t = new Thread(name) {
            @Override
            public void run() {
                while (!isInterrupted()) {
                    try {
                        Thread.sleep(periodMs);
                        task.run();
                    } catch (InterruptedException e) {
                        return;
                    } catch (Throwable e) {
                        AgentLog.error(getName(), e);
                    }
                }
            }
        };
        t.setDaemon(true);
        return t;
    }

    static void start(Instrumentation inst, AgentProperties props, boolean attached) {
        final AgentConfig config = new AgentConfig();
        AgentLog.init(props.logDir);
        final Sender sender = new Sender(new HttpPoster(props.gatewayUrl, props.agentToken), config,
                Batch.AgentInfo.detect("0.1.0"), 1000);
        TxTracker tracker = new TxTracker(TxTracker.forSender(sender), config);
        final ActiveRegistry registry = new ActiveRegistry();
        final StackSampler sampler = new StackSampler(registry, config);
        tracker.setActive(registry, sampler);
        final JvmCollector jvm = new JvmCollector();
        final ThreadDumper dumper = new ThreadDumper();
        sender.setCommandListener(new Sender.CommandListener() {
            public void onCommand(long id, String type) {
                if (!"thread_dump".equals(type)) {
                    return;
                }
                String[] d = dumper.dump(ThreadDumper.DEFAULT_MAX_BYTES);
                if (d == null) {
                    AgentLog.warn("thread dump " + id + " ignored: limited to one per minute");
                } else {
                    sender.offerDump(id, d[0], Boolean.parseBoolean(d[1]));
                }
            }
        });
        final Thread activeLoop = daemon("agent-t-active", 1000, new Runnable() {
            public void run() {
                ActiveRegistry.ActiveSnapshot a = registry.snapshot(System.currentTimeMillis(), config.slowMs, 50);
                sender.offerActive(a.top, a.buckets);
            }
        });
        final Thread jvmLoop = daemon("agent-t-jvm", 5000, new Runnable() {
            public void run() {
                sender.offerJvm(jvm.sample());
            }
        });
        final AgentRuntime rt = new AgentRuntime(new InstControl(inst), new AgentTransformer(), tracker);
        final Thread poller = new Thread("agent-t-control") {
            @Override
            public void run() {
                while (true) {
                    try {
                        Thread.sleep(1000);
                        AgentLog.setLevel(config.logLevel);
                        rt.applyExcludes(config.excludeClasses);
                        rt.apply(config.enabled);
                    } catch (InterruptedException e) {
                        return;
                    } catch (Throwable t) {
                        AgentLog.error("control loop", t);
                    }
                }
            }
        };
        poller.setDaemon(true);
        launch(rt, attached, new Runnable() {
            public void run() {
                sender.start();
                sampler.start();
                activeLoop.start();
                jvmLoop.start();
            }
        }, new Runnable() {
            public void run() {
                poller.start();
            }
        }, new Runnable() {
            public void run() {
                sender.stop();
                sampler.stop();
                activeLoop.interrupt();
                jvmLoop.interrupt();
            }
        });
        AgentLog.info("agent-t started (" + (attached ? "agentmain" : "premain") + ") system=" + props.systemName
                + " role=" + props.instanceRole);
    }
}
