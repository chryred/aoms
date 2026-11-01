package testapp;

import javax.servlet.http.HttpServletRequest;

public class FakeRequest implements HttpServletRequest {
    private final String uri;
    private final String traceparent;

    public FakeRequest(String uri, String traceparent) {
        this.uri = uri;
        this.traceparent = traceparent;
    }

    public String getRemoteAddr() {
        return "10.1.2.3";
    }

    public String getMethod() {
        return "GET";
    }

    public String getRequestURI() {
        return uri;
    }

    public String getHeader(String name) {
        return "traceparent".equals(name) ? traceparent : null;
    }
}
