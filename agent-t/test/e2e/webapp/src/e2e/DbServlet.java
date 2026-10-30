package e2e;

import java.io.IOException;
import java.sql.Connection;
import org.postgresql.ds.PGSimpleDataSource;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import javax.servlet.ServletException;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

/** /db : PostgreSQL 쿼리 3회 (DataSource 연결 1회, 정상 close). DB_URL/DB_USER/DB_PASSWORD 환경변수. */
@WebServlet("/db")
public class DbServlet extends HttpServlet {
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws ServletException, IOException {
        String url = env("DB_URL", "jdbc:postgresql://postgres:5432/synapse");
        String user = env("DB_USER", "synapse");
        String pw = env("DB_PASSWORD", "synapse");
        int total = 0;
        Connection c = null;
        try {
            // DataSource.getConnection 경로 — 에이전트의 커넥션 open/close 추적(P1) 대상
            PGSimpleDataSource ds = new PGSimpleDataSource();
            ds.setUrl(url);
            ds.setUser(user);
            ds.setPassword(pw);
            c = ds.getConnection();
            String[] sqls = {
                "select count(*) from systems where id > ?",
                "select pg_sleep(0.01), ? + 1",
                "select ? as v, now()"
            };
            for (int i = 0; i < sqls.length; i++) {
                PreparedStatement ps = c.prepareStatement(sqls[i]);
                try {
                    ps.setInt(1, i);
                    ResultSet rs = ps.executeQuery();
                    while (rs.next()) {
                        total++;
                    }
                    rs.close();
                } finally {
                    ps.close();
                }
            }
        } catch (Exception e) {
            throw new ServletException(e);
        } finally {
            if (c != null) {
                try {
                    c.close();
                } catch (Exception ignore) {
                    // ignore
                }
            }
        }
        resp.setContentType("text/plain");
        resp.getWriter().write("db rows=" + total);
    }

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.length() == 0 ? d : v;
    }
}
