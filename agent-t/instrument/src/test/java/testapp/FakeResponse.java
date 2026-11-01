package testapp;

import javax.servlet.http.HttpServletResponse;

public class FakeResponse implements HttpServletResponse {
    public int status = 200;

    public int getStatus() {
        return status;
    }
}
