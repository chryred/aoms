package com.synapsev.agentt.norm;

/**
 * Turns a JDBC URL into a short display name {@code host:port/database} (credentials and driver parameters are
 * dropped). Pure string handling, never throws; an unparsable URL yields the vendor name, anything else "".
 * Java 6 API only.
 */
public final class JdbcUrlNormalizer {
    public static final int MAX_LEN = 128;

    private JdbcUrlNormalizer() { }

    public static String normalize(String url) {
        if (url == null) {
            return "";
        }
        String out;
        try {
            out = parse(url.trim());
        } catch (Throwable t) {
            out = "";
        }
        return clean(out);
    }

    private static String parse(String url) {
        if (url.length() >= 5 && url.regionMatches(true, 0, "jdbc:", 0, 5)) {
            url = url.substring(5);
        }
        if (url.length() == 0) {
            return "";
        }
        String lower = url.toLowerCase();
        String vendor = vendorOf(lower);
        if (vendor.equals("oracle") || vendor.equals("tibero")) {
            return oracleLike(vendor, url);
        }
        int sep = url.indexOf("://");
        if (sep >= 0) {
            return authorityForm(vendor, url.substring(sep + 3));
        }
        return vendor;
    }

    private static String vendorOf(String lower) {
        if (lower.startsWith("microsoft:sqlserver") || lower.startsWith("jtds:sqlserver")
                || lower.startsWith("sqlserver")) {
            return "sqlserver";
        }
        if (lower.startsWith("jtds:sybase") || lower.startsWith("sybase")) {
            return "sybase";
        }
        if (lower.startsWith("ibm:") || lower.startsWith("db2")) {
            return "db2";
        }
        int i = 0;
        while (i < lower.length() && isIdent(lower.charAt(i))) {
            i++;
        }
        return lower.substring(0, i);
    }

    private static boolean isIdent(char c) {
        return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
    }

    /** {@code oracle:thin:@host:port:SID}, {@code @//host:port/service}, {@code @(DESCRIPTION=...)}, TNS alias. */
    private static String oracleLike(String vendor, String url) {
        int at = url.lastIndexOf('@');
        if (at < 0) {
            return vendor;
        }
        String t = url.substring(at + 1).trim();
        if (t.length() == 0) {
            return vendor;
        }
        if (t.charAt(0) == '(') {
            String host = descValue(t, "HOST");
            if (host == null) {
                return vendor;
            }
            String port = descValue(t, "PORT");
            String db = descValue(t, "SERVICE_NAME");
            if (db == null) {
                db = descValue(t, "SID");
            }
            return join(host, port, db, vendor);
        }
        if (t.startsWith("ldap")) {
            return vendor;
        }
        if (t.startsWith("//")) {
            return authorityForm(vendor, t.substring(2));
        }
        // host:port:SID | host:port/service | host/service | alias
        String hostPort = t;
        String db = "";
        int slash = t.indexOf('/');
        if (slash >= 0) {
            hostPort = t.substring(0, slash);
            db = cut(t.substring(slash + 1), "?;");
        }
        String[] p = hostPort.split(":", -1);
        if (slash < 0 && p.length == 1) {
            return vendor + "/" + cut(p[0], "?;"); // TNS alias
        }
        String host = p[0];
        String port = p.length > 1 ? p[1] : "";
        if (slash < 0 && p.length > 2) {
            db = cut(p[2], "?;");
        }
        return join(host, port, db, vendor);
    }

    /** Value of {@code (KEY=value)} in a TNS descriptor, case/space tolerant; first occurrence. */
    private static String descValue(String d, String key) {
        String u = d.toUpperCase();
        int from = 0;
        while (true) {
            int i = u.indexOf(key, from);
            if (i < 0) {
                return null;
            }
            from = i + key.length();
            if (i == 0 || (u.charAt(i - 1) != '(' && u.charAt(i - 1) != ' ')) {
                continue; // e.g. SERVICE_NAME matched inside another word, or no opening paren
            }
            int j = from;
            while (j < d.length() && d.charAt(j) == ' ') {
                j++;
            }
            if (j >= d.length() || d.charAt(j) != '=') {
                continue;
            }
            j++;
            int e = d.indexOf(')', j);
            if (e < 0) {
                return null;
            }
            String v = d.substring(j, e).trim();
            return v.length() == 0 ? null : v;
        }
    }

    /** {@code [user[:pw]@]host[:port][,host2...][/db][?|;params]} after the {@code //}. */
    private static String authorityForm(String vendor, String rest) {
        int end = rest.length();
        for (int i = 0; i < rest.length(); i++) {
            char c = rest.charAt(i);
            if (c == '(') { // address=(host=..)(port=..) form: skip balanced parens
                int close = rest.lastIndexOf(')');
                int k = rest.indexOf('/', Math.max(close, i));
                end = k < 0 ? indexOfAny(rest, "?;", Math.max(close, i)) : k;
                if (end < 0) {
                    end = rest.length();
                }
                break;
            }
            if (c == '/' || c == '?' || c == ';') {
                end = i;
                break;
            }
        }
        String authority = rest.substring(0, end);
        String tail = rest.substring(end);
        int at = authority.lastIndexOf('@');
        if (at >= 0) {
            authority = authority.substring(at + 1);
        }
        String host;
        String port = "";
        if (authority.indexOf('(') >= 0) {
            host = descValue(authority, "HOST");
            port = descValue(authority, "PORT");
            if (host == null) {
                return vendor;
            }
        } else {
            int comma = authority.indexOf(',');
            if (comma >= 0) {
                authority = authority.substring(0, comma);
            }
            host = authority;
            if (authority.startsWith("[")) {
                int rb = authority.indexOf(']');
                if (rb > 0) {
                    host = authority.substring(0, rb + 1);
                    if (rb + 1 < authority.length() && authority.charAt(rb + 1) == ':') {
                        port = authority.substring(rb + 2);
                    }
                }
            } else {
                int colon = authority.lastIndexOf(':');
                if (colon >= 0) {
                    host = authority.substring(0, colon);
                    port = authority.substring(colon + 1);
                }
            }
            int bs = host.indexOf('\\'); // SQL Server named instance
            if (bs >= 0 && port.length() > 0) {
                host = host.substring(0, bs);
            }
        }
        String db = "";
        if (tail.startsWith("/")) {
            db = cut(tail.substring(1), "?;:");
        }
        if (db.length() == 0) {
            db = paramValue(tail, new String[] {"databasename", "database", "dbname"});
        }
        return join(host, port, db, vendor);
    }

    private static String paramValue(String tail, String[] keys) {
        String lower = tail.toLowerCase();
        for (int k = 0; k < keys.length; k++) {
            int from = 0;
            while (true) {
                int i = lower.indexOf(keys[k] + "=", from);
                if (i < 0) {
                    break;
                }
                from = i + 1;
                if (i > 0 && lower.charAt(i - 1) != ';' && lower.charAt(i - 1) != '?' && lower.charAt(i - 1) != '&') {
                    continue;
                }
                int s = i + keys[k].length() + 1;
                int e = indexOfAny(tail, ";&", s);
                return (e < 0 ? tail.substring(s) : tail.substring(s, e)).trim();
            }
        }
        return "";
    }

    private static String join(String host, String port, String db, String vendor) {
        host = host == null ? "" : host.trim();
        if (host.length() == 0) {
            return vendor;
        }
        port = port == null ? "" : port.trim();
        if (port.length() == 0 || !isDigits(port)) {
            port = defaultPort(vendor);
        }
        StringBuilder sb = new StringBuilder(host);
        if (port.length() > 0) {
            sb.append(':').append(port);
        }
        if (db != null && db.trim().length() > 0) {
            sb.append('/').append(db.trim());
        }
        return sb.toString();
    }

    private static String defaultPort(String vendor) {
        if (vendor.equals("oracle")) {
            return "1521";
        }
        if (vendor.equals("postgresql")) {
            return "5432";
        }
        if (vendor.equals("mysql") || vendor.equals("mariadb")) {
            return "3306";
        }
        if (vendor.equals("sqlserver")) {
            return "1433";
        }
        if (vendor.equals("tibero")) {
            return "8629";
        }
        if (vendor.equals("db2")) {
            return "50000";
        }
        return "";
    }

    private static boolean isDigits(String s) {
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) < '0' || s.charAt(i) > '9') {
                return false;
            }
        }
        return true;
    }

    private static String cut(String s, String stops) {
        int e = indexOfAny(s, stops, 0);
        return (e < 0 ? s : s.substring(0, e)).trim();
    }

    private static int indexOfAny(String s, String chars, int from) {
        for (int i = Math.max(0, from); i < s.length(); i++) {
            if (chars.indexOf(s.charAt(i)) >= 0) {
                return i;
            }
        }
        return -1;
    }

    private static String clean(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length() && sb.length() < MAX_LEN; i++) {
            char c = s.charAt(i);
            sb.append(c < 0x20 || c == 0x7f ? '?' : c);
        }
        return sb.toString();
    }
}
