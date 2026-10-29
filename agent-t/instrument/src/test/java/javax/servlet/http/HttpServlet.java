package javax.servlet.http;

import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;

/** Minimal stand-in for the servlet API class; the agent matches it by name. */
public abstract class HttpServlet {
    public void service(ServletRequest req, ServletResponse resp) {
        service((HttpServletRequest) req, (HttpServletResponse) resp);
    }

    protected void service(HttpServletRequest req, HttpServletResponse resp) {
        if ("GET".equals(req.getMethod())) {
            doGet(req, resp);
        }
    }

    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
    }
}
