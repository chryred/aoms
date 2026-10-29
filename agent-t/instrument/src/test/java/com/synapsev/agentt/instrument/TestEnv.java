package com.synapsev.agentt.instrument;

import com.synapsev.agentt.bridge.Hooks;
import com.synapsev.agentt.conf.AgentConfig;
import com.synapsev.agentt.model.TxRecord;
import com.synapsev.agentt.tx.CollectingOut;
import com.synapsev.agentt.tx.TxTracker;
import java.util.List;

/** Wires tracker + transformer + stub class loader and installs the tracker as the global hook sink. */
final class TestEnv {
    final AgentConfig config = new AgentConfig();
    final CollectingOut out = new CollectingOut();
    final TxTracker tracker = new TxTracker(out, config);
    final AgentTransformer transformer = new AgentTransformer();
    final StubLoader loader = new StubLoader(transformer);

    TestEnv() {
        config.normalDetailRate = 0.0;
        Hooks.setSink(tracker);
    }

    void close() {
        Hooks.setSink(null);
    }

    List<TxRecord> records() {
        return out.records;
    }

    /** Public so the tracker's reflection can call it; stands in for an HttpServletRequest. */
    public static final class Req {
        private final String uri;

        public Req(String uri) {
            this.uri = uri;
        }

        public String getRequestURI() {
            return uri;
        }

        public String getMethod() {
            return "POST";
        }
    }

    Object begin(String uri) {
        return Hooks.servletEnter(new Req(uri), new Object());
    }

    void end(Object token) {
        Hooks.servletExit(token, new Object(), null);
    }
}
