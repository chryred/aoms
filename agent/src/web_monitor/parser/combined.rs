/// Apache/WebtOB Combined Log Format parser.
/// Supports:
///   - Standard Combined: `%h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-Agent}i"`
///   - With response time: `%h %l %u %t "%r" %>s %b %D` (%D = microseconds)
///   - Or `%h %l %u %t "%r" %>s %b %T` (%T = seconds, float)
///
/// Example:
///   127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326 1234567
use super::super::HttpEntry;
use super::LogParser;
use regex::Regex;
use std::sync::OnceLock;

static LINE_RE: OnceLock<Regex> = OnceLock::new();

fn line_re() -> &'static Regex {
    LINE_RE.get_or_init(|| {
        Regex::new(
            r#"^\S+ \S+ \S+ \[.+?\] "(\w+) ([^ "]+)[^"]*" (\d{3}) \S+(?: ".*?" ".*?")?(?: (\d+(?:\.\d+)?))?"#
        ).unwrap()
    })
}

pub struct CombinedParser;

impl LogParser for CombinedParser {
    fn parse_line(&self, line: &str) -> Option<HttpEntry> {
        let caps = line_re().captures(line)?;

        let method = caps.get(1)?.as_str().to_string();
        let uri = caps.get(2)?.as_str().to_string();
        let status_code: u16 = caps.get(3)?.as_str().parse().ok()?;

        // Optional response time field (last capture group)
        let duration_ms = caps.get(4).and_then(|m| {
            let val: f64 = m.as_str().parse().ok()?;
            // Heuristic: if > 10000, it's microseconds (%D); if < 100 and has decimal, it's seconds (%T)
            let ms = if val > 10_000.0 {
                val / 1000.0 // microseconds → ms
            } else if val < 100.0 && m.as_str().contains('.') {
                val * 1000.0 // seconds → ms
            } else {
                val // already ms or unknown unit
            };
            Some(ms)
        });

        Some(HttpEntry {
            method,
            uri,
            status_code,
            duration_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_standard_combined() {
        let p = CombinedParser;
        let line = r#"127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326 "-" "Mozilla/5.0""#;
        let entry = p.parse_line(line).unwrap();
        assert_eq!(entry.method, "GET");
        assert_eq!(entry.uri, "/apache_pb.gif");
        assert_eq!(entry.status_code, 200);
        assert!(entry.duration_ms.is_none());
    }

    #[test]
    fn test_with_microseconds() {
        let p = CombinedParser;
        let line = r#"192.168.1.1 - - [01/Jan/2024:10:00:00 +0900] "POST /api/orders HTTP/1.1" 201 512 245000"#;
        let entry = p.parse_line(line).unwrap();
        assert_eq!(entry.status_code, 201);
        // 245000 μs → 245 ms
        assert!((entry.duration_ms.unwrap() - 245.0).abs() < 1.0);
    }

    #[test]
    fn test_with_seconds() {
        let p = CombinedParser;
        let line = r#"10.0.0.1 - - [01/Jan/2024:10:00:00 +0000] "GET /api/health HTTP/1.1" 200 64 0.312"#;
        let entry = p.parse_line(line).unwrap();
        assert!((entry.duration_ms.unwrap() - 312.0).abs() < 1.0);
    }

    #[test]
    fn test_invalid() {
        let p = CombinedParser;
        assert!(p.parse_line("not a log line").is_none());
    }

    // W-CB-N-04: 정수 ms (100 이상) — as-is
    #[test]
    fn test_with_ms_integer() {
        let p = CombinedParser;
        let line = r#"10.0.0.1 - - [01/Jan/2024:10:00:00 +0000] "GET /api/health HTTP/1.1" 200 64 150"#;
        let entry = p.parse_line(line).unwrap();
        assert!((entry.duration_ms.unwrap() - 150.0).abs() < 1.0);
    }

    // W-CB-E-01: duration 필드 없음
    #[test]
    fn test_no_duration() {
        let p = CombinedParser;
        let line = r#"127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326 "-" "Mozilla/5.0""#;
        let entry = p.parse_line(line).unwrap();
        assert!(entry.duration_ms.is_none());
    }

    // W-CB-E-02: POST 메서드
    #[test]
    fn test_post_method() {
        let p = CombinedParser;
        let line = r#"10.0.0.1 - - [01/Jan/2024:10:00:00 +0000] "POST /api HTTP/1.1" 201 100"#;
        let entry = p.parse_line(line).unwrap();
        assert_eq!(entry.method, "POST");
    }

    // W-CB-E-03: 상태코드 301 리다이렉트
    #[test]
    fn test_redirect_status() {
        let p = CombinedParser;
        let line = r#"10.0.0.1 - - [01/Jan/2024:10:00:00 +0000] "GET /old HTTP/1.1" 301 0"#;
        let entry = p.parse_line(line).unwrap();
        assert_eq!(entry.status_code, 301);
    }

    // W-CB-F-02: 빈 줄
    #[test]
    fn test_empty_line() {
        let p = CombinedParser;
        assert!(p.parse_line("").is_none());
    }
}
