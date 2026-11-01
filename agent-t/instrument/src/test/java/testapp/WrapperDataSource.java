package testapp;

import java.sql.Connection;
import javax.sql.DataSource;

/** Pool-like wrapper: asks a delegate DataSource, but hands out its own connection object. */
public abstract class WrapperDataSource implements DataSource {
    public Connection getConnection() {
        try {
            ((DataSource) Make.of(StubDataSource.class)).getConnection();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return (Connection) Make.of(StubConnection.class);
    }

    public Connection getConnection(String user, String password) {
        return getConnection();
    }
}
