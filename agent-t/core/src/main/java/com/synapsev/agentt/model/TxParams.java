package com.synapsev.agentt.model;

import java.util.ArrayList;
import java.util.List;

/** Masked request parameters of a retained transaction (q = query string, p = [name, value] pairs, t = truncated). */
public final class TxParams {
    public String query = "";
    public List<String[]> params = new ArrayList<String[]>();
    public boolean truncated;

    /** Rough serialized size in bytes. */
    public long estimateBytes() {
        long b = 40 + query.length();
        for (int i = 0; i < params.size(); i++) {
            String[] p = params.get(i);
            b += 12 + p[0].length() + p[1].length();
        }
        return b;
    }
}
