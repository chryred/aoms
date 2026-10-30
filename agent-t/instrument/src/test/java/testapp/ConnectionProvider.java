package testapp;

/** Unrelated type (no JDBC supertypes) with a covariant connection factory. */
public class ConnectionProvider {
    public PgConn getConnection() {
        return (PgConn) Make.of(PgConn.class);
    }
}
