package com.synapsev.agentt.id;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class Fnv64Test {
    @Test
    public void knownVectors() {
        assertEquals("cbf29ce484222325", Fnv64.hex(""));
        assertEquals("af63dc4c8601ec8c", Fnv64.hex("a"));
    }

    @Test
    public void alwaysSixteenLowercaseHexChars() {
        String h = Fnv64.hex("한글 select");
        assertEquals(16, h.length());
        assertEquals(h.toLowerCase(), h);
    }
}
