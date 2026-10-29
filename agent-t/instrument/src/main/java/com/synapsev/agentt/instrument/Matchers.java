package com.synapsev.agentt.instrument;

import java.util.Set;

/** Decides which classes and methods are instrumented (spec 6.3, phase P1). Pure name/descriptor logic. */
final class Matchers {
    enum Kind { SERVLET, SQL_EXEC, SQL_PREPARE, FETCH, CONN_OPEN, CONN_CLOSE, CONN_COMMIT, CONN_ROLLBACK, EXT }

    private static final String[] SERVLET_NS = {"javax/servlet", "jakarta/servlet"};
    private static final String STATEMENT = "java/sql/Statement";
    private static final String CONNECTION = "java/sql/Connection";
    private static final String RESULT_SET = "java/sql/ResultSet";
    private static final String DATA_SOURCE = "javax/sql/DataSource";
    private static final String HTTP_URL_CONNECTION = "java/net/HttpURLConnection";

    private Matchers() { }

    /** Cheap name filter applied before any class file parsing. */
    static boolean eligible(String name) {
        if (name == null || name.length() == 0 || name.charAt(0) == '[') {
            return false;
        }
        if (name.startsWith("java/") || name.startsWith("jdk/") || name.startsWith("com/synapsev/agentt/")
                || name.startsWith("org/objectweb/") || name.indexOf("$$Lambda") >= 0) {
            return false;
        }
        if (name.startsWith("sun/")) {
            return name.startsWith("sun/net/www/protocol/http/") || name.startsWith("sun/net/www/protocol/https/");
        }
        return true;
    }

    /** True when the class belongs to at least one instrumented family. */
    static boolean interesting(String name, Set<String> anc) {
        return isHttpServlet(name) || hasFilter(anc) || anc.contains(STATEMENT) || anc.contains(CONNECTION)
                || anc.contains(RESULT_SET) || anc.contains(DATA_SOURCE) || anc.contains(HTTP_URL_CONNECTION);
    }

    static Kind match(String cls, Set<String> anc, String name, String desc) {
        for (int i = 0; i < SERVLET_NS.length; i++) {
            String ns = SERVLET_NS[i];
            if (cls.equals(ns + "/http/HttpServlet") && name.equals("service")
                    && (desc.equals("(L" + ns + "/http/HttpServletRequest;L" + ns + "/http/HttpServletResponse;)V")
                    || desc.equals("(L" + ns + "/ServletRequest;L" + ns + "/ServletResponse;)V"))) {
                return Kind.SERVLET;
            }
            if (anc.contains(ns + "/Filter") && name.equals("doFilter")
                    && desc.equals("(L" + ns + "/ServletRequest;L" + ns + "/ServletResponse;L" + ns
                    + "/FilterChain;)V")) {
                return Kind.SERVLET;
            }
        }
        if (anc.contains(STATEMENT) && isExecute(name)) {
            if (desc.startsWith("()") || desc.startsWith("(Ljava/lang/String;")) {
                return Kind.SQL_EXEC;
            }
        }
        if (anc.contains(CONNECTION)) {
            if ((name.equals("prepareStatement") || name.equals("prepareCall")) && desc.startsWith("(Ljava/lang/String;")
                    && returnsObject(desc)) {
                return Kind.SQL_PREPARE;
            }
            if (name.equals("close") && desc.equals("()V")) {
                return Kind.CONN_CLOSE;
            }
            if (name.equals("commit") && desc.equals("()V")) {
                return Kind.CONN_COMMIT;
            }
            if (name.equals("rollback") && desc.equals("()V")) {
                return Kind.CONN_ROLLBACK;
            }
        }
        if (anc.contains(RESULT_SET) && name.equals("next") && desc.equals("()Z")) {
            return Kind.FETCH;
        }
        if (anc.contains(DATA_SOURCE) && name.equals("getConnection") && returnsObject(desc)) {
            return Kind.CONN_OPEN;
        }
        if (anc.contains(HTTP_URL_CONNECTION)) {
            if ((name.equals("connect") && desc.equals("()V"))
                    || (name.equals("getOutputStream") && desc.equals("()Ljava/io/OutputStream;"))
                    || (name.equals("getInputStream") && desc.equals("()Ljava/io/InputStream;"))
                    || (name.equals("getResponseCode") && desc.equals("()I"))) {
                return Kind.EXT;
            }
        }
        return null;
    }

    /** Return types are not compared exactly so covariant implementations match too. */
    private static boolean returnsObject(String desc) {
        return desc.indexOf(")L") > 0;
    }

    /** Class-name exclusion: prefix, or glob when the pattern contains '*' (dots or slashes). */
    static boolean excluded(String internalName, java.util.List<String> patterns) {
        for (int i = 0; i < patterns.size(); i++) {
            String p = patterns.get(i).replace('.', '/');
            if (p.indexOf('*') >= 0 ? glob(p, internalName) : internalName.startsWith(p)) {
                return true;
            }
        }
        return false;
    }

    private static boolean glob(String p, String s) {
        int pi = 0;
        int si = 0;
        int star = -1;
        int mark = 0;
        while (si < s.length()) {
            if (pi < p.length() && p.charAt(pi) == '*') {
                star = pi++;
                mark = si;
            } else if (pi < p.length() && p.charAt(pi) == s.charAt(si)) {
                pi++;
                si++;
            } else if (star >= 0) {
                pi = star + 1;
                si = ++mark;
            } else {
                return false;
            }
        }
        while (pi < p.length() && p.charAt(pi) == '*') {
            pi++;
        }
        return pi == p.length();
    }

    private static boolean isExecute(String n) {
        return n.equals("execute") || n.equals("executeQuery") || n.equals("executeUpdate")
                || n.equals("executeBatch") || n.equals("executeLargeUpdate") || n.equals("executeLargeBatch");
    }

    private static boolean isHttpServlet(String name) {
        return name.equals("javax/servlet/http/HttpServlet") || name.equals("jakarta/servlet/http/HttpServlet");
    }

    private static boolean hasFilter(Set<String> anc) {
        return anc.contains("javax/servlet/Filter") || anc.contains("jakarta/servlet/Filter");
    }
}
