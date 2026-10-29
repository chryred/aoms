package testapp;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public abstract class StubPreparedStatement implements PreparedStatement {
    public String sql = "";

    /** Ternary and loop on purpose: instrumenting this method needs recomputed stack map frames. */
    public boolean execute() {
        int n = sql.length() > 3 ? 3 : 1;
        boolean r = false;
        for (int i = 0; i < n; i++) {
            r = !r || i > 1;
        }
        return r;
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
