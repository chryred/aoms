package com.synapsev.agentt.tx;

import com.synapsev.agentt.model.TxRecord;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Test double for {@link TxTracker.Out} that keeps everything it is given. */
public final class CollectingOut implements TxTracker.Out {
    public final List<TxRecord> records = Collections.synchronizedList(new ArrayList<TxRecord>());
    public final List<String> sqlDefs = Collections.synchronizedList(new ArrayList<String>());
    public final List<String> uriDefs = Collections.synchronizedList(new ArrayList<String>());

    public void offerTx(TxRecord tx) {
        records.add(tx);
    }

    public void defineSql(String id, String text) {
        sqlDefs.add(id + "=" + text);
    }

    public void defineUri(String id, String text) {
        uriDefs.add(id + "=" + text);
    }
}
