package com.synapsev.agentt.instrument;

import com.synapsev.agentt.shaded.asm.ClassWriter;
import com.synapsev.agentt.shaded.asm.MethodVisitor;
import com.synapsev.agentt.shaded.asm.Opcodes;
import com.synapsev.agentt.shaded.asm.Type;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.HashSet;
import java.util.Set;

/**
 * Defines the stub servlet/JDBC classes itself (child first), running the {@link AgentTransformer} over their real
 * bytecode, and generates a concrete "$Impl" subclass for every abstract stub.
 */
public final class StubLoader extends ClassLoader {
    private final AgentTransformer transformer;
    public final Set<String> transformedNames = new HashSet<String>();

    public StubLoader(AgentTransformer transformer) {
        super(StubLoader.class.getClassLoader());
        this.transformer = transformer;
    }

    public static byte[] classBytes(String className) throws Exception {
        InputStream in = StubLoader.class.getClassLoader().getResourceAsStream(className.replace('.', '/') + ".class");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
        in.close();
        return out.toByteArray();
    }

    @Override
    protected synchronized Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
        Class<?> c = findLoadedClass(name);
        if (c != null) {
            return c;
        }
        if (!name.startsWith("javax.servlet.") && !name.startsWith("testapp.")) {
            return super.loadClass(name, resolve);
        }
        try {
            byte[] bytes;
            if (name.endsWith("$Impl")) {
                bytes = concreteSubclass(name, loadClass(name.substring(0, name.length() - 5)));
            } else {
                bytes = classBytes(name);
                byte[] t = transformer.transform(this, name.replace('.', '/'), null, null, bytes);
                if (t != null) {
                    transformedNames.add(name);
                    bytes = t;
                }
            }
            return defineClass(name, bytes, 0, bytes.length);
        } catch (ClassNotFoundException e) {
            throw e;
        } catch (Exception e) {
            throw new ClassNotFoundException(name, e);
        }
    }

    private static byte[] concreteSubclass(String name, Class<?> base) {
        String internal = name.replace('.', '/');
        String superInternal = base.getName().replace('.', '/');
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        cw.visit(Opcodes.V1_6, Opcodes.ACC_PUBLIC, internal, null, superInternal, null);
        MethodVisitor init = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        init.visitCode();
        init.visitVarInsn(Opcodes.ALOAD, 0);
        init.visitMethodInsn(Opcodes.INVOKESPECIAL, superInternal, "<init>", "()V", false);
        init.visitInsn(Opcodes.RETURN);
        init.visitMaxs(0, 0);
        init.visitEnd();
        Set<String> done = new HashSet<String>();
        for (Method m : base.getMethods()) {
            if (!Modifier.isAbstract(m.getModifiers())) {
                done.add(m.getName() + Type.getMethodDescriptor(m)); // implemented by the stub itself
            }
        }
        for (Method m : base.getMethods()) {
            if (!Modifier.isAbstract(m.getModifiers())) {
                continue;
            }
            String desc = Type.getMethodDescriptor(m);
            if (!done.add(m.getName() + desc)) {
                continue;
            }
            MethodVisitor mv = cw.visitMethod(Opcodes.ACC_PUBLIC, m.getName(), desc, null, null);
            mv.visitCode();
            mv.visitTypeInsn(Opcodes.NEW, "java/lang/UnsupportedOperationException");
            mv.visitInsn(Opcodes.DUP);
            mv.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/UnsupportedOperationException", "<init>", "()V", false);
            mv.visitInsn(Opcodes.ATHROW);
            mv.visitMaxs(0, 0);
            mv.visitEnd();
        }
        cw.visitEnd();
        return cw.toByteArray();
    }
}
