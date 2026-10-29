package com.synapsev.agentt.log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.TimeZone;

/** Tiny file logger (UTC timestamps, 10MB rotation to one backup). Never throws, silent without a log dir. */
public final class AgentLog {
    private static final long MAX_BYTES = 10L * 1024 * 1024;
    private static final Object LOCK = new Object();
    private static final SimpleDateFormat FMT = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
    private static volatile int level = 1; // 0 debug, 1 info, 2 warn, 3 error
    private static File file;
    private static OutputStream out;
    private static long written;

    static {
        FMT.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    private AgentLog() { }

    public static void init(String dir) {
        synchronized (LOCK) {
            closeQuietly();
            file = null;
            if (dir == null || dir.length() == 0) {
                return;
            }
            try {
                File d = new File(dir);
                d.mkdirs();
                file = new File(d, "agent-t.log");
            } catch (Throwable t) {
                file = null;
            }
        }
    }

    public static void setLevel(String name) {
        if ("debug".equalsIgnoreCase(name)) {
            level = 0;
        } else if ("warn".equalsIgnoreCase(name)) {
            level = 2;
        } else if ("error".equalsIgnoreCase(name)) {
            level = 3;
        } else {
            level = 1;
        }
    }

    public static void debug(String m) {
        log(0, "DEBUG", m, null);
    }

    public static void info(String m) {
        log(1, "INFO", m, null);
    }

    public static void warn(String m) {
        log(2, "WARN", m, null);
    }

    public static void error(String m, Throwable t) {
        log(3, "ERROR", m, t);
    }

    private static void log(int lv, String tag, String msg, Throwable t) {
        if (lv < level) {
            return;
        }
        try {
            synchronized (LOCK) {
                if (file == null) {
                    return;
                }
                if (out == null) {
                    out = new FileOutputStream(file, true);
                    written = file.length();
                } else if (written > MAX_BYTES) {
                    closeQuietly();
                    File bak = new File(file.getPath() + ".1");
                    bak.delete();
                    file.renameTo(bak);
                    out = new FileOutputStream(file, true);
                    written = 0;
                }
                StringBuilder sb = new StringBuilder();
                sb.append(FMT.format(new Date())).append(' ').append(tag).append(' ').append(msg);
                if (t != null) {
                    sb.append(" | ").append(t);
                }
                sb.append('\n');
                byte[] b = sb.toString().getBytes("UTF-8");
                out.write(b);
                out.flush();
                written += b.length;
            }
        } catch (Throwable ignore) {
            // logging must never affect the host application
        }
    }

    private static void closeQuietly() {
        if (out != null) {
            try {
                out.close();
            } catch (IOException ignore) {
                // ignore
            }
            out = null;
        }
    }
}
