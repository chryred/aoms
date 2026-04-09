/// Common Log Format (CLF) parser — no response time field.
/// Format: `%h %l %u %t "%r" %>s %b`
use super::super::HttpEntry;
use super::LogParser;
use regex::Regex;
use std::sync::OnceLock;

static LINE_RE: OnceLock<Regex> = OnceLock::new();

fn line_re() -> &'static Regex {
    LINE_RE.get_or_init(|| {
        Regex::new(r#"^\S+ \S+ \S+ \[.+?\] "(\w+) ([^ "]+)[^"]*" (\d{3}) "#).unwrap()
    })
}

pub struct ClfParser;

impl LogParser for ClfParser {
    fn parse_line(&self, line: &str) -> Option<HttpEntry> {
        let caps = line_re().captures(line)?;
        Some(HttpEntry {
            method: caps.get(1)?.as_str().to_string(),
            uri: caps.get(2)?.as_str().to_string(),
            status_code: caps.get(3)?.as_str().parse().ok()?,
            duration_ms: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clf() {
        let p = ClfParser;
        let line = r#"127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /index.html HTTP/1.0" 200 2326"#;
        let entry = p.parse_line(line).unwrap();
        assert_eq!(entry.uri, "/index.html");
        assert!(entry.duration_ms.is_none());
    }
}
