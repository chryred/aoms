package com.synapsev.agentt.tx;

import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.model.TxParams;
import java.net.URLDecoder;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Collects and masks request parameters (never bodies). Pure functions; callers wrap in try/catch. Opt-in via
 * {@code capture.params}; reading happens only at servlet exit (never at entry, so the app sees an untouched request).
 */
public final class ParamCapture {
    public static final int MAX_PARAMS = 50;
    public static final int MAX_VALUE = 256;
    public static final int MAX_NAME = 64;
    public static final int MAX_QUERY = 1024;
    public static final int MAX_TOTAL_BYTES = 4096;
    static final String MASK = "****";

    private static final String[] SENSITIVE = {"password", "passwd", "pwd", "pass", "token", "secret", "auth", "card",
        "cvc", "ssn", "jumin", "resident", "rrn", "account", "acct", "phone", "mobile", "tel", "email", "birth",
        "addr"};
    private static final Pattern RRN = Pattern.compile("(?<!\\d)\\d{6}-?\\d{7}(?!\\d)");
    private static final Pattern CARD_DASHED =
            Pattern.compile("(?<!\\d)\\d{4}[- ]\\d{4}[- ]\\d{4}[- ]\\d{1,7}(?!\\d)");
    private static final Pattern CARD = Pattern.compile("(?<!\\d)\\d{13,19}(?!\\d)");
    private static final Pattern EMAIL = Pattern.compile("[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+");

    private ParamCapture() { }

    /** Whether a request URI may have its parameters captured: enabled, matches include (if any), not in exclude. */
    public static boolean allowed(AgentConfig cfg, String uri) {
        if (!cfg.captureParams) {
            return false;
        }
        String u = uri == null ? "" : uri;
        List<String> ex = cfg.captureUriExclude;
        for (int i = 0; i < ex.size(); i++) {
            if (glob(ex.get(i), u)) {
                return false;
            }
        }
        List<String> in = cfg.captureUriInclude;
        if (in.isEmpty()) {
            return true;
        }
        for (int i = 0; i < in.size(); i++) {
            if (glob(in.get(i), u)) {
                return true;
            }
        }
        return false;
    }

    /** '*' = any run of characters, '?' = one character; everything else literal. */
    static boolean glob(String pattern, String s) {
        if (pattern == null || pattern.length() == 0) {
            return false;
        }
        int p = 0;
        int i = 0;
        int star = -1;
        int mark = 0;
        while (i < s.length()) {
            if (p < pattern.length() && (pattern.charAt(p) == '?' || pattern.charAt(p) == s.charAt(i))
                    && pattern.charAt(p) != '*') {
                p++;
                i++;
            } else if (p < pattern.length() && pattern.charAt(p) == '*') {
                star = p++;
                mark = i;
            } else if (star >= 0) {
                p = star + 1;
                i = ++mark;
            } else {
                return false;
            }
        }
        while (p < pattern.length() && pattern.charAt(p) == '*') {
            p++;
        }
        return p == pattern.length();
    }

    static boolean sensitiveName(String name) {
        String n = name.toLowerCase(java.util.Locale.ENGLISH);
        for (int i = 0; i < SENSITIVE.length; i++) {
            if (n.indexOf(SENSITIVE[i]) >= 0) {
                return true;
            }
        }
        return false;
    }

    /** Masks RRN / card number / email patterns inside a value. */
    static String maskValue(String v) {
        String r = RRN.matcher(v).replaceAll(MASK);
        r = CARD_DASHED.matcher(r).replaceAll(MASK);
        r = CARD.matcher(r).replaceAll(MASK);
        return EMAIL.matcher(r).replaceAll(MASK);
    }

    /**
     * Builds the masked parameter record from the raw query string and the {@code getParameterMap()} result
     * (a Map of name -> String[] or String). Returns null when there is nothing to report.
     */
    public static TxParams build(String queryString, Object parameterMap) {
        TxParams out = new TxParams();
        int[] used = new int[] {0}; // bytes spent in p
        out.query = maskQuery(queryString, out);
        if (parameterMap instanceof Map) {
            for (Map.Entry<?, ?> e : ((Map<?, ?>) parameterMap).entrySet()) {
                if (!(e.getKey() instanceof String)) {
                    continue;
                }
                String name = (String) e.getKey();
                Object v = e.getValue();
                if (v instanceof Object[]) {
                    Object[] arr = (Object[]) v;
                    for (int i = 0; i < arr.length; i++) {
                        if (!add(out, used, name, arr[i])) {
                            return finish(out);
                        }
                    }
                } else if (!add(out, used, name, v)) {
                    return finish(out);
                }
            }
        }
        return finish(out);
    }

    private static TxParams finish(TxParams t) {
        return t.query.length() == 0 && t.params.isEmpty() ? null : t;
    }

    /** false = limit reached, stop. */
    private static boolean add(TxParams out, int[] used, String name, Object value) {
        if (out.params.size() >= MAX_PARAMS) {
            out.truncated = true;
            return false;
        }
        String n = name;
        if (n.length() > MAX_NAME) {
            n = n.substring(0, MAX_NAME);
            out.truncated = true;
        }
        String v = value == null ? "" : String.valueOf(value);
        v = sensitiveName(name) ? MASK : maskValue(v);
        if (v.length() > MAX_VALUE) {
            v = v.substring(0, MAX_VALUE);
            out.truncated = true;
        }
        int cost = 12 + utf8(n) + utf8(v);
        if (utf8(out.query) + used[0] + cost > MAX_TOTAL_BYTES) {
            out.truncated = true;
            return false;
        }
        used[0] += cost;
        out.params.add(new String[] {n, v});
        return true;
    }

    private static String maskQuery(String q, TxParams out) {
        if (q == null || q.length() == 0) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        int pos = 0;
        while (pos <= q.length() && sb.length() < MAX_QUERY) {
            int amp = q.indexOf('&', pos);
            String part = q.substring(pos, amp < 0 ? q.length() : amp);
            pos = amp < 0 ? q.length() + 1 : amp + 1;
            if (part.length() == 0) {
                continue;
            }
            int eq = part.indexOf('=');
            String rawName = eq < 0 ? part : part.substring(0, eq);
            String name = decode(rawName);
            String val = eq < 0 ? null : decode(part.substring(eq + 1));
            if (sb.length() > 0) {
                sb.append('&');
            }
            sb.append(name);
            if (val != null) {
                sb.append('=').append(sensitiveName(name) ? MASK : maskValue(val));
            }
        }
        if (pos <= q.length() || sb.length() > MAX_QUERY) {
            out.truncated = true;
        }
        return sb.length() > MAX_QUERY ? sb.substring(0, MAX_QUERY) : sb.toString();
    }

    private static String decode(String s) {
        try {
            return URLDecoder.decode(s, "UTF-8");
        } catch (Throwable t) {
            return s;
        }
    }

    private static int utf8(String s) {
        int b = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            b += c < 0x80 ? 1 : (c < 0x800 ? 2 : 3);
        }
        return b;
    }
}
