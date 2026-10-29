package testapp;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public abstract class StubPreparedStatement implements PreparedStatement {
    public String sql = "";

    public boolean execute() {
        return true;
    }

    public ResultSet executeQuery() {
        return (ResultSet) Make.of(StubResultSet.class);
    }

    public int executeUpdate() throws SQLException {
        if (sql.indexOf("fail") >= 0) {
            throw new SQLException("forced failure");
        }
        return 1;
    }
}
