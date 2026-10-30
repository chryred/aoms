package testapp;

public abstract class PgConn implements BaseConn {
    private boolean autoCommit = true;

    public void setAutoCommit(boolean on) {
        autoCommit = on;
    }

    public boolean getAutoCommit() {
        return autoCommit;
    }

    public void commit() {
    }

    public void rollback() {
    }

    public void close() {
    }
}
