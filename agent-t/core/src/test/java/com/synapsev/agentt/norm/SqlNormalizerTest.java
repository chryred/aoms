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
    public void hugeKoreanSqlIsTruncatedToCap() {
        // Korean in identifiers (not inside a '...' literal), so nothing is replaced by '?' and truncation really happens
        StringBuilder sb = new StringBuilder("select ");
        while (sb.length() < 65536) {
            sb.append("\uCEEC\uB7FC\uBA85 ");
        }
        String out = SqlNormalizer.normalize(sb.toString() + "from dual");
        assertTrue("len=" + out.length(), out.length() <= 8192);
        assertTrue("truncation must have happened, len=" + out.length(), out.length() > 8000);
        assertFalse(Character.isHighSurrogate(out.charAt(out.length() - 1)));
    }

    @Test
    public void highSurrogateAtLastIndexIsNotLeftIsolated() {
        // 8191 'a' then an emoji: the high surrogate sits exactly at index 8191 (= max - 1)
        String in = repeat("a", 8191) + "\uD83D\uDE00" + "bbb";
        String out = SqlNormalizer.normalize(in);
        assertTrue(out.length() <= 8192);
        assertEquals(8191, out.length());
        assertEquals('a', out.charAt(out.length() - 1));
        // control: emoji one position earlier fits whole
        String ok = SqlNormalizer.normalize(repeat("a", 8190) + "\uD83D\uDE00" + "bbb");
        assertEquals(8192, ok.length());
        assertTrue(Character.isLowSurrogate(ok.charAt(8191)));
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
