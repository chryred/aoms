package testapp;

import java.sql.Connection;
import javax.sql.DataSource;

public abstract class StubDataSource implements DataSource {
    public Connection getConnection() {
        return (Connection) Make.of(StubConnection.class);
    }

    public Connection getConnection(String user, String password) {
        return getConnection();
    }
}
