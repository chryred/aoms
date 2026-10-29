package testapp;

import javax.servlet.FilterChain;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/** Drives Filter -> Servlet through the instrumented stub classes. */
public class ServletScenario implements Runnable {
    public String uri = "/order/123";
    public String traceparent;
    public boolean withFilter = true;
    public boolean merge;

    public void run() {
        final OrderServlet servlet = new OrderServlet();
        final FakeRequest req = new FakeRequest(uri, traceparent);
        final FakeResponse resp = new FakeResponse();
        if (!withFilter) {
            servlet.service((HttpServletRequest) req, (HttpServletResponse) resp);
            return;
        }
        FilterChain chain = new FilterChain() {
            public void doFilter(ServletRequest r, ServletResponse s) {
                servlet.service((HttpServletRequest) r, (HttpServletResponse) s);
            }
        };
        if (merge) {
            new MergeFilter().doFilter(req, resp, chain);
        } else {
            new OrderFilter().doFilter(req, resp, chain);
        }
    }
}
