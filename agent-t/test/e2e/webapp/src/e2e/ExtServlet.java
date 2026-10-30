package e2e;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/** /ext : 다른 대상(EXT_URL, 기본 tomcat9 의 /db)을 HttpURLConnection 으로 호출. */
@WebServlet("/ext")
public class ExtServlet extends HttpServlet {
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        String target = System.getenv("EXT_URL");
        if (target == null || target.length() == 0) {
            target = "http://tomcat9:8080/db";
        }
        HttpURLConnection c = (HttpURLConnection) new URL(target).openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(10000);
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        byte[] buf = new byte[1024];
        int n = 0;
        int total = 0;
        if (in != null) {
            while ((n = in.read(buf)) > 0) {
                total += n;
            }
            in.close();
        }
        resp.setContentType("text/plain");
        resp.getWriter().write("ext status=" + code + " bytes=" + total);
    }
}
