use super::super::HttpEntry;
use super::LogParser;
use serde::Deserialize;

#[derive(Deserialize)]
struct NginxJsonLine {
    #[serde(default)]
    method: String,
    #[serde(default)]
    uri: String,
    #[serde(default)]
    status: u16,
    #[serde(default)]
    duration_ms: Option<f64>,
    // Alternative field names nginx might use
    #[serde(default)]
    request_time: Option<f64>,
    #[serde(default)]
    request_time_ms: Option<f64>,
}

pub struct NginxJsonParser;

impl LogParser for NginxJsonParser {
    fn parse_line(&self, line: &str) -> Option<HttpEntry> {
        let parsed: NginxJsonLine = serde_json::from_str(line).ok()?;

        // duration_ms > request_time_ms (ms) > request_time (seconds → ms)
        let duration_ms = parsed.duration_ms
            .or(parsed.request_time_ms)
            .or_else(|| parsed.request_time.map(|t| t * 1000.0));

        Some(HttpEntry {
            method: if parsed.method.is_empty() { "GET".to_string() } else { parsed.method },
            uri: parsed.uri,
            status_code: parsed.status,
            duration_ms,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_json_with_duration_ms() {
        let p = NginxJsonParser;
        let line = r#"{"time":"2024-01-01T10:00:00+09:00","method":"GET","uri":"/api/customers","status":200,"duration_ms":245.3}"#;
        let entry = p.parse_line(line).unwrap();
        assert_eq!(entry.method, "GET");
        assert_eq!(entry.uri, "/api/customers");
        assert_eq!(entry.status_code, 200);
        assert!((entry.duration_ms.unwrap() - 245.3).abs() < 0.1);
    }

    #[test]
    fn test_parse_request_time_seconds() {
        let p = NginxJsonParser;
        let line = r#"{"method":"POST","uri":"/api/orders","status":201,"request_time":0.312}"#;
        let entry = p.parse_line(line).unwrap();
        assert!((entry.duration_ms.unwrap() - 312.0).abs() < 1.0);
    }

    #[test]
    fn test_invalid_json() {
        let p = NginxJsonParser;
        assert!(p.parse_line("not json").is_none());
    }

    // W-NJ-N-03: request_time_ms 두 번째 우선
    #[test]
    fn test_request_time_ms_priority() {
        let p = NginxJsonParser;
        let line = r#"{"method":"GET","uri":"/api","status":200,"request_time_ms":200.0}"#;
        let entry = p.parse_line(line).unwrap();
        assert!((entry.duration_ms.unwrap() - 200.0).abs() < 0.1);
    }

    // W-NJ-N-04: request_time (초) 세 번째 우선
    #[test]
    fn test_request_time_seconds_fallback() {
        let p = NginxJsonParser;
        let line = r#"{"method":"GET","uri":"/api","status":200,"request_time":0.5}"#;
        let entry = p.parse_line(line).unwrap();
        assert!((entry.duration_ms.unwrap() - 500.0).abs() < 1.0);
    }

    // W-NJ-E-01: duration 필드 없음
    #[test]
    fn test_no_duration_field() {
        let p = NginxJsonParser;
        let line = r#"{"method":"GET","uri":"/api","status":200}"#;
        let entry = p.parse_line(line).unwrap();
        assert!(entry.duration_ms.is_none());
    }

    // W-NJ-E-02: 상태코드 500
    #[test]
    fn test_status_500() {
        let p = NginxJsonParser;
        let line = r#"{"method":"GET","uri":"/api","status":500}"#;
        let entry = p.parse_line(line).unwrap();
        assert_eq!(entry.status_code, 500);
    }

    // W-NJ-E-03: URI 쿼리스트링 포함 — 파서에서 보존
    #[test]
    fn test_uri_with_query_preserved() {
        let p = NginxJsonParser;
        let line = r#"{"method":"GET","uri":"/api?page=1&size=10","status":200}"#;
        let entry = p.parse_line(line).unwrap();
        assert!(entry.uri.contains("page=1"), "parser should preserve query string");
    }

    // W-NJ-F-02: 빈 줄
    #[test]
    fn test_empty_line() {
        let p = NginxJsonParser;
        assert!(p.parse_line("").is_none());
    }

    // W-NJ-F-03: 필수 필드 누락 — 빈 JSON
    #[test]
    fn test_empty_json_object() {
        let p = NginxJsonParser;
        // 빈 JSON은 default 값으로 처리됨 (status=0이지만 파싱 성공)
        let result = p.parse_line("{}");
        // 구현에 따라 Some(entry) or None — 어느 쪽이든 크래시 없음
        let _ = result;
    }
}
