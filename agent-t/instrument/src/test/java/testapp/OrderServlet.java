package testapp;

import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class OrderServlet extends HttpServlet {
    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) {
        if (req.getRequestURI().indexOf("boom") >= 0) {
            throw new IllegalStateException("boom");
        }
    }
}
