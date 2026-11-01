package com.synapsev.agentt.instrument;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.synapsev.agentt.shaded.asm.ClassWriter;
import com.synapsev.agentt.shaded.asm.Opcodes;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public class HierarchyResolverTest {
    private static byte[] cls(String name, String sup, String... ifaces) {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(Opcodes.V1_6, Opcodes.ACC_PUBLIC, name, null, sup, ifaces);
        cw.visitEnd();
        return cw.toByteArray();
    }

    /** Loader with no parent that serves exactly the given class files. */
    private static ClassLoader loader(final Map<String, byte[]> files) {
        return new ClassLoader(null) {
            @Override
            public InputStream getResourceAsStream(String n) {
                byte[] b = files.get(n);
                return b == null ? null : new ByteArrayInputStream(b);
            }
        };
    }

    private static Map<String, byte[]> files(Object... kv) {
        Map<String, byte[]> m = new HashMap<String, byte[]>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put((String) kv[i], (byte[]) kv[i + 1]);
        }
        return m;
    }

    @Test
    public void sameClassNameResolvesPerLoader() {
        HierarchyResolver r = new HierarchyResolver();
        ClassLoader l1 = loader(files("x/A.class", cls("x/A", "java/lang/Object")));
        ClassLoader l2 = loader(files("x/B.class", cls("x/B", "java/lang/Object")));
        assertTrue(r.ancestors("x/Child", cls("x/Child", "x/A"), l1).contains("x/A"));
        java.util.Set<String> two = r.ancestors("x/Child", cls("x/Child", "x/B"), l2);
        assertTrue(two.contains("x/B"));
        assertFalse(two.contains("x/A"));
    }

    @Test
    public void missingAnswerInOneLoaderDoesNotPoisonAnother() {
        HierarchyResolver r = new HierarchyResolver();
        ClassLoader l1 = loader(files());
        ClassLoader l2 = loader(files("x/Z.class", cls("x/Z", "java/lang/Object", "java/sql/Statement")));
        assertNull(r.info("x/Z", l1));
        assertNotNull(r.info("x/Z", l2));
        assertTrue(r.ancestors("x/Q", cls("x/Q", "x/Z"), l2).contains("java/sql/Statement"));
        assertFalse(r.ancestors("x/Q", cls("x/Q", "x/Z"), l1).contains("java/sql/Statement"));
    }

    @Test
    public void commonSuperOfSiblingsIsTheSharedParent() {
        HierarchyResolver r = new HierarchyResolver();
        ClassLoader l = loader(files("x/P.class", cls("x/P", "java/lang/Object"),
                "x/S1.class", cls("x/S1", "x/P"), "x/S2.class", cls("x/S2", "x/P")));
        assertEquals("x/P", r.commonSuperClass("x/S1", "x/S2", l));
        assertEquals("x/P", r.commonSuperClass("x/S1", "x/P", l));
    }

    @Test
    public void brokenChainThrowsInsteadOfGuessing() {
        HierarchyResolver r = new HierarchyResolver();
        ClassLoader l = loader(files("x/S1.class", cls("x/S1", "x/Gone"), "x/S2.class", cls("x/S2", "java/lang/Object")));
        try {
            r.commonSuperClass("x/S1", "x/S2", l);
            fail();
        } catch (HierarchyResolver.UnresolvedHierarchyException expected) {
            assertTrue(expected.getMessage().contains("x/Gone"));
        }
    }
}
