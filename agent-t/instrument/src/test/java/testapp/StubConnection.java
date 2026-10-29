package testapp;

import java.sql.Connection;
import java.sql.PreparedStatement;

public abstract class StubConnection implements Connection {
    private boolean autoCommit = true;
    public int commits;

    public PreparedStatement prepareStatement(String sql) {
        StubPreparedStatement s = (StubPreparedStatement) Make.of(StubPreparedStatement.class);
        s.sql = sql;
        return s;
    }

    public void setAutoCommit(boolean on) {
        autoCommit = on;
    }

    public boolean getAutoCommit() {
        return autoCommit;
    }

    public void commit() {
        commits++;
    }

    public void rollback() {
    }

    public void close() {
    }
}
