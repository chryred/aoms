package com.synapsev.agentt.transport;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Posts a gzip batch to {gateway}/t/v1/batch. Overridable so tests can substitute a mock. */
public class HttpPoster {
    public static final class Response {
        public final int status;
        public final String body;

        public Response(int status, String body) {
            this.status = status;
            this.body = body == null ? "" : body;
        }
    }

    private static final int MAX_RESPONSE = 1024 * 1024;
    private final String url;
    private final String token;

    public HttpPoster(String gatewayUrl, String token) {
        String g = gatewayUrl == null ? "" : gatewayUrl;
        while (g.endsWith("/")) {
            g = g.substring(0, g.length() - 1);
        }
        this.url = g + "/t/v1/batch";
        this.token = token;
    }

    public Response post(byte[] gzipJson) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setConnectTimeout(3000);
            c.setReadTimeout(10000);
            c.setDoOutput(true);
            c.setRequestMethod("POST");
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setRequestProperty("Content-Encoding", "gzip");
            c.setRequestProperty("Content-Type", "application/json");
            c.setFixedLengthStreamingMode(gzipJson.length);
            OutputStream os = c.getOutputStream();
            try {
                os.write(gzipJson);
            } finally {
                os.close();
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            return new Response(status, in == null ? "" : read(in));
        } finally {
            c.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int r;
            while ((r = in.read(buf)) > 0 && bos.size() < MAX_RESPONSE) {
                bos.write(buf, 0, r);
            }
            return new String(bos.toByteArray(), "UTF-8");
        } finally {
            in.close();
        }
    }
}
