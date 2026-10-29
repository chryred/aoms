package com.synapsev.agentt.bridge;

/**
 * Static entry points called from instrumented bytecode. Loaded by the bootstrap class loader. Every method
 * returns immediately when no sink is installed and never lets a Throwable escape into the host application.
 */
public final class Hooks {
    /** Installed by the agent runtime; null disables all hooks (kill switch). */
    public static volatile HookSink sink;

    private Hooks() { }

    public static void setSink(HookSink s) {
        sink = s;
    }

    public static Object servletEnter(Object req, Object resp) {
        HookSink s = sink;
        if (s == null) {
            return null;
        }
        try {
            return s.servletEnter(req, resp);
        } catch (Throwable t) {
            return null;
        }
    }

    public static void servletExit(Object token, Object resp, Throwable t) {
        HookSink s = sink;
        if (s == null) {
            return;
        }
        try {
            s.servletExit(token, resp, t);
        } catch (Throwable ignore) {
            // never affect the host application
        }
    }

    public static void sqlPrepare(Object stmt, String sql) {
        HookSink s = sink;
        if (s == null) {
            return;
        }
        try {
            s.sqlPrepare(stmt, sql);
        } catch (Throwable ignore) {
            // never affect the host application
        }
    }

    public static Object sqlEnter(Object stmt, String sqlOrNull) {
        HookSink s = sink;
        if (s == null) {
            return null;
        }
        try {
            return s.sqlEnter(stmt, sqlOrNull);
        } catch (Throwable t) {
            return null;
        }
    }

    public static void sqlExit(Object token, Throwable t) {
        HookSink s = sink;
        if (s == null) {
            return;
        }
        try {
            s.sqlExit(token, t);
        } catch (Throwable ignore) {
            // never affect the host application
        }
    }

    public static void fetchEnter(Object rs) {
        HookSink s = sink;
        if (s == null) {
            return;
        }
        try {
            s.fetchEnter(rs);
        } catch (Throwable ignore) {
            // never affect the host application
        }
    }

    public static void fetch(Object rs, boolean hasRow) {
        HookSink s = sink;
        if (s == null) {
            return;
        }
        try {
            s.fetch(rs, hasRow);
        } catch (Throwable ignore) {
            // never affect the host application
        }
    }

    public static void connOpen(Object conn) {
        HookSink s = sink;
        if (s == null) {
            return;
        }
        try {
            s.connOpen(conn);
        } catch (Throwable ignore) {
            // never affect the host application
        }
    }

    public static void connClose(Object conn) {
        HookSink s = sink;
        if (s == null) {
            return;
        }
        try {
            s.connClose(conn);
        } catch (Throwable ignore) {
            // never affect the host application
        }
    }

    public static void connCommit(Object conn) {
        HookSink s = sink;
        if (s == null) {
            return;
        }
        try {
            s.connCommit(conn);
        } catch (Throwable ignore) {
            // never affect the host application
        }
    }

    public static void connRollback(Object conn) {
        HookSink s = sink;
        if (s == null) {
            return;
        }
        try {
            s.connRollback(conn);
        } catch (Throwable ignore) {
            // never affect the host application
        }
    }

    public static Object extEnter(Object urlConn) {
        HookSink s = sink;
        if (s == null) {
            return null;
        }
        try {
            return s.extEnter(urlConn);
        } catch (Throwable t) {
            return null;
        }
    }

    public static void extExit(Object token, Throwable t) {
        HookSink s = sink;
        if (s == null) {
            return;
        }
        try {
            s.extExit(token, t);
        } catch (Throwable ignore) {
            // never affect the host application
        }
    }
}
