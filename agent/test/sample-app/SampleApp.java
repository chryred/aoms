import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URL;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;

/**
 * OTel Java Agent end-to-end 검증용 샘플 앱 (JDK 8 stdlib + PostgreSQL JDBC)
 *
 * 엔드포인트:
 *   GET /ok           — 50ms 응답 (정상 sampling 검증)
 *   GET /slow         — 1.2s sleep (slow trace sampling 검증)
 *   GET /error        — 500 RuntimeException (error sampling 검증)
 *   GET /dependency   — 내부 /ok 재호출 (multi-span trace 검증)
 *   GET /db           — PostgreSQL SELECT 쿼리 (JDBC auto-instrument 검증, db.statement span attribute)
 *
 * 환경변수 (JDBC 접속):
 *   DB_URL      — jdbc:postgresql://host.docker.internal:5432/synapse
 *   DB_USER     — synapse
 *   DB_PASSWORD — synapse
 */
public class SampleApp {

    private static final String DB_URL = envOrDefault("DB_URL",
        "jdbc:postgresql://host.docker.internal:5432/synapse");
    private static final String DB_USER = envOrDefault("DB_USER", "synapse");
    private static final String DB_PASSWORD = envOrDefault("DB_PASSWORD", "synapse");

    private static String envOrDefault(String key, String fallback) {
        String v = System.getenv(key);
        return v != null && !v.isEmpty() ? v : fallback;
    }

    public static void main(String[] args) throws IOException {
        int port = 8081;
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);

        server.createContext("/ok", new OkHandler());
        server.createContext("/slow", new SlowHandler());
        server.createContext("/error", new ErrorHandler());
        server.createContext("/dependency", new DependencyHandler(port));
        server.createContext("/db", new DbHandler());

        server.setExecutor(null);
        server.start();
        System.out.println("[SampleApp] listening on :" + port);
    }

    private static void send(HttpExchange ex, int status, String body) throws IOException {
        byte[] bytes = body.getBytes("UTF-8");
        ex.sendResponseHeaders(status, bytes.length);
        OutputStream os = ex.getResponseBody();
        os.write(bytes);
        os.close();
    }

    static class OkHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            try { Thread.sleep(50); } catch (InterruptedException ignored) {}
            send(ex, 200, "{\"status\":\"ok\"}");
        }
    }

    static class SlowHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            try { Thread.sleep(1200); } catch (InterruptedException ignored) {}
            send(ex, 200, "{\"status\":\"slow\"}");
        }
    }

    static class ErrorHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            RuntimeException cause = new RuntimeException("simulated error for OTel sampling test");
            // 응답 먼저 전송 (5xx → OTel HTTP semantic convention: ERROR span)
            send(ex, 500, "{\"error\":\"" + cause.getMessage() + "\"}");
            // re-throw → OTel agent가 exception을 span에 기록 (exception throw도 에러)
            throw new IOException(cause);
        }
    }

    static class DependencyHandler implements HttpHandler {
        private final int port;
        DependencyHandler(int port) { this.port = port; }

        public void handle(HttpExchange ex) throws IOException {
            // 내부 /ok 재호출 → multi-span trace 생성
            HttpURLConnection conn = (HttpURLConnection)
                new URL("http://127.0.0.1:" + port + "/ok").openConnection();
            conn.setRequestMethod("GET");
            conn.getResponseCode();
            conn.disconnect();
            send(ex, 200, "{\"status\":\"dependency-ok\"}");
        }
    }

    static class DbHandler implements HttpHandler {
        public void handle(HttpExchange ex) throws IOException {
            // OTel Java Agent의 jdbc module이 PreparedStatement를 자동 instrument
            // → span attributes: db.system=postgresql, db.statement=SELECT ...
            Connection conn = null;
            PreparedStatement ps = null;
            ResultSet rs = null;
            try {
                // SPI 미탐지 환경 대비 명시적 driver load (debian postgresql-jdbc jar 호환)
                try { Class.forName("org.postgresql.Driver"); } catch (ClassNotFoundException ignored) {}
                conn = DriverManager.getConnection(DB_URL, DB_USER, DB_PASSWORD);
                // 시스템 테이블 카운트 — 부가 라이브러리 없이 실행 가능
                ps = conn.prepareStatement(
                    "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = ?"
                );
                ps.setString(1, "public");
                rs = ps.executeQuery();
                long n = 0;
                if (rs.next()) n = rs.getLong("n");
                send(ex, 200, "{\"tables_in_public\":" + n + "}");
            } catch (Exception e) {
                e.printStackTrace();
                String msg = e.getMessage() != null ? e.getMessage().replace('"', '\'') : "null";
                send(ex, 500, "{\"error\":\"" + e.getClass().getSimpleName() + ": " + msg + "\"}");
            } finally {
                try { if (rs != null) rs.close(); } catch (Exception ignored) {}
                try { if (ps != null) ps.close(); } catch (Exception ignored) {}
                try { if (conn != null) conn.close(); } catch (Exception ignored) {}
            }
        }
    }
}
