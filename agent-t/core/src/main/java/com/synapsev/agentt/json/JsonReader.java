package com.synapsev.agentt.json;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal recursive-descent JSON parser. Produces Map (LinkedHashMap), List (ArrayList), String,
 * Long (integral numbers that fit), Double, Boolean or null. Throws IllegalArgumentException on bad input.
 */
public final class JsonReader {
    private static final int MAX_DEPTH = 64;

    private final String s;
    private int pos;

    private JsonReader(String s) {
        this.s = s;
    }

    public static Object parse(String json) {
        if (json == null) {
            throw new IllegalArgumentException("null json");
        }
        JsonReader r = new JsonReader(json);
        r.ws();
        Object v = r.value(0);
        r.ws();
        if (r.pos != json.length()) {
            throw r.err("trailing characters");
        }
        return v;
    }

    private IllegalArgumentException err(String m) {
        return new IllegalArgumentException("json: " + m + " at " + pos);
    }

    private void ws() {
        while (pos < s.length()) {
            char c = s.charAt(pos);
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                pos++;
            } else {
                break;
            }
        }
    }

    private Object value(int depth) {
        if (depth > MAX_DEPTH) {
            throw err("too deep");
        }
        if (pos >= s.length()) {
            throw err("unexpected end");
        }
        char c = s.charAt(pos);
        switch (c) {
            case '{':
                return object(depth);
            case '[':
                return array(depth);
            case '"':
                return string();
            case 't':
                literal("true");
                return Boolean.TRUE;
            case 'f':
                literal("false");
                return Boolean.FALSE;
            case 'n':
                literal("null");
                return null;
            default:
                return number();
        }
    }

    private void literal(String w) {
        if (!s.startsWith(w, pos)) {
            throw err("bad literal");
        }
        pos += w.length();
    }

    private Map<String, Object> object(int depth) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        pos++;
        ws();
        if (pos < s.length() && s.charAt(pos) == '}') {
            pos++;
            return m;
        }
        while (true) {
            ws();
            if (pos >= s.length() || s.charAt(pos) != '"') {
                throw err("expected key");
            }
            String k = string();
            ws();
            if (pos >= s.length() || s.charAt(pos) != ':') {
                throw err("expected ':'");
            }
            pos++;
            ws();
            m.put(k, value(depth + 1));
            ws();
            if (pos >= s.length()) {
                throw err("unexpected end");
            }
            char c = s.charAt(pos++);
            if (c == '}') {
                return m;
            }
            if (c != ',') {
                throw err("expected ',' or '}'");
            }
        }
    }

    private List<Object> array(int depth) {
        List<Object> l = new ArrayList<Object>();
        pos++;
        ws();
        if (pos < s.length() && s.charAt(pos) == ']') {
            pos++;
            return l;
        }
        while (true) {
            ws();
            l.add(value(depth + 1));
            ws();
            if (pos >= s.length()) {
                throw err("unexpected end");
            }
            char c = s.charAt(pos++);
            if (c == ']') {
                return l;
            }
            if (c != ',') {
                throw err("expected ',' or ']'");
            }
        }
    }

    private String string() {
        pos++;
        StringBuilder sb = new StringBuilder();
        while (true) {
            if (pos >= s.length()) {
                throw err("unterminated string");
            }
            char c = s.charAt(pos++);
            if (c == '"') {
                return sb.toString();
            }
            if (c != '\\') {
                sb.append(c);
                continue;
            }
            if (pos >= s.length()) {
                throw err("bad escape");
            }
            char e = s.charAt(pos++);
            switch (e) {
                case '"':
                case '\\':
                case '/':
                    sb.append(e);
                    break;
                case 'b':
                    sb.append('\b');
                    break;
                case 'f':
                    sb.append('\f');
                    break;
                case 'n':
                    sb.append('\n');
                    break;
                case 'r':
                    sb.append('\r');
                    break;
                case 't':
                    sb.append('\t');
                    break;
                case 'u':
                    if (pos + 4 > s.length()) {
                        throw err("bad unicode escape");
                    }
                    try {
                        sb.append((char) Integer.parseInt(s.substring(pos, pos + 4), 16));
                    } catch (NumberFormatException ex) {
                        throw err("bad unicode escape");
                    }
                    pos += 4;
                    break;
                default:
                    throw err("bad escape");
            }
        }
    }

    private Object number() {
        int start = pos;
        boolean integral = true;
        while (pos < s.length()) {
            char c = s.charAt(pos);
            if ((c >= '0' && c <= '9') || c == '-' || c == '+') {
                pos++;
            } else if (c == '.' || c == 'e' || c == 'E') {
                integral = false;
                pos++;
            } else {
                break;
            }
        }
        if (start == pos) {
            throw err("unexpected character");
        }
        String t = s.substring(start, pos);
        try {
            if (integral) {
                try {
                    return Long.valueOf(Long.parseLong(t));
                } catch (NumberFormatException ex) {
                    return Double.valueOf(Double.parseDouble(t));
                }
            }
            return Double.valueOf(Double.parseDouble(t));
        } catch (NumberFormatException ex) {
            throw err("bad number");
        }
    }
}
