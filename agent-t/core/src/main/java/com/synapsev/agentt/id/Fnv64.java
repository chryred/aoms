package com.synapsev.agentt.id;

import java.io.UnsupportedEncodingException;

/** FNV-1a 64bit over UTF-8 bytes, rendered as 16 lowercase hex chars (protocol section 2). */
public final class Fnv64 {
    private static final long OFFSET = 0xcbf29ce484222325L;
    private static final long PRIME = 0x100000001b3L;
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private Fnv64() { }

    public static String hex(String s) {
        byte[] b;
        try {
            b = (s == null ? "" : s).getBytes("UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
        long h = OFFSET;
        for (int i = 0; i < b.length; i++) {
            h ^= (b[i] & 0xffL);
            h *= PRIME;
        }
        char[] out = new char[16];
        for (int i = 15; i >= 0; i--) {
            out[i] = HEX[(int) (h & 0xf)];
            h >>>= 4;
        }
        return new String(out);
    }
}
