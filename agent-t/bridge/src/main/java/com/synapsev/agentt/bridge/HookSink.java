package com.synapsev.agentt.bridge;

/**
 * Receiver of the calls injected into application classes. Only JDK types appear in signatures because this
 * interface lives on the bootstrap class path (application and agent classes are not visible from there).
 */
public interface HookSink {
    Object servletEnter(Object req, Object resp);

    void servletExit(Object token, Object resp, Throwable t);

    void sqlPrepare(Object stmt, String sql);

    Object sqlEnter(Object stmt, String sqlOrNull);

    void sqlExit(Object token, Throwable t);

    /** Called on entry of ResultSet.next(); paired with exactly one {@link #fetch}. */
    void fetchEnter(Object rs);

    void fetch(Object rs, boolean hasRow);

    /** Called on entry of DataSource.getConnection; paired with exactly one {@link #connOpen} (null on failure). */
    void connOpenEnter(Object dataSource);

    void connOpen(Object conn);

    void connClose(Object conn);

    void connCommit(Object conn);

    void connRollback(Object conn);

    Object extEnter(Object urlConn);

    void extExit(Object token, Throwable t);
}
