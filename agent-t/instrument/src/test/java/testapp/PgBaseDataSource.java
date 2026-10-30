package testapp;

import javax.sql.CommonDataSource;

/** Shape of pgjdbc's BaseDataSource: declares getConnection() but does NOT implement javax.sql.DataSource. */
public abstract class PgBaseDataSource implements CommonDataSource {
    public PgConn getConnection() {
        return (PgConn) Make.of(PgConn.class);
    }
}
