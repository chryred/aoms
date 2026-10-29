package com.synapsev.agentt.norm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.id.Fnv64;
import org.junit.Test;

public class SqlNormalizerTest {
    @Test
    public void literalsBecomePlaceholders() {
        assertEquals("select * from t where id = ? and nm=?",
                SqlNormalizer.normalize("select * from t where id = 10 and nm='홍길동'"));
    }

    @Test
    public void identifiersWithDigitsAreKept() {
        assertEquals("select c1 from t2 where x = ?", SqlNormalizer.normalize("select c1 from t2 where x = 3.14"));
    }

    @Test
    public void escapedQuoteStaysInsideLiteral() {
        assertEquals("where a = ? and b = ?", SqlNormalizer.normalize("where a = 'it''s' and b = 2"));
    }

    @Test
    public void inListCollapses() {
        assertEquals("in (?)", SqlNormalizer.normalize("in (1,2,3)"));
        assertEquals("where id IN (?)", SqlNormalizer.normalize("where id IN ( 1 , 'a', 3 )"));
    }

    @Test
    public void whitespaceOnlyDifferenceGivesSameId() {
        String a = SqlNormalizer.normalize("select  *\n from\tt  where id = 1");
        String b = SqlNormalizer.normalize(" select * from t where id =   99 ");
        assertEquals(Fnv64.hex(a), Fnv64.hex(b));
    }

    @Test
    public void hugeKoreanSqlIsCappedWithoutBrokenSurrogate() {
        StringBuilder sb = new StringBuilder("select '");
        while (sb.length() < 65536) {
            sb.append("한글");
        }
        String big = sb.toString() + "' from dual";
        String out = SqlNormalizer.normalize(big);
        assertTrue(out.length() <= 8192);

        // surrogate pairs right at the boundary
        StringBuilder emoji = new StringBuilder("select ");
        while (emoji.length() < 65536) {
            emoji.append("x😀 ");
        }
        for (int pad = 0; pad < 3; pad++) {
            String o = SqlNormalizer.normalize(repeat("a", pad) + emoji);
            assertTrue(o.length() <= 8192);
            assertFalse(Character.isHighSurrogate(o.charAt(o.length() - 1)));
        }
    }

    @Test
    public void nullIsEmpty() {
        assertEquals("", SqlNormalizer.normalize(null));
    }

    private static String repeat(String s, int n) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < n; i++) {
            b.append(s);
        }
        return b.toString();
    }
}
