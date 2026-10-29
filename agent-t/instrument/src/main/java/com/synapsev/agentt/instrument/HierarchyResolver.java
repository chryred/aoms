package com.synapsev.agentt.instrument;

import com.synapsev.agentt.shaded.asm.ClassReader;
import com.synapsev.agentt.shaded.asm.Opcodes;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
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

    /** Answers are cached per defining loader: same class name in two webapps may have different supertypes. */
    private static final class Cache {
        final Map<String, Info> infos = new ConcurrentHashMap<String, Info>();
        final Map<String, Set<String>> ancestors = new ConcurrentHashMap<String, Set<String>>();
    }

    private final Cache bootCache = new Cache();
    private final Map<ClassLoader, Cache> caches = new WeakHashMap<ClassLoader, Cache>();

    private Cache cache(ClassLoader loader) {
        if (loader == null) {
            return bootCache;
        }
        synchronized (caches) {
            Cache c = caches.get(loader);
            if (c == null) {
                c = new Cache();
                caches.put(loader, c);
            }
            return c;
        }
    }

    /** Raised when frame computation would need a guess; the transformer then keeps the original class. */
    static final class UnresolvedHierarchyException extends RuntimeException {
        private static final long serialVersionUID = 1L;

        UnresolvedHierarchyException(String m) {
            super(m);
        }
    }

    /** All supertypes of {@code name} including itself, using the class bytes we already hold for the class. */
    Set<String> ancestors(String name, byte[] bytes, ClassLoader loader) {
        Cache cache = cache(loader);
        Set<String> cached = cache.ancestors.get(name);
        if (cached != null) {
            return cached;
        }
        ClassReader cr = new ClassReader(bytes);
        Set<String> out = new HashSet<String>();
        out.add(name);
        addAll(cr.getSuperName(), cr.getInterfaces(), loader, out, 0);
        if (cache.ancestors.size() >= CACHE_MAX) {
            cache.ancestors.clear();
        }
        cache.ancestors.put(name, out);
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
        Cache cache = cache(loader);
        Info i = cache.infos.get(name);
        if (i != null) {
            return i == MISSING ? null : i;
        }
        i = read(name, loader);
        if (i == null && loader != null && (name.startsWith("java/") || name.startsWith("javax/"))) {
            i = read(name, null); // loaders that hide JDK class files
        }
        if (cache.infos.size() >= CACHE_MAX) {
            cache.infos.clear();
        }
        cache.infos.put(name, i == null ? MISSING : i);
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

    /**
     * Mirrors ASM's default getCommonSuperClass but reads class files instead of loading classes. Throws when a
     * header is unreadable: guessing could produce a frame the verifier rejects.
     */
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
        if (info(a, loader).isInterface || info(b, loader).isInterface) {
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
            if (i == null) {
                throw new UnresolvedHierarchyException("cannot read class header of " + n);
            }
            n = i.superName;
        }
        return l;
    }
}
