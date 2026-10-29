package com.synapsev.agentt.instrument;

import com.synapsev.agentt.log.AgentLog;
import com.synapsev.agentt.shaded.asm.ClassReader;
import com.synapsev.agentt.shaded.asm.ClassVisitor;
import com.synapsev.agentt.shaded.asm.ClassWriter;
import com.synapsev.agentt.shaded.asm.MethodVisitor;
import com.synapsev.agentt.shaded.asm.Opcodes;
import java.lang.instrument.ClassFileTransformer;
import java.security.ProtectionDomain;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Rewrites servlet/JDBC/connection/HttpURLConnection classes. Any failure leaves the original class bytes in
 * place (returns null) and only bumps a counter, so a bad transformation can never break the host application.
 */
public final class AgentTransformer implements ClassFileTransformer {
    private static final int LOG_LIMIT = 20;

    private final HierarchyResolver resolver = new HierarchyResolver();
    private final AtomicInteger failures = new AtomicInteger();
    private final AtomicInteger transformed = new AtomicInteger();
    private final ThreadLocal<Boolean> busy = new ThreadLocal<Boolean>();
    private volatile boolean active = true;
    private volatile List<String> excludeClasses = Collections.emptyList();

    /** Class-name prefixes / globs that are never rewritten (takes effect on the next transform or retransform). */
    public void setExcludeClasses(List<String> patterns) {
        excludeClasses = patterns == null ? Collections.<String>emptyList() : patterns;
    }

    public List<String> getExcludeClasses() {
        return excludeClasses;
    }

    public void setActive(boolean on) {
        active = on;
    }

    public int failures() {
        return failures.get();
    }

    public int transformedClasses() {
        return transformed.get();
    }

    public byte[] transform(ClassLoader loader, String name, Class<?> redefined, ProtectionDomain pd, byte[] bytes) {
        if (!active || name == null || bytes == null || busy.get() != null || !Matchers.eligible(name)
                || Matchers.excluded(name, excludeClasses)) {
            return null;
        }
        busy.set(Boolean.TRUE);
        try {
            Set<String> anc = redefined != null ? resolver.ancestors(redefined) : resolver.ancestors(name, bytes, loader);
            if (!Matchers.interesting(name, anc)) {
                return null;
            }
            byte[] out = rewrite(loader, name, anc, bytes);
            if (out != null) {
                transformed.incrementAndGet();
            }
            return out;
        } catch (Throwable t) {
            int n = failures.incrementAndGet();
            if (n <= LOG_LIMIT) {
                AgentLog.warn("instrumentation skipped for " + name + ": " + t);
            }
            return null;
        } finally {
            busy.remove();
        }
    }

    /**
     * True when a loaded class belongs to an instrumented family (used to pick retransform targets). Exclusions
     * are deliberately ignored: newly excluded classes must be retransformed to get their original bytes back.
     */
    public boolean isCandidate(Class<?> c) {
        try {
            String name = c.getName().replace('.', '/');
            return Matchers.eligible(name) && !c.isInterface() && Matchers.interesting(name, resolver.ancestors(c));
        } catch (Throwable t) {
            return false;
        }
    }

    private byte[] rewrite(final ClassLoader loader, final String name, final Set<String> anc, byte[] bytes) {
        ClassReader cr = new ClassReader(bytes);
        if ((cr.getAccess() & Opcodes.ACC_INTERFACE) != 0) {
            return null;
        }
        int version = ((bytes[6] & 0xff) << 8) | (bytes[7] & 0xff);
        int flags = version >= Opcodes.V1_6 ? ClassWriter.COMPUTE_FRAMES : ClassWriter.COMPUTE_MAXS;
        ClassWriter cw = new ClassWriter(cr, flags) {
            @Override
            protected String getCommonSuperClass(String a, String b) {
                return resolver.commonSuperClass(a, b, loader);
            }
        };
        final boolean[] changed = new boolean[1];
        ClassVisitor cv = new ClassVisitor(AsmApi.LEVEL, cw) {
            @Override
            public MethodVisitor visitMethod(int access, String mname, String desc, String sig, String[] exc) {
                MethodVisitor mv = super.visitMethod(access, mname, desc, sig, exc);
                if (mv == null || (access & (Opcodes.ACC_ABSTRACT | Opcodes.ACC_NATIVE | Opcodes.ACC_STATIC | Opcodes.ACC_BRIDGE
                        | Opcodes.ACC_SYNTHETIC)) != 0) {
                    return mv;
                }
                Matchers.Kind k = Matchers.match(name, anc, mname, desc);
                if (k == null) {
                    return mv;
                }
                changed[0] = true;
                return new HookAdapter(mv, access, mname, desc, k);
            }
        };
        cr.accept(cv, ClassReader.SKIP_FRAMES);
        return changed[0] ? cw.toByteArray() : null;
    }
}
