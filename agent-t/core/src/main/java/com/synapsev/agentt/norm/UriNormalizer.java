package com.synapsev.agentt.norm;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Normalizes request URIs: query string / fragment / ";param" removed, all-digit segments become {n},
 * UUID segments become {uuid}, then server-supplied regex rules apply; capped at 1,024 chars.
 */
public final class UriNormalizer {
    public static final int MAX_LEN = 1024;
    private static final Pattern UUID = Pattern.compile(
            "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final Map<String, Pattern> RULE_CACHE = new ConcurrentHashMap<String, Pattern>();

    private UriNormalizer() { }

    public static String normalize(String uri, List<String[]> extraRules) {
        if (uri == null) {
            return "";
        }
        int cut = uri.length();
        int q = uri.indexOf('?');
        if (q >= 0) {
            cut = q;
        }
        int h = uri.indexOf('#');
        if (h >= 0 && h < cut) {
            cut = h;
        }
        String path = uri.substring(0, cut);

        StringBuilder sb = new StringBuilder(path.length());
        int start = 0;
        int n = path.length();
        while (start <= n) {
            int slash = path.indexOf('/', start);
            int end = slash < 0 ? n : slash;
            String seg = path.substring(start, end);
            int semi = seg.indexOf(';');
            if (semi >= 0) {
                seg = seg.substring(0, semi);
            }
            if (isAllDigits(seg)) {
                seg = "{n}";
            } else if (seg.length() == 36 && UUID.matcher(seg).matches()) {
                seg = "{uuid}";
            }
            sb.append(seg);
            if (slash < 0) {
                break;
            }
            sb.append('/');
            start = slash + 1;
        }
        String out = sb.toString();
        if (extraRules != null) {
            for (int i = 0; i < extraRules.size(); i++) {
                out = applyRule(out, extraRules.get(i));
            }
        }
        return SqlNormalizer.truncate(out, MAX_LEN);
    }

    private static boolean isAllDigits(String s) {
        if (s.length() == 0) {
            return false;
        }
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c < '0' || c > '9') {
                return false;
            }
        }
        return true;
    }

    private static String applyRule(String in, String[] rule) {
        if (rule == null || rule.length < 2 || rule[0] == null || rule[1] == null) {
            return in;
        }
        try {
            Pattern p = RULE_CACHE.get(rule[0]);
            if (p == null) {
                if (RULE_CACHE.size() > 256) {
                    RULE_CACHE.clear();
                }
                p = Pattern.compile(rule[0]);
                RULE_CACHE.put(rule[0], p);
            }
            return p.matcher(in).replaceAll(rule[1]);
        } catch (RuntimeException e) {
            return in; // invalid regex or replacement: ignore the rule
        }
    }
}
