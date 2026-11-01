package testapp;

import java.sql.ResultSet;

public abstract class StubResultSet implements ResultSet {
    private int served;

    public boolean next() {
        served++;
        return served <= 1000;
    }
}
