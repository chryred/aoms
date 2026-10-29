package com.synapsev.agentt.tx;

import java.lang.ref.ReferenceQueue;
import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;

/** Identity-keyed weak map (JDBC drivers may override equals/hashCode on statements). Thread-safe, bounded. */
final class WeakIdentityMap {
    private static final int MAX_ENTRIES = 200000;

    private static final class Key extends WeakReference<Object> {
        private final int hash;

        Key(Object o, ReferenceQueue<Object> q) {
            super(o, q);
            hash = System.identityHashCode(o);
        }

        @Override
        public int hashCode() {
            return hash;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) {
                return true;
            }
            if (!(o instanceof Key)) {
                return false;
            }
            Object a = get();
            return a != null && a == ((Key) o).get();
        }
    }

    private final Map<Key, String> map = new HashMap<Key, String>();
    private final ReferenceQueue<Object> queue = new ReferenceQueue<Object>();

    synchronized void put(Object k, String v) {
        expunge();
        if (map.size() >= MAX_ENTRIES) {
            map.clear();
        }
        map.put(new Key(k, queue), v);
    }

    synchronized String get(Object k) {
        return map.get(new Key(k, null));
    }

    private void expunge() {
        Object r;
        while ((r = queue.poll()) != null) {
            map.remove(r);
        }
    }
}
