package testapp;

import java.sql.Connection;
import javax.sql.DataSource;

/** Shape of PGSimpleDataSource: only the subclass implements DataSource. */
public abstract class PgSimpleDataSource extends PgBaseDataSource implements DataSource {
    public Connection getConnection(String user, String password) {
        return getConnection();
    }
}
