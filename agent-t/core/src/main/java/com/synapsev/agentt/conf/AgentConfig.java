package com.synapsev.agentt.conf;

import com.synapsev.agentt.json.JsonReader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Runtime configuration pushed by the gateway. Fields are volatile; omitted JSON fields keep their value. */
public final class AgentConfig {
    public volatile int version = 0;
    public volatile boolean enabled = true;
    public volatile long slowMs = 3000;
    public volatile double normalDetailRate = 0.01;
    public volatile long stackIntervalMs = 1000;
    /** URI prefixes/patterns to exclude from tracing. */
    public volatile List<String> exclude = Collections.emptyList();
    /** Class-name prefixes or '*' globs (dots or slashes) that are never instrumented. */
    public volatile List<String> excludeClasses = Collections.emptyList();
    /** Extra URI normalization rules: {regex, replacement}. */
    public volatile List<String[]> uriRules = Collections.emptyList();
    public volatile String logLevel = "info";
    /** Opt-in request-parameter capture (agent-t.properties only, never pushed by the gateway). */
    public volatile boolean captureParams = false;
    /** DB 커넥션 풀 지표 수집(agent-t.properties 의 pool.metrics, 기본 true; 게이트웨이가 바꾸지 못함). */
    public volatile boolean poolMetrics = true;
    /** Glob lists ('*', '?') over the request URI; empty include = all URIs; exclude wins. */
    public volatile List<String> captureUriInclude = Collections.emptyList();
    public volatile List<String> captureUriExclude = Collections.emptyList();

    /**
     * Applies a gateway response body (with a "config" member) or a bare config object.
     * Throws IllegalArgumentException when the JSON is malformed.
     */
    public void applyJson(String json) {
        Object root = JsonReader.parse(json);
        if (!(root instanceof Map)) {
            throw new IllegalArgumentException("config json is not an object");
        }
        Map<?, ?> m = (Map<?, ?>) root;
        if (m.get("config") instanceof Map) {
            m = (Map<?, ?>) m.get("config");
        }
        if (m.get("version") instanceof Number) {
            version = ((Number) m.get("version")).intValue();
        }
        if (m.get("enabled") instanceof Boolean) {
            enabled = ((Boolean) m.get("enabled")).booleanValue();
        }
        if (m.get("slow_ms") instanceof Number) {
            slowMs = ((Number) m.get("slow_ms")).longValue();
        }
        if (m.get("normal_detail_rate") instanceof Number) {
            normalDetailRate = ((Number) m.get("normal_detail_rate")).doubleValue();
        }
        if (m.get("stack_interval_ms") instanceof Number) {
            stackIntervalMs = ((Number) m.get("stack_interval_ms")).longValue();
        }
        if (m.get("exclude") instanceof List) {
            List<String> ex = new ArrayList<String>();
            for (Object o : (List<?>) m.get("exclude")) {
                if (o instanceof String) {
                    ex.add((String) o);
                }
            }
            exclude = ex;
        }
        if (m.get("exclude_classes") instanceof List) {
            List<String> ex = new ArrayList<String>();
            for (Object o : (List<?>) m.get("exclude_classes")) {
                if (o instanceof String && ((String) o).trim().length() > 0) {
                    ex.add(((String) o).trim());
                }
            }
            excludeClasses = ex;
        }
        if (m.get("uri_rules") instanceof List) {
            List<String[]> rules = new ArrayList<String[]>();
            for (Object o : (List<?>) m.get("uri_rules")) {
                String[] r = toRule(o);
                if (r != null) {
                    rules.add(r);
                }
            }
            uriRules = rules;
        }
        if (m.get("log_level") instanceof String) {
            logLevel = (String) m.get("log_level");
        }
    }

    /** Accepts ["regex","replacement"] or {"pattern"|"regex": ..., "replace"|"replacement": ...}. */
    private static String[] toRule(Object o) {
        if (o instanceof List && ((List<?>) o).size() >= 2) {
            List<?> l = (List<?>) o;
            if (l.get(0) instanceof String && l.get(1) instanceof String) {
                return new String[] {(String) l.get(0), (String) l.get(1)};
            }
        } else if (o instanceof Map) {
            Map<?, ?> r = (Map<?, ?>) o;
            Object p = r.get("pattern") != null ? r.get("pattern") : r.get("regex");
            Object rep = r.get("replace") != null ? r.get("replace") : r.get("replacement");
            if (p instanceof String && rep instanceof String) {
                return new String[] {(String) p, (String) rep};
            }
        }
        return null;
    }
}
