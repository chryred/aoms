package com.synapsev.agentt.instrument;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.shaded.asm.ClassWriter;
import com.synapsev.agentt.shaded.asm.Label;
import com.synapsev.agentt.shaded.asm.MethodVisitor;
import com.synapsev.agentt.shaded.asm.Opcodes;
import java.sql.ResultSet;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/** A return inside an application catch-any range: a failing exit hook must not be caught by that handler. */
public class HookRegionOrderTest {
    private TestEnv env;

    @Before
    public void setUp() {
        env = new TestEnv();
        env.loader.generated.put("testapp.AsmResultSet", asmResultSet());
    }

    @After
    public void tearDown() {
        env.close();
    }

    /** abstract class AsmResultSet implements ResultSet { boolean next() { try { return true; } catch (any) { return false; } } } */
    private static byte[] asmResultSet() {
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_FRAMES | ClassWriter.COMPUTE_MAXS);
        cw.visit(Opcodes.V1_7, Opcodes.ACC_PUBLIC | Opcodes.ACC_ABSTRACT, "testapp/AsmResultSet", null,
                "java/lang/Object", new String[] {"java/sql/ResultSet"});
        MethodVisitor init = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        init.visitCode();
        init.visitVarInsn(Opcodes.ALOAD, 0);
        init.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/Object", "<init>", "()V", false);
        init.visitInsn(Opcodes.RETURN);
        init.visitMaxs(0, 0);
        init.visitEnd();
        MethodVisitor mv = cw.visitMethod(Opcodes.ACC_PUBLIC, "next", "()Z", null, null);
        Label from = new Label();
        Label to = new Label();
        Label handler = new Label();
        mv.visitCode();
        mv.visitTryCatchBlock(from, to, handler, null);
        mv.visitLabel(from);
        mv.visitInsn(Opcodes.ICONST_1);
        mv.visitInsn(Opcodes.IRETURN);
        mv.visitLabel(to);
        mv.visitLabel(handler);
        mv.visitInsn(Opcodes.POP);
        mv.visitInsn(Opcodes.ICONST_0);
        mv.visitInsn(Opcodes.IRETURN);
        mv.visitMaxs(0, 0);
        mv.visitEnd();
        cw.visitEnd();
        return cw.toByteArray();
    }

    private ResultSet newResultSet() throws Exception {
        return (ResultSet) env.loader.loadClass("testapp.Make").getMethod("of", Class.class)
                .invoke(null, env.loader.loadClass("testapp.AsmResultSet"));
    }

    @Test
    public void returnValueSurvivesFailingHookInsideCatchAnyRange() throws Exception {
        env.loader.blockBridge = true;
        ResultSet rs = newResultSet();
        assertTrue(env.loader.transformedNames.contains("testapp.AsmResultSet"));
        assertTrue("original return value, not the application's catch-any result", rs.next());
    }

    @Test
    public void normalHooksStillWorkOnTheSameShape() throws Exception {
        Object tok = env.begin("/rs");
        ResultSet rs = newResultSet();
        assertTrue(rs.next());
        env.end(tok);
        assertEquals(1, env.records().get(0).fetchCnt);
        assertEquals(0, env.transformer.failures());
    }
}
