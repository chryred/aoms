package com.synapsev.agentt.instrument;

import com.synapsev.agentt.shaded.asm.ClassReader;
import com.synapsev.agentt.shaded.asm.Opcodes;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Answers "which supertypes does this class have" without loading classes: class files are read through the
 * defining loader's resources and only their headers are parsed. Results are cached by internal name.
 */
final class HierarchyResolver {
    static final class Info {
        final String superName;
        final String[] interfaces;
        final boolean isInterface;

        Info(String superName, String[] interfaces, boolean isInterface) {
            this.superName = superName;
            this.interfaces = interfaces;
            this.isInterface = isInterface;
        }
    }

    private static final int CACHE_MAX = 50000;
    private static final int DEPTH_MAX = 64;
    private static final Info MISSING = new Info(null, new String[0], false);

    private final Map<String, Info> infos = new ConcurrentHashMap<String, Info>();
    private final Map<String, Set<String>> ancestors = new ConcurrentHashMap<String, Set<String>>();

    /** All supertypes of {@code name} including itself, using the class bytes we already hold for the class. */
    Set<String> ancestors(String name, byte[] bytes, ClassLoader loader) {
        Set<String> cached = ancestors.get(name);
        if (cached != null) {
            return cached;
        }
        ClassReader cr = new ClassReader(bytes);
        Set<String> out = new HashSet<String>();
        out.add(name);
        addAll(cr.getSuperName(), cr.getInterfaces(), loader, out, 0);
        remember(name, out);
        return out;
    }

    /** Same for an already loaded class (retransform path). */
    Set<String> ancestors(Class<?> c) {
        Set<String> out = new HashSet<String>();
        collect(c, out, 0);
        return out;
    }

    private void collect(Class<?> c, Set<String> out, int depth) {
        if (c == null || depth > DEPTH_MAX || !out.add(c.getName().replace('.', '/'))) {
            return;
        }
        collect(c.getSuperclass(), out, depth + 1);
        Class<?>[] ifs = c.getInterfaces();
        for (int i = 0; i < ifs.length; i++) {
            collect(ifs[i], out, depth + 1);
        }
    }

    private void remember(String name, Set<String> set) {
        if (ancestors.size() >= CACHE_MAX) {
            ancestors.clear();
        }
        ancestors.put(name, set);
    }

    private void addAll(String superName, String[] interfaces, ClassLoader loader, Set<String> out, int depth) {
        if (depth > DEPTH_MAX) {
            return;
        }
        visit(superName, loader, out, depth);
        if (interfaces != null) {
            for (int i = 0; i < interfaces.length; i++) {
                visit(interfaces[i], loader, out, depth);
            }
        }
    }

    private void visit(String name, ClassLoader loader, Set<String> out, int depth) {
        if (name == null || !out.add(name)) {
            return;
        }
        Info i = info(name, loader);
        if (i != null) {
            addAll(i.superName, i.interfaces, loader, out, depth + 1);
        }
    }

    /** Header information for a class, or null when its bytes cannot be found. */
    Info info(String name, ClassLoader loader) {
        Info i = infos.get(name);
        if (i != null) {
            return i == MISSING ? null : i;
        }
        i = read(name, loader);
        if (i == null && loader != null) {
            i = read(name, null);
        }
        if (infos.size() >= CACHE_MAX) {
            infos.clear();
        }
        infos.put(name, i == null ? MISSING : i);
        return i;
    }

    private static Info read(String name, ClassLoader loader) {
        InputStream is = null;
        try {
            String res = name + ".class";
            is = loader != null ? loader.getResourceAsStream(res) : ClassLoader.getSystemResourceAsStream(res);
            if (is == null) {
                return null;
            }
            ClassReader cr = new ClassReader(is);
            return new Info(cr.getSuperName(), cr.getInterfaces(), (cr.getAccess() & Opcodes.ACC_INTERFACE) != 0);
        } catch (Throwable t) {
            return null;
        } finally {
            if (is != null) {
                try {
                    is.close();
                } catch (Throwable ignore) {
                    // ignore
                }
            }
        }
    }

    /** Mirrors ASM's default getCommonSuperClass but reads class files instead of loading classes. */
    String commonSuperClass(String a, String b, ClassLoader loader) {
        if (a.equals(b)) {
            return a;
        }
        List<String> chainA = chain(a, loader);
        List<String> chainB = chain(b, loader);
        if (chainA.contains(b)) {
            return b;
        }
        if (chainB.contains(a)) {
            return a;
        }
        Info ia = info(a, loader);
        Info ib = info(b, loader);
        if (ia == null || ib == null || ia.isInterface || ib.isInterface) {
            return "java/lang/Object";
        }
        for (int i = 0; i < chainA.size(); i++) {
            if (chainB.contains(chainA.get(i))) {
                return chainA.get(i);
            }
        }
        return "java/lang/Object";
    }

    private List<String> chain(String name, ClassLoader loader) {
        List<String> l = new ArrayList<String>();
        String n = name;
        while (n != null && l.size() < DEPTH_MAX) {
            l.add(n);
            Info i = info(n, loader);
            n = i == null ? null : i.superName;
        }
        return l;
    }
}
