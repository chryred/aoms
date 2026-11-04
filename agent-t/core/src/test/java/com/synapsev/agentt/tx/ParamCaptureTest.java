package com.synapsev.agentt.tx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.model.TxParams;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.Test;

public class ParamCaptureTest {
    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put((String) kv[i], kv[i + 1]);
        }
        return m;
    }

    private static String value(TxParams t, String name) {
        for (String[] p : t.params) {
            if (p[0].equals(name)) {
                return p[1];
            }
        }
        return null;
    }

    @Test
    public void sensitiveNamesAreMaskedCaseInsensitively() {
        String[] names = {"password", "PASSWD", "userPwd", "pass", "accessToken", "client_secret", "Authorization",
            "cardNo", "cvc", "ssn", "jumin", "residentNo", "rrn", "accountNo", "acct", "phone", "Mobile", "telNo",
            "EMAIL", "birthDay", "address"};
        for (String n : names) {
            Map<String, Object> m = map(n, new String[] {"plain"});
            assertEquals(n, "****", value(ParamCapture.build("", m), n));
        }
        assertEquals("seoul", value(ParamCapture.build("", map("city", new String[] {"seoul"})), "city"));
    }

    @Test
    public void sensitiveValuesAreMaskedByPattern() {
        TxParams t = ParamCapture.build("", map(
                "a", new String[] {"900101-1234567"},
                "b", new String[] {"9001011234567"},
                "c", new String[] {"4111111111111111"},
                "d", new String[] {"4111-1111-1111-1111"},
                "e", new String[] {"mail me at foo.bar@example.com ok"},
                "f", new String[] {"12345"}));
        assertEquals("****", value(t, "a"));
        assertEquals("****", value(t, "b"));
        assertEquals("****", value(t, "c"));
        assertEquals("****", value(t, "d"));
        assertEquals("mail me at **** ok", value(t, "e"));
        assertEquals("12345", value(t, "f"));
    }

    @Test
    public void queryStringIsMaskedAndDecoded() {
        TxParams t = ParamCapture.build("page=2&password=abc&q=%ED%95%9C%EA%B8%80&mail=a%40b.com&flag", null);
        assertEquals("page=2&password=****&q=한글&mail=****&flag", t.query);
        assertFalse(t.truncated);
        assertTrue(t.params.isEmpty());
    }

    @Test
    public void valueTruncatedTo256AndFlagged() {
        char[] c = new char[500];
        Arrays.fill(c, 'x');
        TxParams t = ParamCapture.build("", map("k", new String[] {new String(c)}));
        assertEquals(256, value(t, "k").length());
        assertTrue(t.truncated);
    }

    @Test
    public void maxFiftyParams() {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        for (int i = 0; i < 80; i++) {
            m.put("p" + i, new String[] {"v"});
        }
        TxParams t = ParamCapture.build("", m);
        assertEquals(50, t.params.size());
        assertTrue(t.truncated);
    }

    @Test
    public void totalSizeBoundedBy4KB() {
        char[] c = new char[250];
        Arrays.fill(c, 'y');
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        for (int i = 0; i < 40; i++) {
            m.put("n" + i, new String[] {new String(c)});
        }
        TxParams t = ParamCapture.build("", m);
        assertTrue(t.estimateBytes() < 4096 + 200);
        assertTrue(t.params.size() < 40);
        assertTrue(t.truncated);
    }

    @Test
    public void multiValuesAndNullValuesAndGarbageMap() {
        TxParams t = ParamCapture.build("", map("tag", new String[] {"a", "b"}, "n", null, "s", "plain"));
        assertEquals(4, t.params.size());
        assertEquals("a", t.params.get(0)[1]);
        assertEquals("b", t.params.get(1)[1]);
        assertEquals("", t.params.get(2)[1]);
        assertEquals("plain", t.params.get(3)[1]);
        assertNull(ParamCapture.build("", "not a map"));
        assertNull(ParamCapture.build(null, null));
    }

    @Test
    public void disabledByDefaultAndUriFilters() {
        AgentConfig cfg = new AgentConfig();
        assertFalse(ParamCapture.allowed(cfg, "/a"));
        cfg.captureParams = true;
        assertTrue(ParamCapture.allowed(cfg, "/a"));
        cfg.captureUriInclude = Arrays.asList("/api/*", "/order/??");
        cfg.captureUriExclude = Arrays.asList("/api/login*", "*/health");
        assertTrue(ParamCapture.allowed(cfg, "/api/orders/1"));
        assertTrue(ParamCapture.allowed(cfg, "/order/12"));
        assertFalse(ParamCapture.allowed(cfg, "/order/123"));
        assertFalse(ParamCapture.allowed(cfg, "/other"));
        assertFalse(ParamCapture.allowed(cfg, "/api/login"));
        assertFalse(ParamCapture.allowed(cfg, "/api/loginForm"));
        assertFalse(ParamCapture.allowed(cfg, "/api/x/health"));
        assertNotNull(cfg);
    }
}
