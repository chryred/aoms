package e2e;

import java.io.IOException;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/** /slow : 3.5초 대기 (느린 기준 3000ms 초과). */
@WebServlet("/slow")
public class SlowServlet extends HttpServlet {
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        try {
            Thread.sleep(3500);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        resp.setContentType("text/plain");
        resp.getWriter().write("slow");
    }
}
