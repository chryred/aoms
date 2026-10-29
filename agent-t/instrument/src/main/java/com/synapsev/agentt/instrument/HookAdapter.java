package com.synapsev.agentt.instrument;

import com.synapsev.agentt.shaded.asm.Label;
import com.synapsev.agentt.shaded.asm.MethodVisitor;
import com.synapsev.agentt.shaded.asm.Opcodes;
import com.synapsev.agentt.shaded.asm.Type;
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
    private static final Method CONN_OPEN = new Method("connOpen", "(Ljava/lang/Object;)V");
    private static final Method CONN_CLOSE = new Method("connClose", "(Ljava/lang/Object;)V");
    private static final Method CONN_COMMIT = new Method("connCommit", "(Ljava/lang/Object;)V");
    private static final Method CONN_ROLLBACK = new Method("connRollback", "(Ljava/lang/Object;)V");
    private static final Method EXT_ENTER = new Method("extEnter", "(Ljava/lang/Object;)Ljava/lang/Object;");
    private static final Method EXT_EXIT = new Method("extExit", "(Ljava/lang/Object;Ljava/lang/Throwable;)V");

    private final Matchers.Kind kind;
    private final int argCount;
    private final Label start = new Label();
    private final Label end = new Label();
    private int token = -1;
    private boolean guarded;

    HookAdapter(MethodVisitor mv, int access, String name, String desc, Matchers.Kind kind) {
        super(AsmApi.LEVEL, mv, access, name, desc);
        this.kind = kind;
        this.argCount = Type.getArgumentTypes(desc).length;
    }

    @Override
    protected void onMethodEnter() {
        switch (kind) {
            case SERVLET:
                loadArg(0);
                loadArg(1);
                invokeStatic(HOOKS, SERVLET_ENTER);
                saveToken();
                break;
            case SQL_EXEC:
                loadThis();
                if (argCount > 0) {
                    loadArg(0);
                } else {
                    visitInsn(Opcodes.ACONST_NULL);
                }
                invokeStatic(HOOKS, SQL_ENTER);
                saveToken();
                break;
            case EXT:
                loadThis();
                invokeStatic(HOOKS, EXT_ENTER);
                saveToken();
                break;
            case FETCH:
                loadThis();
                invokeStatic(HOOKS, FETCH_ENTER);
                markGuarded();
                break;
            case CONN_CLOSE:
                loadThis();
                invokeStatic(HOOKS, CONN_CLOSE);
                break;
            default:
                break;
        }
    }

    @Override
    protected void onMethodExit(int opcode) {
        if (opcode == Opcodes.ATHROW) {
            return; // every throw leaves through the catch-all handler
        }
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
                dup();
                loadArg(0);
                invokeStatic(HOOKS, SQL_PREPARE);
                break;
            case FETCH:
                dup();
                loadThis();
                swap();
                invokeStatic(HOOKS, FETCH);
                break;
            case CONN_OPEN:
                dup();
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
    }

    @Override
    public void visitMaxs(int maxStack, int maxLocals) {
        if (guarded) {
            mark(end);
            catchException(start, end, THROWABLE);
            int ex = newLocal(THROWABLE);
            storeLocal(ex);
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
                default:
                    break;
            }
            loadLocal(ex);
            throwException();
        }
        super.visitMaxs(maxStack, maxLocals);
    }

    private void saveToken() {
        token = newLocal(OBJECT);
        storeLocal(token);
        markGuarded();
    }

    private void markGuarded() {
        guarded = true;
        mark(start);
    }
}
