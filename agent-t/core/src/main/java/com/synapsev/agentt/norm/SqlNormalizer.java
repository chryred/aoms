package com.synapsev.agentt.norm;

import java.util.regex.Pattern;

/**
 * Normalizes SQL text so that the same statement shape yields the same ID: whitespace collapsed,
 * numeric and quoted-string literals replaced by '?', IN lists collapsed to "(?)", capped at 8,192 chars.
 */
public final class SqlNormalizer {
    public static final int MAX_LEN = 8192;
    /** Stop scanning once this much output exists (IN-collapse can only shrink it). */
    private static final int SCAN_LIMIT = MAX_LEN * 4;
    private static final Pattern IN_LIST = Pattern.compile("(?i)\\b(in\\s*)\\(\\s*\\?(?:\\s*,\\s*\\?)+\\s*\\)");

    private SqlNormalizer() { }

    public static String normalize(String sql) {
        if (sql == null) {
            return "";
        }
        int n = sql.length();
        StringBuilder sb = new StringBuilder(Math.min(n, MAX_LEN) + 16);
        boolean pendingSpace = false;
        int i = 0;
        while (i < n && sb.length() < SCAN_LIMIT) {
            char c = sql.charAt(i);
            if (Character.isWhitespace(c)) {
                pendingSpace = sb.length() > 0;
                i++;
                continue;
            }
            if (pendingSpace) {
                sb.append(' ');
                pendingSpace = false;
            }
            if (c == '\'') {
                i = skipString(sql, i);
                sb.append('?');
            } else if (c >= '0' && c <= '9' && !endsWithIdentChar(sb)) {
                i = skipNumber(sql, i);
                sb.append('?');
            } else {
                sb.append(c);
                i++;
            }
        }
        String s = sb.toString();
        if (s.indexOf('?') >= 0) {
            s = IN_LIST.matcher(s).replaceAll("$1(?)");
        }
        return truncate(s, MAX_LEN);
    }

    static String truncate(String s, int max) {
        if (s.length() <= max) {
            return s;
        }
        int end = max;
        if (Character.isHighSurrogate(s.charAt(end - 1))) {
            end--;
        }
        return s.substring(0, end);
    }

    private static boolean endsWithIdentChar(StringBuilder sb) {
        if (sb.length() == 0) {
            return false;
        }
        return isIdentChar(sb.charAt(sb.length() - 1));
    }

    private static boolean isIdentChar(char c) {
        return Character.isLetterOrDigit(c) || c == '_' || c == '$' || c == '#';
    }

    /** Returns index just after the closing quote ('' is an escaped quote); end of input if unterminated. */
    private static int skipString(String s, int i) {
        int n = s.length();
        int j = i + 1;
        while (j < n) {
            if (s.charAt(j) == '\'') {
                if (j + 1 < n && s.charAt(j + 1) == '\'') {
                    j += 2;
                    continue;
                }
                return j + 1;
            }
            j++;
        }
        return n;
    }

    private static int skipNumber(String s, int i) {
        int n = s.length();
        int j = i;
        while (j < n && isDigit(s.charAt(j))) {
            j++;
        }
        if (j + 1 < n && s.charAt(j) == '.' && isDigit(s.charAt(j + 1))) {
            j++;
            while (j < n && isDigit(s.charAt(j))) {
                j++;
            }
        }
        if (j < n && (s.charAt(j) == 'e' || s.charAt(j) == 'E')) {
            int k = j + 1;
            if (k < n && (s.charAt(k) == '+' || s.charAt(k) == '-')) {
                k++;
            }
            if (k < n && isDigit(s.charAt(k))) {
                while (k < n && isDigit(s.charAt(k))) {
                    k++;
                }
                j = k;
            }
        }
        while (j < n && isIdentChar(s.charAt(j))) { // suffixes such as 10L, 0x1F
            j++;
        }
        return j;
    }

    private static boolean isDigit(char c) {
        return c >= '0' && c <= '9';
    }
}
