package testapp;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Never touches the network; keeps its own "opened" flag so setRequestProperty stays legal. */
public class StubHttpURLConnection extends HttpURLConnection {
    public StubHttpURLConnection() throws Exception {
        super(new URL("http://example.com:8080/api/items?id=3"));
    }

    public void disconnect() {
    }

    public boolean usingProxy() {
        return false;
    }

    public void connect() {
    }

    public InputStream getInputStream() {
        connect();
        return new ByteArrayInputStream(new byte[0]);
    }

    public int getResponseCode() {
        getInputStream();
        return 200;
    }
}
