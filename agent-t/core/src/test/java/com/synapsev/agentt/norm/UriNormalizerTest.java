package com.synapsev.agentt.norm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class UriNormalizerTest {
    private static final List<String[]> NONE = new ArrayList<String[]>();

    @Test
    public void numericSegmentAndQueryString() {
        assertEquals("/order/{n}/item", UriNormalizer.normalize("/order/12345/item?x=1", NONE));
    }

    @Test
    public void uuidSegment() {
        assertEquals("/u/{uuid}", UriNormalizer.normalize("/u/550e8400-e29b-41d4-a716-446655440000", NONE));
    }

    @Test
    public void koreanPathIsKept() {
        assertEquals("/상품/조회", UriNormalizer.normalize("/상품/조회", NONE));
    }

    @Test
    public void extraRulesApplyInOrder() {
        List<String[]> rules = new ArrayList<String[]>();
        rules.add(new String[] {"/tenant/[a-z]+/", "/tenant/{t}/"});
        assertEquals("/tenant/{t}/list", UriNormalizer.normalize("/tenant/abc/list", rules));
    }

    @Test
    public void invalidRuleIsIgnored() {
        List<String[]> rules = new ArrayList<String[]>();
        rules.add(new String[] {"([", "x"});
        assertEquals("/a/b", UriNormalizer.normalize("/a/b", rules));
    }

    @Test
    public void cappedAt1024() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 2000; i++) {
            sb.append("/😀x");
        }
        String out = UriNormalizer.normalize(sb.toString(), NONE);
        assertTrue(out.length() <= 1024);
        assertTrue(!Character.isHighSurrogate(out.charAt(out.length() - 1)));
    }
}
