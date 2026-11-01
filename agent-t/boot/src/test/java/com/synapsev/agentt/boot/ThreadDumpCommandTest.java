package com.synapsev.agentt.boot;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.synapsev.agentt.jvm.ThreadDumper;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;

public class ThreadDumpCommandTest {
    private static final class Sink implements AgentRuntime.DumpSink {
        final List<Long> ids = new ArrayList<Long>();
        final List<String> texts = new ArrayList<String>();

        public void offerDump(long cmdId, String text, boolean truncated) {
            ids.add(cmdId);
            texts.add(text);
        }
    }

    @Test
    public void rateLimitedRequestStillGetsReply() {
        Sink sink = new Sink();
        ThreadDumper d = new ThreadDumper();
        AgentRuntime.handleCommand(7, "thread_dump", d, sink);
        AgentRuntime.handleCommand(8, "thread_dump", d, sink);
        assertEquals(2, sink.ids.size());
        assertEquals(Long.valueOf(7), sink.ids.get(0));
        assertEquals(Long.valueOf(8), sink.ids.get(1));
        assertTrue(sink.texts.get(0).contains(Thread.currentThread().getName()));
        assertEquals(AgentRuntime.RATE_LIMITED_TEXT, sink.texts.get(1));
    }

    @Test
    public void otherCommandsIgnored() {
        Sink sink = new Sink();
        AgentRuntime.handleCommand(1, "something_else", new ThreadDumper(), sink);
        assertFalse(sink.ids.size() > 0);
    }
}
