package com.synapsev.agentt.instrument;

import com.synapsev.agentt.shaded.asm.AnnotationVisitor;
import com.synapsev.agentt.shaded.asm.Label;
import com.synapsev.agentt.shaded.asm.MethodVisitor;
import com.synapsev.agentt.shaded.asm.Opcodes;
import com.synapsev.agentt.shaded.asm.Type;
import com.synapsev.agentt.shaded.asm.TypePath;
import com.synapsev.agentt.shaded.asm.commons.AdviceAdapter;
import com.synapsev.agentt.shaded.asm.commons.Method;

/**
 * Wraps one method body with bridge hook calls: enter at the top, exit before every return, and a catch-all
 * handler that reports the exception and rethrows it unchanged. Adds no fields or methods to the class.
 */
final class HookAdapter extends AdviceAdapter {
    private static final Type HOOKS = Type.getObjectType("com/synapsev/agentt/bridge/Hooks");
    private static final Type OBJECT = Type.getType(Object.class);
    private static final Type THROWABLE = Type.getType(Throwable.class);
    private static final Method SERVLET_ENTER = new Method("servletEnter", "(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;");
    private static final Method SERVLET_EXIT = new Method("servletExit", "(Ljava/lang/Object;Ljava/lang/Object;Ljava/lang/Throwable;)V");
    private static final Method SQL_ENTER = new Method("sqlEnter", "(Ljava/lang/Object;Ljava/lang/String;)Ljava/lang/Object;");
    private static final Method SQL_EXIT = new Method("sqlExit", "(Ljava/lang/Object;Ljava/lang/Throwable;)V");
    private static final Method SQL_PREPARE = new Method("sqlPrepare", "(Ljava/lang/Object;Ljava/lang/String;)V");
    private static final Method FETCH_ENTER = new Method("fetchEnter", "(Ljava/lang/Object;)V");
    private static final Method FETCH = new Method("fetch", "(Ljava/lang/Object;Z)V");
    private static final Method CONN_OPEN_ENTER = new Method("connOpenEnter", "(Ljava/lang/Object;)V");
    private static final Method CONN_OPEN = new Method("connOpen", "(Ljava/lang/Object;)V");
    private static final Method CONN_CLOSE = new Method("connClose", "(Ljava/lang/Object;)V");
    private static final Method CONN_COMMIT = new Method("connCommit", "(Ljava/lang/Object;)V");
    private static final Method CONN_ROLLBACK = new Method("connRollback", "(Ljava/lang/Object;)V");
    private static final Method EXT_ENTER = new Method("extEnter", "(Ljava/lang/Object;)Ljava/lang/Object;");
    private static final Method EXT_EXIT = new Method("extExit", "(Ljava/lang/Object;Ljava/lang/Throwable;)V");

    private final Matchers.Kind kind;
    private final int argCount;
    private final Type returnType;
    private final Label start = new Label();
    private final Label end = new Label();
    private int token = -1;
    private boolean guarded;
    /**
     * Exception-table entries are emitted in the order [hook regions][application entries][method-level catch-all]
     * so that a hook failure is always handled by its own region first, even when the hook call sits inside an
     * application catch-any range (the JVM takes the first matching entry).
     */
    private final java.util.List<Label[]> hookEntries = new java.util.ArrayList<Label[]>();
    private final java.util.List<Object[]> appEntries = new java.util.ArrayList<Object[]>();

    @Override
    public void visitTryCatchBlock(Label from, Label to, Label handler, String type) {
        appEntries.add(new Object[] {from, to, handler, type});
    }

    @Override
    public AnnotationVisitor visitTryCatchAnnotation(int typeRef, TypePath typePath, String desc, boolean visible) {
        return null; // type annotations on catch blocks cannot follow their (re-ordered) block; they are optional
    }

    HookAdapter(MethodVisitor mv, int access, String name, String desc, Matchers.Kind kind) {
        super(AsmApi.LEVEL, mv, access, name, desc);
        this.kind = kind;
        this.argCount = Type.getArgumentTypes(desc).length;
        this.returnType = Type.getReturnType(desc);
    }

    /** Starts a region in which one hook call is made; any Throwable raised inside is discarded. */
    private Label open() {
        Label s = new Label();
        mark(s);
        return s;
    }

    /** Ends the region; the handler drops the Throwable (and pushes null when the hook returns a token). */
    private void close(Label s, boolean returnsObject) {
        Label e = new Label();
        Label after = new Label();
        mark(e);
        goTo(after);
        Label h = new Label();
        hookEntries.add(new Label[] {s, e, h});
        mark(h);
        pop();
        if (returnsObject) {
            visitInsn(Opcodes.ACONST_NULL);
        }
        mark(after);
    }

    @Override
    protected void onMethodEnter() {
        switch (kind) {
            case SERVLET: {
                token = newLocal(OBJECT);
                Label s = open();
                loadArg(0);
                loadArg(1);
                invokeStatic(HOOKS, SERVLET_ENTER);
                close(s, true);
                storeLocal(token);
                markGuarded();
                break;
            }
            case SQL_EXEC: {
                token = newLocal(OBJECT);
                Label s = open();
                loadThis();
                if (argCount > 0) {
                    loadArg(0);
                } else {
                    visitInsn(Opcodes.ACONST_NULL);
                }
                invokeStatic(HOOKS, SQL_ENTER);
                close(s, true);
                storeLocal(token);
                markGuarded();
                break;
            }
            case EXT: {
                token = newLocal(OBJECT);
                Label s = open();
                loadThis();
                invokeStatic(HOOKS, EXT_ENTER);
                close(s, true);
                storeLocal(token);
                markGuarded();
                break;
            }
            case FETCH: {
                Label s = open();
                loadThis();
                invokeStatic(HOOKS, FETCH_ENTER);
                close(s, false);
                markGuarded();
                break;
            }
            case CONN_OPEN: {
                Label s = open();
                loadThis();
                invokeStatic(HOOKS, CONN_OPEN_ENTER);
                close(s, false);
                markGuarded();
                break;
            }
            case CONN_CLOSE: {
                Label s = open();
                loadThis();
                invokeStatic(HOOKS, CONN_CLOSE);
                close(s, false);
                break;
            }
            default:
                break;
        }
    }

    @Override
    protected void onMethodExit(int opcode) {
        if (opcode == Opcodes.ATHROW || kind == Matchers.Kind.CONN_CLOSE) {
            return; // every throw leaves through the catch-all handler
        }
        // The operand stack is discarded when a hook call fails, so the return value is parked in a local.
        boolean hasValue = opcode != Opcodes.RETURN;
        int ret = -1;
        if (hasValue) {
            ret = newLocal(returnType);
            storeLocal(ret);
        }
        Label s = open();
        switch (kind) {
            case SERVLET:
                loadLocal(token);
                loadArg(1);
                visitInsn(Opcodes.ACONST_NULL);
                invokeStatic(HOOKS, SERVLET_EXIT);
                break;
            case SQL_EXEC:
                loadLocal(token);
                visitInsn(Opcodes.ACONST_NULL);
                invokeStatic(HOOKS, SQL_EXIT);
                break;
            case EXT:
                loadLocal(token);
                visitInsn(Opcodes.ACONST_NULL);
                invokeStatic(HOOKS, EXT_EXIT);
                break;
            case SQL_PREPARE:
                loadLocal(ret);
                loadArg(0);
                invokeStatic(HOOKS, SQL_PREPARE);
                break;
            case FETCH:
                loadThis();
                loadLocal(ret);
                invokeStatic(HOOKS, FETCH);
                break;
            case CONN_OPEN:
                loadLocal(ret);
                invokeStatic(HOOKS, CONN_OPEN);
                break;
            case CONN_COMMIT:
                loadThis();
                invokeStatic(HOOKS, CONN_COMMIT);
                break;
            case CONN_ROLLBACK:
                loadThis();
                invokeStatic(HOOKS, CONN_ROLLBACK);
                break;
            default:
                break;
        }
        close(s, false);
        if (hasValue) {
            loadLocal(ret);
        }
    }

    @Override
    public void visitMaxs(int maxStack, int maxLocals) {
        Label catchAll = new Label();
        if (guarded) {
            mark(end);
            mark(catchAll);
            int ex = newLocal(THROWABLE);
            storeLocal(ex);
            Label s = open();
            switch (kind) {
                case SERVLET:
                    loadLocal(token);
                    loadArg(1);
                    loadLocal(ex);
                    invokeStatic(HOOKS, SERVLET_EXIT);
                    break;
                case SQL_EXEC:
                    loadLocal(token);
                    loadLocal(ex);
                    invokeStatic(HOOKS, SQL_EXIT);
                    break;
                case EXT:
                    loadLocal(token);
                    loadLocal(ex);
                    invokeStatic(HOOKS, EXT_EXIT);
                    break;
                case FETCH:
                    loadThis();
                    push(false);
                    invokeStatic(HOOKS, FETCH);
                    break;
                case CONN_OPEN:
                    visitInsn(Opcodes.ACONST_NULL);
                    invokeStatic(HOOKS, CONN_OPEN);
                    break;
                default:
                    break;
            }
            close(s, false);
            loadLocal(ex);
            throwException();
        }
        for (Label[] h : hookEntries) {
            mv.visitTryCatchBlock(h[0], h[1], h[2], "java/lang/Throwable");
        }
        for (Object[] a : appEntries) {
            mv.visitTryCatchBlock((Label) a[0], (Label) a[1], (Label) a[2], (String) a[3]);
        }
        if (guarded) {
            mv.visitTryCatchBlock(start, end, catchAll, "java/lang/Throwable");
        }
        super.visitMaxs(maxStack, maxLocals);
    }

    private void markGuarded() {
        guarded = true;
        mark(start);
    }
}
