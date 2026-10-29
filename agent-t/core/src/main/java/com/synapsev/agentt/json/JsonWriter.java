package com.synapsev.agentt.json;

/** Minimal streaming JSON writer (Java 6, no dependencies). Not thread-safe. */
public final class JsonWriter {
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private final StringBuilder sb;
    private boolean[] needComma = new boolean[32];
    private int depth;
    private boolean afterKey;

    public JsonWriter(int capacity) {
        sb = new StringBuilder(capacity);
    }

    private void beforeValue() {
        if (afterKey) {
            afterKey = false;
            return;
        }
        if (depth > 0) {
            if (needComma[depth - 1]) {
                sb.append(',');
            }
            needComma[depth - 1] = true;
        }
    }

    private void push(char open) {
        beforeValue();
        sb.append(open);
        if (depth == needComma.length) {
            boolean[] n = new boolean[depth * 2];
            System.arraycopy(needComma, 0, n, 0, depth);
            needComma = n;
        }
        needComma[depth++] = false;
    }

    private void pop(char close) {
        depth--;
        sb.append(close);
    }

    public JsonWriter beginObject() {
        push('{');
        return this;
    }

    public JsonWriter endObject() {
        pop('}');
        return this;
    }

    public JsonWriter beginArray() {
        push('[');
        return this;
    }

    public JsonWriter endArray() {
        pop(']');
        return this;
    }

    public JsonWriter key(String k) {
        beforeValue();
        string(k);
        sb.append(':');
        afterKey = true;
        return this;
    }

    public JsonWriter value(String s) {
        if (s == null) {
            return nullValue();
        }
        beforeValue();
        string(s);
        return this;
    }

    public JsonWriter value(long v) {
        beforeValue();
        sb.append(v);
        return this;
    }

    public JsonWriter value(double v) {
        beforeValue();
        if (Double.isNaN(v) || Double.isInfinite(v)) {
            sb.append('0');
        } else {
            sb.append(v);
        }
        return this;
    }

    public JsonWriter value(boolean v) {
        beforeValue();
        sb.append(v ? "true" : "false");
        return this;
    }

    public JsonWriter nullValue() {
        beforeValue();
        sb.append("null");
        return this;
    }

    private void string(String s) {
        sb.append('"');
        int n = s.length();
        for (int i = 0; i < n; i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                default:
                    if (c < 0x20 || c == ' ' || c == ' ' || isLoneSurrogate(s, i)) {
                        sb.append("\\u").append(HEX[(c >> 12) & 0xf]).append(HEX[(c >> 8) & 0xf])
                                .append(HEX[(c >> 4) & 0xf]).append(HEX[c & 0xf]);
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append('"');
    }

    private static boolean isLoneSurrogate(String s, int i) {
        char c = s.charAt(i);
        if (Character.isHighSurrogate(c)) {
            return i + 1 >= s.length() || !Character.isLowSurrogate(s.charAt(i + 1));
        }
        if (Character.isLowSurrogate(c)) {
            return i == 0 || !Character.isHighSurrogate(s.charAt(i - 1));
        }
        return false;
    }

    @Override
    public String toString() {
        return sb.toString();
    }
}
