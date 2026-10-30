package testapp;

/** Mimics Tomcat-JDBC PooledConnection: no JDBC supertypes, accessor returning a stored physical connection. */
public class ConnectionProvider {
    private PgConn physical;

    public PgConn getConnection() {
        if (physical == null) {
            physical = (PgConn) Make.of(PgConn.class);
        }
        return physical;
    }
}
